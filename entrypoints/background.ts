import {
  clearCache,
  getAsrCache,
  getCacheStats,
  getPageCacheMany,
  getSubtitleCache,
  hashCacheKey,
  setAsrCache,
  setPageCacheMany,
  setSubtitleCache,
} from '@/src/core/cache/db';
import { getEngineById, loadSettings, subscribeSettings } from '@/src/core/config/storage';
import type { ExtensionSettings } from '@/src/core/config/types';
import { listOllamaModels } from '@/src/core/engines/ollama';
import { createProvider, executeWithFallback } from '@/src/core/engines/registry';
import { EngineError } from '@/src/core/engines/types';
import {
  TRANSLATION_PORT_NAME,
  type AsrDirectMediaPayload,
  type PortClientMessage,
  type PortServerMessage,
  type ResegmentPayload,
  type RuntimeRequest,
  type TranslateBatchPayload,
} from '@/src/core/messaging/protocol';
import { syncLocalCorsDnrRules } from '@/src/core/network/dnr-cors';
import { TranslationScheduler } from '@/src/core/scheduler/queue';
import { transcribeAudioBlob } from '@/src/core/video/asr/whisper-client';
import type { SubtitleCue } from '@/src/core/video/core/types';
import { diagLog, installGlobalErrorHooks } from '@/src/core/debug/logger';

export default defineBackground(() => {
  installGlobalErrorHooks('background');
  let cachedSettings: ExtensionSettings | null = null;
  const scheduler = new TranslationScheduler();

  async function getSettings(): Promise<ExtensionSettings> {
    if (!cachedSettings) {
      cachedSettings = await loadSettings();
      configureScheduler(cachedSettings);
    }
    return cachedSettings;
  }

  function configureScheduler(settings: ExtensionSettings): void {
    for (const engine of settings.engines) {
      scheduler.configureEngine(engine.id, engine.concurrency ?? 3, engine.rpmLimit);
    }
  }

  // Sync DNR CORS rules for local Ollama & local Whisper on install/startup/settings change
  const initializeDnr = async () => {
    try {
      const settings = await getSettings();
      await syncLocalCorsDnrRules(settings);
    } catch {
      // Ignore DNR initialization errors in unsupported test environments
    }
  };

  chrome.runtime.onInstalled.addListener(() => {
    void initializeDnr();
  });
  chrome.runtime.onStartup.addListener(() => {
    void initializeDnr();
  });
  void initializeDnr();

  subscribeSettings((next) => {
    cachedSettings = next;
    configureScheduler(next);
    void syncLocalCorsDnrRules(next);
  });

  // Keyboard shortcut: Alt+A toggles current tab page translation
  chrome.commands?.onCommand.addListener(async (command) => {
    if (command !== 'toggle-page-translate') return;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_PAGE_TRANSLATE' }).catch(() => {});
    }
  });

  // Long-lived Port connections keep MV3 Service Worker alive during slow local Ollama / ASR calls!
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== TRANSLATION_PORT_NAME) return;

    const inflightAborts = new Map<string, AbortController>();
    let disconnected = false;

    const safePost = (msg: PortServerMessage) => {
      if (disconnected) return;
      try {
        port.postMessage(msg);
      } catch {
        disconnected = true;
      }
    };

    port.onDisconnect.addListener(() => {
      disconnected = true;
      for (const ctrl of inflightAborts.values()) ctrl.abort();
      inflightAborts.clear();
    });

    port.onMessage.addListener((msg: PortClientMessage) => {
      if (msg.type === 'PING') {
        safePost({ type: 'PONG' });
        return;
      }
      if (msg.type === 'CANCEL_REQUEST') {
        const ctrl = inflightAborts.get(msg.requestId);
        if (ctrl) {
          ctrl.abort();
          inflightAborts.delete(msg.requestId);
        }
        return;
      }

      if (msg.type === 'TRANSLATE_BATCH') {
        void handleTranslateBatch(msg.payload, inflightAborts, safePost);
      } else if (msg.type === 'RESEGMENT_ASR') {
        void handleResegmentAsr(msg.payload, inflightAborts, safePost);
      } else if (msg.type === 'ASR_DIRECT_MEDIA') {
        void handleDirectMediaAsr(msg.payload, inflightAborts, safePost);
      }
    });
  });

  async function handleTranslateBatch(
    payload: TranslateBatchPayload,
    inflightAborts: Map<string, AbortController>,
    safePost: (msg: PortServerMessage) => void,
  ): Promise<void> {
    const ctrl = new AbortController();
    inflightAborts.set(payload.requestId, ctrl);

    try {
      const settings = await getSettings();
      const targetEngineId =
        payload.engineId ??
        (payload.scope === 'subtitle' ? settings.activeVideoEngineId : settings.activePageEngineId);
      const profile = getEngineById(settings, targetEngineId);

      // L2 IndexedDB Cache lookup (for webpage blocks)
      const glossaryDigest = JSON.stringify(settings.glossary.filter((g) => g.enabled));
      const promptDigest =
        payload.scope === 'subtitle'
          ? settings.prompts.subtitleSystemPrompt
          : settings.prompts.webpageSystemPrompt;

      const resolvedMap = new Map<number, string>();
      const uncachedItems: Array<{ i: number; text: string; cacheKey: string }> = [];
      let cachedCount = 0;

      if (settings.cacheEnabled && !payload.bypassCache && payload.scope === 'webpage') {
        const itemKeys = await Promise.all(
          payload.items.map((item) =>
            hashCacheKey([
              profile.id,
              profile.model ?? '',
              payload.targetLang,
              promptDigest,
              glossaryDigest,
              item.text,
            ]),
          ),
        );
        const hits = await getPageCacheMany(itemKeys, settings.cacheTtlDays);
        for (let idx = 0; idx < payload.items.length; idx++) {
          const item = payload.items[idx];
          const key = itemKeys[idx];
          if (!item || !key) continue;
          const hit = hits.get(key);
          if (hit !== undefined) {
            resolvedMap.set(item.i, hit);
            cachedCount++;
          } else {
            uncachedItems.push({ i: item.i, text: item.text, cacheKey: key });
          }
        }
      } else {
        for (const item of payload.items) {
          uncachedItems.push({ i: item.i, text: item.text, cacheKey: '' });
        }
      }

      let usedEngineId = profile.id;
      let fallbackTriggered = false;

      if (uncachedItems.length > 0) {
        const execOutcome = await scheduler.enqueue({
          id: payload.requestId,
          engineKey: profile.id,
          priority: payload.priority,
          signal: ctrl.signal,
          run: () =>
            executeWithFallback(
              settings,
              profile.id,
              {
                scope: payload.scope,
                sourceLang: payload.sourceLang,
                targetLang: payload.targetLang,
                items: uncachedItems.map((u) => ({ i: u.i, text: u.text })),
                glossary: settings.glossary,
                prompts: settings.prompts,
                videoMeta: payload.videoMeta,
                prevContext: payload.prevContext,
                pageTitle: payload.pageTitle,
              },
              ctrl.signal,
            ),
        });

        usedEngineId = execOutcome.usedEngineId;
        fallbackTriggered = execOutcome.fallbackTriggered;

        const cacheWrites = [];
        for (const translated of execOutcome.result.items) {
          resolvedMap.set(translated.i, translated.text);
          if (settings.cacheEnabled && payload.scope === 'webpage') {
            const meta = uncachedItems.find((u) => u.i === translated.i);
            if (meta?.cacheKey) {
              cacheWrites.push({
                key: meta.cacheKey,
                translation: translated.text,
                engineId: usedEngineId,
                updatedAt: Date.now(),
              });
            }
          }
        }
        if (cacheWrites.length > 0) {
          void setPageCacheMany(cacheWrites);
        }
      }

      safePost({
        type: 'TRANSLATE_RESULT',
        requestId: payload.requestId,
        ok: true,
        translations: payload.items.map((it) => ({
          i: it.i,
          text: resolvedMap.get(it.i) ?? it.text,
        })),
        usedEngineId,
        fallbackTriggered,
        cachedCount,
      });
    } catch (err) {
      if (ctrl.signal.aborted) return;
      const code = err instanceof EngineError ? err.code : 'UNKNOWN';
      const errMsg = err instanceof Error ? err.message : String(err);
      diagLog('background', 'error', `TRANSLATE_BATCH 失败 [${code}] scope=${payload.scope} engine=${payload.engineId ?? 'default'}`, err);
      safePost({
        type: 'TRANSLATE_ERROR',
        requestId: payload.requestId,
        ok: false,
        error: errMsg,
        errorCode: code,
      });
    } finally {
      inflightAborts.delete(payload.requestId);
    }
  }

  async function handleResegmentAsr(
    payload: ResegmentPayload,
    inflightAborts: Map<string, AbortController>,
    safePost: (msg: PortServerMessage) => void,
  ): Promise<void> {
    const ctrl = new AbortController();
    inflightAborts.set(payload.requestId, ctrl);
    try {
      const settings = await getSettings();
      const profile = getEngineById(settings, payload.engineId ?? settings.activeVideoEngineId);
      const provider = createProvider(profile);
      if (!provider.resegment) {
        throw new Error('当前翻译引擎不支持 AI 语义断句');
      }
      const segments = await scheduler.enqueue({
        id: payload.requestId,
        engineKey: profile.id,
        priority: 'high',
        signal: ctrl.signal,
        run: () =>
          provider.resegment!(payload.tokens, settings.prompts.resegmentSystemPrompt, ctrl.signal),
      });
      safePost({ type: 'RESEGMENT_RESULT', requestId: payload.requestId, ok: true, segments });
    } catch (err) {
      if (ctrl.signal.aborted) return;
      safePost({
        type: 'RESEGMENT_ERROR',
        requestId: payload.requestId,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      inflightAborts.delete(payload.requestId);
    }
  }

  async function ensureOffscreenDocument(): Promise<void> {
    const offscreenUrl = chrome.runtime.getURL('offscreen.html');
    const existing = await chrome.runtime.getContexts?.({
      contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType],
      documentUrls: [offscreenUrl],
    });
    if (existing && existing.length > 0) return;

    await chrome.offscreen.createDocument({
      url: offscreenUrl,
      reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
      justification: '将长视频音频解码并重采样为 16kHz 单声道 WAV 切片以供 Whisper ASR 识别',
    });
  }

  function arrayBufferToBase64(buf: ArrayBuffer): string {
    const bytes = new Uint8Array(buf);
    let binary = '';
    const step = 0x8000;
    for (let i = 0; i < bytes.length; i += step) {
      binary += String.fromCharCode(...bytes.subarray(i, i + step));
    }
    return btoa(binary);
  }

  function base64ToBlob(b64: string, mime: string): Blob {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  async function handleDirectMediaAsr(
    payload: AsrDirectMediaPayload,
    inflightAborts: Map<string, AbortController>,
    safePost: (msg: PortServerMessage) => void,
  ): Promise<void> {
    const ctrl = new AbortController();
    inflightAborts.set(payload.requestId, ctrl);

    try {
      const settings = await getSettings();
      const cacheKey = `asr:${payload.platform}:${payload.mediaKey}:${settings.video.asrModel}`;

      if (settings.cacheEnabled) {
        const cached = await getAsrCache(cacheKey);
        if (cached && cached.length > 0) {
          safePost({ type: 'ASR_RESULT', requestId: payload.requestId, ok: true, cues: cached, cached: true });
          return;
        }
      }

      safePost({
        type: 'ASR_PROGRESS',
        requestId: payload.requestId,
        stage: 'downloading',
        percent: 15,
        message: '拉取视频音频流',
      });

      const mediaResp = await fetch(payload.mediaUrl, { signal: ctrl.signal });
      if (!mediaResp.ok) {
        throw new Error(`无法下载视频音频流 (HTTP ${mediaResp.status})`);
      }
      const mediaBuf = await mediaResp.arrayBuffer();
      const sizeMb = mediaBuf.byteLength / (1024 * 1024);

      let allCues: SubtitleCue[] = [];

      // Groq/OpenAI Whisper directly accepts MP4 up to ~20MB in a single ultra-fast request!
      if (sizeMb <= 18) {
        safePost({
          type: 'ASR_PROGRESS',
          requestId: payload.requestId,
          stage: 'transcribing',
          percent: 55,
          message: 'AI 语音识别转写中',
        });
        const mp4Blob = new Blob([mediaBuf], { type: 'video/mp4' });
        allCues = await transcribeAudioBlob(mp4Blob, 'video.mp4', settings.video, 0, ctrl.signal);
      } else {
        // Larger videos: decode & resample to 16kHz mono 60s WAV chunks via Offscreen Document!
        safePost({
          type: 'ASR_PROGRESS',
          requestId: payload.requestId,
          stage: 'decoding',
          percent: 35,
          message: '音频重采样切片中',
        });
        await ensureOffscreenDocument();
        const sliceRes = (await chrome.runtime.sendMessage({
          type: 'OFFSCREEN_SLICE_AUDIO',
          mediaBase64: arrayBufferToBase64(mediaBuf),
          chunkDurationSec: 60,
        })) as { ok: boolean; chunks?: Array<{ wavBase64: string; offsetMs: number }>; error?: string };

        if (!sliceRes?.ok || !sliceRes.chunks) {
          throw new Error(sliceRes?.error || 'Offscreen 音频解码切片失败');
        }

        for (let idx = 0; idx < sliceRes.chunks.length; idx++) {
          const ch = sliceRes.chunks[idx];
          if (!ch) continue;
          const pct = Math.round(45 + ((idx + 1) / sliceRes.chunks.length) * 50);
          safePost({
            type: 'ASR_PROGRESS',
            requestId: payload.requestId,
            stage: 'transcribing',
            percent: pct,
            message: `AI 语音识别切片 ${idx + 1}/${sliceRes.chunks.length}`,
          });
          const wavBlob = base64ToBlob(ch.wavBase64, 'audio/wav');
          const chunkCues = await transcribeAudioBlob(
            wavBlob,
            `chunk_${idx}.wav`,
            settings.video,
            ch.offsetMs,
            ctrl.signal,
          );
          allCues.push(...chunkCues);
        }
      }

      // Re-index cues sequentially
      allCues = allCues.map((c, idx) => ({ ...c, id: idx + 1 }));
      if (settings.cacheEnabled && allCues.length > 0) {
        void setAsrCache(cacheKey, allCues);
      }

      safePost({
        type: 'ASR_PROGRESS',
        requestId: payload.requestId,
        stage: 'done',
        percent: 100,
        message: '语音识别完成',
      });
      safePost({ type: 'ASR_RESULT', requestId: payload.requestId, ok: true, cues: allCues });
    } catch (err) {
      if (ctrl.signal.aborted) return;
      diagLog('background', 'error', `ASR_DIRECT_MEDIA 失败 (${payload.platform})`, err);
      safePost({
        type: 'ASR_ERROR',
        requestId: payload.requestId,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      inflightAborts.delete(payload.requestId);
    }
  }

  // One-shot control messages from Popup / Options / Content Script
  chrome.runtime.onMessage.addListener(
    (msg: RuntimeRequest | { type: 'OPEN_OPTIONS_PAGE' }, _sender, sendResponse) => {
      if (!msg || typeof msg !== 'object') return false;

      if (msg.type === 'OPEN_OPTIONS_PAGE') {
        void chrome.runtime.openOptionsPage();
        sendResponse({ ok: true });
        return false;
      }

      switch (msg.type) {
        case 'TEST_ENGINE': {
          (async () => {
            // Ensure local DNR CORS rule is synced before testing Ollama/local engines
            const settings = await getSettings();
            const mergedForDnr: ExtensionSettings = {
              ...settings,
              engines: [
                ...settings.engines.filter((e) => e.id !== msg.profile.id),
                msg.profile,
              ],
            };
            await syncLocalCorsDnrRules(mergedForDnr);
            const provider = createProvider(msg.profile);
            const result = await provider.testConnection();
            if (!result.ok) {
              diagLog('background', 'warn', `测试引擎失败 (${msg.profile.id}/${msg.profile.kind})`, result.error);
            }
            sendResponse(result);
          })().catch((err) => {
            diagLog('background', 'error', `测试引擎异常 (${msg.profile.id})`, err);
            sendResponse({ ok: false, latencyMs: 0, error: String(err) });
          });
          return true;
        }

        case 'LIST_OLLAMA_MODELS': {
          (async () => {
            const settings = await getSettings();
            await syncLocalCorsDnrRules({
              ...settings,
              engines: settings.engines.map((e) =>
                e.kind === 'ollama' ? { ...e, baseUrl: msg.baseUrl, ollamaAutoFixCors: true } : e,
              ),
            });
            const models = await listOllamaModels(msg.baseUrl);
            sendResponse({ ok: true, models });
          })().catch((err) => {
            sendResponse({
              ok: false,
              error: err instanceof Error ? err.message : String(err),
              errorCode: err instanceof EngineError ? err.code : 'UNKNOWN',
            });
          });
          return true;
        }

        case 'TEST_ASR': {
          (async () => {
            const start = performance.now();
            // Create a tiny valid 0.4s silent 16kHz WAV to validate endpoint & auth key
            const samples = 6400;
            const buf = new ArrayBuffer(44 + samples * 2);
            const v = new DataView(buf);
            const ws = (o: number, s: string) => {
              for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
            };
            ws(0, 'RIFF');
            v.setUint32(4, 36 + samples * 2, true);
            ws(8, 'WAVE');
            ws(12, 'fmt ');
            v.setUint32(16, 16, true);
            v.setUint16(20, 1, true);
            v.setUint16(22, 1, true);
            v.setUint32(24, 16000, true);
            v.setUint32(28, 32000, true);
            v.setUint16(32, 2, true);
            v.setUint16(34, 16, true);
            ws(36, 'data');
            v.setUint32(40, samples * 2, true);

            const settings = await getSettings();
            await transcribeAudioBlob(
              new Blob([buf], { type: 'audio/wav' }),
              'ping.wav',
              {
                ...settings.video,
                asrBaseUrl: msg.baseUrl,
                asrApiKey: msg.apiKey,
                asrModel: msg.model,
              },
              0,
            );
            sendResponse({ ok: true, latencyMs: Math.round(performance.now() - start) });
          })().catch((err) => {
            sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
          });
          return true;
        }

        case 'GET_CACHE_STATS': {
          getCacheStats()
            .then((stats) => sendResponse({ ok: true, stats }))
            .catch((err) => sendResponse({ ok: false, error: String(err) }));
          return true;
        }

        case 'CLEAR_CACHE': {
          clearCache(msg.target ?? 'all')
            .then(() => sendResponse({ ok: true }))
            .catch((err) => sendResponse({ ok: false, error: String(err) }));
          return true;
        }

        case 'SYNC_DNR_RULES': {
          getSettings()
            .then((s) => syncLocalCorsDnrRules(s))
            .then((count) => sendResponse({ ok: true, count }))
            .catch((err) => sendResponse({ ok: false, error: String(err) }));
          return true;
        }

        case 'GET_SUBTITLE_CACHE': {
          getSettings()
            .then((s) => getSubtitleCache(msg.cacheKey, s.cacheTtlDays))
            .then((cues) => sendResponse({ ok: true, cues }))
            .catch(() => sendResponse({ ok: false }));
          return true;
        }

        case 'SET_SUBTITLE_CACHE': {
          setSubtitleCache(msg.cacheKey, msg.cues)
            .then(() => sendResponse({ ok: true }))
            .catch(() => sendResponse({ ok: false }));
          return true;
        }

        default:
          return false;
      }
    },
  );
});
