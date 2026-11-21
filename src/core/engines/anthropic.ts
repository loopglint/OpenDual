import type { EngineProfile } from '../config/types';
import {
  createTimeoutSignal,
  EngineError,
  normalizeBaseUrl,
  type ResegmentSegment,
  type TranslateBatchRequest,
  type TranslateBatchResult,
  type TranslationProvider,
} from './types';
import { buildSystemPrompt, buildUserPayload } from './prompts';
import { parseResegmentResponse, parseStructuredBatchResponse } from './parser';
import { DEFAULT_SETTINGS } from '../config/defaults';

export class AnthropicProvider implements TranslationProvider {
  readonly profile: EngineProfile;
  readonly capabilities = {
    supportsBatch: true,
    supportsStream: false,
    supportsContext: true,
    supportsHtmlTags: true,
    supportsResegment: true,
  };

  constructor(profile: EngineProfile) {
    this.profile = profile;
  }

  private async callMessages(systemPrompt: string, userMessage: string, signal: AbortSignal): Promise<string> {
    const apiKey = (this.profile.apiKey ?? '').trim();
    if (!apiKey) {
      throw new EngineError('Anthropic Claude API Key 未填写', 'AUTH', { retryable: false });
    }
    const base = normalizeBaseUrl(this.profile.baseUrl ?? '', 'https://api.anthropic.com');
    const url = /\/v1\/messages$/i.test(base) ? base : `${base}/v1/messages`;

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        ...(this.profile.customHeaders ?? {}),
      },
      body: JSON.stringify({
        model: this.profile.model || 'claude-3-5-haiku-latest',
        max_tokens: 4096,
        temperature: this.profile.temperature ?? 0.1,
        system: [
          {
            type: 'text',
            text: systemPrompt,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{ role: 'user', content: userMessage }],
        ...(this.profile.extraBody ?? {}),
      }),
      signal,
    });

    if (resp.status === 401 || resp.status === 403) {
      throw new EngineError(`Anthropic 认证失败 (${resp.status})`, 'AUTH', {
        retryable: false,
        status: resp.status,
      });
    }
    if (resp.status === 429) {
      throw new EngineError('Anthropic 触发速率限制 (429)', 'RATE_LIMIT', { status: 429 });
    }
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new EngineError(`Anthropic 请求失败 (${resp.status}): ${errText.slice(0, 200)}`, 'NETWORK', {
        status: resp.status,
      });
    }

    const data = (await resp.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    return (data.content ?? [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('');
  }

  async translateBatch(req: TranslateBatchRequest, parentSignal: AbortSignal): Promise<TranslateBatchResult> {
    const { signal, cleanup } = createTimeoutSignal(parentSignal, this.profile.timeoutMs ?? 60000);
    try {
      const systemPrompt = buildSystemPrompt(req);
      const userPayload = buildUserPayload(req);
      const raw = await this.callMessages(systemPrompt, userPayload, signal);
      const { matched, missingIndices } = parseStructuredBatchResponse(raw, req.items);

      if (missingIndices.length > 0) {
        for (const missingId of missingIndices) {
          const item = req.items.find((x) => x.i === missingId);
          if (!item) continue;
          const retryRaw = await this.callMessages(
            `Translate into ${req.targetLang}, preserving <v id="N"/> and <g id="N">...</g> tags. Return ONLY the translation.`,
            item.text,
            signal,
          );
          if (retryRaw.trim()) matched.set(item.i, retryRaw.trim());
        }
      }

      return {
        items: req.items.map((it) => ({ i: it.i, text: matched.get(it.i) ?? it.text })),
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
      const raw = await this.callMessages(systemPrompt, formatted, signal);
      return parseResegmentResponse(raw, tokens.length);
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
          items: [{ i: 0, text: 'Hello from Claude!' }],
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
