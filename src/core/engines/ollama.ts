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

export interface OllamaModelInfo {
  name: string;
  sizeBytes?: number;
  parameterSize?: string;
}

export async function listOllamaModels(baseUrl: string): Promise<OllamaModelInfo[]> {
  const root = normalizeBaseUrl(baseUrl, 'http://localhost:11434').replace(/\/v1$/i, '');
  const resp = await fetch(`${root}/api/tags`, { method: 'GET' });
  if (resp.status === 403) {
    throw new EngineError(
      'Ollama 拒绝访问 (HTTP 403 CORS)。请开启插件的“自动修复本地 CORS”或配置环境变量 OLLAMA_ORIGINS="chrome-extension://*" 后重启 Ollama。',
      'CORS_OLLAMA',
      { retryable: false, status: 403 },
    );
  }
  if (!resp.ok) {
    throw new EngineError(`无法拉取 Ollama 模型列表 (HTTP ${resp.status})`, 'NETWORK', {
      status: resp.status,
    });
  }
  const data = (await resp.json()) as {
    models?: Array<{ name: string; size?: number; details?: { parameter_size?: string } }>;
  };
  return (data.models ?? []).map((m) => ({
    name: m.name,
    sizeBytes: m.size,
    parameterSize: m.details?.parameter_size,
  }));
}

async function readNdjsonStream(resp: Response): Promise<string> {
  if (!resp.body) {
    const json = (await resp.json()) as { message?: { content?: string } };
    return json.message?.content ?? '';
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const chunk = JSON.parse(trimmed) as { message?: { content?: string }; done?: boolean };
        if (chunk.message?.content) {
          content += chunk.message.content;
        }
      } catch {
        // Ignore partial chunk
      }
    }
  }
  if (buffer.trim()) {
    try {
      const tail = JSON.parse(buffer.trim()) as { message?: { content?: string } };
      if (tail.message?.content) content += tail.message.content;
    } catch {
      // Ignore
    }
  }
  return content;
}

async function readOpenAiSseStream(resp: Response): Promise<string> {
  if (!resp.body) {
    const json = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return json.choices?.[0]?.message?.content ?? '';
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';

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
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const piece = chunk.choices?.[0]?.delta?.content;
        if (piece) content += piece;
      } catch {
        // Ignore malformed SSE line
      }
    }
  }
  return content;
}

export class OllamaProvider implements TranslationProvider {
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
  ): Promise<string> {
    const root = normalizeBaseUrl(this.profile.baseUrl ?? '', 'http://localhost:11434').replace(/\/v1$/i, '');
    const model = (this.profile.model ?? '').trim();
    if (!model) {
      throw new EngineError('未指定 Ollama 模型名称（如 qwen2.5:7b）', 'MODEL_NOT_FOUND', { retryable: false });
    }

    const useOpenAiMode = this.profile.ollamaApiMode === 'openai';
    const streaming = this.profile.streaming !== false;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(this.profile.customHeaders ?? {}),
    };

    const url = useOpenAiMode ? `${root}/v1/chat/completions` : `${root}/api/chat`;
    const body = useOpenAiMode
      ? {
          model,
          temperature: this.profile.temperature ?? 0.1,
          stream: streaming,
          ...(forceJson ? { response_format: { type: 'json_object' } } : {}),
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          ...(this.profile.extraBody ?? {}),
        }
      : {
          model,
          stream: streaming,
          keep_alive: this.profile.ollamaKeepAlive ?? '10m',
          ...(this.profile.ollamaDisableThinking ? { think: false } : {}),
          ...(forceJson ? { format: 'json' } : {}),
          options: {
            temperature: this.profile.temperature ?? 0.1,
            num_ctx: this.profile.ollamaNumCtx ?? 4096,
          },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          ...(this.profile.extraBody ?? {}),
        };

    let resp: Response;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (signal.aborted) {
        throw err instanceof EngineError ? err : new EngineError('Ollama 请求已取消或超时', 'TIMEOUT');
      }
      throw new EngineError(
        `无法连接到本地 Ollama (${root})，请确认 Ollama 正在运行。详情: ${err instanceof Error ? err.message : String(err)}`,
        'NETWORK',
        { retryable: false },
      );
    }

    if (resp.status === 403) {
      throw new EngineError(
        'Ollama 拒绝请求 (HTTP 403 CORS)。请确保已开启“自动修复本地 CORS”或设置环境变量 OLLAMA_ORIGINS="chrome-extension://*" 并重启 Ollama。',
        'CORS_OLLAMA',
        { retryable: false, status: 403 },
      );
    }
    if (resp.status === 404) {
      throw new EngineError(
        `Ollama 模型 "${model}" 未找到 (404)，请先执行 ollama pull ${model} 或在设置中刷新模型列表。`,
        'MODEL_NOT_FOUND',
        { retryable: false, status: 404 },
      );
    }
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new EngineError(`Ollama 返回错误 (${resp.status}): ${errText.slice(0, 200)}`, 'NETWORK', {
        status: resp.status,
      });
    }

    if (useOpenAiMode) {
      if (streaming) return readOpenAiSseStream(resp);
      const json = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
      return json.choices?.[0]?.message?.content ?? '';
    }

    if (streaming) {
      return readNdjsonStream(resp);
    }
    const json = (await resp.json()) as { message?: { content?: string } };
    return json.message?.content ?? '';
  }

  private async translateSliceWithHealing(
    req: TranslateBatchRequest,
    items: TranslateItem[],
    systemPrompt: string,
    signal: AbortSignal,
    depth: number,
  ): Promise<Map<number, string>> {
    const subReq: TranslateBatchRequest = { ...req, items };
    const userPayload = buildUserPayload(subReq);
    const raw = await this.chatCompletion(systemPrompt, userPayload, signal, true);
    const { matched, missingIndices } = parseStructuredBatchResponse(raw, items);

    if (missingIndices.length === 0) {
      return matched;
    }

    // Binary split self-healing for missing items (common with small 3B/7B local models)
    if (missingIndices.length > 0 && depth < 2) {
      const missingItems = items.filter((it) => missingIndices.includes(it.i));
      if (missingItems.length === 1) {
        // Direct plain-text single retry without strict JSON wrapper
        const single = missingItems[0];
        if (!single) return matched;
        const fallbackRaw = await this.chatCompletion(
          `Translate the following text into ${req.targetLang}. Preserve all <v id="N"/> and <g id="N">...</g> tags verbatim. Output ONLY the translation.`,
          single.text,
          signal,
          false,
        );
        const { matched: singleMatch } = parseStructuredBatchResponse(fallbackRaw, [single]);
        const val = singleMatch.get(single.i);
        if (val) matched.set(single.i, val);
      } else {
        const mid = Math.ceil(missingItems.length / 2);
        const left = await this.translateSliceWithHealing(
          req,
          missingItems.slice(0, mid),
          systemPrompt,
          signal,
          depth + 1,
        );
        const right = await this.translateSliceWithHealing(
          req,
          missingItems.slice(mid),
          systemPrompt,
          signal,
          depth + 1,
        );
        for (const [k, v] of left) matched.set(k, v);
        for (const [k, v] of right) matched.set(k, v);
      }
    }

    return matched;
  }

  async translateBatch(req: TranslateBatchRequest, parentSignal: AbortSignal): Promise<TranslateBatchResult> {
    const { signal, cleanup } = createTimeoutSignal(parentSignal, this.profile.timeoutMs ?? 120000);
    try {
      const systemPrompt = buildSystemPrompt(req);
      const matched = await this.translateSliceWithHealing(req, req.items, systemPrompt, signal, 0);
      return {
        items: req.items.map((item) => ({
          i: item.i,
          text: matched.get(item.i) ?? item.text,
        })),
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
    const { signal, cleanup } = createTimeoutSignal(parentSignal, this.profile.timeoutMs ?? 120000);
    try {
      const formatted = tokens.map((t) => `[${t.idx}]${t.text}`).join(' ');
      const raw = await this.chatCompletion(systemPrompt, formatted, signal, true);
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
          items: [{ i: 0, text: 'Hello from local Ollama!' }],
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
