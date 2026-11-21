import { describe, expect, it } from 'vitest';
import { extractTranslatableBlocks } from '@/src/core/dom/extractor';
import { BUILTIN_SITE_RULES } from '@/src/core/rules/builtin-rules';

describe('Mainstream Site DOM Extractor & Protection Rules', () => {
  it('extracts GitHub markdown paragraphs while strictly excluding code blocks & nav', () => {
    document.body.innerHTML = `
      <nav><p>Navigation item should stay untranslated</p></nav>
      <div class="markdown-body">
        <h1>Project Overview</h1>
        <p>This library provides fast bilingual translation with <code>npm install</code>.</p>
        <pre><code>const x = "do not translate code";</code></pre>
      </div>
    `;
    const githubRule = BUILTIN_SITE_RULES.find((r) => r.id === 'github')!;
    const blocks = extractTranslatableBlocks(document, githubRule, '');
    const texts = blocks.map((el) => el.textContent?.trim());

    expect(texts).toContain('Project Overview');
    expect(texts.some((t) => t?.includes('fast bilingual translation'))).toBe(true);
    expect(texts.some((t) => t?.includes('do not translate code'))).toBe(false);
    expect(texts.some((t) => t?.includes('Navigation item'))).toBe(false);
  });

  it('traverses Reddit open Shadow DOM (shreddit-post) and excludes user flair/handles', () => {
    document.body.innerHTML = '';
    const postHost = document.createElement('shreddit-post');
    const shadow = postHost.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <h1 slot="title">How does local Ollama perform for subtitle translation?</h1>
      <shreddit-post-flair>Discussion</shreddit-post-flair>
      <div slot="text-body">
        <p>I tested Qwen 2.5 7B on YouTube videos and the quality is great.</p>
      </div>
    `;
    document.body.appendChild(postHost);

    const redditRule = BUILTIN_SITE_RULES.find((r) => r.id === 'reddit')!;
    const blocks = extractTranslatableBlocks(document, redditRule, '');
    const texts = blocks.map((el) => el.textContent?.trim());

    expect(texts).toContain('How does local Ollama perform for subtitle translation?');
    expect(texts).toContain('I tested Qwen 2.5 7B on YouTube videos and the quality is great.');
    expect(texts).not.toContain('Discussion');
  });

  it('treats X tweetText as an atomic block and excludes User-Name & composer', () => {
    document.body.innerHTML = `
      <article data-testid="tweet">
        <div data-testid="User-Name"><span>John Doe @johndoe</span></div>
        <div data-testid="tweetText">
          <span>Just shipped a new open-source </span>
          <a href="/hashtag/AI" role="link"><span>#AI</span></a>
          <span> browser extension!</span>
        </div>
        <div contenteditable="true"><div data-testid="tweetText">Draft reply should not translate</div></div>
      </article>
    `;

    const xRule = BUILTIN_SITE_RULES.find((r) => r.id === 'x-twitter')!;
    const blocks = extractTranslatableBlocks(document, xRule, '');
    expect(blocks.length).toBe(1);
    expect(blocks[0]?.textContent).toContain('Just shipped a new open-source');
  });
});
