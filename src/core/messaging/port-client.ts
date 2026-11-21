import {
  TRANSLATION_PORT_NAME,
  type AsrDirectMediaPayload,
  type PortClientMessage,
  type PortServerMessage,
  type ResegmentPayload,
  type TranslateBatchPayload,
} from './protocol';
import type { SubtitleCue } from '../video/core/types';

interface PendingHandlers<T> {
  resolve: (value: T) => void;
  reject: (err: Error) => void;
  onProgress?: (stage: string, percent: number, message: string) => void;
}

export interface BatchTranslateOutcome {
  translations: Array<{ i: number; text: string }>;
  usedEngineId: string;
  fallbackTriggered?: boolean;
  cachedCount: number;
}

/**
 * Long-lived MV3 Port client between Content Script and Background Service Worker.
 * Automatically reconnects if the Service Worker restarts after idle, while keeping
 * the SW alive during long local Ollama / LLM inference calls.
 */
export class TranslationPortClient {
  private port: chrome.runtime.Port | null = null;
  private pending = new Map<string, PendingHandlers<unknown>>();
  private seq = 0;

  private ensurePort(): chrome.runtime.Port {
    if (this.port) return this.port;
    const port = chrome.runtime.connect({ name: TRANSLATION_PORT_NAME });
    this.port = port;

    port.onMessage.addListener((msg: PortServerMessage) => {
      if (msg.type === 'PONG') return;
      const entry = this.pending.get(msg.requestId);
      if (!entry) return;

      switch (msg.type) {
        case 'TRANSLATE_RESULT':
          this.pending.delete(msg.requestId);
          entry.resolve({
            translations: msg.translations,
            usedEngineId: msg.usedEngineId,
            fallbackTriggered: msg.fallbackTriggered,
            cachedCount: msg.cachedCount,
          } satisfies BatchTranslateOutcome);
          break;
        case 'TRANSLATE_ERROR':
          this.pending.delete(msg.requestId);
          entry.reject(new Error(msg.error));
          break;
        case 'RESEGMENT_RESULT':
          this.pending.delete(msg.requestId);
          entry.resolve(msg.segments);
          break;
        case 'RESEGMENT_ERROR':
          this.pending.delete(msg.requestId);
          entry.reject(new Error(msg.error));
          break;
        case 'ASR_PROGRESS':
          entry.onProgress?.(msg.stage, msg.percent, msg.message);
          break;
        case 'ASR_RESULT':
          this.pending.delete(msg.requestId);
          entry.resolve(msg.cues);
          break;
        case 'ASR_ERROR':
          this.pending.delete(msg.requestId);
          entry.reject(new Error(msg.error));
          break;
      }
    });

    port.onDisconnect.addListener(() => {
      this.port = null;
      for (const [id, handlers] of this.pending.entries()) {
        handlers.reject(new Error('后台服务连接已断开，请重试'));
        this.pending.delete(id);
      }
    });

    return port;
  }

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}_${Date.now()}_${this.seq}`;
  }

  private post(msg: PortClientMessage): void {
    this.ensurePort().postMessage(msg);
  }

  translateBatch(
    payload: Omit<TranslateBatchPayload, 'requestId'>,
    signal?: AbortSignal,
  ): Promise<BatchTranslateOutcome> {
    const requestId = this.nextId('tr');
    return new Promise<BatchTranslateOutcome>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error('翻译请求已取消'));
        return;
      }
      this.pending.set(requestId, {
        resolve: resolve as (v: unknown) => void,
        reject,
      });

      const onAbort = () => {
        if (this.pending.has(requestId)) {
          this.pending.delete(requestId);
          try {
            this.post({ type: 'CANCEL_REQUEST', requestId });
          } catch {
            // Ignore disconnect during cancel
          }
          reject(new Error('翻译请求已取消'));
        }
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      try {
        this.post({
          type: 'TRANSLATE_BATCH',
          payload: { ...payload, requestId },
        });
      } catch (err) {
        this.pending.delete(requestId);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  resegmentAsr(
    payload: Omit<ResegmentPayload, 'requestId'>,
    signal?: AbortSignal,
  ): Promise<Array<{ startIdx: number; endIdx: number; text: string }>> {
    const requestId = this.nextId('seg');
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error('已取消'));
        return;
      }
      this.pending.set(requestId, {
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      signal?.addEventListener(
        'abort',
        () => {
          if (this.pending.has(requestId)) {
            this.pending.delete(requestId);
            try {
              this.post({ type: 'CANCEL_REQUEST', requestId });
            } catch {
              // Ignore
            }
            reject(new Error('已取消'));
          }
        },
        { once: true },
      );
      this.post({ type: 'RESEGMENT_ASR', payload: { ...payload, requestId } });
    });
  }

  requestDirectMediaAsr(
    payload: Omit<AsrDirectMediaPayload, 'requestId'>,
    onProgress?: (stage: string, percent: number, message: string) => void,
    signal?: AbortSignal,
  ): Promise<SubtitleCue[]> {
    const requestId = this.nextId('asr');
    return new Promise<SubtitleCue[]>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error('已取消'));
        return;
      }
      this.pending.set(requestId, {
        resolve: resolve as (v: unknown) => void,
        reject,
        onProgress,
      });
      signal?.addEventListener(
        'abort',
        () => {
          if (this.pending.has(requestId)) {
            this.pending.delete(requestId);
            try {
              this.post({ type: 'CANCEL_REQUEST', requestId });
            } catch {
              // Ignore
            }
            reject(new Error('已取消'));
          }
        },
        { once: true },
      );
      this.post({ type: 'ASR_DIRECT_MEDIA', payload: { ...payload, requestId } });
    });
  }

  disconnect(): void {
    this.port?.disconnect();
    this.port = null;
    this.pending.clear();
  }
}

export const sharedPortClient = new TranslationPortClient();
