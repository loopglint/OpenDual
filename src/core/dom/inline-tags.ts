export interface SerializedBlock {
  serialized: string;
  plainText: string;
  voidNodes: Map<number, Node>;
  groupElements: Map<number, HTMLElement>;
}

const DEFAULT_PROTECTED_INLINE_TAGS = new Set([
  'CODE',
  'KBD',
  'SAMP',
  'VAR',
  'MATH',
  'SVG',
  'IMG',
  'BR',
  'INPUT',
  'BUTTON',
  'SELECT',
  'TEXTAREA',
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
]);

const TRANSLATABLE_INLINE_TAGS = new Set([
  'A',
  'STRONG',
  'B',
  'EM',
  'I',
  'U',
  'S',
  'DEL',
  'INS',
  'MARK',
  'SMALL',
  'SUB',
  'SUP',
  'SPAN',
  'ABBR',
  'CITE',
  'Q',
  'TIME',
  'BDI',
]);

function matchesAnySelector(el: Element, selectors: string[]): boolean {
  for (const sel of selectors) {
    try {
      if (el.matches(sel)) return true;
    } catch {
      // Ignore invalid user CSS selector
    }
  }
  return false;
}

export function isProtectedInlineElement(el: Element, stayOriginalSelectors: string[]): boolean {
  if (DEFAULT_PROTECTED_INLINE_TAGS.has(el.tagName)) return true;
  if (el.getAttribute('translate') === 'no' || el.classList.contains('notranslate')) return true;
  if (el.tagName === 'X-TRANS-WRAP' || el.hasAttribute('data-xt-wrapper')) return true;
  if (stayOriginalSelectors.length > 0 && matchesAnySelector(el, stayOriginalSelectors)) return true;
  return false;
}

/**
 * Serializes a block DOM element into an inline-tag-preserving string:
 * - Protected nodes (code, math, @mention, img) -> <v id="N"/>
 * - Translatable styled/link inline nodes (a, strong, em) -> <g id="N">innerText</g>
 * Never mutates the source DOM tree.
 */
export function serializeBlockWithInlineTags(
  root: HTMLElement,
  stayOriginalSelectors: string[] = [],
): SerializedBlock {
  const voidNodes = new Map<number, Node>();
  const groupElements = new Map<number, HTMLElement>();
  let voidSeq = 0;
  let groupSeq = 0;
  let plainParts: string[] = [];

  function walk(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? '';
      plainParts.push(text);
      return text;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const el = node as HTMLElement;
    if (el.tagName === 'X-TRANS-WRAP' || el.hasAttribute('data-xt-wrapper')) {
      return '';
    }

    if (isProtectedInlineElement(el, stayOriginalSelectors)) {
      const id = voidSeq++;
      voidNodes.set(id, el);
      // Keep spacing hint for readability
      const inner = el.textContent?.trim() ?? '';
      if (inner) plainParts.push(inner);
      return `<v id="${id}"/>`;
    }

    if (TRANSLATABLE_INLINE_TAGS.has(el.tagName)) {
      let innerOut = '';
      for (const child of Array.from(el.childNodes)) {
        innerOut += walk(child);
      }
      if (!innerOut.trim()) return innerOut;
      // Only wrap meaningful styled/link elements in <g> to keep prompts lean & accurate
      const needsPreservation =
        el.tagName === 'A' ||
        el.tagName === 'STRONG' ||
        el.tagName === 'B' ||
        el.tagName === 'EM' ||
        el.tagName === 'I' ||
        el.tagName === 'MARK' ||
        el.tagName === 'DEL';
      if (needsPreservation) {
        const id = groupSeq++;
        groupElements.set(id, el);
        return `<g id="${id}">${innerOut}</g>`;
      }
      return innerOut;
    }

    // Recurse into generic inline/phrasing wrappers
    let acc = '';
    for (const child of Array.from(el.childNodes)) {
      acc += walk(child);
    }
    return acc;
  }

  let serialized = '';
  for (const child of Array.from(root.childNodes)) {
    serialized += walk(child);
  }

  serialized = serialized.replace(/[ \t\r\n]+/g, ' ').trim();
  const plainText = plainParts.join('').replace(/[ \t\r\n]+/g, ' ').trim();

  return { serialized, plainText, voidNodes, groupElements };
}

/**
 * Safely reconstructs translated text containing <v id="N"/> and <g id="N">...</g>
 * into a DocumentFragment using ONLY createTextNode + cloneNode (ZERO innerHTML -> 100% XSS-safe).
 */
export function buildSafeTranslatedFragment(
  doc: Document,
  translatedText: string,
  meta: Pick<SerializedBlock, 'voidNodes' | 'groupElements'>,
): DocumentFragment {
  const frag = doc.createDocumentFragment();
  const tokenRegex = /<v\s+id=["'](\d+)["']\s*\/?>|<g\s+id=["'](\d+)["']\s*>|<\/g>/gi;

  const stack: Array<DocumentFragment | HTMLElement> = [frag];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  const topNode = () => stack[stack.length - 1] ?? frag;

  const appendText = (text: string) => {
    if (!text) return;
    topNode().appendChild(doc.createTextNode(text));
  };

  while ((match = tokenRegex.exec(translatedText)) !== null) {
    if (match.index > lastIndex) {
      appendText(translatedText.slice(lastIndex, match.index));
    }

    const voidIdStr = match[1];
    const groupIdStr = match[2];

    if (voidIdStr !== undefined) {
      const originalNode = meta.voidNodes.get(Number(voidIdStr));
      if (originalNode) {
        const cloned = originalNode.cloneNode(true);
        if (cloned.nodeType === Node.ELEMENT_NODE) {
          (cloned as HTMLElement).removeAttribute('id');
          (cloned as HTMLElement).setAttribute('data-xt-cloned', '1');
        }
        topNode().appendChild(cloned);
      }
    } else if (groupIdStr !== undefined) {
      const originalGroup = meta.groupElements.get(Number(groupIdStr));
      if (originalGroup) {
        // Shallow clone preserves tagName (A/STRONG/EM), href, target, rel, className safely!
        const clonedShell = originalGroup.cloneNode(false) as HTMLElement;
        clonedShell.removeAttribute('id');
        clonedShell.setAttribute('data-xt-cloned', '1');
        topNode().appendChild(clonedShell);
        stack.push(clonedShell);
      }
    } else {
      // Closing </g>
      if (stack.length > 1) {
        stack.pop();
      }
    }

    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex < translatedText.length) {
    appendText(translatedText.slice(lastIndex));
  }

  return frag;
}
