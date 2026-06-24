export type TranscriptDisplayMode = 'original' | 'translated' | 'both';

export interface TranscriptSegment {
  segmentId: string;
  speaker: 'interviewer' | 'user';
  sourceText: string;
  translatedText?: string;
  timestamp: number;
  speakerLabel: string;
  translationState: 'pending' | 'complete' | 'error' | 'skipped';
  detectedLanguage?: string;
}

export function normalizeTranscriptForDuplicate(text: string): string {
  return (text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function longestCommonWordRun(left: string[], right: string[]): number {
  let best = 0;
  const dp = new Array(right.length + 1).fill(0);
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = right.length; j >= 1; j -= 1) {
      if (left[i - 1] === right[j - 1]) {
        dp[j] = dp[j - 1] + 1;
        if (dp[j] > best) best = dp[j];
      } else {
        dp[j] = 0;
      }
    }
  }
  return best;
}

export function areTranscriptTextsSimilar(left: string, right: string): boolean {
  const a = normalizeTranscriptForDuplicate(left);
  const b = normalizeTranscriptForDuplicate(right);
  if (!a || !b) return false;
  if (a === b) return true;

  const aWords = a.split(' ').filter(Boolean);
  const bWords = b.split(' ').filter(Boolean);
  const minWords = Math.min(aWords.length, bWords.length);
  if (minWords < 3) return false;

  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  const commonRun = longestCommonWordRun(aWords, bWords);
  if (commonRun >= 4 || (minWords <= 5 && commonRun >= Math.max(3, minWords - 1))) {
    return true;
  }
  if (minWords >= 4 && longer.includes(shorter) && shorter.length / Math.max(1, longer.length) >= 0.30) {
    return true;
  }

  const aSet = new Set(aWords);
  const bSet = new Set(bWords);
  const intersection = [...aSet].filter((word) => bSet.has(word)).length;
  const union = new Set([...aWords, ...bWords]).size;
  return union > 0 && (intersection / union >= 0.72 || intersection / Math.max(1, minWords) >= 0.78);
}

const CROSS_ROLE_DUPLICATE_WINDOW_MS = 8000;
const CROSS_ROLE_DUPLICATE_SCAN_LIMIT = 80;
const SEGMENT_ID_RECENT_SCAN_LIMIT = 160;

function isCrossRoleDuplicate(a: TranscriptSegment, b: TranscriptEventForSegment): boolean {
  if (!b.speaker || a.speaker === b.speaker) return false;
  const delta = Math.abs((b.timestamp ?? Date.now()) - a.timestamp);
  return delta <= CROSS_ROLE_DUPLICATE_WINDOW_MS && areTranscriptTextsSimilar(a.sourceText, b.sourceText || b.text);
}

function findRecentCrossRoleDuplicate(
  segments: TranscriptSegment[],
  event: TranscriptEventForSegment
): TranscriptSegment | undefined {
  const eventTimestamp = event.timestamp ?? Date.now();
  let scanned = 0;
  for (let i = segments.length - 1; i >= 0 && scanned < CROSS_ROLE_DUPLICATE_SCAN_LIMIT; i -= 1) {
    const item = segments[i];
    if (eventTimestamp - item.timestamp > CROSS_ROLE_DUPLICATE_WINDOW_MS) {
      break;
    }
    scanned += 1;
    if (isCrossRoleDuplicate(item, event)) {
      return item;
    }
  }
  return undefined;
}

function pruneRecentUserDuplicates(
  segments: TranscriptSegment[],
  event: TranscriptEventForSegment
): TranscriptSegment[] {
  const eventTimestamp = event.timestamp ?? Date.now();
  const duplicateIndexes = new Set<number>();
  let scanned = 0;

  for (let i = segments.length - 1; i >= 0 && scanned < CROSS_ROLE_DUPLICATE_SCAN_LIMIT; i -= 1) {
    const item = segments[i];
    if (eventTimestamp - item.timestamp > CROSS_ROLE_DUPLICATE_WINDOW_MS) {
      break;
    }
    scanned += 1;
    if (item.speaker === 'user' && isCrossRoleDuplicate(item, event)) {
      duplicateIndexes.add(i);
    }
  }

  if (duplicateIndexes.size === 0) {
    return segments;
  }
  return segments.filter((_, index) => !duplicateIndexes.has(index));
}

function insertTranscriptSegmentSorted(segments: TranscriptSegment[], segment: TranscriptSegment): TranscriptSegment[] {
  const last = segments[segments.length - 1];
  if (!last || segment.timestamp >= last.timestamp) {
    return [...segments, segment];
  }

  const insertAt = segments.findIndex((item) => item.timestamp > segment.timestamp);
  if (insertAt === -1) {
    return [...segments, segment];
  }

  return [
    ...segments.slice(0, insertAt),
    segment,
    ...segments.slice(insertAt),
  ];
}


function findTranscriptSegmentIndex(segments: TranscriptSegment[], segmentId: string, timestamp?: number): number {
  if (!segmentId) return -1;

  const lastIndex = segments.length - 1;
  if (lastIndex >= 0 && segments[lastIndex].segmentId === segmentId) {
    return lastIndex;
  }

  let scanned = 0;
  const eventTimestamp = timestamp ?? segments[lastIndex]?.timestamp ?? Date.now();
  for (let i = lastIndex; i >= 0 && scanned < SEGMENT_ID_RECENT_SCAN_LIMIT; i -= 1) {
    const item = segments[i];
    if (item.segmentId === segmentId) {
      return i;
    }
    if (eventTimestamp - item.timestamp > CROSS_ROLE_DUPLICATE_WINDOW_MS && scanned >= CROSS_ROLE_DUPLICATE_SCAN_LIMIT) {
      break;
    }
    scanned += 1;
  }

  // Translation retries can target an older visible row. Fall back only for bounded state,
  // never for an unbounded long-video transcript.
  if (segments.length <= SEGMENT_ID_RECENT_SCAN_LIMIT) {
    return segments.findIndex((item) => item.segmentId === segmentId);
  }
  return -1;
}

export interface TranscriptEventForSegment {
  final: boolean;
  text: string;
  sourceText?: string;
  translatedText?: string;
  segmentId?: string;
  /** When `speakerLabel` is omitted, defaults: interviewer -> Interviewer, user -> Me, unknown -> User 1 */
  speaker?: 'interviewer' | 'user';
  speakerLabel?: string;
  timestamp?: number;
  translationState?: 'pending' | 'complete' | 'error' | 'skipped';
  detectedLanguage?: string;
}

function defaultSpeakerLabelForEvent(event: TranscriptEventForSegment): string {
  if (event.speaker === 'user') return 'Me';
  if (event.speaker === 'interviewer') return 'Interviewer';
  return 'User 1';
}

export function upsertTranscriptSegment(
  segments: TranscriptSegment[],
  event: TranscriptEventForSegment
): TranscriptSegment[] {
  if (!event.final || !event.segmentId) {
    return segments;
  }

  const sourceText = (event.sourceText || event.text || '').trim();
  if (!sourceText) {
    return segments;
  }

  const speakerLabel = (event.speakerLabel?.trim() || defaultSpeakerLabelForEvent(event)).slice(0, 32);
  const translationState = event.translationState || 'skipped';

  const eventSpeaker = event.speaker === 'user' ? 'user' : 'interviewer';
  const normalizedEvent = { ...event, sourceText };
  const crossRoleDuplicate = findRecentCrossRoleDuplicate(segments, normalizedEvent);
  if (eventSpeaker === 'user' && crossRoleDuplicate?.speaker === 'interviewer') {
    return segments;
  }

  const prunedSegments = eventSpeaker === 'interviewer'
    ? pruneRecentUserDuplicates(segments, normalizedEvent)
    : segments;

  const index = findTranscriptSegmentIndex(prunedSegments, event.segmentId, event.timestamp);
  if (index === -1) {
    return insertTranscriptSegmentSorted(prunedSegments, {
      segmentId: event.segmentId,
      speaker: eventSpeaker,
      sourceText,
      translatedText: event.translatedText?.trim() || undefined,
      timestamp: event.timestamp ?? Date.now(),
      speakerLabel,
      translationState,
      detectedLanguage: event.detectedLanguage || undefined,
    });
  }

  const updated = [...prunedSegments];
  const existing = updated[index];
  updated[index] = {
    ...existing,
    speaker: eventSpeaker,
    sourceText,
    translatedText: event.translatedText?.trim() || existing.translatedText,
    timestamp: event.timestamp ?? existing.timestamp,
    speakerLabel: event.speakerLabel?.trim()
      ? event.speakerLabel.trim().slice(0, 32)
      : existing.speakerLabel,
    translationState: event.translationState || existing.translationState,
    detectedLanguage: event.detectedLanguage || existing.detectedLanguage,
  };
  return updated;
}
