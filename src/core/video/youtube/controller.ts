import type { ExtensionSettings } from '../../config/types';
import { getEngineById } from '../../config/storage';
import { sharedPortClient } from '../../messaging/port-client';
import { downloadSubtitleFile } from '../core/exporter';
import {
  applyLlmResegmentation,
  parseWebVtt,
  parseYouTubeJson3,
  smartResegmentCues,
} from '../core/segmenter';
import type { SubtitleCue, SubtitleTrackMeta, VideoMetadata, YtJson3Payload } from '../core/types';
import { SlidingWindowSubtitleTranslator } from '../core/window-translator';
import { VideoSubtitleOverlay } from '../overlay/SubtitleOverlay';
import { diagLog } from '../../debug/logger';

export const YT_BRIDGE_CHANNEL = 'luminous-yt-bridge-v1';

interface YtMainTimedtextEvent {
  channel: typeof YT_BRIDGE_CHANNEL;
  type: 'TIMEDTEXT_CAPTURED';
  videoId: string;
  url: string;
  lang: string;
  isAsr: boolean;
  format: 'json3' | 'vtt';
  payload: unknown;
}

interface YtMainMetaEvent {
  channel: typeof YT_BRIDGE_CHANNEL;
  type: 'PLAYER_META';
  videoId: string;
  title?: string;
  author?: string;
  description?: string;
  durationSec?: number;
  tracks: SubtitleTrackMeta[];
}

interface YtMainNavigateEvent {
  channel: typeof YT_BRIDGE_CHANNEL;
  type: 'NAVIGATE';
  videoId: string;
}

type YtMainEvent = YtMainTimedtextEvent | YtMainMetaEvent | YtMainNavigateEvent;

const HIDE_NATIVE_CSS_ID = 'luminous-yt-hide-native-cc';
const YT_BUTTON_ID = 'luminous-yt-sub-btn';

export class YouTubeSubtitleController {
  private settings: ExtensionSettings;
  private enabled: boolean;
  private currentVideoId = '';
  private currentMeta: VideoMetadata | null = null;
  private availableTracks: SubtitleTrackMeta[] = [];
  private activeTrackLang = '';

  private overlay: VideoSubtitleOverlay | null = null;
  private translator: SlidingWindowSubtitleTranslator | null = null;
  private boundVideoEl: HTMLVideoElement | null = null;
  private lastCapturedPayload: YtMainTimedtextEvent | null = null;
  private controlBarObserver: MutationObserver | null = null;

  constructor(settings: ExtensionSettings) {
    this.settings = settings;
    this.enabled = settings.video.enabledYoutube && settings.video.autoEnableOnPlay;
    this.listenMainWorld();
    this.observePlayerControls();
    this.requestPlayerMeta();
  }

  isActive(): boolean {
    return this.enabled && !!this.currentVideoId;
  }

  updateSettings(next: ExtensionSettings): void {
    const engineChanged =
      next.activeVideoEngineId !== this.settings.activeVideoEngineId ||
      next.targetLang !== this.settings.targetLang ||
      next.video.smartSegmentation !== this.settings.video.smartSegmentation;

    this.settings = next;
    this.overlay?.updateSettings(next.video);
    this.syncHideNativeCaptions();

    if (engineChanged && this.enabled && this.lastCapturedPayload) {
      void this.processCapturedSubtitles(this.lastCapturedPayload);
    }
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    this.updatePlayerButtonVisual();
    this.syncHideNativeCaptions();

    if (!this.enabled) {
      this.overlay?.setActive(false);
      this.translator?.destroy();
      this.translator = null;
      return false;
    }

    this.ensureOverlayMounted();
    this.overlay?.setActive(true);
    if (this.lastCapturedPayload && this.lastCapturedPayload.videoId === this.currentVideoId) {
      void this.processCapturedSubtitles(this.lastCapturedPayload);
    } else {
      this.overlay?.setStatus('正在加载字幕轨...', 3500);
      this.requestNativeTrackTrigger();
    }
    return true;
  }

  destroy(): void {
    this.translator?.destroy();
    this.overlay?.destroy();
    this.controlBarObserver?.disconnect();
    document.getElementById(HIDE_NATIVE_CSS_ID)?.remove();
    document.getElementById(YT_BUTTON_ID)?.remove();
  }

  private listenMainWorld(): void {
    window.addEventListener('message', (event) => {
      if (event.source !== window || !event.data) return;
      const data = event.data as YtMainEvent;
      if (data.channel !== YT_BRIDGE_CHANNEL) return;

      switch (data.type) {
        case 'NAVIGATE':
          this.handleVideoSwitch(data.videoId);
          break;
        case 'PLAYER_META':
          this.handlePlayerMeta(data);
          break;
        case 'TIMEDTEXT_CAPTURED':
          this.handleTimedtextCaptured(data);
          break;
      }
    });
  }

  private handleVideoSwitch(videoId: string): void {
    if (!videoId || videoId === this.currentVideoId) return;
    this.currentVideoId = videoId;
    this.availableTracks = [];
    this.lastCapturedPayload = null;
    this.translator?.destroy();
    this.translator = null;
    this.overlay?.setCues([]);
    this.overlay?.setStatus(null);
    this.requestPlayerMeta();
  }

  private handlePlayerMeta(data: YtMainMetaEvent): void {
    if (!data.videoId) return;
    if (this.currentVideoId && this.currentVideoId !== data.videoId) {
      this.handleVideoSwitch(data.videoId);
    }
    this.currentVideoId = data.videoId;
    this.currentMeta = {
      platform: 'youtube',
      videoId: data.videoId,
      title: data.title,
      author: data.author,
      description: data.description,
      durationSec: data.durationSec,
    };
    this.availableTracks = data.tracks ?? [];
    this.ensureOverlayMounted();

    if (this.enabled && this.availableTracks.length > 0 && !this.lastCapturedPayload) {
      this.requestNativeTrackTrigger();
    } else if (this.enabled && this.availableTracks.length === 0) {
      this.overlay?.setStatus('此视频无官方字幕', 4000);
    }
  }

  private handleTimedtextCaptured(data: YtMainTimedtextEvent): void {
    if (data.videoId) {
      this.currentVideoId = data.videoId;
    }
    this.lastCapturedPayload = data;
    this.activeTrackLang = data.lang || 'auto';

    if (!this.enabled) return;
    void this.processCapturedSubtitles(data);
  }

  private async processCapturedSubtitles(data: YtMainTimedtextEvent): Promise<void> {
    this.ensureOverlayMounted();
    if (!this.overlay || !this.boundVideoEl) return;

    this.overlay.setActive(true);
    this.syncHideNativeCaptions();
    this.overlay.setStatus('正在清洗并智能断句...');

    let cues: SubtitleCue[] = [];

    if (data.format === 'json3' && data.payload && typeof data.payload === 'object') {
      const parsed = parseYouTubeJson3(data.payload as YtJson3Payload, data.isAsr);

      if (this.settings.video.smartSegmentation) {
        cues = smartResegmentCues(parsed.rawCues);

        // Optional LLM semantic re-segmentation pass for unpunctuated ASR when LLM engine is active
        const engine = getEngineById(this.settings, this.settings.activeVideoEngineId);
        const isLlm =
          engine.kind === 'ollama' ||
          engine.kind === 'deepseek' ||
          engine.kind === 'openai' ||
          engine.kind === 'anthropic' ||
          engine.kind === 'openai-compatible';

        if (
          this.settings.video.llmSemanticResegment &&
          parsed.needsAsrResegment &&
          isLlm &&
          parsed.tokens.length > 20 &&
          parsed.tokens.length <= 1500
        ) {
          try {
            this.overlay.setStatus('AI 语义重断句中...');
            const llmSegs = await sharedPortClient.resegmentAsr({
              engineId: engine.id,
              tokens: parsed.tokens.map((t, idx) => ({ idx, text: t.text })),
            });
            const refined = applyLlmResegmentation(parsed.tokens, llmSegs);
            if (refined.length > 0) cues = refined;
          } catch {
            // Fall back smoothly to rule-based smart segmentation
          }
        }
      } else {
        cues = parsed.rawCues;
      }
    } else if (data.format === 'vtt' && typeof data.payload === 'string') {
      const rawVtt = parseWebVtt(data.payload);
      cues = this.settings.video.smartSegmentation ? smartResegmentCues(rawVtt) : rawVtt;
    }

    if (cues.length === 0) {
      this.overlay.setStatus('字幕内容为空', 3000);
      return;
    }

    this.overlay.setCues(cues);

    this.translator?.destroy();
    const meta: VideoMetadata = this.currentMeta ?? {
      platform: 'youtube',
      videoId: this.currentVideoId || 'unknown',
      title: document.title.replace(/\s*-\s*YouTube$/i, ''),
    };

    this.translator = new SlidingWindowSubtitleTranslator(
      cues,
      meta,
      this.settings,
      this.activeTrackLang,
      {
        onCuesUpdated: (updated) => {
          this.overlay?.setCues(updated);
        },
        onStatusChange: (status) => {
          if (status.state === 'ready') {
            this.overlay?.setStatus(status.message ?? '字幕就绪', 2200);
          } else if (status.state === 'error') {
            diagLog('youtube', 'error', `YouTube 字幕翻译失败 (${this.currentVideoId})`, status.message);
            this.overlay?.setStatus(`翻译错误: ${status.message ?? ''}`, 6000);
          } else {
            this.overlay?.setStatus(status.message ?? null);
          }
        },
      },
    );

    await this.translator.initialize(this.boundVideoEl.currentTime);
  }

  private ensureOverlayMounted(): void {
    const player =
      document.querySelector<HTMLElement>('.html5-video-player') ??
      document.querySelector<HTMLElement>('#movie_player');
    const video = player?.querySelector<HTMLVideoElement>('video');
    if (!player || !video) return;

    if (this.boundVideoEl === video && this.overlay) return;

    this.overlay?.destroy();
    this.boundVideoEl = video;

    video.addEventListener('seeked', () => {
      this.translator?.onPlaybackCursor(video.currentTime, true);
    });
    video.addEventListener('timeupdate', () => {
      this.translator?.onPlaybackCursor(video.currentTime, false);
    });

    this.overlay = new VideoSubtitleOverlay(player, video, this.settings.video, {
      onExportSrt: () => {
        const cues = this.translator?.getCues() ?? [];
        if (cues.length > 0) {
          downloadSubtitleFile(
            cues,
            'srt',
            this.currentMeta?.title ?? this.currentVideoId,
            this.settings.video.bilingualOrder,
          );
        }
      },
      onClose: () => {
        this.enabled = false;
        this.updatePlayerButtonVisual();
        this.syncHideNativeCaptions();
      },
    });
  }

  private syncHideNativeCaptions(): void {
    const shouldHide = this.enabled && this.settings.video.hideNativeCaptions;
    let styleEl = document.getElementById(HIDE_NATIVE_CSS_ID) as HTMLStyleElement | null;
    if (shouldHide) {
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = HIDE_NATIVE_CSS_ID;
        styleEl.textContent = `.ytp-caption-window-container { opacity: 0 !important; pointer-events: none !important; }`;
        (document.head || document.documentElement).appendChild(styleEl);
      }
    } else {
      styleEl?.remove();
    }
  }

  private requestPlayerMeta(): void {
    window.postMessage({ channel: YT_BRIDGE_CHANNEL, type: 'REQUEST_META' }, '*');
  }

  private requestNativeTrackTrigger(): void {
    window.postMessage(
      {
        channel: YT_BRIDGE_CHANNEL,
        type: 'TRIGGER_CAPTIONS',
        targetLang: this.settings.targetLang,
      },
      '*',
    );
  }

  private observePlayerControls(): void {
    const injectButton = () => {
      const rightControls = document.querySelector<HTMLElement>('.ytp-right-controls');
      if (!rightControls || document.getElementById(YT_BUTTON_ID)) return;

      const btn = document.createElement('button');
      btn.id = YT_BUTTON_ID;
      btn.className = 'ytp-button';
      btn.type = 'button';
      btn.title = 'OpenDual 双语字幕开关';
      btn.style.cssText =
        'display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;width:44px;vertical-align:top;';
      btn.textContent = '双语';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggle();
      });

      rightControls.prepend(btn);
      this.updatePlayerButtonVisual();
    };

    injectButton();
    this.controlBarObserver = new MutationObserver(() => injectButton());
    this.controlBarObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  private updatePlayerButtonVisual(): void {
    const btn = document.getElementById(YT_BUTTON_ID);
    if (!btn) return;
    btn.style.color = this.enabled ? '#38bdf8' : 'rgba(255,255,255,0.72)';
    btn.style.textShadow = this.enabled ? '0 0 8px rgba(56,189,248,0.65)' : 'none';
  }
}
