import type { EngineProfile, LanguageCode } from '../config/types';
import {
  createTimeoutSignal,
  EngineError,
  type TranslateBatchRequest,
  type TranslateBatchResult,
  type TranslationProvider,
} from './types';

function mapGoogleLang(lang: LanguageCode): string {
  if (lang === 'auto') return 'auto';
  return lang;
}

const BATCH_SEP = '\n⟪§LBT_SEP§⟫\n';

/**
 * Protects <v id="n"/> and <g id="n">...</g> inline placeholders from Google Translate corruption.
 */
function encodeInlinePlaceholders(text: string): { encoded: string; map: Map<string, string> } {
  const map = new Map<string, string>();
  let seq = 0;
  const encoded = text.replace(/<v\s+id="\d+"\s*\/>|<g\s+id="\d+">|<\/g>/g, (match) => {
    const token = `⟦T${seq++}⟧`;
    map.set(token, match);
    return token;
  });
  return { encoded, map };
}

function decodeInlinePlaceholders(text: string, map: Map<string, string>): string {
  if (map.size === 0) return text;
  let result = text;
  for (const [token, original] of map.entries()) {
    // Allow optional whitespace that MT may insert around brackets
    const num = token.match(/\d+/)?.[0];
    if (num !== undefined) {
      const fuzzy = new RegExp(`⟦\\s*T\\s*${num}\\s*⟧`, 'gi');
      result = result.replace(fuzzy, original);
    }
  }
  return result;
}

async function fetchGoogleSingle(
  text: string,
  sl: string,
  tl: string,
  signal: AbortSignal,
): Promise<string> {
  const params = new URLSearchParams({
    client: 'gtx',
    sl,
    tl,
    dt: 't',
    dj: '1',
  });

  // Use POST form body to avoid URL length truncation on larger batches
  const body = new URLSearchParams({ q: text });
  const resp = await fetch(`https://translate.googleapis.com/translate_a/single?${params.toString()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: body.toString(),
    signal,
  });

  if (resp.status === 429) {
    throw new EngineError('Google 免费翻译触发限流 (429)', 'RATE_LIMIT', { status: 429 });
  }
  if (!resp.ok) {
    throw new EngineError(`Google 免费翻译请求失败 (${resp.status})`, 'NETWORK', { status: resp.status });
  }

  const json = (await resp.json()) as {
    sentences?: Array<{ trans?: string }>;
  };
  if (Array.isArray(json.sentences)) {
    return json.sentences.map((s) => s.trans ?? '').join('');
  }
  throw new EngineError('Google 免费翻译返回格式异常', 'PARSE_ERROR', { retryable: false });
}

export class GoogleFreeProvider implements TranslationProvider {
  readonly profile: EngineProfile;
  readonly capabilities = {
    supportsBatch: true,
    supportsStream: false,
    supportsContext: false,
    supportsHtmlTags: false,
    supportsResegment: false,
  };

  constructor(profile: EngineProfile) {
    this.profile = profile;
  }

  async translateBatch(req: TranslateBatchRequest, parentSignal: AbortSignal): Promise<TranslateBatchResult> {
    const { signal, cleanup } = createTimeoutSignal(parentSignal, this.profile.timeoutMs ?? 15000);
    try {
      const sl = mapGoogleLang(req.sourceLang);
      const tl = mapGoogleLang(req.targetLang);

      const prepared = req.items.map((item) => encodeInlinePlaceholders(item.text));

      if (req.items.length === 1) {
        const firstItem = req.items[0];
        const firstPrep = prepared[0];
        if (!firstItem || !firstPrep) return { items: [] };
        const raw = await fetchGoogleSingle(firstPrep.encoded, sl, tl, signal);
        return {
          items: [{ i: firstItem.i, text: decodeInlinePlaceholders(raw.trim(), firstPrep.map) }],
        };
      }

      // Join batch with rare delimiter; fall back to individual calls if delimiter got altered
      const combined = prepared.map((p) => p.encoded).join(BATCH_SEP);
      const rawCombined = await fetchGoogleSingle(combined, sl, tl, signal);
      const parts = rawCombined.split(/\s*⟪\s*§\s*LBT_SEP\s*§\s*⟫\s*/i);

      if (parts.length === req.items.length) {
        return {
          items: req.items.map((item, idx) => ({
            i: item.i,
            text: decodeInlinePlaceholders((parts[idx] ?? '').trim(), prepared[idx]?.map ?? new Map()),
          })),
        };
      }

      // Delimiter mismatch self-healing: translate individually
      const results = [];
      for (let idx = 0; idx < req.items.length; idx++) {
        const item = req.items[idx];
        const prep = prepared[idx];
        if (!item || !prep) continue;
        const single = await fetchGoogleSingle(prep.encoded, sl, tl, signal);
        results.push({
          i: item.i,
          text: decodeInlinePlaceholders(single.trim(), prep.map),
        });
      }
      return { items: results };
    } catch (err) {
      if (err instanceof EngineError) throw err;
      throw new EngineError(
        `Google 免费翻译失败: ${err instanceof Error ? err.message : String(err)}`,
        'NETWORK',
      );
    } finally {
      cleanup();
    }
  }

  async testConnection(signal?: AbortSignal) {
    const start = performance.now();
    try {
      const res = await this.translateBatch(
        {
          scope: 'webpage',
          sourceLang: 'en',
          targetLang: 'zh-CN',
          items: [{ i: 0, text: 'Hello, bilingual world!' }],
          glossary: [],
          prompts: { webpageSystemPrompt: '', subtitleSystemPrompt: '', resegmentSystemPrompt: '' },
        },
        signal ?? new AbortController().signal,
      );
      return {
        ok: true,
        latencyMs: Math.round(performance.now() - start),
        sample: res.items[0]?.text,
      };
    } catch (err) {
      const e = err instanceof EngineError ? err : new EngineError(String(err), 'UNKNOWN');
      return {
        ok: false,
        latencyMs: Math.round(performance.now() - start),
        error: e.message,
        errorCode: e.code,
      };
    }
  }
}
