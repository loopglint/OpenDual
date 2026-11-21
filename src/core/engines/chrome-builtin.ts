import type { EngineProfile, LanguageCode } from '../config/types';
import {
  EngineError,
  type TranslateBatchRequest,
  type TranslateBatchResult,
  type TranslationProvider,
} from './types';

interface BuiltinTranslatorInstance {
  translate(input: string): Promise<string>;
  destroy?(): void;
}

interface BuiltinTranslatorApi {
  availability(options: { sourceLanguage: string; targetLanguage: string }): Promise<string>;
  create(options: {
    sourceLanguage: string;
    targetLanguage: string;
    monitor?: (m: EventTarget) => void;
  }): Promise<BuiltinTranslatorInstance>;
}

interface BuiltinLanguageDetectorApi {
  availability(): Promise<string>;
  create(): Promise<{ detect(text: string): Promise<Array<{ detectedLanguage: string; confidence: number }>> }>;
}

function getGlobalTranslatorApi(): BuiltinTranslatorApi | null {
  const g = globalThis as unknown as { Translator?: BuiltinTranslatorApi };
  return typeof g.Translator === 'object' && g.Translator ? g.Translator : null;
}

function getGlobalDetectorApi(): BuiltinLanguageDetectorApi | null {
  const g = globalThis as unknown as { LanguageDetector?: BuiltinLanguageDetectorApi };
  return typeof g.LanguageDetector === 'object' && g.LanguageDetector ? g.LanguageDetector : null;
}

function normalizeBcp47(lang: LanguageCode): string {
  if (lang === 'zh-CN') return 'zh';
  if (lang === 'zh-TW') return 'zh-Hant';
  return lang;
}

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
  let result = text;
  for (const [token, original] of map.entries()) {
    const num = token.match(/\d+/)?.[0];
    if (num !== undefined) {
      result = result.replace(new RegExp(`⟦\\s*T\\s*${num}\\s*⟧`, 'gi'), original);
    }
  }
  return result;
}

export class ChromeBuiltinProvider implements TranslationProvider {
  readonly profile: EngineProfile;
  readonly capabilities = {
    supportsBatch: false,
    supportsStream: false,
    supportsContext: false,
    supportsHtmlTags: false,
    supportsResegment: false,
  };

  private instanceCache = new Map<string, BuiltinTranslatorInstance>();

  constructor(profile: EngineProfile) {
    this.profile = profile;
  }

  private async detectSourceLang(sampleText: string): Promise<string> {
    const detectorApi = getGlobalDetectorApi();
    if (!detectorApi) return 'en';
    try {
      const avail = await detectorApi.availability();
      if (avail === 'unavailable' || avail === 'no') return 'en';
      const detector = await detectorApi.create();
      const results = await detector.detect(sampleText.slice(0, 400));
      const best = results?.[0];
      if (best && best.detectedLanguage && best.detectedLanguage !== 'und') {
        return best.detectedLanguage;
      }
    } catch {
      // Fallback to English
    }
    return 'en';
  }

  private async getTranslator(sourceLanguage: string, targetLanguage: string): Promise<BuiltinTranslatorInstance> {
    const api = getGlobalTranslatorApi();
    if (!api) {
      throw new EngineError(
        '当前浏览器不支持内置 Translator API（需要桌面端 Chrome 138+ 或 Edge 148+）',
        'UNSUPPORTED',
        { retryable: false },
      );
    }

    const key = `${sourceLanguage}->${targetLanguage}`;
    const existing = this.instanceCache.get(key);
    if (existing) return existing;

    const availability = await api.availability({ sourceLanguage, targetLanguage });
    if (availability === 'unavailable' || availability === 'no') {
      throw new EngineError(
        `Chrome 内置翻译暂不支持 ${sourceLanguage} -> ${targetLanguage} 语言对或硬件未满足要求`,
        'UNSUPPORTED',
        { retryable: false },
      );
    }

    const instance = await api.create({ sourceLanguage, targetLanguage });
    this.instanceCache.set(key, instance);
    return instance;
  }

  async translateBatch(req: TranslateBatchRequest, signal: AbortSignal): Promise<TranslateBatchResult> {
    if (signal.aborted) {
      throw new EngineError('请求已取消', 'ABORTED', { retryable: false });
    }
    const targetLanguage = normalizeBcp47(req.targetLang);
    const sourceLanguage =
      req.sourceLang === 'auto'
        ? await this.detectSourceLang(req.items.map((x) => x.text).join(' '))
        : normalizeBcp47(req.sourceLang);

    if (sourceLanguage === targetLanguage) {
      return { items: req.items.map((it) => ({ i: it.i, text: it.text })) };
    }

    const translator = await this.getTranslator(sourceLanguage, targetLanguage);
    const out = [];
    for (const item of req.items) {
      if (signal.aborted) {
        throw new EngineError('请求已取消', 'ABORTED', { retryable: false });
      }
      const { encoded, map } = encodeInlinePlaceholders(item.text);
      const translated = await translator.translate(encoded);
      out.push({ i: item.i, text: decodeInlinePlaceholders(translated.trim(), map) });
    }
    return { items: out };
  }

  async testConnection(signal?: AbortSignal) {
    const start = performance.now();
    try {
      const res = await this.translateBatch(
        {
          scope: 'webpage',
          sourceLang: 'en',
          targetLang: 'zh-CN',
          items: [{ i: 0, text: 'Hello, on-device translation!' }],
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
      const e = err instanceof EngineError ? err : new EngineError(String(err), 'UNSUPPORTED', { retryable: false });
      return {
        ok: false,
        latencyMs: Math.round(performance.now() - start),
        error: e.message,
        errorCode: e.code,
      };
    }
  }
}
