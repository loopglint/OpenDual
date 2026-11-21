import type { ExtensionSettings } from '../../config/types';
import { getEngineById } from '../../config/storage';
import { sharedPortClient } from '../../messaging/port-client';
import type { SubtitleCue, VideoMetadata } from './types';

export interface WindowTranslatorCallbacks {
  onCuesUpdated: (cues: SubtitleCue[]) => void;
  onStatusChange: (status: {
    state: 'idle' | 'translating' | 'ready' | 'error';
    progress: number;
    message?: string;
  }) => void;
}

/**
 * Playback-Cursor Priority Sliding-Window Subtitle Translator:
 * - Immediately prioritizes translating [currentTime - 5s, currentTime + 90s] so first subtitles appear in <1.5s
 * - Injects VideoMetadata + 3 read-only preceding cues for superior pronoun & domain accuracy
 * - On user seek, aborts stale far-away prefetch batches and jumps immediately to the new cursor
 * - Persists completed tracks into Background IndexedDB cache for instant 0-cost replays
 */
export class SlidingWindowSubtitleTranslator {
  private cues: SubtitleCue[] = [];
  private meta: VideoMetadata;
  private settings: ExtensionSettings;
  private callbacks: WindowTranslatorCallbacks;
  private cacheKey: string;

  private batchSize = 14;
  private translatedIndices = new Set<number>();
  private inFlightBatches = new Set<number>();
  private abortControllers = new Map<number, AbortController>();
  private destroyed = false;
  private activeCursorMs = 0;

  constructor(
    cues: SubtitleCue[],
    meta: VideoMetadata,
    settings: ExtensionSettings,
    trackLang: string,
    callbacks: WindowTranslatorCallbacks,
  ) {
    this.cues = cues.map((c) => ({ ...c }));
    this.meta = meta;
    this.settings = settings;
    this.callbacks = callbacks;

    const engine = getEngineById(settings, settings.activeVideoEngineId);
    this.batchSize = Math.min(18, Math.max(8, engine.maxItemsPerBatch ?? 14));
    this.cacheKey = `sub:${meta.platform}:${meta.videoId}:${trackLang}:${engine.id}:${engine.model ?? ''}:${settings.targetLang}:${cues.length}`;
  }

  getCues(): SubtitleCue[] {
    return this.cues;
  }

  async initialize(currentTimeSec: number): Promise<void> {
    this.activeCursorMs = Math.max(0, currentTimeSec * 1000);

    // Check L2 IndexedDB track cache first -> instant replay!
    if (this.settings.cacheEnabled && typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      try {
        const cached = (await chrome.runtime.sendMessage({
          type: 'GET_SUBTITLE_CACHE',
          cacheKey: this.cacheKey,
        })) as { cues?: SubtitleCue[] } | undefined;

        if (cached?.cues && cached.cues.length === this.cues.length) {
          this.cues = cached.cues;
          for (let i = 0; i < this.cues.length; i++) this.translatedIndices.add(i);
          this.callbacks.onCuesUpdated(this.cues);
          this.callbacks.onStatusChange({ state: 'ready', progress: 100, message: '已命中字幕缓存' });
          return;
        }
      } catch {
        // Ignore cache lookup failure
      }
    }

    this.scheduleAroundTime(currentTimeSec);
  }

  /**
   * Called on timeupdate / seeked to keep playback window prioritized ahead of background prefetch.
   */
  onPlaybackCursor(currentTimeSec: number, isSeek = false): void {
    if (this.destroyed) return;
    this.activeCursorMs = Math.max(0, currentTimeSec * 1000);

    if (isSeek) {
      const targetBatch = this.findBatchIndexForTime(this.activeCursorMs);
      // Abort stale prefetch batches far away from the new seek location
      for (const [batchIdx, ctrl] of this.abortControllers.entries()) {
        if (Math.abs(batchIdx - targetBatch) > 1) {
          ctrl.abort();
          this.abortControllers.delete(batchIdx);
          this.inFlightBatches.delete(batchIdx);
        }
      }
    }

    this.scheduleAroundTime(currentTimeSec);
  }

  destroy(): void {
    this.destroyed = true;
    for (const ctrl of this.abortControllers.values()) {
      ctrl.abort();
    }
    this.abortControllers.clear();
    this.inFlightBatches.clear();
  }

  private findBatchIndexForTime(timeMs: number): number {
    let cueIdx = this.cues.findIndex((c) => c.endMs >= timeMs);
    if (cueIdx === -1) cueIdx = Math.max(0, this.cues.length - 1);
    return Math.floor(cueIdx / this.batchSize);
  }

  private scheduleAroundTime(currentTimeSec: number): void {
    if (this.destroyed || this.cues.length === 0) return;
    const totalBatches = Math.ceil(this.cues.length / this.batchSize);
    const centerBatch = this.findBatchIndexForTime(currentTimeSec * 1000);

    // Build priority order: centerBatch -> centerBatch+1 -> centerBatch+2 -> remaining forward -> earlier batches
    const ordered: Array<{ batchIdx: number; priority: 'high' | 'normal' | 'low' }> = [];
    const seen = new Set<number>();

    const pushBatch = (idx: number, priority: 'high' | 'normal' | 'low') => {
      if (idx < 0 || idx >= totalBatches || seen.has(idx)) return;
      seen.add(idx);
      if (this.isBatchComplete(idx) || this.inFlightBatches.has(idx)) return;
      ordered.push({ batchIdx: idx, priority });
    };

    pushBatch(centerBatch, 'high');
    pushBatch(centerBatch + 1, 'high');
    pushBatch(centerBatch + 2, 'normal');

    for (let i = centerBatch + 3; i < totalBatches; i++) {
      pushBatch(i, 'low');
    }
    for (let i = centerBatch - 1; i >= 0; i--) {
      pushBatch(i, 'low');
    }

    const engine = getEngineById(this.settings, this.settings.activeVideoEngineId);
    const maxParallel = engine.kind === 'ollama' ? 1 : Math.min(3, engine.concurrency ?? 2);

    for (const item of ordered) {
      if (this.inFlightBatches.size >= maxParallel) break;
      void this.runBatch(item.batchIdx, item.priority);
    }
  }

  private isBatchComplete(batchIdx: number): boolean {
    const start = batchIdx * this.batchSize;
    const end = Math.min(this.cues.length, start + this.batchSize);
    for (let i = start; i < end; i++) {
      if (!this.translatedIndices.has(i)) return false;
    }
    return true;
  }

  private async runBatch(batchIdx: number, priority: 'high' | 'normal' | 'low'): Promise<void> {
    if (this.destroyed || this.inFlightBatches.has(batchIdx)) return;

    const start = batchIdx * this.batchSize;
    const end = Math.min(this.cues.length, start + this.batchSize);
    const pendingItems: Array<{ i: number; text: string }> = [];

    for (let i = start; i < end; i++) {
      const cue = this.cues[i];
      if (cue && !this.translatedIndices.has(i)) {
        pendingItems.push({ i, text: cue.source });
      }
    }
    if (pendingItems.length === 0) return;

    this.inFlightBatches.add(batchIdx);
    const ctrl = new AbortController();
    this.abortControllers.set(batchIdx, ctrl);

    this.emitProgress('translating');

    // Collect up to 3 preceding cues as read-only context for coherent subtitle translation
    const prevContext: Array<{ source: string; target?: string }> = [];
    for (let c = Math.max(0, start - 3); c < start; c++) {
      const ctxCue = this.cues[c];
      if (ctxCue) {
        prevContext.push({
          source: ctxCue.source,
          target: ctxCue.target,
        });
      }
    }

    try {
      const outcome = await sharedPortClient.translateBatch(
        {
          scope: 'subtitle',
          engineId: this.settings.activeVideoEngineId,
          sourceLang: this.settings.sourceLang,
          targetLang: this.settings.targetLang,
          items: pendingItems,
          priority,
          videoMeta: this.meta,
          prevContext,
        },
        ctrl.signal,
      );

      if (this.destroyed) return;

      for (const tr of outcome.translations) {
        const targetCue = this.cues[tr.i];
        if (targetCue) {
          targetCue.target = tr.text;
          this.translatedIndices.add(tr.i);
        }
      }

      this.callbacks.onCuesUpdated(this.cues);

      if (this.translatedIndices.size >= this.cues.length) {
        this.emitProgress('ready');
        this.persistTrackCache();
      } else {
        this.emitProgress('translating');
      }
    } catch (err) {
      if (!ctrl.signal.aborted && !this.destroyed) {
        this.callbacks.onStatusChange({
          state: 'error',
          progress: this.computePercent(),
          message: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      this.inFlightBatches.delete(batchIdx);
      this.abortControllers.delete(batchIdx);
      if (!this.destroyed && this.translatedIndices.size < this.cues.length) {
        this.scheduleAroundTime(this.activeCursorMs / 1000);
      }
    }
  }

  private computePercent(): number {
    if (this.cues.length === 0) return 100;
    return Math.round((this.translatedIndices.size / this.cues.length) * 100);
  }

  private emitProgress(state: 'translating' | 'ready'): void {
    this.callbacks.onStatusChange({
      state,
      progress: this.computePercent(),
      message: state === 'ready' ? '全片双语字幕就绪' : `字幕翻译中 (${this.computePercent()}%)`,
    });
  }

  private persistTrackCache(): void {
    if (!this.settings.cacheEnabled || typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      return;
    }
    // Strip heavy word arrays before saving compact track cache
    const compact = this.cues.map(({ id, startMs, endMs, source, target, isNonSpeech }) => ({
      id,
      startMs,
      endMs,
      source,
      target,
      isNonSpeech,
    }));
    chrome.runtime
      .sendMessage({
        type: 'SET_SUBTITLE_CACHE',
        cacheKey: this.cacheKey,
        cues: compact,
      })
      .catch(() => {});
  }
}
