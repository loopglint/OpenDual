import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@/src/core/config/defaults';
import { matchUrlPattern, resolveSiteRule } from '@/src/core/rules/matcher';

describe('Mainstream Site Rule Matcher', () => {
  it('matches wildcards, bare domains, and path exclusions accurately', () => {
    expect(matchUrlPattern('https://x.com/elonmusk/status/123', 'x.com')).toBe(true);
    expect(matchUrlPattern('https://old.reddit.com/r/LocalLLaMA', '*.reddit.com')).toBe(true);
    expect(matchUrlPattern('https://en.wikipedia.org/wiki/Transformer', '*.wikipedia.org')).toBe(true);
    expect(matchUrlPattern('https://github.com/org/repo/blob/main/index.ts', 'github.com/*/blob/*')).toBe(true);
  });

  it('resolves built-in rules for mainstream sites and skips GitHub raw code blob pages', () => {
    expect(resolveSiteRule('https://github.com/org/repo/issues/42', DEFAULT_SETTINGS)?.id).toBe('github');
    expect(resolveSiteRule('https://github.com/org/repo/blob/main/src/app.ts', DEFAULT_SETTINGS)).toBeNull();
    expect(resolveSiteRule('https://www.reddit.com/r/MachineLearning/comments/abc/', DEFAULT_SETTINGS)?.id).toBe('reddit');
    expect(resolveSiteRule('https://arxiv.org/html/2401.00001', DEFAULT_SETTINGS)?.id).toBe('tech-docs-arxiv');
    expect(resolveSiteRule('https://www.youtube.com/watch?v=dQw4w9WgXcQ', DEFAULT_SETTINGS)?.id).toBe('youtube-page');
    expect(resolveSiteRule('https://x.com/home', DEFAULT_SETTINGS)?.id).toBe('x-twitter');
  });

  it('gives user custom rules higher precedence than built-in rules', () => {
    const customSettings = {
      ...DEFAULT_SETTINGS,
      userRules: [
        {
          id: 'my-github-override',
          name: 'My GitHub Override',
          matches: ['github.com'],
          selectors: ['.custom-selector'],
        },
      ],
    };
    expect(resolveSiteRule('https://github.com/org/repo', customSettings)?.id).toBe('my-github-override');
  });
});
