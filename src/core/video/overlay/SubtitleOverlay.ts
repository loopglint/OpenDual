import type { SubtitleBilingualOrder, VideoSubtitleSettings } from '../../config/types';
import type { SubtitleCue } from '../core/types';

export interface OverlayActionCallbacks {
  onToggleOrder?: (next: SubtitleBilingualOrder) => void;
  onExportSrt?: () => void;
  onExportVtt?: () => void;
  onTriggerAsr?: () => void;
  onClose?: () => void;
}

/**
 * Binary-search O(log N) lookup for the active subtitle cue at timeMs.
 */
export function findActiveCue(cues: SubtitleCue[], timeMs: number): SubtitleCue | null {
  if (cues.length === 0) return null;
  let lo = 0;
  let hi = cues.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const cue = cues[mid];
    if (!cue) break;
    if (timeMs < cue.startMs) {
      hi = mid - 1;
    } else if (timeMs > cue.endMs) {
      lo = mid + 1;
    } else {
      return cue;
    }
  }
  return null;
}

/**
 * Completely CSS-isolated Shadow DOM Bilingual Video Subtitle Overlay.
 * Mounted inside the player root (.html5-video-player or X videoPlayer) so Fullscreen works natively!
 */
export class VideoSubtitleOverlay {
  private host: HTMLDivElement;
  private shadow: ShadowRoot;
  private wrapperEl: HTMLDivElement;
  private targetLineEl: HTMLDivElement;
  private sourceLineEl: HTMLDivElement;
  private statusPillEl: HTMLDivElement;
  private asrButtonEl: HTMLButtonElement;
  private toolbarEl: HTMLDivElement;

  private video: HTMLVideoElement;
  private container: HTMLElement;
  private settings: VideoSubtitleSettings;
  private callbacks: OverlayActionCallbacks;

  private cues: SubtitleCue[] = [];
  private active = true;
  private currentCueId = -1;
  private rafId: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private fontScaleFactor = 1;
  private pausedByHover = false;
  private dragOffsetPercent: number;

  constructor(
    container: HTMLElement,
    video: HTMLVideoElement,
    settings: VideoSubtitleSettings,
    callbacks: OverlayActionCallbacks = {},
  ) {
    this.container = container;
    this.video = video;
    this.settings = settings;
    this.callbacks = callbacks;
    this.dragOffsetPercent = settings.verticalOffsetPercent;

    this.host = document.createElement('div');
    this.host.setAttribute('data-xt-ui-root', '1');
    this.host.setAttribute('data-xt-subtitle-overlay', '1');
    this.host.style.cssText =
      'position:absolute;inset:0;pointer-events:none;z-index:2147483640;overflow:hidden;';

    this.shadow = this.host.attachShadow({ mode: 'open' });
    this.shadow.innerHTML = `
      <style>
        :host {
          all: initial;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
        }
        .xt-stage {
          position: absolute;
          left: 0;
          right: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 0 4%;
          pointer-events: none;
          transition: bottom 0.08s linear;
        }
        .xt-box {
          pointer-events: auto;
          max-width: 90%;
          padding: 6px 14px;
          border-radius: 8px;
          text-align: center;
          user-select: text;
          cursor: grab;
          display: none;
          flex-direction: column;
          gap: 3px;
          box-shadow: 0 2px 12px rgba(0, 0, 0, 0.35);
          backdrop-filter: blur(4px);
          transition: opacity 0.12s ease;
        }
        .xt-box.visible {
          display: flex;
        }
        .xt-box:active {
          cursor: grabbing;
        }
        .xt-line {
          line-height: 1.38;
          word-break: break-word;
          text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9), 0 0 2px rgba(0, 0, 0, 0.95);
        }
        .xt-target {
          font-weight: 600;
        }
        .xt-source {
          font-weight: 400;
          opacity: 0.92;
        }
        .xt-status-bar {
          position: absolute;
          top: 10px;
          right: 12px;
          display: flex;
          align-items: center;
          gap: 6px;
          pointer-events: auto;
        }
        .xt-pill {
          display: none;
          align-items: center;
          gap: 5px;
          padding: 4px 10px;
          border-radius: 999px;
          background: rgba(15, 23, 42, 0.78);
          color: #f8fafc;
          font-size: 12px;
          line-height: 1.2;
          backdrop-filter: blur(6px);
          border: 1px solid rgba(255, 255, 255, 0.16);
        }
        .xt-pill.show {
          display: inline-flex;
        }
        .xt-btn {
          border: 1px solid rgba(255, 255, 255, 0.22);
          background: rgba(15, 23, 42, 0.8);
          color: #f8fafc;
          font-size: 12px;
          font-weight: 500;
          padding: 4px 10px;
          border-radius: 999px;
          cursor: pointer;
          backdrop-filter: blur(6px);
          transition: background 0.15s ease, transform 0.1s ease;
        }
        .xt-btn:hover {
          background: rgba(37, 99, 235, 0.92);
          transform: translateY(-1px);
        }
        .xt-btn-asr {
          display: none;
          background: linear-gradient(135deg, rgba(37, 99, 235, 0.92), rgba(6, 182, 212, 0.92));
        }
        .xt-btn-asr.show {
          display: inline-flex;
          align-items: center;
          gap: 4px;
        }
        .xt-mini-tools {
          display: none;
          align-items: center;
          gap: 4px;
          margin-bottom: 4px;
          pointer-events: auto;
        }
        .xt-stage:hover .xt-mini-tools.has-cues {
          display: flex;
        }
        .xt-tool-btn {
          border: none;
          background: rgba(15, 23, 42, 0.82);
          color: #e2e8f0;
          font-size: 11px;
          padding: 3px 7px;
          border-radius: 5px;
          cursor: pointer;
        }
        .xt-tool-btn:hover {
          background: rgba(59, 130, 246, 0.9);
          color: #fff;
        }
      </style>
      <div class="xt-status-bar">
        <div class="xt-pill" id="statusPill"></div>
        <button class="xt-btn xt-btn-asr" id="asrBtn" type="button">✦ 一键 AI 字幕</button>
      </div>
      <div class="xt-stage" id="stage">
        <div class="xt-mini-tools" id="miniTools">
          <button class="xt-tool-btn" id="orderBtn" type="button" title="切换双语排布">上译下原</button>
          <button class="xt-tool-btn" id="srtBtn" type="button" title="导出双语 SRT">导出 SRT</button>
          <button class="xt-tool-btn" id="closeBtn" type="button" title="暂时隐藏双语字幕">隐藏</button>
        </div>
        <div class="xt-box" id="box">
          <div class="xt-line xt-target" id="targetLine"></div>
          <div class="xt-line xt-source" id="sourceLine"></div>
        </div>
      </div>
    `;

    this.wrapperEl = this.shadow.getElementById('box') as HTMLDivElement;
    this.targetLineEl = this.shadow.getElementById('targetLine') as HTMLDivElement;
    this.sourceLineEl = this.shadow.getElementById('sourceLine') as HTMLDivElement;
    this.statusPillEl = this.shadow.getElementById('statusPill') as HTMLDivElement;
    this.asrButtonEl = this.shadow.getElementById('asrBtn') as HTMLButtonElement;
    this.toolbarEl = this.shadow.getElementById('miniTools') as HTMLDivElement;

    this.bindInteractions();
    this.mount();
    this.applyStyles();
    this.startSyncLoop();
  }

  private mount(): void {
    const computed = window.getComputedStyle(this.container);
    if (computed.position === 'static') {
      this.container.style.position = 'relative';
    }
    this.container.appendChild(this.host);

    this.resizeObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 800;
      // Scale cleanly from compact X timeline cards (~480px) to 1080p fullscreen (~1920px)
      this.fontScaleFactor = Math.max(0.68, Math.min(1.5, width / 860));
      this.applyStyles();
    });
    this.resizeObserver.observe(this.container);
  }

  private bindInteractions(): void {
    // Hover-to-pause reading aid
    this.wrapperEl.addEventListener('mouseenter', () => {
      if (this.settings.hoverPause && !this.video.paused) {
        this.pausedByHover = true;
        this.video.pause();
      }
    });
    this.wrapperEl.addEventListener('mouseleave', () => {
      if (this.pausedByHover) {
        this.pausedByHover = false;
        this.video.play().catch(() => {});
      }
    });

    // Vertical drag repositioning
    let dragging = false;
    let startY = 0;
    let startOffset = this.dragOffsetPercent;

    this.wrapperEl.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      dragging = true;
      startY = e.clientY;
      startOffset = this.dragOffsetPercent;
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const containerHeight = Math.max(200, this.container.clientHeight);
      const deltaPercent = ((startY - e.clientY) / containerHeight) * 100;
      this.dragOffsetPercent = Math.max(3, Math.min(70, startOffset + deltaPercent));
      this.applyStyles();
    });
    window.addEventListener('mouseup', () => {
      dragging = false;
    });

    this.shadow.getElementById('orderBtn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const orderCycle: SubtitleBilingualOrder[] = ['target-top', 'source-top', 'target-only'];
      const next: SubtitleBilingualOrder =
        orderCycle[(orderCycle.indexOf(this.settings.bilingualOrder) + 1) % orderCycle.length] ?? 'target-top';
      this.settings = { ...this.settings, bilingualOrder: next };
      this.applyStyles();
      this.renderCurrentCue(true);
      this.callbacks.onToggleOrder?.(next);
    });

    this.shadow.getElementById('srtBtn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.callbacks.onExportSrt?.();
    });

    this.shadow.getElementById('closeBtn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.setActive(false);
      this.callbacks.onClose?.();
    });

    this.asrButtonEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.callbacks.onTriggerAsr?.();
    });
  }

  updateSettings(next: VideoSubtitleSettings): void {
    this.settings = next;
    this.dragOffsetPercent = next.verticalOffsetPercent;
    this.applyStyles();
    this.renderCurrentCue(true);
  }

  setCues(cues: SubtitleCue[]): void {
    this.cues = cues;
    this.toolbarEl.classList.toggle('has-cues', cues.length > 0);
    this.renderCurrentCue(true);
  }

  setActive(active: boolean): void {
    this.active = active;
    if (!active) {
      this.wrapperEl.classList.remove('visible');
    } else {
      this.renderCurrentCue(true);
    }
  }

  setStatus(message: string | null, autoHideMs = 0): void {
    if (!message) {
      this.statusPillEl.classList.remove('show');
      this.statusPillEl.textContent = '';
      return;
    }
    this.statusPillEl.textContent = message;
    this.statusPillEl.classList.add('show');
    if (autoHideMs > 0) {
      setTimeout(() => {
        if (this.statusPillEl.textContent === message) {
          this.statusPillEl.classList.remove('show');
        }
      }, autoHideMs);
    }
  }

  setShowAsrButton(show: boolean, label = '✦ 一键 AI 字幕'): void {
    this.asrButtonEl.textContent = label;
    this.asrButtonEl.classList.toggle('show', show);
  }

  private applyStyles(): void {
    const stage = this.shadow.getElementById('stage') as HTMLDivElement;
    stage.style.bottom = `${this.dragOffsetPercent}%`;

    const scaledTarget = Math.round(this.settings.fontSize * this.fontScaleFactor);
    const scaledSource = Math.max(11, Math.round(scaledTarget * this.settings.sourceFontScale));

    this.wrapperEl.style.backgroundColor = `rgba(10, 14, 23, ${this.settings.bgOpacity})`;
    this.targetLineEl.style.fontSize = `${scaledTarget}px`;
    this.targetLineEl.style.color = this.settings.targetColor;
    this.sourceLineEl.style.fontSize = `${scaledSource}px`;
    this.sourceLineEl.style.color = this.settings.sourceColor;

    const orderBtn = this.shadow.getElementById('orderBtn');
    if (this.settings.bilingualOrder === 'target-top') {
      this.targetLineEl.style.order = '1';
      this.sourceLineEl.style.order = '2';
      this.sourceLineEl.style.display = 'block';
      if (orderBtn) orderBtn.textContent = '上译下原';
    } else if (this.settings.bilingualOrder === 'source-top') {
      this.targetLineEl.style.order = '2';
      this.sourceLineEl.style.order = '1';
      this.sourceLineEl.style.display = 'block';
      if (orderBtn) orderBtn.textContent = '上原下译';
    } else {
      this.targetLineEl.style.order = '1';
      this.sourceLineEl.style.display = 'none';
      if (orderBtn) orderBtn.textContent = '仅译文';
    }
  }

  private renderCurrentCue(force = false): void {
    if (!this.active || this.cues.length === 0) {
      this.wrapperEl.classList.remove('visible');
      return;
    }

    const timeMs = this.video.currentTime * 1000;
    const cue = findActiveCue(this.cues, timeMs);

    if (!cue) {
      if (this.currentCueId !== -1 || force) {
        this.currentCueId = -1;
        this.wrapperEl.classList.remove('visible');
      }
      return;
    }

    const renderKey = `${cue.id}:${cue.target ?? ''}`;
    if (!force && this.wrapperEl.dataset.renderKey === renderKey) return;

    this.currentCueId = cue.id;
    this.wrapperEl.dataset.renderKey = renderKey;
    this.targetLineEl.textContent = cue.target || (this.settings.bilingualOrder === 'target-only' ? cue.source : '...');
    this.sourceLineEl.textContent = cue.source;
    this.wrapperEl.classList.add('visible');
  }

  private startSyncLoop(): void {
    const tick = () => {
      if (!this.host.isConnected) return;
      this.renderCurrentCue(false);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  destroy(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.resizeObserver?.disconnect();
    this.host.remove();
  }
}
