import type { EngineProfile, GlossaryEntry, LanguageCode, PromptSettings } from '../config/types';
import type { VideoMetadata } from '../video/core/types';

export type EngineErrorCode =
  | 'NETWORK'
  | 'TIMEOUT'
  | 'RATE_LIMIT'
  | 'AUTH'
  | 'CORS_OLLAMA'
  | 'MODEL_NOT_FOUND'
  | 'UNSUPPORTED'
  | 'PARSE_ERROR'
  | 'ABORTED'
  | 'UNKNOWN';

export class EngineError extends Error {
  readonly code: EngineErrorCode;
  readonly retryable: boolean;
  readonly status?: number;

  constructor(
    message: string,
    code: EngineErrorCode,
    opts?: { retryable?: boolean; status?: number },
  ) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
    this.retryable = opts?.retryable ?? (code === 'NETWORK' || code === 'TIMEOUT' || code === 'RATE_LIMIT');
    this.status = opts?.status;
  }
}

export interface TranslateItem {
  i: number;
  text: string;
}

export interface TranslateBatchRequest {
  scope: 'webpage' | 'subtitle';
  sourceLang: LanguageCode;
  targetLang: LanguageCode;
  items: TranslateItem[];
  glossary: GlossaryEntry[];
  prompts: PromptSettings;
  videoMeta?: VideoMetadata;
  prevContext?: Array<{ source: string; target?: string }>;
  pageTitle?: string;
}

export interface TranslateBatchResult {
  items: TranslateItem[];
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    cacheHitTokens?: number;
  };
}

export interface ResegmentSegment {
  startIdx: number;
  endIdx: number;
  text: string;
}

export interface EngineCapabilities {
  supportsBatch: boolean;
  supportsStream: boolean;
  supportsContext: boolean;
  supportsHtmlTags: boolean;
  supportsResegment: boolean;
}

export interface TranslationProvider {
  readonly profile: EngineProfile;
  readonly capabilities: EngineCapabilities;
  translateBatch(req: TranslateBatchRequest, signal: AbortSignal): Promise<TranslateBatchResult>;
  resegment?(
    tokens: Array<{ idx: number; text: string }>,
    systemPrompt: string,
    signal: AbortSignal,
  ): Promise<ResegmentSegment[]>;
  testConnection(signal?: AbortSignal): Promise<{ ok: boolean; latencyMs: number; sample?: string; error?: string; errorCode?: EngineErrorCode }>;
}

export function normalizeBaseUrl(raw: string, fallback: string): string {
  const trimmed = (raw || fallback).trim();
  return trimmed.replace(/\/+$/, '');
}

export function createTimeoutSignal(parent: AbortSignal | undefined, timeoutMs: number): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new EngineError(`请求超时 (${timeoutMs}ms)`, 'TIMEOUT', { retryable: true }));
  }, timeoutMs);

  const onAbort = () => {
    controller.abort(parent?.reason ?? new EngineError('请求已取消', 'ABORTED', { retryable: false }));
  };

  if (parent) {
    if (parent.aborted) {
      clearTimeout(timer);
      controller.abort(parent.reason);
    } else {
      parent.addEventListener('abort', onAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      parent?.removeEventListener('abort', onAbort);
    },
  };
}

export const LANG_NAME_MAP: Record<LanguageCode, string> = {
  auto: 'the detected source language',
  'zh-CN': 'Simplified Chinese (简体中文)',
  'zh-TW': 'Traditional Chinese (繁體中文)',
  en: 'English',
  ja: 'Japanese (日本語)',
  ko: 'Korean (한국어)',
  fr: 'French',
  de: 'German',
  es: 'Spanish',
  ru: 'Russian',
  pt: 'Portuguese',
  it: 'Italian',
};
