import type { BilingualTheme, DisplayMode } from '../config/types';

export const PAGE_STYLE_ELEMENT_ID = 'luminous-translator-page-styles';
export const SITE_PATCH_STYLE_ID = 'luminous-translator-site-patch';

export function buildBaseTranslatorCss(customCss: string): string {
  return `
    /* Non-destructive bilingual wrapper */
    x-trans-wrap[data-xt-wrapper="1"] {
      display: block;
      margin-top: 0.35em;
      margin-bottom: 0.15em;
      font-family: inherit;
      font-size: 0.96em;
      line-height: 1.55;
      color: inherit;
      word-break: break-word;
      white-space: pre-wrap;
      box-sizing: border-box;
      text-decoration: none;
    }

    x-trans-wrap[data-xt-wrapper="1"][data-xt-layout="inline"] {
      display: inline;
      margin: 0 0 0 0.4em;
    }

    /* Loading indicator */
    x-trans-wrap[data-xt-state="loading"] {
      opacity: 0.65;
      font-size: 0.85em;
    }

    x-trans-wrap[data-xt-state="loading"]::after {
      content: "";
      display: inline-block;
      width: 10px;
      height: 10px;
      margin-left: 6px;
      border: 1.5px solid currentColor;
      border-right-color: transparent;
      border-radius: 50%;
      vertical-align: -1px;
      animation: xt-spin 0.75s linear infinite;
    }

    @keyframes xt-spin {
      to { transform: rotate(360deg); }
    }

    x-trans-wrap[data-xt-state="error"] {
      color: #ef4444;
      font-size: 0.84em;
      opacity: 0.9;
    }

    /* Replace mode: visually hide original nodes while preserving React/Vue DOM tree intact! */
    html[data-xt-mode="replace"] [data-xt-translated="1"] {
      font-size: 0 !important;
      line-height: 0 !important;
      color: transparent !important;
    }
    html[data-xt-mode="replace"] [data-xt-translated="1"] > :not(x-trans-wrap[data-xt-wrapper="1"]) {
      display: none !important;
    }
    html[data-xt-mode="replace"] [data-xt-translated="1"] > x-trans-wrap[data-xt-wrapper="1"] {
      font-size: initial;
      font-size: var(--xt-orig-font-size, 15px) !important;
      line-height: var(--xt-orig-line-height, 1.55) !important;
      color: var(--xt-orig-color, inherit) !important;
      margin-top: 0 !important;
      display: inline !important;
    }

    /* Theme: default (subtle contrast) */
    html[data-xt-theme="default"] x-trans-wrap[data-xt-wrapper="1"] {
      opacity: 0.92;
    }

    /* Theme: underline */
    html[data-xt-theme="underline"] x-trans-wrap[data-xt-wrapper="1"] {
      text-decoration: underline;
      text-decoration-color: rgba(59, 130, 246, 0.55);
      text-underline-offset: 4px;
      text-decoration-thickness: 1.5px;
    }

    /* Theme: dashed */
    html[data-xt-theme="dashed"] x-trans-wrap[data-xt-wrapper="1"] {
      border-bottom: 1.5px dashed rgba(99, 102, 241, 0.55);
      padding-bottom: 2px;
    }

    /* Theme: highlight */
    html[data-xt-theme="highlight"] x-trans-wrap[data-xt-wrapper="1"] {
      background: linear-gradient(120deg, rgba(59, 130, 246, 0.12), rgba(16, 185, 129, 0.12));
      border-radius: 5px;
      padding: 3px 7px;
    }

    /* Theme: blockquote */
    html[data-xt-theme="blockquote"] x-trans-wrap[data-xt-wrapper="1"] {
      border-left: 3px solid #3b82f6;
      padding-left: 10px;
      opacity: 0.92;
    }

    /* Theme: blur-learning */
    html[data-xt-theme="blur-learning"] x-trans-wrap[data-xt-wrapper="1"] {
      filter: blur(5px);
      transition: filter 0.2s ease;
      cursor: pointer;
    }
    html[data-xt-theme="blur-learning"] x-trans-wrap[data-xt-wrapper="1"]:hover {
      filter: blur(0);
    }

    /* Theme: weakened-original */
    html[data-xt-theme="weakened-original"] [data-xt-translated="1"] {
      color: color-mix(in srgb, currentColor 58%, transparent);
    }
    html[data-xt-theme="weakened-original"] x-trans-wrap[data-xt-wrapper="1"] {
      color: var(--xt-orig-color, inherit);
      opacity: 1;
      font-weight: 450;
    }

    /* Prevent line-clamp clipping when bilingual content is appended */
    [data-xt-unclamp="1"] {
      -webkit-line-clamp: unset !important;
      max-height: none !important;
      overflow: visible !important;
    }

    ${customCss || ''}
  `;
}

export function applyTranslatorStyles(
  doc: Document,
  opts: {
    mode: DisplayMode;
    theme: BilingualTheme;
    customCss: string;
    sitePatchCss?: string;
  },
): void {
  doc.documentElement.setAttribute('data-xt-mode', opts.mode);
  doc.documentElement.setAttribute('data-xt-theme', opts.theme);

  let styleEl = doc.getElementById(PAGE_STYLE_ELEMENT_ID) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = doc.createElement('style');
    styleEl.id = PAGE_STYLE_ELEMENT_ID;
    (doc.head || doc.documentElement).appendChild(styleEl);
  }
  styleEl.textContent = buildBaseTranslatorCss(opts.customCss);

  if (opts.sitePatchCss) {
    let patchEl = doc.getElementById(SITE_PATCH_STYLE_ID) as HTMLStyleElement | null;
    if (!patchEl) {
      patchEl = doc.createElement('style');
      patchEl.id = SITE_PATCH_STYLE_ID;
      (doc.head || doc.documentElement).appendChild(patchEl);
    }
    patchEl.textContent = opts.sitePatchCss;
  }
}

export function injectShadowRootStyles(shadowRoot: ShadowRoot, customCss: string): void {
  if (shadowRoot.getElementById(PAGE_STYLE_ELEMENT_ID)) return;
  const styleEl = document.createElement('style');
  styleEl.id = PAGE_STYLE_ELEMENT_ID;
  styleEl.textContent = buildBaseTranslatorCss(customCss);
  shadowRoot.appendChild(styleEl);
}
