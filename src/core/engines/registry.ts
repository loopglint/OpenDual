import type { EngineProfile, ExtensionSettings } from '../config/types';
import { getEngineById } from '../config/storage';
import { AnthropicProvider } from './anthropic';
import { ChromeBuiltinProvider } from './chrome-builtin';
import { DeepLxProvider } from './deeplx';
import { EdgeFreeProvider } from './edge-free';
import { GoogleFreeProvider } from './google-free';
import { OllamaProvider } from './ollama';
import { OpenAiCompatProvider } from './openai-compat';
import { EngineError, type TranslateBatchRequest, type TranslateBatchResult, type TranslationProvider } from './types';

export function createProvider(profile: EngineProfile): TranslationProvider {
  switch (profile.kind) {
    case 'edge-free':
      return new EdgeFreeProvider(profile);
    case 'google-free':
      return new GoogleFreeProvider(profile);
    case 'chrome-builtin':
      return new ChromeBuiltinProvider(profile);
    case 'ollama':
      return new OllamaProvider(profile);
    case 'anthropic':
      return new AnthropicProvider(profile);
    case 'deeplx':
      return new DeepLxProvider(profile);
    case 'deepseek':
    case 'openai':
    case 'openai-compatible':
    default:
      return new OpenAiCompatProvider(profile);
  }
}

export interface FallbackExecutionResult {
  result: TranslateBatchResult;
  usedEngineId: string;
  fallbackTriggered: boolean;
}

/**
 * Executes a batch translation with exponential backoff retries on transient failures,
 * and automatic fallback chain ONLY when the primary engine is a free online engine
 * (never silently swapping a user's explicit paid/local LLM without failing clearly, unless configured in fallback chain).
 */
export async function executeWithFallback(
  settings: ExtensionSettings,
  primaryEngineId: string,
  req: TranslateBatchRequest,
  signal: AbortSignal,
): Promise<FallbackExecutionResult> {
  const primaryProfile = getEngineById(settings, primaryEngineId);
  const candidateProfiles: EngineProfile[] = [primaryProfile];

  // Auto-fallback between free engines to keep out-of-the-box reliability rock-solid
  const isFreePrimary =
    primaryProfile.kind === 'edge-free' ||
    primaryProfile.kind === 'google-free' ||
    primaryProfile.kind === 'chrome-builtin';

  if (isFreePrimary) {
    for (const fallbackId of settings.fallbackEngineIds) {
      if (fallbackId === primaryProfile.id) continue;
      const p = settings.engines.find((e) => e.id === fallbackId && e.enabled);
      if (p && !candidateProfiles.some((c) => c.id === p.id)) {
        candidateProfiles.push(p);
      }
    }
  }

  let lastError: unknown;

  for (let idx = 0; idx < candidateProfiles.length; idx++) {
    const profile = candidateProfiles[idx];
    if (!profile) continue;
    const provider = createProvider(profile);

    const maxAttempts = profile.kind === 'ollama' ? 1 : 2;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (signal.aborted) {
        throw new EngineError('翻译任务已取消', 'ABORTED', { retryable: false });
      }
      try {
        const result = await provider.translateBatch(req, signal);
        return {
          result,
          usedEngineId: profile.id,
          fallbackTriggered: idx > 0,
        };
      } catch (err) {
        lastError = err;
        if (err instanceof EngineError && (err.code === 'ABORTED' || err.code === 'AUTH' || err.code === 'CORS_OLLAMA')) {
          throw err;
        }
        const canRetry = err instanceof EngineError ? err.retryable : true;
        if (canRetry && attempt + 1 < maxAttempts) {
          const backoffMs = 450 * Math.pow(2, attempt) + Math.floor(Math.random() * 200);
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          continue;
        }
        break;
      }
    }
  }

  if (lastError instanceof Error) throw lastError;
  throw new EngineError('所有可用翻译引擎均执行失败', 'UNKNOWN');
}
