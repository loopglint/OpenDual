import type { EngineProfile, LanguageCode } from '../config/types';
import {
  createTimeoutSignal,
  EngineError,
  type TranslateBatchRequest,
  type TranslateBatchResult,
  type TranslationProvider,
} from './types';

function mapDeepLLang(lang: LanguageCode): string {
  if (lang === 'auto') return 'auto';
  if (lang === 'zh-CN' || lang === 'zh-TW') return 'ZH';
  return lang.toUpperCase();
}

export class DeepLxProvider implements TranslationProvider {
  readonly profile: EngineProfile;
  readonly capabilities = {
    supportsBatch: false,
    supportsStream: false,
    supportsContext: false,
    supportsHtmlTags: false,
    supportsResegment: false,
  };

  constructor(profile: EngineProfile) {
    this.profile = profile;
  }

  async translateBatch(req: TranslateBatchRequest, parentSignal: AbortSignal): Promise<TranslateBatchResult> {
    const { signal, cleanup } = createTimeoutSignal(parentSignal, this.profile.timeoutMs ?? 20000);
    try {
      const url = (this.profile.baseUrl || 'http://localhost:1188/translate').trim();
      const targetLang = mapDeepLLang(req.targetLang);
      const sourceLang = mapDeepLLang(req.sourceLang);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(this.profile.apiKey ? { Authorization: `Bearer ${this.profile.apiKey}` } : {}),
        ...(this.profile.customHeaders ?? {}),
      };

      const out = [];
      for (const item of req.items) {
        const resp = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            text: item.text,
            source_lang: sourceLang,
            target_lang: targetLang,
          }),
          signal,
        });
        if (!resp.ok) {
          throw new EngineError(`DeepLX 请求失败 (${resp.status})`, resp.status === 429 ? 'RATE_LIMIT' : 'NETWORK', {
            status: resp.status,
          });
        }
        const data = (await resp.json()) as { data?: string; code?: number; message?: string };
        if (typeof data.data !== 'string') {
          throw new EngineError(data.message || 'DeepLX 返回格式错误', 'PARSE_ERROR');
        }
        out.push({ i: item.i, text: data.data.trim() });
      }
      return { items: out };
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
          items: [{ i: 0, text: 'Hello from DeepLX!' }],
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
