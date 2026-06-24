import { readFileSync } from 'node:fs';
import path from 'node:path';
import t from 'tap';
import { upsertTranscriptSegment } from '../src/lib/transcriptSegments';
import { buildTranscriptTranslationPrompt, isTranscriptTranslationConfigured } from '../electron/transcript/translationExecutor';

t.test('upsertTranscriptSegment appends and patches by segmentId', (t) => {
  const initial = upsertTranscriptSegment([], {
    final: true,
    text: 'hello world',
    sourceText: 'hello world',
    segmentId: 'seg_1',
  });

  t.equal(initial.length, 1, 'creates one segment');
  t.equal(initial[0].sourceText, 'hello world', 'stores source text');
  t.equal(initial[0].speakerLabel, 'User 1', 'defaults speaker label');

  const patched = upsertTranscriptSegment(initial, {
    final: true,
    text: 'hello world',
    sourceText: 'hello world',
    translatedText: '你好，世界',
    segmentId: 'seg_1',
  });

  t.equal(patched.length, 1, 'does not duplicate segment');
  t.equal(patched[0].translatedText, '你好，世界', 'patches translated text');
  t.equal(patched[0].speakerLabel, 'User 1', 'preserves speaker label when not sent again');
  t.end();
});

t.test('upsertTranscriptSegment accepts custom speakerLabel', (t) => {
  const rows = upsertTranscriptSegment([], {
    final: true,
    text: 'hi',
    segmentId: 'seg_x',
    speakerLabel: 'User 2',
  });
  t.equal(rows[0].speakerLabel, 'User 2');
  t.end();
});

t.test('upsertTranscriptSegment defaults interviewer label when speaker is interviewer', (t) => {
  const rows = upsertTranscriptSegment([], {
    final: true,
    text: 'hello',
    segmentId: 'seg_int',
    speaker: 'interviewer',
  });
  t.equal(rows[0].speakerLabel, 'Interviewer');
  t.end();
});

t.test('upsertTranscriptSegment defaults user label when speaker is user', (t) => {
  const rows = upsertTranscriptSegment([], {
    final: true,
    text: 'hello',
    segmentId: 'seg_u',
    speaker: 'user',
  });
  t.equal(rows[0].speakerLabel, 'Me');
  t.end();
});


t.test('upsertTranscriptSegment keeps long transcript updates bounded to recent duplicate window', (t) => {
  let rows = [] as ReturnType<typeof upsertTranscriptSegment>;
  for (let i = 0; i < 500; i += 1) {
    rows = upsertTranscriptSegment(rows, {
      final: true,
      text: `interviewer turn ${i} unique words for long running video workload`,
      sourceText: `interviewer turn ${i} unique words for long running video workload`,
      segmentId: `seg_${i}`,
      speaker: 'interviewer',
      timestamp: 1_700_000_000_000 + i * 1000,
    });
  }

  const before = Date.now();
  const updated = upsertTranscriptSegment(rows, {
    final: true,
    text: 'latest question with unique bounded scan words',
    sourceText: 'latest question with unique bounded scan words',
    segmentId: 'seg_latest',
    speaker: 'interviewer',
    timestamp: 1_700_000_600_000,
  });

  t.equal(updated.length, 501, 'appends new segment');
  t.ok(Date.now() - before < 100, 'long transcript update remains bounded');
  t.end();
});

t.test('rolling transcript source caps rendered rows for long meetings', (t) => {
  const source = readFileSync(path.join(process.cwd(), 'src/components/ui/RollingTranscript.tsx'), 'utf8');
  t.match(source, /MAX_RENDERED_TRANSCRIPT_SEGMENTS = 240/, 'rendered transcript rows are capped');
  t.match(source, /visibleSegments\.map/, 'component maps the visible tail instead of the full transcript');
  t.match(source, /older entries remain saved/, 'UI explains older transcript entries are preserved');
  t.end();
});

t.test('translation executor helpers validate config and build prompt', (t) => {
  t.equal(isTranscriptTranslationConfigured(true, 'qwen2.5:7b', 'Translate to Chinese'), true, 'valid config passes');
  t.equal(isTranscriptTranslationConfigured(true, '', 'Translate to Chinese'), false, 'missing model fails');
  t.equal(isTranscriptTranslationConfigured(false, 'qwen2.5:7b', 'Translate to Chinese'), false, 'disabled translation fails');

  const prompt = buildTranscriptTranslationPrompt('Translate to Chinese', 'hello world');
  t.match(prompt, /Source text:/, 'prompt includes source text header');
  t.match(prompt, /hello world/, 'prompt includes source text body');
  t.match(prompt, /Return translated text only/, 'prompt enforces clean output');
  t.end();
});

t.test('transcript segment id lookups avoid full scans during long video streams', (t) => {
  const source = readFileSync(path.join(process.cwd(), 'src/lib/transcriptSegments.ts'), 'utf8');
  t.match(source, /SEGMENT_ID_RECENT_SCAN_LIMIT = 160/, 'segment id lookup has a recent scan cap');
  t.match(source, /findTranscriptSegmentIndex/, 'upsert uses a bounded segment id lookup helper');
  t.match(source, /segments\.length <= SEGMENT_ID_RECENT_SCAN_LIMIT/, 'full id scan is allowed only for bounded small state');
  t.notMatch(source, /const index = prunedSegments\.findIndex\(\(item\) => item\.segmentId === event\.segmentId\)/, 'hot upsert path no longer always scans the full transcript');
  t.end();
});
