import { describe, expect, it } from 'vitest';
import { isAlreadyTargetLanguage, isTranslatableText } from '@/src/core/dom/language';

describe('Per-Block Language & Translatability Filter', () => {
  it('filters out URLs, pure numbers, versions, and snake_case tokens', () => {
    expect(isTranslatableText('https://github.com/openai/whisper')).toBe(false);
    expect(isTranslatableText('12,345.67%')).toBe(false);
    expect(isTranslatableText('v2.4.1')).toBe(false);
    expect(isTranslatableText('my_config_variable')).toBe(false);
    expect(isTranslatableText('OpenAI released a new model today.')).toBe(true);
  });

  it('skips Chinese blocks containing embedded English acronyms when targetLang is zh-CN', () => {
    expect(isAlreadyTargetLanguage('这款插件支持本地 Ollama 和 DeepSeek API 调用。', 'zh-CN')).toBe(true);
    expect(isAlreadyTargetLanguage('This extension supports local Ollama and DeepSeek API.', 'zh-CN')).toBe(false);
    // Japanese text containing Kanji + Kana must NOT be misclassified as Chinese!
    expect(isAlreadyTargetLanguage('この拡張機能はローカルのOllamaをサポートしています。', 'zh-CN')).toBe(false);
    expect(isAlreadyTargetLanguage('この拡張機能はローカルのOllamaをサポートしています。', 'ja')).toBe(true);
  });
});
