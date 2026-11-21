import type { ExtensionSettings } from '../../config/types';
import { sharedPortClient } from '../../messaging/port-client';
import { downloadSubtitleFile } from '../core/exporter';
import { parseWebVtt, smartResegmentCues } from '../core/segmenter';
import type { SubtitleCue, VideoMetadata, XInterceptedMediaInfo } from '../core/types';
import { SlidingWindowSubtitleTranslator } from '../core/window-translator';
import { VideoSubtitleOverlay } from '../overlay/SubtitleOverlay';
import { parseHlsMasterSubtitles, parseHlsVttSegments } from './hls-parser';
import { diagLog } from '../../debug/logger';

export const X_BRIDGE_CHANNEL = 'luminous-x-bridge-v1';

type XMainEvent =
  | {
      channel: typeof X_BRIDGE_CHANNEL;
      type: 'GRAPHQL_MEDIA';
      items: XInterceptedMediaInfo[];
    }
  | {
      channel: typeof X_BRIDGE_CHANNEL;
      type: 'HLS_MASTER';
      url: string;
      body: string;
    }
  | {
      channel: typeof X_BRIDGE_CHANNEL;
      type: 'VTT_CAPTURED';
      url: string;
      body: string;
    };

interface XVideoBinding {
  video: HTMLVideoElement;
  container: HTMLElement;
  tweetId: string;
  mediaInfo?: XInterceptedMediaInfo;
  overlay: VideoSubtitleOverlay;
  translator: SlidingWindowSubtitleTranslator | null;
  hasSubtitles: boolean;
  asrInFlight: boolean;
}

/**
 * X (Twitter) 3-Tier Video Subtitle Controller:
 * - Tier 1: Zero-cost instant capture from X GraphQL + HLS m3u8 SUBTITLES + VTT + native textTracks
 * - Tier 2: One-click AI ASR ("一键 AI 字幕") for captionless ("生肉") videos using Direct Media URL -> Whisper/Groq/Faster-Whisper (with tabCapture fallback)
 * - Tier 3: Virtualized feed binding by Tweet ID / Poster Media ID + automatic recycle cleanup
 */
export class XVideoSubtitleController {
  private settings: ExtensionSettings;
  private enabled: boolean;

  // LRU media cache keyed by tweetId and mediaId/poster token
  private mediaByTweetId = new Map<string, XInterceptedMediaInfo>();
  private hlsSubtitlesByHlsUrl = new Map<string, Array<{ lang: string; name: string; uri: string }>>();
  private vttBodiesByUrl = new Map<string, string>();
  private bindings = new Map<HTMLVideoElement, XVideoBinding>();
  private domObserver: MutationObserver | null = null;
  private scanTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(settings: ExtensionSettings) {
    this.settings = settings;
    this.enabled = settings.video.enabledX;
    this.listenMainWorld();
    this.observeVideos();
  }

  isActive(): boolean {
    return this.enabled && this.bindings.size > 0;
  }

  updateSettings(next: ExtensionSettings): void {
    this.settings = next;
    this.enabled = next.video.enabledX;
    for (const binding of this.bindings.values()) {
      binding.overlay.updateSettings(next.video);
      binding.overlay.setActive(this.enabled && binding.hasSubtitles);
      binding.overlay.setShowAsrButton(
        this.enabled && next.video.asrEnabled && !binding.hasSubtitles,
      );
    }
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    for (const binding of this.bindings.values()) {
      binding.overlay.setActive(this.enabled && binding.hasSubtitles);
      binding.overlay.setShowAsrButton(
        this.enabled && this.settings.video.asrEnabled && !binding.hasSubtitles,
      );
    }
    return this.enabled;
  }

  destroy(): void {
    this.domObserver?.disconnect();
    if (this.scanTimer) clearTimeout(this.scanTimer);
    for (const binding of this.bindings.values()) {
      binding.translator?.destroy();
      binding.overlay.destroy();
    }
    this.bindings.clear();
  }

  private listenMainWorld(): void {
    window.addEventListener('message', (event) => {
      if (event.source !== window || !event.data) return;
      const data = event.data as XMainEvent;
      if (data.channel !== X_BRIDGE_CHANNEL) return;

      if (data.type === 'GRAPHQL_MEDIA') {
        for (const item of data.items) {
          this.mediaByTweetId.set(item.tweetId, item);
          if (this.mediaByTweetId.size > 250) {
            const first = this.mediaByTweetId.keys().next().value;
            if (first) this.mediaByTweetId.delete(first);
          }
        }
        this.reconcileBindings();
      } else if (data.type === 'HLS_MASTER') {
        const subTracks = parseHlsMasterSubtitles(data.body, data.url);
        if (subTracks.length > 0) {
          this.hlsSubtitlesByHlsUrl.set(data.url, subTracks);
          // Also attach to any matching GraphQL media record whose hlsUrl shares the same video asset path
          for (const media of this.mediaByTweetId.values()) {
            if (media.hlsUrl && this.urlsShareAsset(media.hlsUrl, data.url)) {
              media.subtitleUrls = subTracks.map((t) => ({ lang: t.lang, name: t.name, url: t.uri }));
            }
          }
          this.reconcileBindings();
        }
      } else if (data.type === 'VTT_CAPTURED') {
        this.vttBodiesByUrl.set(data.url, data.body);
        this.reconcileBindings();
      }
    });
  }

  private urlsShareAsset(a: string, b: string): boolean {
    if (a === b) return true;
    const stripQuery = (u: string) => u.split('?')[0];
    return stripQuery(a) === stripQuery(b);
  }

  private observeVideos(): void {
    const scheduleScan = () => {
      if (this.scanTimer) return;
      this.scanTimer = setTimeout(() => {
        this.scanTimer = null;
        this.scanVideos();
      }, 300);
    };

    scheduleScan();
    this.domObserver = new MutationObserver(() => scheduleScan());
    this.domObserver.observe(document.body, { childList: true, subtree: true });
  }

  private extractTweetIdForVideo(video: HTMLVideoElement): string {
    const article = video.closest('article[data-testid="tweet"]');
    if (article) {
      const links = Array.from(article.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]'));
      for (const a of links) {
        const m = a.getAttribute('href')?.match(/\/status\/(\d+)/);
        if (m?.[1]) return m[1];
      }
    }
    const urlMatch = window.location.pathname.match(/\/status\/(\d+)/);
    if (urlMatch?.[1]) return urlMatch[1];
    return video.poster || video.currentSrc || `xvid_${Math.random().toString(36).slice(2, 8)}`;
  }

  private findMediaInfo(video: HTMLVideoElement, tweetId: string): XInterceptedMediaInfo | undefined {
    const direct = this.mediaByTweetId.get(tweetId);
    if (direct) return direct;
    // Match by poster image path if tweet ID wasn't in DOM (e.g. expanded video modal)
    const poster = video.poster;
    if (poster) {
      const posterKey = (poster.split('?')[0] ?? '').split('/').pop();
      if (posterKey) {
        for (const item of this.mediaByTweetId.values()) {
          if (item.posterUrl && item.posterUrl.includes(posterKey)) {
            return item;
          }
        }
      }
    }
    return undefined;
  }

  private scanVideos(): void {
    // Prune detached / recycled videos from X virtual timeline
    for (const [video, binding] of this.bindings.entries()) {
      if (!video.isConnected) {
        binding.translator?.destroy();
        binding.overlay.destroy();
        this.bindings.delete(video);
      }
    }

    const videos = Array.from(document.querySelectorAll<HTMLVideoElement>('video'));
    for (const video of videos) {
      if (this.bindings.has(video)) continue;
      const container =
        video.closest<HTMLElement>('[data-testid="videoPlayer"]') ??
        video.closest<HTMLElement>('[data-testid="videoComponent"]') ??
        video.parentElement;
      if (!container) continue;

      const tweetId = this.extractTweetIdForVideo(video);
      const mediaInfo = this.findMediaInfo(video, tweetId);

      const overlay = new VideoSubtitleOverlay(container, video, this.settings.video, {
        onExportSrt: () => {
          const b = this.bindings.get(video);
          const cues = b?.translator?.getCues() ?? [];
          if (cues.length > 0) {
            downloadSubtitleFile(
              cues,
              'srt',
              `x_${b?.tweetId ?? 'video'}`,
              this.settings.video.bilingualOrder,
            );
          }
        },
        onTriggerAsr: () => {
          const b = this.bindings.get(video);
          if (b) void this.triggerAsrForBinding(b);
        },
      });

      const binding: XVideoBinding = {
        video,
        container,
        tweetId,
        mediaInfo,
        overlay,
        translator: null,
        hasSubtitles: false,
        asrInFlight: false,
      };
      this.bindings.set(video, binding);

      video.addEventListener('seeked', () => {
        binding.translator?.onPlaybackCursor(video.currentTime, true);
      });
      video.addEventListener('timeupdate', () => {
        binding.translator?.onPlaybackCursor(video.currentTime, false);
      });

      // Observe native HTML5 textTracks (X sometimes attaches VTT tracks directly)
      video.textTracks.addEventListener('addtrack', () => {
        void this.tryLoadNativeTextTrack(binding);
      });

      this.tryAttachTier1Subtitles(binding);
    }
  }

  private reconcileBindings(): void {
    for (const binding of this.bindings.values()) {
      if (!binding.mediaInfo) {
        binding.mediaInfo = this.findMediaInfo(binding.video, binding.tweetId);
      }
      if (!binding.hasSubtitles) {
        this.tryAttachTier1Subtitles(binding);
      }
    }
  }

  private tryAttachTier1Subtitles(binding: XVideoBinding): void {
    const media = binding.mediaInfo;

    // 1. Check HLS subtitle URLs attached to this video's media metadata
    if (media && media.subtitleUrls.length > 0) {
      const preferred = media.subtitleUrls[0];
      if (preferred) {
        void this.loadSubtitlesFromUrl(binding, preferred.url, preferred.lang);
        return;
      }
    }

    // 2. Check HTML5 video.textTracks
    if (binding.video.textTracks.length > 0) {
      void this.tryLoadNativeTextTrack(binding);
      return;
    }

    // 3. No Tier-1 captions detected yet -> show Tier-2 "✦ 一键 AI 字幕" button for captionless videos
    if (this.enabled && this.settings.video.asrEnabled) {
      binding.overlay.setShowAsrButton(true);
    }
  }

  private async tryLoadNativeTextTrack(binding: XVideoBinding): Promise<void> {
    if (binding.hasSubtitles) return;
    const track = Array.from(binding.video.textTracks).find(
      (t) => t.kind === 'subtitles' || t.kind === 'captions',
    );
    if (!track) return;

    track.mode = 'hidden';
    await new Promise((r) => setTimeout(r, 350));
    const cuesList = track.cues;
    if (!cuesList || cuesList.length === 0) return;

    const rawCues: SubtitleCue[] = [];
    for (let i = 0; i < cuesList.length; i++) {
      const c = cuesList[i] as VTTCue;
      if (!c.text?.trim()) continue;
      rawCues.push({
        id: rawCues.length + 1,
        startMs: Math.round(c.startTime * 1000),
        endMs: Math.round(c.endTime * 1000),
        source: c.text.replace(/\s+/g, ' ').trim(),
      });
    }
    if (rawCues.length > 0) {
      await this.startSubtitleTranslation(binding, rawCues, track.language || 'auto');
    }
  }

  private async loadSubtitlesFromUrl(binding: XVideoBinding, subUrl: string, lang: string): Promise<void> {
    if (binding.hasSubtitles) return;
    try {
      let vttCombined = '';
      if (subUrl.includes('.m3u8')) {
        const subResp = await fetch(subUrl);
        if (!subResp.ok) return;
        const subPlaylist = await subResp.text();
        const segUrls = parseHlsVttSegments(subPlaylist, subUrl);
        const chunks = await Promise.all(
          segUrls.slice(0, 40).map(async (u) => {
            const cached = this.vttBodiesByUrl.get(u);
            if (cached) return cached;
            const r = await fetch(u);
            return r.ok ? r.text() : '';
          }),
        );
        vttCombined = chunks.join('\n\n');
      } else {
        const cached = this.vttBodiesByUrl.get(subUrl);
        if (cached) {
          vttCombined = cached;
        } else {
          const r = await fetch(subUrl);
          if (r.ok) vttCombined = await r.text();
        }
      }

      const rawCues = parseWebVtt(vttCombined);
      if (rawCues.length > 0) {
        await this.startSubtitleTranslation(binding, rawCues, lang);
      }
    } catch {
      // Ignore transient HLS subtitle fetch errors
    }
  }

  private async startSubtitleTranslation(
    binding: XVideoBinding,
    rawCues: SubtitleCue[],
    lang: string,
  ): Promise<void> {
    binding.hasSubtitles = true;
    binding.overlay.setShowAsrButton(false);
    binding.overlay.setActive(this.enabled);

    const cues = this.settings.video.smartSegmentation ? smartResegmentCues(rawCues) : rawCues;
    binding.overlay.setCues(cues);

    const meta: VideoMetadata = {
      platform: 'x',
      videoId: binding.tweetId,
      title: binding.mediaInfo?.text?.slice(0, 120) ?? `X Post ${binding.tweetId}`,
      author: binding.mediaInfo?.author,
      durationSec: Number.isFinite(binding.video.duration) ? binding.video.duration : undefined,
    };

    binding.translator?.destroy();
    binding.translator = new SlidingWindowSubtitleTranslator(cues, meta, this.settings, lang, {
      onCuesUpdated: (updated) => binding.overlay.setCues(updated),
      onStatusChange: (status) => {
        if (status.state === 'ready') {
          binding.overlay.setStatus(status.message ?? '双语字幕就绪', 2200);
        } else if (status.state === 'error') {
          binding.overlay.setStatus(`翻译错误: ${status.message ?? ''}`, 6000);
        } else {
          binding.overlay.setStatus(status.message ?? null);
        }
      },
    });

    await binding.translator.initialize(binding.video.currentTime);
  }

  /**
   * Tier 2: One-click AI ASR pipeline for captionless ("生肉") X videos.
   * Uses the lowest-bitrate MP4 URL captured from GraphQL for ultra-fast audio extraction -> Whisper/Groq/Local Faster-Whisper!
   */
  private async triggerAsrForBinding(binding: XVideoBinding): Promise<void> {
    if (binding.asrInFlight) return;

    const media = binding.mediaInfo ?? this.findMediaInfo(binding.video, binding.tweetId);
    const mp4Url = media?.mp4Variants?.[0]?.url;

    if (!mp4Url) {
      binding.overlay.setStatus('未捕获到直连 MP4 流，请点击播放或进入推文详情页后重试', 5000);
      return;
    }

    binding.asrInFlight = true;
    binding.overlay.setShowAsrButton(false);
    binding.overlay.setStatus('正在提取视频音频并转写...');

    try {
      const asrCues = await sharedPortClient.requestDirectMediaAsr(
        {
          mediaUrl: mp4Url,
          mediaKey: media?.mediaKey ?? binding.tweetId,
          platform: 'x',
        },
        (_stage, percent, message) => {
          binding.overlay.setStatus(`${message} (${percent}%)`);
        },
      );

      if (asrCues.length === 0) {
        binding.overlay.setStatus('未检测到人声对话', 4000);
        binding.overlay.setShowAsrButton(true);
        return;
      }

      await this.startSubtitleTranslation(binding, asrCues, 'asr');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      diagLog('x', 'error', `X 视频 AI 字幕失败 (${binding.tweetId})`, err);
      binding.overlay.setStatus(`AI 字幕失败: ${msg.slice(0, 70)}`, 6000);
      binding.overlay.setShowAsrButton(true, '↻ 重试 AI 字幕');
    } finally {
      binding.asrInFlight = false;
    }
  }
}
