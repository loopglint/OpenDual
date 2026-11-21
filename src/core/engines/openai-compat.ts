import type { EngineProfile } from '../config/types';
import {
  createTimeoutSignal,
  EngineError,
  normalizeBaseUrl,
  type ResegmentSegment,
  type TranslateBatchRequest,
  type TranslateBatchResult,
  type TranslateItem,
  type TranslationProvider,
} from './types';
import { buildSystemPrompt, buildUserPayload } from './prompts';
import { parseResegmentResponse, parseStructuredBatchResponse } from './parser';
import { DEFAULT_SETTINGS } from '../config/defaults';

function resolveChatEndpoint(profile: EngineProfile): string {
  const defaultBase =
    profile.kind === 'deepseek' ? 'https://api.deepseek.com' : 'https://api.openai.com/v1';
  const base = normalizeBaseUrl(profile.baseUrl ?? '', defaultBase);
  if (/\/chat\/completions$/i.test(base)) return base;
  if (/\/v1$/i.test(base) || /\/openai$/i.test(base)) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}

function isReasonerModel(model: string): boolean {
  const lower = model.toLowerCase();
  return (
    lower.includes('reasoner') ||
    lower.startsWith('o1') ||
    lower.startsWith('o3') ||
    lower.startsWith('o4')
  );
}

interface CompletionOutput {
  content: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    cacheHitTokens?: number;
  };
}

async function parseSseCompletion(resp: Response): Promise<CompletionOutput> {
  if (!resp.body) {
    const json = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        prompt_cache_hit_tokens?: number;
      };
    };
    return {
      content: json.choices?.[0]?.message?.content ?? '',
      usage: json.usage
        ? {
            promptTokens: json.usage.prompt_tokens,
            completionTokens: json.usage.completion_tokens,
            cacheHitTokens: json.usage.prompt_cache_hit_tokens,
          }
        : undefined,
    };
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let usage: CompletionOutput['usage'];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const dataStr = trimmed.slice(5).trim();
      if (dataStr === '[DONE]') continue;
      try {
        const chunk = JSON.parse(dataStr) as {
          choices?: Array<{
            delta?: {
              content?: string | null;
              reasoning_content?: string | null; // DeepSeek-R1 reasoning field — intentionally ignored
            };
          }>;
          usage?: {
            prompt_tokens?: number;
            completion_tokens?: number;
            prompt_cache_hit_tokens?: number;
          };
        };
        const deltaContent = chunk.choices?.[0]?.delta?.content;
        if (typeof deltaContent === 'string' && deltaContent.length > 0) {
          content += deltaContent;
        }
        if (chunk.usage) {
          usage = {
            promptTokens: chunk.usage.prompt_tokens,
            completionTokens: chunk.usage.completion_tokens,
            cacheHitTokens: chunk.usage.prompt_cache_hit_tokens,
          };
        }
      } catch {
        // Ignore partial SSE JSON
      }
    }
  }

  return { content, usage };
}

export class OpenAiCompatProvider implements TranslationProvider {
  readonly profile: EngineProfile;
  readonly capabilities = {
    supportsBatch: true,
    supportsStream: true,
    supportsContext: true,
    supportsHtmlTags: true,
    supportsResegment: true,
  };

  constructor(profile: EngineProfile) {
    this.profile = profile;
  }

  private async chatCompletion(
    systemPrompt: string,
    userMessage: string,
    signal: AbortSignal,
    forceJson = true,
  ): Promise<CompletionOutput> {
    const url = resolveChatEndpoint(this.profile);
    const model = (this.profile.model ?? '').trim();
    if (!model) {
      throw new EngineError(`引擎 "${this.profile.name}" 未配置模型名称`, 'MODEL_NOT_FOUND', {
        retryable: false,
      });
    }

    const isLocalHost = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(url);
    const apiKey = (this.profile.apiKey ?? '').trim();
    if (!apiKey && !isLocalHost) {
      throw new EngineError(`引擎 "${this.profile.name}" 尚未填写 API Key`, 'AUTH', {
        retryable: false,
      });
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      ...(this.profile.customHeaders ?? {}),
    };

    const reasoner = isReasonerModel(model);
    const streaming = this.profile.streaming !== false;

    const payload: Record<string, unknown> = {
      model,
      stream: streaming,
      // Keep system message completely static as first message to maximize DeepSeek / OpenAI Prompt Caching!
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      ...(this.profile.extraBody ?? {}),
    };

    if (!reasoner) {
      payload.temperature = this.profile.temperature ?? 0.1;
      if (forceJson && this.profile.kind !== 'openai-compatible') {
        payload.response_format = { type: 'json_object' };
      } else if (forceJson && this.profile.kind === 'openai-compatible') {
        // OpenAI-compatible gateways broadly support json_object; harmless to enable when model supports it
        payload.response_format = { type: 'json_object' };
      }
    }

    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal,
    });

    if (resp.status === 401 || resp.status === 403) {
      throw new EngineError(`${this.profile.name} 认证失败 (${resp.status})，请检查 API Key 或余额`, 'AUTH', {
        retryable: false,
        status: resp.status,
      });
    }
    if (resp.status === 429) {
      throw new EngineError(`${this.profile.name} 触发速率限制 (429)`, 'RATE_LIMIT', {
        retryable: true,
        status: 429,
      });
    }
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      // Retry without response_format if a custom OpenAI-compatible provider rejects it (HTTP 400)
      if (resp.status === 400 && payload.response_format && /response_format/i.test(errText)) {
        delete payload.response_format;
        const retryResp = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal,
        });
        if (retryResp.ok) {
          return streaming
            ? parseSseCompletion(retryResp)
            : this.parseJsonCompletion(retryResp);
        }
      }
      throw new EngineError(
        `${this.profile.name} 请求失败 (${resp.status}): ${errText.slice(0, 220)}`,
        resp.status >= 500 ? 'NETWORK' : 'UNKNOWN',
        { retryable: resp.status >= 500, status: resp.status },
      );
    }

    if (streaming) {
      return parseSseCompletion(resp);
    }
    return this.parseJsonCompletion(resp);
  }

  private async parseJsonCompletion(resp: Response): Promise<CompletionOutput> {
    const json = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        prompt_cache_hit_tokens?: number;
      };
    };
    return {
      content: json.choices?.[0]?.message?.content ?? '',
      usage: json.usage
        ? {
            promptTokens: json.usage.prompt_tokens,
            completionTokens: json.usage.completion_tokens,
            cacheHitTokens: json.usage.prompt_cache_hit_tokens,
          }
        : undefined,
    };
  }

  private async translateSliceWithHealing(
    req: TranslateBatchRequest,
    items: TranslateItem[],
    systemPrompt: string,
    signal: AbortSignal,
    depth: number,
  ): Promise<{ matched: Map<number, string>; usage?: CompletionOutput['usage'] }> {
    const subReq: TranslateBatchRequest = { ...req, items };
    const userPayload = buildUserPayload(subReq);
    const completion = await this.chatCompletion(systemPrompt, userPayload, signal, true);
    const { matched, missingIndices } = parseStructuredBatchResponse(completion.content, items);

    if (missingIndices.length > 0 && depth < 2) {
      const missingItems = items.filter((it) => missingIndices.includes(it.i));
      if (missingItems.length === 1) {
        const single = missingItems[0];
        if (!single) return { matched, usage: completion.usage };
        const fallback = await this.chatCompletion(
          `Translate the text into ${req.targetLang}. Preserve all <v id="N"/> and <g id="N">...</g> tags verbatim. Return ONLY the translated text.`,
          single.text,
          signal,
          false,
        );
        const { matched: singleMatched } = parseStructuredBatchResponse(fallback.content, [single]);
        const text = singleMatched.get(single.i);
        if (text) matched.set(single.i, text);
      } else {
        const mid = Math.ceil(missingItems.length / 2);
        const [left, right] = await Promise.all([
          this.translateSliceWithHealing(req, missingItems.slice(0, mid), systemPrompt, signal, depth + 1),
          this.translateSliceWithHealing(req, missingItems.slice(mid), systemPrompt, signal, depth + 1),
        ]);
        for (const [k, v] of left.matched) matched.set(k, v);
        for (const [k, v] of right.matched) matched.set(k, v);
      }
    }

    return { matched, usage: completion.usage };
  }

  async translateBatch(req: TranslateBatchRequest, parentSignal: AbortSignal): Promise<TranslateBatchResult> {
    const { signal, cleanup } = createTimeoutSignal(parentSignal, this.profile.timeoutMs ?? 60000);
    try {
      const systemPrompt = buildSystemPrompt(req);
      const { matched, usage } = await this.translateSliceWithHealing(
        req,
        req.items,
        systemPrompt,
        signal,
        0,
      );
      return {
        items: req.items.map((item) => ({
          i: item.i,
          text: matched.get(item.i) ?? item.text,
        })),
        usage,
      };
    } finally {
      cleanup();
    }
  }

  async resegment(
    tokens: Array<{ idx: number; text: string }>,
    systemPrompt: string,
    parentSignal: AbortSignal,
  ): Promise<ResegmentSegment[]> {
    const { signal, cleanup } = createTimeoutSignal(parentSignal, this.profile.timeoutMs ?? 60000);
    try {
      const formatted = tokens.map((t) => `[${t.idx}]${t.text}`).join(' ');
      const { content } = await this.chatCompletion(systemPrompt, formatted, signal, true);
      return parseResegmentResponse(content, tokens.length);
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
          items: [{ i: 0, text: 'Hello, AI bilingual translation!' }],
          glossary: [],
          prompts: DEFAULT_SETTINGS.prompts,
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
