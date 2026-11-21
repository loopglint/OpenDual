import type { LanguageCode } from '../config/types';

export interface ScriptProfile {
  han: number;
  kana: number;
  hangul: number;
  latin: number;
  cyrillic: number;
  digits: number;
  lettersTotal: number;
}

export function analyzeScripts(text: string): ScriptProfile {
  let han = 0;
  let kana = 0;
  let hangul = 0;
  let latin = 0;
  let cyrillic = 0;
  let digits = 0;

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if ((code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf)) {
      han++;
    } else if ((code >= 0x3040 && code <= 0x30ff) || (code >= 0x31f0 && code <= 0x31ff)) {
      kana++;
    } else if (code >= 0xac00 && code <= 0xd7af) {
      hangul++;
    } else if (
      (code >= 0x0041 && code <= 0x005a) ||
      (code >= 0x0061 && code <= 0x007a) ||
      (code >= 0x00c0 && code <= 0x024f)
    ) {
      latin++;
    } else if (code >= 0x0400 && code <= 0x04ff) {
      cyrillic++;
    } else if (code >= 0x0030 && code <= 0x0039) {
      digits++;
    }
  }

  return {
    han,
    kana,
    hangul,
    latin,
    cyrillic,
    digits,
    lettersTotal: han + kana + hangul + latin + cyrillic,
  };
}

const URL_OR_EMAIL_RE = /^(https?:\/\/\S+|www\.\S+|\S+@\S+\.\S+|[@#$][\w.-]+|v?\d+(\.\d+)+)$/i;
const PURE_SYMBOL_OR_NUM_RE = /^[\d\s.,:%$€£¥+\-*/=<>()[\]{}|\\!?~`^&'"—–·•#@]+$/;

/**
 * Checks whether a block of text is meaningful natural language worth translating.
 */
export function isTranslatableText(rawText: string): boolean {
  // Strip placeholder markers before inspecting remaining meaningful content
  const stripped = rawText
    .replace(/<v\s+id="\d+"\s*\/>/g, ' ')
    .replace(/<\/?g(?:\s+id="\d+")?>/g, '')
    .trim();

  if (stripped.length < 2) return false;
  if (PURE_SYMBOL_OR_NUM_RE.test(stripped)) return false;
  if (URL_OR_EMAIL_RE.test(stripped)) return false;

  const profile = analyzeScripts(stripped);
  if (profile.lettersTotal < 2) return false;

  // Skip single short uppercase acronym or pure code-like snake/camel token without spaces
  if (
    profile.han === 0 &&
    profile.kana === 0 &&
    profile.hangul === 0 &&
    !/\s/.test(stripped) &&
    (stripped.includes('_') || /^[A-Z0-9-]{2,8}$/.test(stripped))
  ) {
    return false;
  }

  return true;
}

/**
 * Fast, zero-latency heuristic to decide if a block is ALREADY written in targetLang
 * so mixed-language timelines (X, GitHub, YouTube comments) skip redundant translations cleanly.
 */
export function isAlreadyTargetLanguage(rawText: string, targetLang: LanguageCode): boolean {
  if (targetLang === 'auto') return false;

  const stripped = rawText
    .replace(/<v\s+id="\d+"\s*\/>/g, ' ')
    .replace(/<\/?g(?:\s+id="\d+")?>/g, '')
    .trim();

  const p = analyzeScripts(stripped);
  if (p.lettersTotal === 0) return true;

  switch (targetLang) {
    case 'zh-CN':
    case 'zh-TW': {
      // If Japanese kana is present, it is Japanese, not Chinese!
      if (p.kana >= 2 && p.kana / p.lettersTotal > 0.08) return false;
      // Chinese characters dominate (e.g. mixed Chinese post with a few English terms like "LLM" / "API")
      return p.han >= 2 && p.han / p.lettersTotal >= 0.32;
    }
    case 'ja':
      return (p.kana >= 2 && (p.kana + p.han) / p.lettersTotal >= 0.4);
    case 'ko':
      return p.hangul >= 2 && p.hangul / p.lettersTotal >= 0.35;
    case 'ru':
      return p.cyrillic >= 3 && p.cyrillic / p.lettersTotal >= 0.5;
    case 'en': {
      // Pure Latin scripts could be FR/DE/ES/EN; only skip if high-confidence English stopwords appear and no non-ASCII Latin
      if (p.latin / p.lettersTotal < 0.85) return false;
      const nonAsciiLatin = (stripped.match(/[àâäçéèêëîïôöùûüÿñßäöüáíóú¿¡]/gi) ?? []).length;
      if (nonAsciiLatin > 0) return false;
      const englishStopwords = stripped.match(/\b(the|and|for|that|with|this|from|have|are|you|not|but|can|will|your)\b/gi);
      return (englishStopwords?.length ?? 0) >= 2;
    }
    default:
      return false;
  }
}
