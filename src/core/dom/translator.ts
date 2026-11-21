import type { DisplayMode, ExtensionSettings, SiteRule } from '../config/types';
import { getEngineById } from '../config/storage';
import { resolveSiteRule } from '../rules/matcher';
import { sharedPortClient } from '../messaging/port-client';
import { determineInjectionLayout, extractTranslatableBlocks, isElementExcluded } from './extractor';
import { buildSafeTranslatedFragment, serializeBlockWithInlineTags, type SerializedBlock } from './inline-tags';
import { isAlreadyTargetLanguage, isTranslatableText } from './language';
import { applyTranslatorStyles } from './themes';
import { diagLog } from '../debug/logger';

interface PendingBlockJob {
  id: number;
  el: HTMLElement;
  wrapper: HTMLElement;
  serialized: SerializedBlock;
  inViewport: boolean;
}

export interface WebpageTranslatorStatus {
  active: boolean;
  translating: boolean;
  displayMode: DisplayMode;
  matchedRuleName: string;
  translatedCount: number;
  lastError?: string;
}

/**
 * Full Webpage Bilingual Translation Engine:
 * - Non-destructive <x-trans-wrap> injection (React/Vue hydration safe)
 * - IntersectionObserver viewport-first lazy scheduling + off-screen abort
 * - Debounced MutationObserver for infinite scroll / SPA / Shadow DOM
 * - L1 Memory LRU cache for instant virtual-list re-renders (X / Reddit)
 * - Modifier-key hover single-paragraph translation
 */
export class WebpageTranslator {
  private settings: ExtensionSettings;
  private active = false;
  private displayMode: DisplayMode;
  private matchedRule: SiteRule | null = null;
  private translatedCount = 0;
  private inFlightCount = 0;
  private lastError: string | undefined;

  private intersectionObserver: IntersectionObserver | null = null;
  private mutationObserver: MutationObserver | null = null;
  private pendingJobs = new Map<HTMLElement, PendingBlockJob>();
  private queuedBatch: PendingBlockJob[] = [];
  private batchFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private mutationDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private activeAbortControllers = new Set<AbortController>();
  private jobSeq = 0;

  // L1 Memory LRU cache keyed by `${engineId}|${targetLang}|${serialized}`
  private memoryCache = new Map<string, string>();
  private readonly maxMemoryCache = 600;

  // Hover-translate state
  private hoverModifierPressed = false;
  private lastHoveredEl: HTMLElement | null = null;

  private listeners = new Set<(status: WebpageTranslatorStatus) => void>();

  constructor(settings: ExtensionSettings) {
    this.settings = settings;
    this.displayMode = settings.appearance.displayMode;
    this.matchedRule = resolveSiteRule(window.location.href, settings);
    this.bindHoverListeners();
  }

  onStatusChange(fn: (status: WebpageTranslatorStatus) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emitStatus(): void {
    const status = this.getStatus();
    for (const fn of this.listeners) fn(status);
  }

  getStatus(): WebpageTranslatorStatus {
    return {
      active: this.active,
      translating: this.inFlightCount > 0 || this.queuedBatch.length > 0,
      displayMode: this.displayMode,
      matchedRuleName: this.matchedRule?.name ?? '智能正文识别 (通用)',
      translatedCount: this.translatedCount,
      lastError: this.lastError,
    };
  }

  updateSettings(next: ExtensionSettings): void {
    const engineChanged =
      next.activePageEngineId !== this.settings.activePageEngineId ||
      next.targetLang !== this.settings.targetLang;
    this.settings = next;
    this.displayMode = next.appearance.displayMode;
    this.matchedRule = resolveSiteRule(window.location.href, next);

    if (this.active) {
      applyTranslatorStyles(document, {
        mode: this.displayMode,
        theme: next.appearance.theme,
        customCss: next.appearance.customCss,
        sitePatchCss: this.matchedRule?.injectCss,
      });
      if (engineChanged) {
        this.retranslate();
      }
    }
    this.emitStatus();
  }

  setDisplayMode(mode: DisplayMode): void {
    this.displayMode = mode;
    document.documentElement.setAttribute('data-xt-mode', mode);
    this.emitStatus();
  }

  toggle(): void {
    if (this.active) {
      this.restore();
    } else {
      this.start();
    }
  }

  retranslate(): void {
    this.restore();
    this.memoryCache.clear();
    this.start();
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.lastError = undefined;
    this.matchedRule = resolveSiteRule(window.location.href, this.settings);

    if (this.matchedRule?.defaultMode) {
      this.displayMode = this.matchedRule.defaultMode;
    }

    applyTranslatorStyles(document, {
      mode: this.displayMode,
      theme: this.settings.appearance.theme,
      customCss: this.settings.appearance.customCss,
      sitePatchCss: this.matchedRule?.injectCss,
    });

    this.setupObservers();
    this.scanAndObserve(document);
    this.emitStatus();
  }

  restore(): void {
    this.active = false;
    this.cancelAllInFlight();
    this.intersectionObserver?.disconnect();
    this.intersectionObserver = null;
    this.mutationObserver?.disconnect();
    this.mutationObserver = null;
    if (this.batchFlushTimer) {
      clearTimeout(this.batchFlushTimer);
      this.batchFlushTimer = null;
    }
    if (this.mutationDebounceTimer) {
      clearTimeout(this.mutationDebounceTimer);
      this.mutationDebounceTimer = null;
    }
    this.pendingJobs.clear();
    this.queuedBatch = [];

    // Cleanly remove all injected wrappers across main document and pierced shadow roots
    const removeWrappers = (root: Document | ShadowRoot) => {
      root.querySelectorAll('x-trans-wrap[data-xt-wrapper="1"]').forEach((el) => el.remove());
      root.querySelectorAll<HTMLElement>('[data-xt-translated="1"], [data-xt-pending="1"]').forEach((el) => {
        el.removeAttribute('data-xt-translated');
        el.removeAttribute('data-xt-pending');
        el.removeAttribute('data-xt-unclamp');
        el.style.removeProperty('--xt-orig-color');
        el.style.removeProperty('--xt-orig-font-size');
        el.style.removeProperty('--xt-orig-line-height');
      });
      if (this.matchedRule?.shadowRootSelectors) {
        for (const hostSel of this.matchedRule.shadowRootSelectors) {
          try {
            root.querySelectorAll<HTMLElement>(hostSel).forEach((host) => {
              if (host.shadowRoot) removeWrappers(host.shadowRoot);
            });
          } catch {
            // Ignore
          }
        }
      }
    };
    removeWrappers(document);

    this.translatedCount = 0;
    this.lastError = undefined;
    this.emitStatus();
  }

  private cancelAllInFlight(): void {
    for (const ctrl of this.activeAbortControllers) {
      ctrl.abort();
    }
    this.activeAbortControllers.clear();
    this.inFlightCount = 0;
  }

  private setupObservers(): void {
    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const el = entry.target as HTMLElement;
          const job = this.pendingJobs.get(el);
          if (!job) continue;
          job.inViewport = entry.isIntersecting;
          if (entry.isIntersecting) {
            this.intersectionObserver?.unobserve(el);
            this.pendingJobs.delete(el);
            this.enqueueJobForTranslation(job);
          }
        }
      },
      {
        // Translate current viewport + 1.2 viewport buffer above and below
        rootMargin: '120% 0px 120% 0px',
        threshold: 0.01,
      },
    );

    this.mutationObserver = new MutationObserver((mutations) => {
      if (!this.active) return;
      let hasRelevantAdd = false;
      for (const m of mutations) {
        if (m.type === 'childList' && m.addedNodes.length > 0) {
          for (const node of Array.from(m.addedNodes)) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const el = node as HTMLElement;
              if (
                el.tagName !== 'X-TRANS-WRAP' &&
                !el.hasAttribute('data-xt-wrapper') &&
                !el.hasAttribute('data-xt-ui-root')
              ) {
                hasRelevantAdd = true;
                break;
              }
            }
          }
        }
        if (hasRelevantAdd) break;
      }

      if (hasRelevantAdd) {
        if (this.mutationDebounceTimer) clearTimeout(this.mutationDebounceTimer);
        this.mutationDebounceTimer = setTimeout(() => {
          if (this.active) this.scanAndObserve(document);
        }, 320);
      }
    });

    this.mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  private scanAndObserve(root: Document | HTMLElement): void {
    const blocks = extractTranslatableBlocks(root, this.matchedRule, this.settings.appearance.customCss);
    for (const el of blocks) {
      if (
        this.pendingJobs.has(el) ||
        el.getAttribute('data-xt-translated') === '1' ||
        el.getAttribute('data-xt-pending') === '1'
      ) {
        continue;
      }
      const prepared = this.prepareBlock(el);
      if (!prepared) continue;

      // Immediate L1 memory cache hit -> zero-flicker synchronous restore (great for X virtual lists!)
      const cacheKey = this.makeMemoryKey(prepared.serialized.serialized);
      const cached = this.memoryCache.get(cacheKey);
      if (cached) {
        this.renderTranslation(prepared, cached);
        continue;
      }

      this.pendingJobs.set(el, prepared);
      this.intersectionObserver?.observe(el);
    }
  }

  private prepareBlock(el: HTMLElement): PendingBlockJob | null {
    const serialized = serializeBlockWithInlineTags(el, this.matchedRule?.stayOriginalSelectors ?? []);
    if (!isTranslatableText(serialized.serialized)) return null;
    if (isAlreadyTargetLanguage(serialized.plainText, this.settings.targetLang)) return null;

    const layoutInfo = determineInjectionLayout(el, this.matchedRule);

    const wrapper = (el.ownerDocument ?? document).createElement('x-trans-wrap');
    wrapper.setAttribute('data-xt-wrapper', '1');
    wrapper.setAttribute('data-xt-layout', layoutInfo.layout);
    wrapper.setAttribute('data-xt-state', 'pending');
    wrapper.setAttribute('translate', 'no');

    // Store computed original typography variables for clean Replace mode & Weakened-Original theme
    el.style.setProperty('--xt-orig-color', layoutInfo.origColor);
    el.style.setProperty('--xt-orig-font-size', layoutInfo.origFontSize);
    el.style.setProperty('--xt-orig-line-height', layoutInfo.origLineHeight);
    if (layoutInfo.needsUnclamp) {
      el.setAttribute('data-xt-unclamp', '1');
    }

    return {
      id: ++this.jobSeq,
      el,
      wrapper,
      serialized,
      inViewport: false,
    };
  }

  private enqueueJobForTranslation(job: PendingBlockJob): void {
    if (!job.el.isConnected) return;
    if (
      job.el.getAttribute('data-xt-pending') === '1' ||
      job.el.getAttribute('data-xt-translated') === '1' ||
      job.el.querySelector(':scope > x-trans-wrap[data-xt-wrapper="1"]')
    ) {
      return;
    }
    job.el.setAttribute('data-xt-pending', '1');

    // Show subtle loading indicator
    if (this.settings.appearance.showLoadingSpinner) {
      job.wrapper.setAttribute('data-xt-state', 'loading');
      job.el.appendChild(job.wrapper);
    }

    this.queuedBatch.push(job);
    this.scheduleBatchFlush();
  }

  private scheduleBatchFlush(): void {
    if (this.batchFlushTimer) return;
    this.batchFlushTimer = setTimeout(() => {
      this.batchFlushTimer = null;
      this.flushQueueIntoBatches();
    }, 85);
  }

  private flushQueueIntoBatches(): void {
    if (this.queuedBatch.length === 0) return;

    const engine = getEngineById(this.settings, this.settings.activePageEngineId);
    const maxChars = engine.maxCharsPerBatch ?? 2600;
    const maxItems = engine.maxItemsPerBatch ?? 14;

    const jobs = this.queuedBatch.splice(0, this.queuedBatch.length).filter((j) => j.el.isConnected);
    let currentSlice: PendingBlockJob[] = [];
    let currentChars = 0;

    const dispatch = (slice: PendingBlockJob[]) => {
      if (slice.length === 0) return;
      void this.executeBatch(slice);
    };

    for (const job of jobs) {
      const len = job.serialized.serialized.length;
      if (
        currentSlice.length > 0 &&
        (currentSlice.length >= maxItems || currentChars + len > maxChars)
      ) {
        dispatch(currentSlice);
        currentSlice = [];
        currentChars = 0;
      }
      currentSlice.push(job);
      currentChars += len;
    }
    dispatch(currentSlice);
  }

  private async executeBatch(slice: PendingBlockJob[]): Promise<void> {
    const abortController = new AbortController();
    this.activeAbortControllers.add(abortController);
    this.inFlightCount++;
    this.emitStatus();

    try {
      const outcome = await sharedPortClient.translateBatch(
        {
          scope: 'webpage',
          engineId: this.settings.activePageEngineId,
          sourceLang: this.settings.sourceLang,
          targetLang: this.settings.targetLang,
          items: slice.map((job, idx) => ({ i: idx, text: job.serialized.serialized })),
          priority: 'high',
          pageTitle: document.title,
          pageUrl: window.location.href,
        },
        abortController.signal,
      );

      const map = new Map<number, string>(outcome.translations.map((t) => [t.i, t.text]));
      for (let idx = 0; idx < slice.length; idx++) {
        const job = slice[idx];
        if (!job) continue;
        const translated = map.get(idx);
        if (translated && job.el.isConnected) {
          this.setMemoryCache(this.makeMemoryKey(job.serialized.serialized), translated);
          this.renderTranslation(job, translated);
        } else {
          job.wrapper.remove();
        }
      }
      this.lastError = undefined;
    } catch (err) {
      if (abortController.signal.aborted) return;
      const message = err instanceof Error ? err.message : String(err);
      this.lastError = message;
      diagLog('content', 'error', `网页批量翻译失败 (${this.settings.activePageEngineId})`, message);
      for (const job of slice) {
        if (!job.el.isConnected) continue;
        job.el.removeAttribute('data-xt-pending');
        job.wrapper.setAttribute('data-xt-state', 'error');
        job.wrapper.textContent = `[翻译失败: ${message.slice(0, 60)}]`;
        if (!job.wrapper.parentNode) job.el.appendChild(job.wrapper);
      }
    } finally {
      this.activeAbortControllers.delete(abortController);
      this.inFlightCount = Math.max(0, this.inFlightCount - 1);
      this.emitStatus();
    }
  }

  private renderTranslation(job: PendingBlockJob, translatedText: string): void {
    const doc = job.el.ownerDocument ?? document;
    job.wrapper.textContent = '';
    const fragment = buildSafeTranslatedFragment(doc, translatedText, job.serialized);
    job.wrapper.appendChild(fragment);
    job.wrapper.setAttribute('data-xt-state', 'done');
    if (!job.wrapper.isConnected) {
      job.el.appendChild(job.wrapper);
    }
    job.el.removeAttribute('data-xt-pending');
    job.el.setAttribute('data-xt-translated', '1');
    this.translatedCount++;
  }

  private makeMemoryKey(serialized: string): string {
    return `${this.settings.activePageEngineId}|${this.settings.targetLang}|${serialized}`;
  }

  private setMemoryCache(key: string, value: string): void {
    if (this.memoryCache.size >= this.maxMemoryCache) {
      const oldestKey = this.memoryCache.keys().next().value;
      if (oldestKey !== undefined) this.memoryCache.delete(oldestKey);
    }
    this.memoryCache.set(key, value);
  }

  /**
   * Single-paragraph hover translation when user holds the configured modifier key (e.g. Alt).
   */
  private bindHoverListeners(): void {
    window.addEventListener('keydown', (e) => {
      const trigger = this.settings.appearance.hoverTriggerKey;
      if (trigger !== 'none' && e.key === trigger) {
        this.hoverModifierPressed = true;
        if (this.lastHoveredEl) {
          this.translateSingleHoveredBlock(this.lastHoveredEl);
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.key === this.settings.appearance.hoverTriggerKey) {
        this.hoverModifierPressed = false;
      }
    });

    window.addEventListener(
      'mousemove',
      (e) => {
        const target = e.target as HTMLElement | null;
        if (!target || target.nodeType !== Node.ELEMENT_NODE) return;
        const block = target.closest<HTMLElement>(
          'p, li, h1, h2, h3, h4, blockquote, div[data-testid="tweetText"], #content-text, .commtext',
        );
        this.lastHoveredEl = block;
        if (this.hoverModifierPressed && block) {
          this.translateSingleHoveredBlock(block);
        }
      },
      { passive: true },
    );
  }

  private translateSingleHoveredBlock(el: HTMLElement): void {
    if (isElementExcluded(el, this.matchedRule)) return;

    // Toggle off if already translated via hover
    const existing = el.querySelector<HTMLElement>(':scope > x-trans-wrap[data-xt-wrapper="1"]');
    if (existing) {
      if (!this.active) {
        existing.remove();
        el.removeAttribute('data-xt-translated');
      }
      return;
    }

    applyTranslatorStyles(document, {
      mode: this.displayMode,
      theme: this.settings.appearance.theme,
      customCss: this.settings.appearance.customCss,
      sitePatchCss: this.matchedRule?.injectCss,
    });

    const job = this.prepareBlock(el);
    if (!job) return;

    const cached = this.memoryCache.get(this.makeMemoryKey(job.serialized.serialized));
    if (cached) {
      this.renderTranslation(job, cached);
      return;
    }

    this.enqueueJobForTranslation(job);
  }
}
