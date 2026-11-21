import type { EngineProfile, LanguageCode } from '../config/types';
import {
  createTimeoutSignal,
  EngineError,
  type TranslateBatchRequest,
  type TranslateBatchResult,
  type TranslationProvider,
} from './types';

function mapEdgeLang(lang: LanguageCode): string {
  switch (lang) {
    case 'auto':
      return '';
    case 'zh-CN':
      return 'zh-Hans';
    case 'zh-TW':
      return 'zh-Hant';
    default:
      return lang;
  }
}

/**
 * Protects <v id="n"/> and <g id="n">...</g> inline placeholders using rare bracket tokens
 * that Microsoft Edge's `translatetext` endpoint preserves verbatim without turning quotes into CJK quotes.
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
    const num = token.match(/\d+/)?.[0];
    if (num !== undefined) {
      result = result.replace(new RegExp(`⟦\\s*T\\s*${num}\\s*⟧`, 'gi'), original);
    }
  }
  return result;
}

export class EdgeFreeProvider implements TranslationProvider {
  readonly profile: EngineProfile;
  readonly capabilities = {
    supportsBatch: true,
    supportsStream: false,
    supportsContext: false,
    supportsHtmlTags: true,
    supportsResegment: false,
  };

  constructor(profile: EngineProfile) {
    this.profile = profile;
  }

  async translateBatch(req: TranslateBatchRequest, parentSignal: AbortSignal): Promise<TranslateBatchResult> {
    const { signal, cleanup } = createTimeoutSignal(parentSignal, this.profile.timeoutMs ?? 15000);
    try {
      const from = mapEdgeLang(req.sourceLang);
      const to = mapEdgeLang(req.targetLang) || 'zh-Hans';
      const prepared = req.items.map((item) => encodeInlinePlaceholders(item.text));

      const translated = await this.callDirectEdgeEndpoint(
        prepared.map((p) => p.encoded),
        from,
        to,
        signal,
      );

      if (translated.length !== req.items.length) {
        throw new EngineError('Edge 免费翻译返回条数不匹配', 'PARSE_ERROR');
      }

      return {
        items: req.items.map((it, idx) => ({
          i: it.i,
          text: decodeInlinePlaceholders((translated[idx] ?? it.text).trim(), prepared[idx]?.map ?? new Map()),
        })),
      };
    } catch (err) {
      if (err instanceof EngineError) throw err;
      throw new EngineError(
        `Edge 免费翻译请求失败: ${err instanceof Error ? err.message : String(err)}`,
        'NETWORK',
      );
    } finally {
      cleanup();
    }
  }

  private async callDirectEdgeEndpoint(
    texts: string[],
    from: string,
    to: string,
    signal: AbortSignal,
  ): Promise<string[]> {
    const params = new URLSearchParams({ to, isEnterpriseClient: 'false' });
    if (from) params.set('from', from);

    const resp = await fetch(`https://edge.microsoft.com/translate/translatetext?${params.toString()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(texts),
      signal,
    });

    if (resp.status === 429) {
      throw new EngineError('Edge 免费翻译触发频控 (429)', 'RATE_LIMIT', { status: 429 });
    }
    if (!resp.ok) {
      throw new EngineError(`Edge 免费翻译接口返回 ${resp.status}`, 'NETWORK', { status: resp.status });
    }

    const data = (await resp.json()) as unknown;
    if (Array.isArray(data)) {
      if (data.length > 0 && typeof data[0] === 'string') {
        return data as string[];
      }
      return (data as Array<{ translations?: Array<{ text?: string }> }>).map(
        (entry) => entry?.translations?.[0]?.text ?? '',
      );
    }
    if (data && typeof data === 'object' && Array.isArray((data as { translations?: unknown[] }).translations)) {
      return ((data as { translations: Array<{ text?: string }> }).translations).map((t) => t.text ?? '');
    }
    throw new EngineError('Edge 免费翻译返回数据结构未知', 'PARSE_ERROR', { retryable: false });
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
