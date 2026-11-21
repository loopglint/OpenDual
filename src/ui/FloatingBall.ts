import type { AppearanceSettings, DisplayMode } from '../core/config/types';
import type { WebpageTranslatorStatus } from '../core/dom/translator';

export interface FloatingBallCallbacks {
  onToggleTranslate: () => void;
  onToggleDisplayMode: (next: DisplayMode) => void;
  onOpenOptions: () => void;
  onHideTemporarily: () => void;
}

/**
 * Ultra-lightweight Shadow DOM edge floating pill inspired by Immersive Translate:
 * - Zero style leakage onto host websites
 * - Draggable vertically along the right viewport edge
 * - One-click toggle translate/restore, hover quick actions (bilingual/replace, settings)
 */
export class FloatingBallWidget {
  private host: HTMLDivElement;
  private shadow: ShadowRoot;
  private mainBtn: HTMLButtonElement;
  private modeBtn: HTMLButtonElement;
  private badgeEl: HTMLSpanElement;
  private toastEl: HTMLDivElement;
  private currentStatus: WebpageTranslatorStatus | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(appearance: AppearanceSettings, callbacks: FloatingBallCallbacks) {
    this.host = document.createElement('div');
    this.host.setAttribute('data-xt-ui-root', '1');
    this.host.style.cssText = `
      position: fixed;
      right: 0;
      top: ${appearance.floatingBallPositionY}%;
      z-index: 2147483645;
      pointer-events: none;
    `;

    this.shadow = this.host.attachShadow({ mode: 'open' });
    this.shadow.innerHTML = `
      <style>
        :host {
          all: initial;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
        }
        .dock {
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 6px;
          pointer-events: auto;
          transform: translateX(6px);
          transition: transform 0.2s cubic-bezier(0.22, 1, 0.36, 1);
        }
        .dock:hover {
          transform: translateX(0);
        }
        .pill {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 12px 8px 10px;
          border: 1px solid rgba(148, 163, 184, 0.28);
          border-right: none;
          border-radius: 999px 0 0 999px;
          background: rgba(15, 23, 42, 0.9);
          color: #f8fafc;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          box-shadow: -4px 6px 20px rgba(15, 23, 42, 0.25);
          backdrop-filter: blur(8px);
          transition: background 0.18s ease, box-shadow 0.18s ease;
        }
        .pill:hover {
          background: rgba(30, 41, 59, 0.96);
        }
        .pill.active {
          background: linear-gradient(135deg, #2563eb, #0891b2);
          border-color: rgba(125, 211, 252, 0.45);
        }
        .icon {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: rgba(255, 255, 255, 0.16);
          font-size: 11px;
        }
        .spinner {
          width: 12px;
          height: 12px;
          border: 2px solid rgba(255, 255, 255, 0.35);
          border-top-color: #ffffff;
          border-radius: 50%;
          display: none;
          animation: spin 0.7s linear infinite;
        }
        .pill.loading .spinner {
          display: inline-block;
        }
        .pill.loading .icon {
          display: none;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        .menu {
          display: none;
          flex-direction: column;
          gap: 4px;
          padding: 6px;
          margin-right: 6px;
          border-radius: 10px;
          background: rgba(15, 23, 42, 0.94);
          border: 1px solid rgba(148, 163, 184, 0.24);
          box-shadow: 0 10px 26px rgba(15, 23, 42, 0.35);
          backdrop-filter: blur(10px);
        }
        .dock:hover .menu {
          display: flex;
        }
        .menu-btn {
          border: none;
          background: transparent;
          color: #e2e8f0;
          font-size: 12px;
          text-align: left;
          padding: 5px 9px;
          border-radius: 6px;
          cursor: pointer;
          white-space: nowrap;
        }
        .menu-btn:hover {
          background: rgba(59, 130, 246, 0.28);
          color: #ffffff;
        }
        .toast {
          position: absolute;
          right: 54px;
          top: 2px;
          max-width: 240px;
          padding: 6px 10px;
          border-radius: 8px;
          background: rgba(15, 23, 42, 0.92);
          color: #fecaca;
          border: 1px solid rgba(248, 113, 113, 0.4);
          font-size: 12px;
          line-height: 1.4;
          display: none;
          box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3);
        }
        .toast.show {
          display: block;
        }
      </style>
      <div class="dock">
        <div class="toast" id="toast"></div>
        <button class="pill" id="mainBtn" type="button" title="点击翻译/还原当前页 (Alt+A)">
          <span class="icon">译</span>
          <span class="spinner"></span>
          <span id="badge">译</span>
        </button>
        <div class="menu">
          <button class="menu-btn" id="modeBtn" type="button">模式: 双语对照</button>
          <button class="menu-btn" id="optBtn" type="button">⚙ 引擎与规则设置</button>
          <button class="menu-btn" id="hideBtn" type="button">✕ 隐藏悬浮球</button>
        </div>
      </div>
    `;

    this.mainBtn = this.shadow.getElementById('mainBtn') as HTMLButtonElement;
    this.modeBtn = this.shadow.getElementById('modeBtn') as HTMLButtonElement;
    this.badgeEl = this.shadow.getElementById('badge') as HTMLSpanElement;
    this.toastEl = this.shadow.getElementById('toast') as HTMLDivElement;

    this.mainBtn.addEventListener('click', () => callbacks.onToggleTranslate());
    this.modeBtn.addEventListener('click', () => {
      const next: DisplayMode = this.currentStatus?.displayMode === 'replace' ? 'bilingual' : 'replace';
      callbacks.onToggleDisplayMode(next);
    });
    this.shadow.getElementById('optBtn')?.addEventListener('click', () => callbacks.onOpenOptions());
    this.shadow.getElementById('hideBtn')?.addEventListener('click', () => {
      this.setVisible(false);
      callbacks.onHideTemporarily();
    });

    this.setupDrag();
    this.setVisible(appearance.showFloatingBall);
    document.documentElement.appendChild(this.host);
  }

  private setupDrag(): void {
    let dragging = false;
    let moved = false;
    let startY = 0;
    let startTop = 0;

    this.mainBtn.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      dragging = true;
      moved = false;
      startY = e.clientY;
      startTop = this.host.getBoundingClientRect().top;
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      if (Math.abs(e.clientY - startY) > 6) moved = true;
      if (!moved) return;
      const nextTop = Math.max(40, Math.min(window.innerHeight - 60, startTop + (e.clientY - startY)));
      this.host.style.top = `${nextTop}px`;
    });
    window.addEventListener('mouseup', () => {
      dragging = false;
    });
    this.mainBtn.addEventListener(
      'click',
      (e) => {
        if (moved) {
          e.stopImmediatePropagation();
          e.preventDefault();
          moved = false;
        }
      },
      true,
    );
  }

  setVisible(visible: boolean): void {
    this.host.style.display = visible ? 'block' : 'none';
  }

  updateStatus(status: WebpageTranslatorStatus): void {
    this.currentStatus = status;
    this.mainBtn.classList.toggle('active', status.active);
    this.mainBtn.classList.toggle('loading', status.translating);
    this.badgeEl.textContent = status.active ? (status.translating ? '译中' : '还原') : '翻译';
    this.modeBtn.textContent =
      status.displayMode === 'replace' ? '模式: 仅显示译文' : '模式: 双语对照';

    if (status.lastError) {
      this.showToast(status.lastError);
    }
  }

  showToast(message: string): void {
    this.toastEl.textContent = message;
    this.toastEl.classList.add('show');
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toastEl.classList.remove('show');
    }, 5500);
  }

  destroy(): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.host.remove();
  }
}
