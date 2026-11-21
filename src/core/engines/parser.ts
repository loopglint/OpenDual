import { EngineError, type ResegmentSegment, type TranslateItem } from './types';

/**
 * Strips chain-of-thought reasoning blocks emitted by local/cloud thinking models
 * (e.g. DeepSeek-R1, Qwen3 <think>...</think>).
 */
export function stripThinkingTags(raw: string): string {
  if (!raw) return '';
  let cleaned = raw.replace(/<think>[\s\S]*?<\/think>/gi, '');
  // Handle unclosed <think> if model truncated before closing
  const openIdx = cleaned.search(/<think>/i);
  if (openIdx !== -1) {
    cleaned = cleaned.slice(0, openIdx);
  }
  return cleaned.trim();
}

function stripMarkdownFences(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) {
    return fenced[1].trim();
  }
  return raw.trim();
}

function tryExtractJson(raw: string): unknown | null {
  const candidate = stripMarkdownFences(stripThinkingTags(raw));
  if (!candidate) return null;

  try {
    return JSON.parse(candidate);
  } catch {
    // Attempt extracting outermost JSON object or array
    const firstBrace = candidate.indexOf('{');
    const lastBrace = candidate.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
      } catch {
        // continue
      }
    }
    const firstBracket = candidate.indexOf('[');
    const lastBracket = candidate.lastIndexOf(']');
    if (firstBracket !== -1 && lastBracket > firstBracket) {
      try {
        return JSON.parse(candidate.slice(firstBracket, lastBracket + 1));
      } catch {
        // continue
      }
    }
  }
  return null;
}

export interface ParsedBatchOutcome {
  matched: Map<number, string>;
  missingIndices: number[];
}

function extractPlaceholderIds(text: string): string[] {
  const ids: string[] = [];
  const regex = /<v\s+id="(\d+)"\s*\/>/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (m[1] !== undefined) ids.push(m[1]);
  }
  return ids;
}

/**
 * Validates that every <v id="n"/> protected inline placeholder from the source survived intact.
 */
export function hasIntactPlaceholders(source: string, translated: string): boolean {
  const expected = extractPlaceholderIds(source);
  if (expected.length === 0) return true;
  for (const id of expected) {
    const pattern = new RegExp(`<v\\s+id=["']${id}["']\\s*\\/?>`);
    if (!pattern.test(translated)) return false;
  }
  return true;
}

/**
 * Parses LLM structured batch response (JSON object {"items":[...]}, bare JSON array,
 * or fallback numbered line protocol "[i] translation") and validates 1:1 index alignment.
 */
export function parseStructuredBatchResponse(
  rawResponse: string,
  expectedItems: TranslateItem[],
): ParsedBatchOutcome {
  const expectedMap = new Map<number, string>(expectedItems.map((it) => [it.i, it.text]));
  const matched = new Map<number, string>();

  const parsed = tryExtractJson(rawResponse);
  let arrayLike: unknown[] | null = null;

  if (Array.isArray(parsed)) {
    arrayLike = parsed;
  } else if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.items)) {
      arrayLike = obj.items;
    } else if (Array.isArray(obj.translations)) {
      arrayLike = obj.translations;
    } else if (Array.isArray(obj.results)) {
      arrayLike = obj.results;
    }
  }

  if (arrayLike) {
    for (let idx = 0; idx < arrayLike.length; idx++) {
      const entry = arrayLike[idx];
      if (entry && typeof entry === 'object') {
        const rec = entry as Record<string, unknown>;
        const idRaw = rec.i ?? rec.id ?? rec.index;
        const textRaw = rec.t ?? rec.text ?? rec.translation;
        const idNum = typeof idRaw === 'number' ? idRaw : typeof idRaw === 'string' ? Number(idRaw) : NaN;
        if (Number.isFinite(idNum) && expectedMap.has(idNum) && typeof textRaw === 'string') {
          matched.set(idNum, textRaw.trim());
        }
      } else if (typeof entry === 'string' && arrayLike.length === expectedItems.length) {
        const exp = expectedItems[idx];
        if (exp) matched.set(exp.i, entry.trim());
      }
    }
  } else {
    // Fallback: parse numbered lines like `[0] 译文内容` or `0: 译文内容`
    const cleaned = stripMarkdownFences(stripThinkingTags(rawResponse));
    const lines = cleaned.split(/\r?\n/);
    for (const line of lines) {
      const m = line.match(/^\s*\[?(\d+)\]?\s*[:\-.)]?\s+(.+)$/);
      if (m && m[1] !== undefined && m[2] !== undefined) {
        const idNum = Number(m[1]);
        if (expectedMap.has(idNum)) {
          matched.set(idNum, m[2].trim());
        }
      }
    }
    // Single-item plain text fallback when only 1 item was requested
    if (matched.size === 0 && expectedItems.length === 1 && cleaned.length > 0 && expectedItems[0]) {
      matched.set(expectedItems[0].i, cleaned);
    }
  }

  const missingIndices: number[] = [];
  for (const item of expectedItems) {
    const trans = matched.get(item.i);
    if (!trans || trans.length === 0) {
      missingIndices.push(item.i);
    }
  }

  return { matched, missingIndices };
}

export function parseResegmentResponse(
  rawResponse: string,
  totalTokens: number,
): ResegmentSegment[] {
  const parsed = tryExtractJson(rawResponse);
  if (!parsed || typeof parsed !== 'object') {
    throw new EngineError('智能断句 JSON 解析失败', 'PARSE_ERROR', { retryable: false });
  }
  const rec = parsed as Record<string, unknown>;
  const list = Array.isArray(rec.segments) ? rec.segments : Array.isArray(parsed) ? parsed : null;
  if (!list || list.length === 0) {
    throw new EngineError('智能断句返回为空', 'PARSE_ERROR', { retryable: false });
  }

  const segments: ResegmentSegment[] = [];
  let prevEnd = -1;
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const seg = item as Record<string, unknown>;
    const startIdx = Number(seg.startIdx);
    const endIdx = Number(seg.endIdx);
    const text = typeof seg.text === 'string' ? seg.text.trim() : '';
    if (
      !Number.isInteger(startIdx) ||
      !Number.isInteger(endIdx) ||
      startIdx < 0 ||
      endIdx < startIdx ||
      endIdx >= totalTokens ||
      startIdx <= prevEnd ||
      !text
    ) {
      continue;
    }
    segments.push({ startIdx, endIdx, text });
    prevEnd = endIdx;
  }

  if (segments.length === 0) {
    throw new EngineError('智能断句结果索引无效', 'PARSE_ERROR', { retryable: false });
  }
  return segments;
}
