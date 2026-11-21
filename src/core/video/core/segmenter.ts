import type { SubtitleCue, WordToken, YtJson3Payload } from './types';

const NON_SPEECH_RE = /^[\s♪♫]*(\[[^\]]{1,24}\]|\([^)]{1,24}\)|♪+|♫+)[\s♪♫]*$/;
const SENTENCE_END_RE = /[.?!。？！…]["'”’)\]]*$/;
const CLAUSE_BREAK_RE = /[,;，、；：:—–-]\s*$/;
const CONJUNCTION_WORDS = new Set([
  'and',
  'but',
  'because',
  'so',
  'which',
  'that',
  'while',
  'when',
  'although',
  'however',
  'where',
  'if',
  'then',
  'or',
]);

const PAUSE_SPLIT_MS = 680;
const MIN_CUE_DURATION_MS = 1200;
const MAX_CUE_DURATION_MS = 7000;
const MAX_LATIN_CHARS = 112;
const MAX_CJK_CHARS = 44;

function isMostlyCjk(text: string): boolean {
  let cjk = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if ((c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3040 && c <= 0x30ff) || (c >= 0xac00 && c <= 0xd7af)) {
      cjk++;
    }
  }
  return cjk > text.length * 0.25;
}

function cleanCueText(raw: string): string {
  return raw
    .replace(/<\/?(?:c|i|b|u|v|font|ruby|rt|lang)[^>]*>/gi, '')
    .replace(/<\d{2}:\d{2}:\d{2}\.\d{3}>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\r?\n+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function joinWordsClean(words: WordToken[]): string {
  let out = '';
  for (const w of words) {
    const part = w.text;
    if (!part) continue;
    if (!out) {
      out = part;
    } else if (/^[,.;:!?%)\]}'’”。，、？！；：]/.test(part) || /[\u4e00-\u9fff\u3040-\u30ff]$/.test(out)) {
      out += part;
    } else {
      out += ` ${part}`;
    }
  }
  return out.replace(/\s{2,}/g, ' ').trim();
}

/**
 * Stage 1A: Parses YouTube `json3` caption payload into cleaned word-level tokens
 * and detects whether the track is unpunctuated rolling ASR or punctuated manual captions.
 */
export function parseYouTubeJson3(payload: YtJson3Payload, isAsrHint = false): {
  tokens: WordToken[];
  rawCues: SubtitleCue[];
  needsAsrResegment: boolean;
} {
  const events = payload.events ?? [];
  const rawCues: SubtitleCue[] = [];
  const tokens: WordToken[] = [];
  let hasWordOffsets = false;
  let punctuationCount = 0;

  for (let idx = 0; idx < events.length; idx++) {
    const ev = events[idx];
    if (!ev?.segs || ev.segs.length === 0) continue;
    const evStart = ev.tStartMs ?? 0;

    // Determine event end time (avoid long overlap into the next non-append event)
    let evEnd = evStart + (ev.dDurationMs ?? 3000);
    for (let nextIdx = idx + 1; nextIdx < events.length; nextIdx++) {
      const nextEv = events[nextIdx];
      if (!nextEv?.segs || nextEv.segs.length === 0) continue;
      if (nextEv.aAppend === 1) continue;
      if (typeof nextEv.tStartMs === 'number' && nextEv.tStartMs > evStart) {
        evEnd = Math.min(evEnd, nextEv.tStartMs);
      }
      break;
    }
    if (evEnd <= evStart) evEnd = evStart + 1500;

    const segTexts: string[] = [];
    const evWords: WordToken[] = [];

    for (let s = 0; s < ev.segs.length; s++) {
      const seg = ev.segs[s];
      if (!seg) continue;
      const rawPiece = seg.utf8 ?? '';
      if (!rawPiece || rawPiece === '\n') continue;
      const cleaned = cleanCueText(rawPiece);
      if (!cleaned) continue;

      if (typeof seg.tOffsetMs === 'number' && seg.tOffsetMs > 0) {
        hasWordOffsets = true;
      }

      const tokStart = evStart + (seg.tOffsetMs ?? 0);
      let tokEnd = evEnd;
      // Look ahead to next segment in same event for tight word end timestamp
      for (let ns = s + 1; ns < ev.segs.length; ns++) {
        const nextSeg = ev.segs[ns];
        if (nextSeg && typeof nextSeg.tOffsetMs === 'number' && nextSeg.tOffsetMs > (seg.tOffsetMs ?? 0)) {
          tokEnd = evStart + nextSeg.tOffsetMs;
          break;
        }
      }
      if (tokEnd <= tokStart) tokEnd = tokStart + 250;

      // Split multi-word segments proportionally when a segment bundles multiple words
      const subParts = isMostlyCjk(cleaned) ? [cleaned] : cleaned.split(/\s+/).filter(Boolean);
      const step = (tokEnd - tokStart) / Math.max(1, subParts.length);

      for (let p = 0; p < subParts.length; p++) {
        const wordText = subParts[p];
        if (!wordText) continue;
        if (/[.?!。？！]/.test(wordText)) punctuationCount++;
        const wt: WordToken = {
          text: wordText,
          startMs: Math.round(tokStart + p * step),
          endMs: Math.round(tokStart + (p + 1) * step),
        };
        evWords.push(wt);
      }
      segTexts.push(cleaned);
    }

    const combinedText = cleanCueText(segTexts.join(' '));
    if (!combinedText) continue;

    // Deduplicate YouTube rolling ASR overlap where aAppend duplicates previous line prefix
    const prevRaw = rawCues[rawCues.length - 1];
    if (prevRaw && combinedText === prevRaw.source && Math.abs(evStart - prevRaw.startMs) < 1500) {
      prevRaw.endMs = Math.max(prevRaw.endMs, evEnd);
      continue;
    }

    const isNonSpeech = NON_SPEECH_RE.test(combinedText);
    rawCues.push({
      id: rawCues.length + 1,
      startMs: evStart,
      endMs: evEnd,
      source: combinedText,
      isNonSpeech,
      words: evWords,
    });

    if (!isNonSpeech) {
      for (const w of evWords) {
        const prevTok = tokens[tokens.length - 1];
        // Skip duplicate rolling token at virtually identical timestamp
        if (prevTok && prevTok.text === w.text && Math.abs(prevTok.startMs - w.startMs) < 120) {
          continue;
        }
        tokens.push(w);
      }
    }
  }

  const totalWords = Math.max(1, tokens.length);
  const punctDensity = punctuationCount / totalWords;
  const needsAsrResegment = isAsrHint || hasWordOffsets || (rawCues.length > 6 && punctDensity < 0.025);

  return { tokens, rawCues, needsAsrResegment };
}

function parseVttTimestamp(ts: string): number {
  const cleaned = ts.trim().replace(',', '.');
  const parts = cleaned.split(':');
  if (parts.length === 3) {
    const h = Number(parts[0]);
    const m = Number(parts[1]);
    const s = Number(parts[2]);
    return Math.round((h * 3600 + m * 60 + s) * 1000);
  }
  if (parts.length === 2) {
    const m = Number(parts[0]);
    const s = Number(parts[1]);
    return Math.round((m * 60 + s) * 1000);
  }
  return 0;
}

/**
 * Stage 1B: Parses WebVTT (.vtt) or SRT (.srt) subtitle text (used by X HLS subtitles & fallback tracks).
 */
export function parseWebVtt(vttText: string): SubtitleCue[] {
  const normalized = vttText.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const blocks = normalized.split(/\n{2,}/);
  const cues: SubtitleCue[] = [];

  for (const block of blocks) {
    const lines = block
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const firstLine = lines[0];
    if (!firstLine) continue;
    if (firstLine.startsWith('WEBVTT') || firstLine.startsWith('NOTE') || firstLine.startsWith('STYLE')) {
      continue;
    }

    const timingIdx = lines.findIndex((l) => l.includes('-->'));
    if (timingIdx === -1) continue;

    const timingLine = lines[timingIdx];
    if (!timingLine) continue;
    const [startStr, endWithSettings] = timingLine.split('-->');
    if (!startStr || !endWithSettings) continue;

    const endStr = endWithSettings.trim().split(/\s+/)[0] ?? '';
    if (!endStr) continue;
    const startMs = parseVttTimestamp(startStr);
    const endMs = parseVttTimestamp(endStr);
    if (endMs <= startMs) continue;

    const textLines = lines.slice(timingIdx + 1);
    const text = cleanCueText(textLines.join(' '));
    if (!text) continue;

    // Deduplicate progressive VTT rolling captions where new cue starts with previous cue
    const prev = cues[cues.length - 1];
    if (prev) {
      if (text === prev.source && startMs - prev.endMs < 300) {
        prev.endMs = Math.max(prev.endMs, endMs);
        continue;
      }
      if (text.startsWith(prev.source) && startMs <= prev.endMs + 150) {
        const delta = text.slice(prev.source.length).trim();
        if (delta) {
          cues.push({
            id: cues.length + 1,
            startMs,
            endMs,
            source: delta,
            isNonSpeech: NON_SPEECH_RE.test(delta),
          });
          continue;
        }
      }
    }

    cues.push({
      id: cues.length + 1,
      startMs,
      endMs,
      source: text,
      isNonSpeech: NON_SPEECH_RE.test(text),
    });
  }

  return cues;
}

/**
 * Generates synthetic word-level tokens from a cue when original timestamps are only cue-level.
 */
function cueToWords(cue: SubtitleCue): WordToken[] {
  if (cue.words && cue.words.length > 0) return cue.words;
  const parts = isMostlyCjk(cue.source)
    ? Array.from(cue.source)
    : cue.source.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return [];
  const totalLen = parts.reduce((acc, p) => acc + p.length, 0) || 1;
  const dur = Math.max(200, cue.endMs - cue.startMs);
  let cursor = cue.startMs;

  return parts.map((word, idx) => {
    const slice = idx === parts.length - 1 ? cue.endMs - cursor : Math.round((dur * word.length) / totalLen);
    const startMs = cursor;
    const endMs = Math.max(startMs + 40, cursor + slice);
    cursor = endMs;
    return { text: word, startMs, endMs };
  });
}

/**
 * Stage 3: Splits an overly long sentence at natural punctuation or conjunction boundaries
 * while preserving accurate word-anchored timestamps and comfortable reading duration.
 */
function splitLongWordGroup(words: WordToken[], maxChars: number): WordToken[][] {
  const fullText = joinWordsClean(words);
  const fullDur = (words[words.length - 1]?.endMs ?? 0) - (words[0]?.startMs ?? 0);
  if (fullText.length <= maxChars && fullDur <= MAX_CUE_DURATION_MS) {
    return [words];
  }
  if (words.length <= 3) return [words];

  const minIdx = Math.max(2, Math.floor(words.length * 0.32));
  const maxIdx = Math.min(words.length - 2, Math.ceil(words.length * 0.74));
  const mid = words.length / 2;

  let bestSplit = Math.round(mid);
  let bestScore = -Infinity;

  for (let i = minIdx; i <= maxIdx; i++) {
    const prevWord = words[i - 1];
    const currWord = words[i];
    if (!prevWord || !currWord) continue;
    const gap = currWord.startMs - prevWord.endMs;
    let score = -Math.abs(i - mid) * 1.5;

    if (SENTENCE_END_RE.test(prevWord.text)) score += 60;
    else if (CLAUSE_BREAK_RE.test(prevWord.text)) score += 35;
    else if (CONJUNCTION_WORDS.has(currWord.text.toLowerCase())) score += 22;

    if (gap > 280) score += Math.min(35, gap / 12);

    if (score > bestScore) {
      bestScore = score;
      bestSplit = i;
    }
  }

  return [
    ...splitLongWordGroup(words.slice(0, bestSplit), maxChars),
    ...splitLongWordGroup(words.slice(bestSplit), maxChars),
  ];
}

/**
 * Final pass: enforces strictly monotonic non-overlapping timestamps & comfortable minimum display duration.
 */
function enforceTimelineGuardrails(cues: SubtitleCue[]): SubtitleCue[] {
  for (let i = 0; i < cues.length; i++) {
    const curr = cues[i];
    if (!curr) continue;
    const next = cues[i + 1];

    if (curr.endMs - curr.startMs < MIN_CUE_DURATION_MS) {
      const targetEnd = curr.startMs + MIN_CUE_DURATION_MS;
      curr.endMs = next ? Math.min(targetEnd, Math.max(curr.endMs, next.startMs - 40)) : targetEnd;
    }

    if (next && curr.endMs > next.startMs) {
      if (next.startMs > curr.startMs + 250) {
        curr.endMs = next.startMs - 20;
      } else {
        next.startMs = curr.endMs;
        if (next.endMs <= next.startMs) next.endMs = next.startMs + 800;
      }
    }
    curr.id = i + 1;
  }
  return cues;
}

/**
 * Stage 2 + 3: Smart Subtitle Re-Segmentation Engine.
 * - Merges fragmented cues into grammatically complete sentences using punctuation & silence gaps
 * - Respects speaker changes (>>) and isolates non-speech cues ([Music])
 * - Re-splits overly long sentences at natural clause boundaries with word-level timestamp anchors
 * - Enforces monotonic, non-overlapping timestamps and comfortable min/max display durations
 */
export function smartResegmentCues(rawCues: SubtitleCue[]): SubtitleCue[] {
  if (rawCues.length === 0) return [];

  const result: SubtitleCue[] = [];
  let bufferWords: WordToken[] = [];

  const flushBuffer = () => {
    if (bufferWords.length === 0) return;
    const textSample = joinWordsClean(bufferWords);
    const maxChars = isMostlyCjk(textSample) ? MAX_CJK_CHARS : MAX_LATIN_CHARS;
    const groups = splitLongWordGroup(bufferWords, maxChars);

    for (const grp of groups) {
      const first = grp[0];
      const last = grp[grp.length - 1];
      if (!first || !last) continue;
      const text = joinWordsClean(grp);
      if (!text) continue;
      const startMs = first.startMs;
      const endMs = Math.max(startMs + 400, last.endMs);
      result.push({
        id: result.length + 1,
        startMs,
        endMs,
        source: text,
        words: grp,
      });
    }
    bufferWords = [];
  };

  for (const cue of rawCues) {
    if (cue.isNonSpeech) {
      flushBuffer();
      result.push({
        id: result.length + 1,
        startMs: cue.startMs,
        endMs: cue.endMs,
        source: cue.source,
        isNonSpeech: true,
      });
      continue;
    }

    const words = cueToWords(cue);
    if (words.length === 0) continue;

    // Speaker change indicator -> flush previous speaker
    if (/^(>>|—|- )/.test(cue.source)) {
      flushBuffer();
    }

    for (const word of words) {
      if (bufferWords.length > 0) {
        const first = bufferWords[0];
        const last = bufferWords[bufferWords.length - 1];
        if (first && last) {
          const gap = word.startMs - last.endMs;
          const currentDur = word.endMs - first.startMs;
          const currentText = joinWordsClean(bufferWords);
          const maxChars = isMostlyCjk(currentText) ? MAX_CJK_CHARS : MAX_LATIN_CHARS;

          const endsSentence = SENTENCE_END_RE.test(last.text);
          const longSilence = gap >= PAUSE_SPLIT_MS;
          const hitHardCap = currentDur >= MAX_CUE_DURATION_MS * 1.15 || currentText.length >= maxChars * 1.35;

          if (endsSentence || longSilence || hitHardCap) {
            flushBuffer();
          }
        }
      }
      bufferWords.push(word);
    }
  }
  flushBuffer();

  return enforceTimelineGuardrails(result);
}

/**
 * Applies LLM semantic re-segmentation output back onto original word-level timestamps,
 * preserving every semantic sentence boundary chosen by the LLM while enforcing reading-speed guardrails!
 */
export function applyLlmResegmentation(
  tokens: WordToken[],
  llmSegments: Array<{ startIdx: number; endIdx: number; text: string }>,
): SubtitleCue[] {
  const result: SubtitleCue[] = [];

  for (const seg of llmSegments) {
    const startTok = tokens[seg.startIdx];
    const endTok = tokens[seg.endIdx];
    const cleanText = seg.text.trim();
    if (!startTok || !endTok || !cleanText) continue;

    const cue: SubtitleCue = {
      id: result.length + 1,
      startMs: startTok.startMs,
      endMs: Math.max(startTok.startMs + 500, endTok.endMs),
      source: cleanText,
    };

    const maxChars = isMostlyCjk(cleanText) ? MAX_CJK_CHARS : MAX_LATIN_CHARS;
    if (cleanText.length <= maxChars && cue.endMs - cue.startMs <= MAX_CUE_DURATION_MS) {
      result.push(cue);
    } else {
      // Split overly long LLM sentence along its punctuated clause boundaries
      const syntheticWords = cueToWords(cue);
      const groups = splitLongWordGroup(syntheticWords, maxChars);
      for (const grp of groups) {
        const first = grp[0];
        const last = grp[grp.length - 1];
        if (!first || !last) continue;
        result.push({
          id: result.length + 1,
          startMs: first.startMs,
          endMs: Math.max(first.startMs + 400, last.endMs),
          source: joinWordsClean(grp),
          words: grp,
        });
      }
    }
  }

  return enforceTimelineGuardrails(result);
}
