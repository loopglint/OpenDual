import { describe, expect, it } from 'vitest';
import {
  applyLlmResegmentation,
  parseWebVtt,
  parseYouTubeJson3,
  smartResegmentCues,
} from '@/src/core/video/core/segmenter';
import { exportCuesToSrt, exportCuesToVtt } from '@/src/core/video/core/exporter';
import { findActiveCue } from '@/src/core/video/overlay/SubtitleOverlay';
import type { YtJson3Payload } from '@/src/core/video/core/types';

describe('Video Subtitle Parser & Smart Re-Segmentation', () => {
  it('parses YouTube json3 ASR rolling captions, isolates [Music], and deduplicates overlaps', () => {
    const sample: YtJson3Payload = {
      events: [
        { tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: '[Music]' }] },
        {
          tStartMs: 2200,
          dDurationMs: 2100,
          wWinId: 1,
          segs: [
            { utf8: 'Welcome', tOffsetMs: 0 },
            { utf8: ' back', tOffsetMs: 350 },
            { utf8: ' to', tOffsetMs: 650 },
            { utf8: ' our', tOffsetMs: 900 },
            { utf8: ' deep', tOffsetMs: 1200 },
            { utf8: ' dive.', tOffsetMs: 1550 },
          ],
        },
        // Rolling duplicate event
        {
          tStartMs: 2250,
          dDurationMs: 2000,
          wWinId: 1,
          aAppend: 1,
          segs: [{ utf8: 'Welcome back to our deep dive.' }],
        },
        {
          tStartMs: 5200,
          dDurationMs: 2600,
          wWinId: 1,
          segs: [
            { utf8: 'Today', tOffsetMs: 0 },
            { utf8: ' we', tOffsetMs: 300 },
            { utf8: ' build', tOffsetMs: 600 },
            { utf8: ' a', tOffsetMs: 900 },
            { utf8: ' translator.', tOffsetMs: 1200 },
          ],
        },
      ],
    };

    const parsed = parseYouTubeJson3(sample, true);
    expect(parsed.needsAsrResegment).toBe(true);
    expect(parsed.rawCues[0]?.isNonSpeech).toBe(true);
    expect(parsed.rawCues[0]?.source).toBe('[Music]');

    const segmented = smartResegmentCues(parsed.rawCues);
    expect(segmented.length).toBe(3);
    expect(segmented[0]?.source).toBe('[Music]');
    expect(segmented[1]?.source).toBe('Welcome back to our deep dive.');
    expect(segmented[2]?.source).toBe('Today we build a translator.');

    // Timestamps must remain strictly monotonic and non-overlapping
    for (let i = 1; i < segmented.length; i++) {
      expect(segmented[i]!.startMs).toBeGreaterThanOrEqual(segmented[i - 1]!.endMs);
    }
  });

  it('merges fragmented mid-sentence cues into complete sentences and splits overly long ones cleanly', () => {
    const fragmented = [
      { id: 1, startMs: 0, endMs: 1100, source: 'When you design' },
      { id: 2, startMs: 1120, endMs: 2200, source: 'a Chrome extension,' },
      { id: 3, startMs: 2230, endMs: 3600, source: 'clean subtitles matter.' },
      { id: 4, startMs: 4600, endMs: 5800, source: 'Next sentence starts after pause.' },
    ];

    const merged = smartResegmentCues(fragmented);
    expect(merged.length).toBe(2);
    expect(merged[0]?.source).toBe('When you design a Chrome extension, clean subtitles matter.');
    expect(merged[0]?.startMs).toBe(0);
    expect(merged[1]?.source).toBe('Next sentence starts after pause.');
  });

  it('parses WebVTT with HTML cue tags and rolling duplicates cleanly', () => {
    const vtt = `WEBVTT

00:00:01.000 --> 00:00:03.200 align:start position:0%
<c.colorE5E5E5>Hello</c> <i>world</i>

00:00:03.200 --> 00:00:05.500
Hello world how are you?

00:00:06.000 --> 00:00:08.500
This is X video caption.
`;
    const cues = parseWebVtt(vtt);
    expect(cues.length).toBe(3);
    expect(cues[0]?.source).toBe('Hello world');
    expect(cues[1]?.source).toBe('how are you?');
    expect(cues[2]?.source).toBe('This is X video caption.');
  });

  it('maps LLM semantic re-segmentation back to exact word timestamps', () => {
    const tokens = [
      { text: 'hello', startMs: 100, endMs: 400 },
      { text: 'everyone', startMs: 420, endMs: 900 },
      { text: 'lets', startMs: 1100, endMs: 1400 },
      { text: 'start', startMs: 1450, endMs: 1950 },
    ];
    const cues = applyLlmResegmentation(tokens, [
      { startIdx: 0, endIdx: 1, text: 'Hello everyone.' },
      { startIdx: 2, endIdx: 3, text: "Let's start." },
    ]);
    expect(cues.length).toBe(2);
    expect(cues[0]?.startMs).toBe(100);
    expect(cues[1]?.startMs).toBe(1100);
    expect(cues[1]?.endMs).toBeGreaterThanOrEqual(1950);
  });

  it('exports valid bilingual SRT / VTT and finds active cue via binary search', () => {
    const cues = [
      { id: 1, startMs: 1000, endMs: 3500, source: 'Hello world', target: '你好世界' },
      { id: 2, startMs: 4000, endMs: 6500, source: 'Good morning', target: '早上好' },
    ];
    expect(findActiveCue(cues, 2000)?.id).toBe(1);
    expect(findActiveCue(cues, 3800)).toBeNull();
    expect(findActiveCue(cues, 5000)?.id).toBe(2);

    const srt = exportCuesToSrt(cues, 'target-top');
    expect(srt).toContain('00:00:01,000 --> 00:00:03,500\n你好世界\nHello world');

    const vtt = exportCuesToVtt(cues, 'source-top');
    expect(vtt).toContain('WEBVTT');
    expect(vtt).toContain('00:00:04.000 --> 00:00:06.500\nGood morning\n早上好');
  });
});
