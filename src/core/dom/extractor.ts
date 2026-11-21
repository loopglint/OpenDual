import type { SiteRule } from '../config/types';
import { injectShadowRootStyles } from './themes';

const GLOBAL_SKIP_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'SVG',
  'CANVAS',
  'CODE',
  'PRE',
  'KBD',
  'SAMP',
  'VAR',
  'MATH',
  'TEXTAREA',
  'INPUT',
  'SELECT',
  'OPTION',
  'IFRAME',
  'AUDIO',
  'VIDEO',
  'TEMPLATE',
  'HEAD',
  'TITLE',
  'META',
  'LINK',
  'X-TRANS-WRAP',
]);

const DEFAULT_BLOCK_TAGS = new Set([
  'P',
  'LI',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'BLOCKQUOTE',
  'FIGCAPTION',
  'DD',
  'DT',
  'TD',
  'TH',
  'SUMMARY',
  'CAPTION',
  'ARTICLE',
]);

const STRUCTURAL_SKIP_TAGS = new Set(['NAV', 'HEADER', 'FOOTER', 'ASIDE']);

function matchesAny(el: Element, selectors?: string[]): boolean {
  if (!selectors || selectors.length === 0) return false;
  for (const sel of selectors) {
    try {
      if (el.matches(sel)) return true;
    } catch {
      // Ignore malformed custom selector
    }
  }
  return false;
}

export function isElementExcluded(el: Element, rule: SiteRule | null): boolean {
  if (GLOBAL_SKIP_TAGS.has(el.tagName)) return true;
  if (el.getAttribute('translate') === 'no') return true;
  if (el.classList.contains('notranslate')) return true;
  if (el.getAttribute('contenteditable') === 'true') return true;
  if (el.getAttribute('aria-hidden') === 'true') return true;
  if (el.hasAttribute('data-xt-wrapper') || el.hasAttribute('data-xt-cloned')) return true;
  if (el.closest('[contenteditable="true"], [translate="no"], .notranslate, pre, code, [data-xt-ui-root="1"]')) {
    return true;
  }
  if (rule?.excludeSelectors && rule.excludeSelectors.length > 0) {
    for (const sel of rule.excludeSelectors) {
      try {
        if (el.matches(sel) || el.closest(sel)) return true;
      } catch {
        // Ignore invalid selector
      }
    }
  }
  return false;
}

function isVisibleElement(el: HTMLElement): boolean {
  if (!el.isConnected) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }
  return true;
}

function hasDirectMeaningfulText(el: HTMLElement): boolean {
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE && (child.textContent?.trim().length ?? 0) >= 2) {
      return true;
    }
  }
  return false;
}

/**
 * Heuristically identifies the main readable container on unknown sites (Readability-inspired density scoring).
 */
export function findHeuristicMainRoot(doc: Document): HTMLElement {
  const semanticCandidates = Array.from(
    doc.querySelectorAll<HTMLElement>('article, main, [role="main"], .post-content, .article-content, .entry-content'),
  ).filter((el) => !STRUCTURAL_SKIP_TAGS.has(el.tagName) && (el.textContent?.trim().length ?? 0) >= 200);

  if (semanticCandidates.length === 1 && semanticCandidates[0]) {
    return semanticCandidates[0];
  }
  if (semanticCandidates.length > 1 && semanticCandidates[0]) {
    let best: HTMLElement = semanticCandidates[0];
    let bestScore = -1;
    for (const cand of semanticCandidates) {
      const pCount = cand.querySelectorAll('p').length;
      const textLen = cand.textContent?.trim().length ?? 0;
      const score = textLen + pCount * 120;
      if (score > bestScore) {
        bestScore = score;
        best = cand;
      }
    }
    if (bestScore >= 350) return best;
  }

  return doc.body;
}

function queryAcrossRoots(
  root: Document | HTMLElement | ShadowRoot,
  selectors: string[],
  shadowHostSelectors: string[],
  customCss: string,
  out: Set<HTMLElement>,
  depth = 0,
): void {
  if (depth > 4) return;
  for (const sel of selectors) {
    try {
      const found = root.querySelectorAll<HTMLElement>(sel);
      for (const el of found) out.add(el);
    } catch {
      // Ignore invalid selector
    }
  }

  if (shadowHostSelectors.length > 0) {
    for (const hostSel of shadowHostSelectors) {
      try {
        const hosts = root.querySelectorAll<HTMLElement>(hostSel);
        for (const host of hosts) {
          if (host.shadowRoot) {
            injectShadowRootStyles(host.shadowRoot, customCss);
            queryAcrossRoots(host.shadowRoot, selectors, shadowHostSelectors, customCss, out, depth + 1);
          }
        }
      } catch {
        // Ignore invalid host selector
      }
    }
  }
}

/**
 * Deduplicates nested candidate elements so we don't translate both a parent container and its child paragraph,
 * unless the parent is explicitly marked as an atomic block.
 */
function deduplicateNestedBlocks(candidates: HTMLElement[], rule: SiteRule | null): HTMLElement[] {
  const candidateSet = new Set(candidates);
  const result: HTMLElement[] = [];

  for (const el of candidates) {
    // If an ancestor is an atomicBlockSelector in our candidate list, skip this child
    let ancestor = el.parentElement;
    let coveredByAtomicAncestor = false;
    while (ancestor) {
      if (candidateSet.has(ancestor) && matchesAny(ancestor, rule?.atomicBlockSelectors)) {
        coveredByAtomicAncestor = true;
        break;
      }
      ancestor = ancestor.parentElement;
    }
    if (coveredByAtomicAncestor) continue;

    // If this element itself is NOT atomic, and it contains other block candidates, skip this container
    if (!matchesAny(el, rule?.atomicBlockSelectors)) {
      let hasChildCandidate = false;
      for (const other of candidates) {
        if (other !== el && el.contains(other)) {
          hasChildCandidate = true;
          break;
        }
      }
      if (hasChildCandidate) continue;
    }

    result.push(el);
  }

  return result;
}

/**
 * Extracts all candidate translatable block elements for the current page / subtree.
 */
export function extractTranslatableBlocks(
  root: Document | HTMLElement,
  rule: SiteRule | null,
  customCss: string,
): HTMLElement[] {
  const candidates = new Set<HTMLElement>();

  if (rule?.selectors && rule.selectors.length > 0) {
    queryAcrossRoots(
      root,
      rule.selectors,
      rule.shadowRootSelectors ?? [],
      customCss,
      candidates,
    );
  } else {
    // Heuristic mode: scan readable content area
    const scanRoot = root instanceof Document ? findHeuristicMainRoot(root) : root;
    const walker = (root instanceof Document ? root : root.ownerDocument).createTreeWalker(
      scanRoot,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode(node) {
          const el = node as HTMLElement;
          if (GLOBAL_SKIP_TAGS.has(el.tagName)) return NodeFilter.FILTER_REJECT;
          if (scanRoot === document.body && STRUCTURAL_SKIP_TAGS.has(el.tagName)) {
            return NodeFilter.FILTER_REJECT;
          }
          if (el.hasAttribute('data-xt-wrapper') || el.hasAttribute('data-xt-ui-root')) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      },
    );

    let curr: Node | null = walker.currentNode;
    while (curr) {
      if (curr.nodeType === Node.ELEMENT_NODE) {
        const el = curr as HTMLElement;
        const isBlockTag = DEFAULT_BLOCK_TAGS.has(el.tagName) || matchesAny(el, rule?.extraBlockSelectors);
        if (isBlockTag && (el.textContent?.trim().length ?? 0) >= 2) {
          candidates.add(el);
        } else if (
          el.tagName === 'DIV' &&
          hasDirectMeaningfulText(el) &&
          el.children.length <= 6 &&
          (el.textContent?.trim().length ?? 0) >= 12
        ) {
          candidates.add(el);
        }
      }
      curr = walker.nextNode();
    }
  }

  const filtered: HTMLElement[] = [];
  for (const el of candidates) {
    if (isElementExcluded(el, rule)) continue;
    if (!isVisibleElement(el)) continue;
    if (el.querySelector(':scope > x-trans-wrap[data-xt-wrapper="1"]')) continue;
    if ((el.textContent?.trim().length ?? 0) < 2) continue;
    filtered.push(el);
  }

  return deduplicateNestedBlocks(filtered, rule);
}

/**
 * Inspects computed layout CSS to prevent flex/grid column breakage and line-clamp clipping.
 */
export function determineInjectionLayout(
  el: HTMLElement,
  rule: SiteRule | null,
): { layout: 'block' | 'inline'; needsUnclamp: boolean; origColor: string; origFontSize: string; origLineHeight: string } {
  const style = window.getComputedStyle(el);
  const display = style.display;
  const whiteSpace = style.whiteSpace;

  let layout: 'block' | 'inline' = 'block';
  if (matchesAny(el, rule?.extraInlineSelectors)) {
    layout = 'inline';
  } else if (matchesAny(el, rule?.extraBlockSelectors)) {
    layout = 'block';
  } else if (
    whiteSpace === 'nowrap' ||
    display === 'inline' ||
    display === 'inline-flex'
  ) {
    layout = 'inline';
  }

  const lineClamp = style.getPropertyValue('-webkit-line-clamp');
  const needsUnclamp =
    (lineClamp && lineClamp !== 'none' && lineClamp !== 'unset') ||
    (style.overflow === 'hidden' && style.textOverflow === 'ellipsis' && layout === 'block');

  return {
    layout,
    needsUnclamp,
    origColor: style.color,
    origFontSize: style.fontSize,
    origLineHeight: style.lineHeight,
  };
}
