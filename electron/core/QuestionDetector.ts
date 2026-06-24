import type { TranscriptSegment } from './SessionTracker';

export type DetectedQuestionType = 'behavioral' | 'technical' | 'coding' | 'clarifying' | 'other';

export interface QuestionDetection {
    isQuestion: boolean;
    question: string;
    confidence: number;
    type: DetectedQuestionType;
    sourceSegmentIds: string[];
    reason: string;
    timestamp: number;
}

type BufferedInterviewerTurn = {
    text: string;
    timestamp: number;
    segmentId: string;
    confidence: number;
};

const FILLER_QUESTIONS = /^(right|okay|ok|yeah|yes|no|cool|great|good|sure|alright|you know|does that make sense)[?\s.!]*$/i;
const QUESTION_START = /\b(can|could|would|will|do|does|did|is|are|was|were|have|has|had|should|tell|walk|explain|describe|how|why|what|when|where|which)\b/i;
const CYRILLIC_QUESTION_START = /^\s*(?:а|и|ну|так|тогда|же|вот)?\s*(?:как|почему|зачем|что|чем|где|когда|куда|откуда|кто|кого|кому|какой|какая|какое|какие|каким|какими|сколько|можешь|можете|можно|нужно|надо)(?=$|[\s,;:.!?])/iu;
const QUESTION_PHRASES = [
    /\b(tell me about|walk me through|explain how|describe how|what are|what is|what would|what do|what did|what have)\b/i,
    /\b(how would you|how do you|how did you|why do you|why did you|can you|could you|would you)\b/i,
    /\b(have you ever|do you have experience|what was your role|what did you learn)\b/i,
    /\b(what are the trade[- ]offs|how would you design|how would you debug|how would you test)\b/i,
    /^\s*(?:а|и|ну|так|тогда|же|вот)?\s*(?:как|почему|зачем|что|где|когда|какой|какая|какие|можешь|можете|можно|нужно)(?=$|[\s,;:.!?])/iu,
    /\b(?:как\s+(?:же\s+)?(?:работает|устроен|формируется|формулируется)|что\s+происходит|почему\s+(?:это|так)|можешь\s+объяснить|можете\s+объяснить|расскажи(?:те)?\s+как)\b/iu,
];
const CODING_SIGNALS = [
    /\b(implement|write|code|solve|design|build|create|debug|optimize)\b/i,
    /\b(array|string|list|tree|graph|matrix|integer|node|linked list|stack|queue|heap|hash map)\b/i,
    /\b(return|find|count|calculate|maximize|minimize|sort|search|traverse)\b/i,
    /\b(time complexity|space complexity|O\(n\)|algorithm|data structure|dynamic programming|binary search|BFS|DFS)\b/i,
];
const TECHNICAL_SIGNALS = /\b(system design|architecture|database|cache|queue|api|service|microservice|react|typescript|javascript|node|python|sql|aws|kubernetes|docker|latency|scalability|consistency|index|transaction)\b/i;
const CYRILLIC_TECHNICAL_SIGNALS = /(?:архитектур|база\s+данных|бд|кэш|кеш|очеред|api|апи|сервис|микросервис|браузер|запрос|ответ|http|https|сервер|клиент|индекс|транзакц|латентност|масштабируем|консистентн|алгоритм|структур[аы]\s+данных)/iu;
const BEHAVIORAL_SIGNALS = /\b(tell me about a time|conflict|challenge|failure|strength|weakness|leadership|team|stakeholder|priority|deadline|project you worked on)\b/i;
const CLARIFYING_SIGNALS = /\b(can you clarify|could you clarify|what do you mean|did you mean|are you asking)\b/i;

function normalizeQuestionKey(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 220);
}

function compactWhitespace(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}


function questionKeysAreSimilar(left: string, right: string): boolean {
    const a = normalizeQuestionKey(left);
    const b = normalizeQuestionKey(right);
    if (!a || !b) return false;
    if (a === b) return true;
    const aWords = a.split(' ').filter(Boolean);
    const bWords = b.split(' ').filter(Boolean);
    const minWords = Math.min(aWords.length, bWords.length);
    if (minWords < 4) return false;
    const shorter = a.length <= b.length ? a : b;
    const longer = a.length <= b.length ? b : a;
    if (longer.includes(shorter) && shorter.length / Math.max(1, longer.length) >= 0.52) return true;
    const aSet = new Set(aWords);
    const bSet = new Set(bWords);
    const overlap = [...aSet].filter((word) => bSet.has(word)).length;
    const union = new Set([...aWords, ...bWords]).size;
    return union > 0 && overlap / union >= 0.74;
}

function isMeaningfullyFullerQuestion(candidate: string, previous: string): boolean {
    const a = normalizeQuestionKey(candidate);
    const b = normalizeQuestionKey(previous);
    if (!a || !b || a === b) return false;
    const aWords = a.split(' ').length;
    const bWords = b.split(' ').length;
    const hasBetterEnding = /[?？]\s*$/.test(candidate) && !/[?？]\s*$/.test(previous);
    return (a.includes(b) && aWords >= bWords + 3) || hasBetterEnding;
}

function mergeQuestionText(existing: string, incoming: string): string {
    const left = compactWhitespace(existing);
    const right = compactWhitespace(incoming);
    if (!left) return right;
    if (!right) return left;
    if (left === right || left.endsWith(right)) return left;
    if (right.startsWith(left)) return right;
    if (questionKeysAreSimilar(left, right) && !isMeaningfullyFullerQuestion(right, left)) return left;

    const leftWords = left.split(/\s+/);
    const rightWords = right.split(/\s+/);
    const maxOverlap = Math.min(14, leftWords.length, rightWords.length);
    for (let overlap = maxOverlap; overlap >= 3; overlap -= 1) {
        if (leftWords.slice(-overlap).join(' ').toLowerCase() === rightWords.slice(0, overlap).join(' ').toLowerCase()) {
            return `${leftWords.join(' ')} ${rightWords.slice(overlap).join(' ')}`.trim();
        }
    }
    return `${left} ${right}`.trim();
}

function splitSentences(text: string): string[] {
    return compactWhitespace(text)
        .split(/(?<=[?!.])\s+/)
        .map((s) => s.trim())
        .filter(Boolean);
}

function hasQuestionStart(text: string): boolean {
    return QUESTION_START.test(text) || CYRILLIC_QUESTION_START.test(text);
}

function hasTechnicalSignal(text: string): boolean {
    return TECHNICAL_SIGNALS.test(text) || CYRILLIC_TECHNICAL_SIGNALS.test(text);
}

function hasSetupSignal(text: string): boolean {
    return /(?:given|suppose|imagine|scenario|problem|requirement|constraint|input|output|array|string|service|api|database|queue|cache|architecture|представим|допустим|например|задача|требован|ограничен|вход|выход|массив|строка|сервис|база|очеред|кэш|кеш|архитектур|браузер|запрос)/iu.test(text);
}

function pickQuestionCandidate(text: string): string {
    const normalized = compactWhitespace(text);
    const sentences = splitSentences(normalized);
    if (sentences.length === 0) return normalized;

    let anchorIndex = -1;
    for (let i = sentences.length - 1; i >= 0; i -= 1) {
        if (/[?？]/.test(sentences[i]) || QUESTION_PHRASES.some((r) => r.test(sentences[i])) || hasQuestionStart(sentences[i])) {
            anchorIndex = i;
            break;
        }
    }
    if (anchorIndex === -1) return sentences.slice(-3).join(' ');

    const selected = sentences.slice(anchorIndex);
    const previous = sentences[anchorIndex - 1];
    if (previous && hasSetupSignal(previous) && !/[?？]/.test(previous)) {
        selected.unshift(previous);
    }
    return selected.slice(-3).join(' ');
}

function assembleBufferedQuestionText(turns: BufferedInterviewerTurn[]): string {
    return turns.reduce((merged, turn) => mergeQuestionText(merged, turn.text), '');
}

function classifyQuestion(text: string): DetectedQuestionType {
    if (CLARIFYING_SIGNALS.test(text)) return 'clarifying';
    const codingSignalCount = CODING_SIGNALS.filter((r) => r.test(text)).length;
    const technicalSignalPresent = hasTechnicalSignal(text);
    const hasAlgorithmicSubject = /\b(array|string|list|tree|graph|matrix|integer|node|linked list|stack|heap|algorithm|data structure|time complexity|space complexity|O\(n\)|dynamic programming|binary search|BFS|DFS)\b/i.test(text);
    if (technicalSignalPresent && !hasAlgorithmicSubject) return 'technical';
    if (codingSignalCount >= 2) return 'coding';
    if (technicalSignalPresent) return 'technical';
    if (BEHAVIORAL_SIGNALS.test(text)) return 'behavioral';
    return 'other';
}

function extractLikelyQuestion(text: string): { question: string; reason: string; score: number } | null {
    const normalized = compactWhitespace(text);
    if (!normalized || normalized.length < 12 || FILLER_QUESTIONS.test(normalized)) return null;

    const candidate = pickQuestionCandidate(normalized);

    let score = 0;
    const reasons: string[] = [];

    if (/[?？]/.test(candidate)) {
        score += 0.42;
        reasons.push('question mark');
    }
    const phraseMatches = QUESTION_PHRASES.filter((r) => r.test(candidate)).length;
    if (phraseMatches > 0) {
        score += 0.18 + Math.min(phraseMatches, 2) * 0.08;
        reasons.push('interview question phrasing');
    }
    if (hasQuestionStart(candidate)) {
        score += 0.16;
        reasons.push('question starter');
    }
    const codingMatches = CODING_SIGNALS.filter((r) => r.test(candidate)).length;
    if (codingMatches >= 2) {
        score += 0.22;
        reasons.push('coding/technical task signals');
    }
    if (hasTechnicalSignal(candidate)) {
        score += 0.1;
        reasons.push('technical topic');
    }
    if (BEHAVIORAL_SIGNALS.test(candidate)) {
        score += 0.12;
        reasons.push('behavioral interview wording');
    }

    const wordCount = candidate.split(/\s+/).length;
    if (wordCount < 3) score -= 0.25;
    if (wordCount >= 5) score += 0.04;
    if (wordCount >= 7) score += 0.08;
    if (wordCount >= 18) score += 0.05;

    if (score < 0.5) return null;

    return {
        question: candidate.replace(/^[,;:\-\s]+/, ''),
        reason: reasons.join(', ') || 'question heuristic',
        score: Math.max(0, Math.min(0.98, score)),
    };
}

function isSafePartialDetection(question: string, score: number, audioConfidence?: number): boolean {
    const wordCount = question.split(/\s+/).filter(Boolean).length;
    if (wordCount < 5) return false;
    if (score < 0.68) return false;
    if (typeof audioConfidence === 'number' && Number.isFinite(audioConfidence) && audioConfidence < 0.7) return false;

    const hasExplicitQuestionMark = /[?？]/.test(question);
    const hasInterviewPhrase = QUESTION_PHRASES.some((r) => r.test(question));
    const hasCodingTask = CODING_SIGNALS.filter((r) => r.test(question)).length >= 2;
    const hasTechnicalQuestion = hasQuestionStart(question) && hasTechnicalSignal(question);
    return hasExplicitQuestionMark || hasInterviewPhrase || hasCodingTask || hasTechnicalQuestion || BEHAVIORAL_SIGNALS.test(question);
}

export class QuestionDetector {
    private readonly bufferWindowMs: number;
    private readonly maxBufferedTurns: number;
    private readonly duplicateWindowMs: number;
    private readonly allowPartialTranscript: boolean;
    private buffer: BufferedInterviewerTurn[] = [];
    private lastQuestionKey: string | null = null;
    private lastQuestionText: string | null = null;
    private lastQuestionAt = 0;

    constructor(options?: { bufferWindowMs?: number; maxBufferedTurns?: number; duplicateWindowMs?: number; allowPartialTranscript?: boolean }) {
        this.bufferWindowMs = options?.bufferWindowMs ?? 45_000;
        this.maxBufferedTurns = options?.maxBufferedTurns ?? 4;
        this.duplicateWindowMs = options?.duplicateWindowMs ?? 120_000;
        this.allowPartialTranscript = options?.allowPartialTranscript === true;
    }

    detect(segment: TranscriptSegment & { segmentId?: string }): QuestionDetection | null {
        if (segment.speaker !== 'interviewer') return null;
        const isFinal = segment.final !== false;
        if (!isFinal && !this.allowPartialTranscript) return null;
        const text = compactWhitespace(segment.text || '');
        if (!text || FILLER_QUESTIONS.test(text)) return null;

        const now = segment.timestamp || Date.now();
        const segmentId = segment.segmentId || `interviewer_${now}_${this.buffer.length}`;
        this.buffer.push({
            text,
            timestamp: now,
            segmentId,
            confidence: typeof segment.confidence === 'number' ? segment.confidence : 0.8,
        });
        const cutoff = now - this.bufferWindowMs;
        this.buffer = this.buffer.filter((turn) => turn.timestamp >= cutoff).slice(-this.maxBufferedTurns);

        const current = extractLikelyQuestion(text);
        const combinedText = assembleBufferedQuestionText(this.buffer);
        const combined = this.buffer.length > 1 ? extractLikelyQuestion(combinedText) : null;
        const picked = current && (!combined || current.score >= combined.score - 0.08) ? current : combined;
        if (!picked) return null;
        if (!isFinal && !isSafePartialDetection(picked.question, picked.score, segment.confidence)) return null;

        const key = normalizeQuestionKey(picked.question);
        if (!key) return null;
        if (this.lastQuestionKey && now - this.lastQuestionAt < this.duplicateWindowMs && questionKeysAreSimilar(this.lastQuestionKey, key)) {
            if (!this.lastQuestionText || !isMeaningfullyFullerQuestion(picked.question, this.lastQuestionText)) {
                return null;
            }
        }

        this.lastQuestionKey = key;
        this.lastQuestionText = picked.question;
        this.lastQuestionAt = now;
        const avgAudioConfidence = this.buffer.reduce((sum, turn) => sum + turn.confidence, 0) / Math.max(1, this.buffer.length);
        const confidence = Math.max(0.5, Math.min(0.99, picked.score * 0.78 + avgAudioConfidence * 0.22));

        return {
            isQuestion: true,
            question: picked.question,
            confidence,
            type: classifyQuestion(picked.question),
            sourceSegmentIds: this.buffer.map((turn) => turn.segmentId),
            reason: picked.reason,
            timestamp: now,
        };
    }

    reset(): void {
        this.buffer = [];
        this.lastQuestionKey = null;
        this.lastQuestionText = null;
        this.lastQuestionAt = 0;
    }
}

export function detectQuestionFromText(text: string): QuestionDetection | null {
    const detector = new QuestionDetector();
    return detector.detect({
        speaker: 'interviewer',
        text,
        timestamp: Date.now(),
        final: true,
        confidence: 0.9,
    });
}
