import { describe, expect, it } from 'vitest';
import {
  hasIntactPlaceholders,
  parseResegmentResponse,
  parseStructuredBatchResponse,
  stripThinkingTags,
} from '@/src/core/engines/parser';

describe('LLM Structured Response Parser & Thinking Stripper', () => {
  it('strips <think>...</think> blocks emitted by DeepSeek-R1 and Qwen3 local models', () => {
    const raw = `<think>Let me translate carefully into natural Chinese...</think>
\`\`\`json
{"items":[{"i":0,"t":"你好世界"},{"i":1,"t":"支持本地 Ollama"}]}
\`\`\``;

    expect(stripThinkingTags(raw)).not.toContain('Let me translate');
    const outcome = parseStructuredBatchResponse(raw, [
      { i: 0, text: 'Hello world' },
      { i: 1, text: 'Supports local Ollama' },
    ]);
    expect(outcome.missingIndices).toEqual([]);
    expect(outcome.matched.get(0)).toBe('你好世界');
    expect(outcome.matched.get(1)).toBe('支持本地 Ollama');
  });

  it('detects missing indices so self-healing retry can recover them', () => {
    const partialJson = '{"items":[{"i":10,"t":"第一句"}]}';
    const outcome = parseStructuredBatchResponse(partialJson, [
      { i: 10, text: 'First sentence' },
      { i: 11, text: 'Second sentence' },
    ]);
    expect(outcome.matched.get(10)).toBe('第一句');
    expect(outcome.missingIndices).toEqual([11]);
  });

  it('falls back to numbered line parsing when weak local models omit JSON wrapper', () => {
    const plain = `[0] 第一条译文\n[1] 第二条译文`;
    const outcome = parseStructuredBatchResponse(plain, [
      { i: 0, text: 'First' },
      { i: 1, text: 'Second' },
    ]);
    expect(outcome.missingIndices).toEqual([]);
    expect(outcome.matched.get(0)).toBe('第一条译文');
    expect(outcome.matched.get(1)).toBe('第二条译文');
  });

  it('validates <v id="n"/> protected inline placeholder integrity', () => {
    expect(hasIntactPlaceholders('Run <v id="0"/> now', '立即运行 <v id="0"/>')).toBe(true);
    expect(hasIntactPlaceholders('Run <v id="0"/> now', '立即运行')).toBe(false);
  });

  it('parses LLM ASR re-segmentation JSON safely and discards overlapping indices', () => {
    const raw = `<think>Segmenting...</think>{"segments":[{"startIdx":0,"endIdx":3,"text":"Hello world today."},{"startIdx":4,"endIdx":6,"text":"Let us begin."}]}`;
    const segs = parseResegmentResponse(raw, 7);
    expect(segs.length).toBe(2);
    expect(segs[0]).toEqual({ startIdx: 0, endIdx: 3, text: 'Hello world today.' });
    expect(segs[1]).toEqual({ startIdx: 4, endIdx: 6, text: 'Let us begin.' });
  });
});
