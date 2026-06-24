import { useCallback, useEffect, useRef, useState } from 'react';
import { areTranscriptTextsSimilar, upsertTranscriptSegment, type TranscriptDisplayMode, type TranscriptSegment } from '../lib/transcriptSegments';

const MAX_LIVE_TRANSCRIPT_SEGMENTS = 1000;
const PARTIAL_TRANSCRIPT_MIN_INTERVAL_MS = 80;

function keepRecentTranscriptSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  return segments.length > MAX_LIVE_TRANSCRIPT_SEGMENTS
    ? segments.slice(-MAX_LIVE_TRANSCRIPT_SEGMENTS)
    : segments;
}

export function useMeetingTranscript() {
  const [transcriptSegments, setTranscriptSegments] = useState<TranscriptSegment[]>([]);
  const [isInterviewerSpeaking, setIsInterviewerSpeaking] = useState(false);
  const [currentInterviewerPartial, setCurrentInterviewerPartial] = useState('');
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  const [currentUserPartial, setCurrentUserPartial] = useState('');
  const [transcriptDisplayMode, setTranscriptDisplayMode] = useState<TranscriptDisplayMode>('original');
  const [showTranscript, setShowTranscript] = useState(() => {
    const stored = localStorage.getItem('pika_interviewer_transcript');
    return stored !== 'false';
  });
  const speakingTimeoutRef = useRef<number | null>(null);
  const currentInterviewerPartialRef = useRef('');
  const currentUserPartialRef = useRef('');
  const lastInterviewerPartialUpdateAtRef = useRef(0);
  const lastUserPartialUpdateAtRef = useRef(0);

  useEffect(() => { currentInterviewerPartialRef.current = currentInterviewerPartial; }, [currentInterviewerPartial]);
  useEffect(() => { currentUserPartialRef.current = currentUserPartial; }, [currentUserPartial]);

  const setInterviewerPartialIfChanged = useCallback((text: string, immediate = false) => {
    if (currentInterviewerPartialRef.current === text) return;
    const now = Date.now();
    if (!immediate && text && now - lastInterviewerPartialUpdateAtRef.current < PARTIAL_TRANSCRIPT_MIN_INTERVAL_MS) {
      currentInterviewerPartialRef.current = text;
      return;
    }
    lastInterviewerPartialUpdateAtRef.current = now;
    currentInterviewerPartialRef.current = text;
    setCurrentInterviewerPartial(text);
  }, []);

  const setUserPartialIfChanged = useCallback((text: string, immediate = false) => {
    if (currentUserPartialRef.current === text) return;
    const now = Date.now();
    if (!immediate && text && now - lastUserPartialUpdateAtRef.current < PARTIAL_TRANSCRIPT_MIN_INTERVAL_MS) {
      currentUserPartialRef.current = text;
      return;
    }
    lastUserPartialUpdateAtRef.current = now;
    currentUserPartialRef.current = text;
    setCurrentUserPartial(text);
  }, []);

  useEffect(() => {
    window.electronAPI?.getTranscriptTranslationSettings?.()
      .then((settings) => {
        if (settings?.displayMode) {
          setTranscriptDisplayMode(settings.displayMode);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    localStorage.setItem('pika_interviewer_transcript', String(showTranscript));
  }, [showTranscript]);

  useEffect(() => {
    const handleStorage = () => {
      const stored = localStorage.getItem('pika_interviewer_transcript');
      setShowTranscript(stored !== 'false');
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  useEffect(() => {
    if (!window.electronAPI?.onNativeAudioTranscript) return;

    return window.electronAPI.onNativeAudioTranscript((transcript) => {
      if (transcript.speaker === 'user') {
        setIsUserSpeaking(!transcript.final);

        if (transcript.final) {
          setUserPartialIfChanged('', true);
          const normalizedSegmentId =
            transcript.segmentId ||
            `user_${transcript.timestamp || Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

          setTranscriptSegments((prev) => {
            const nextSegments = upsertTranscriptSegment(prev, {
              final: true,
              text: transcript.text,
              sourceText: transcript.sourceText,
              translatedText: transcript.translatedText,
              segmentId: normalizedSegmentId,
              speaker: 'user',
              speakerLabel: 'Me',
              timestamp: transcript.timestamp,
              translationState: transcript.translationState,
              detectedLanguage: transcript.detectedLanguage,
            });
            return keepRecentTranscriptSegments(nextSegments);
          });

          if (transcript.displayMode) {
            setTranscriptDisplayMode(transcript.displayMode);
          }
        } else {
          if (areTranscriptTextsSimilar(transcript.text, currentInterviewerPartialRef.current)) {
            setIsUserSpeaking(false);
            setUserPartialIfChanged('', true);
          } else {
            setUserPartialIfChanged(transcript.text);
          }
        }
        return;
      }

      if (transcript.speaker !== 'interviewer') {
        return;
      }

      setIsInterviewerSpeaking(!transcript.final);

      if (transcript.final) {
        setInterviewerPartialIfChanged('', true);
        const normalizedSegmentId =
          transcript.segmentId || `legacy_${transcript.timestamp || Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const speakerFromPayload = transcript.speakerLabel?.trim();

        setTranscriptSegments((prev) => {
          const nextSegments = upsertTranscriptSegment(prev, {
            final: true,
            text: transcript.text,
            sourceText: transcript.sourceText,
            translatedText: transcript.translatedText,
            segmentId: normalizedSegmentId,
            speaker: 'interviewer',
            speakerLabel: speakerFromPayload || undefined,
            timestamp: transcript.timestamp,
            translationState: transcript.translationState,
            detectedLanguage: transcript.detectedLanguage,
          });
          return keepRecentTranscriptSegments(nextSegments);
        });

        if (transcript.displayMode) {
          setTranscriptDisplayMode(transcript.displayMode);
        }

        if (speakingTimeoutRef.current) {
          window.clearTimeout(speakingTimeoutRef.current);
        }
        speakingTimeoutRef.current = window.setTimeout(() => {
          setIsInterviewerSpeaking(false);
          speakingTimeoutRef.current = null;
        }, 3000);
      } else {
        if (areTranscriptTextsSimilar(transcript.text, currentUserPartialRef.current)) {
          setUserPartialIfChanged('', true);
          setIsUserSpeaking(false);
        }
        setInterviewerPartialIfChanged(transcript.text);
      }
    });
  }, [setInterviewerPartialIfChanged, setUserPartialIfChanged]);

  useEffect(() => {
    return () => {
      if (speakingTimeoutRef.current) {
        window.clearTimeout(speakingTimeoutRef.current);
      }
    };
  }, []);

  const handleTranslateTranscriptSegment = useCallback(async (segment: TranscriptSegment) => {
    try {
      const result = await window.electronAPI.translateTranscriptSegment({
        segmentId: segment.segmentId,
        text: segment.sourceText,
        speaker: segment.speakerLabel === 'Me' ? 'user' : 'interviewer',
        speakerLabel: segment.speakerLabel,
        timestamp: segment.timestamp,
      });

      if (!result?.success) {
        setTranscriptSegments((prev) => {
          const nextSegments = upsertTranscriptSegment(prev, {
            final: true,
            text: segment.sourceText,
            sourceText: segment.sourceText,
            segmentId: segment.segmentId,
            speakerLabel: segment.speakerLabel,
            timestamp: segment.timestamp,
            translationState: 'error',
          });
          return keepRecentTranscriptSegments(nextSegments);
        });
      }
    } catch {
      setTranscriptSegments((prev) => {
        const nextSegments = upsertTranscriptSegment(prev, {
          final: true,
          text: segment.sourceText,
          sourceText: segment.sourceText,
          segmentId: segment.segmentId,
          speakerLabel: segment.speakerLabel,
          timestamp: segment.timestamp,
          translationState: 'error',
        });
        return keepRecentTranscriptSegments(nextSegments);
      });
    }
  }, []);

  return {
    transcriptSegments,
    isInterviewerSpeaking,
    currentInterviewerPartial,
    isUserSpeaking,
    currentUserPartial,
    transcriptDisplayMode,
    setTranscriptDisplayMode,
    showTranscript,
    setShowTranscript,
    handleTranslateTranscriptSegment,
  };
}
