import { describe, expect, it } from 'vitest';
import {
  buildSafeTranslatedFragment,
  serializeBlockWithInlineTags,
} from '@/src/core/dom/inline-tags';

describe('Inline Tag Preservation & XSS-Safe DOM Reconstruction', () => {
  it('serializes inline code as <v/> and links/bold as <g>, then restores safely', () => {
    const p = document.createElement('p');
    p.innerHTML =
      'Run <code>npm install</code> and read the <a href="https://example.com" class="doc-link">official <strong>guide</strong></a>.';

    const serialized = serializeBlockWithInlineTags(p, ['code']);
    expect(serialized.serialized).toBe(
      'Run <v id="0"/> and read the <g id="1">official <g id="0">guide</g></g>.',
    );
    expect(serialized.voidNodes.size).toBe(1);
    expect(serialized.groupElements.size).toBe(2);

    const translated = '运行 <v id="0"/> 并阅读<g id="1">官方<g id="0">指南</g></g>。';
    const frag = buildSafeTranslatedFragment(document, translated, serialized);
    const host = document.createElement('div');
    host.appendChild(frag);

    expect(host.querySelector('code')?.textContent).toBe('npm install');
    const link = host.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://example.com');
    expect(link?.className).toBe('doc-link');
    expect(link?.querySelector('strong')?.textContent).toBe('指南');
    expect(host.textContent).toBe('运行 npm install 并阅读官方指南。');
  });

  it('prevents XSS when an untrusted LLM emits script or img onerror tags', () => {
    const p = document.createElement('p');
    p.textContent = 'Hello world';
    const meta = serializeBlockWithInlineTags(p);

    const malicious = '你好 <script>window.__xss=1</script><img src=x onerror="alert(1)"> 世界';
    const frag = buildSafeTranslatedFragment(document, malicious, meta);
    const host = document.createElement('div');
    host.appendChild(frag);

    expect(host.querySelector('script')).toBeNull();
    expect(host.querySelector('img')).toBeNull();
    expect(host.textContent).toContain('<script>');
  });
});
