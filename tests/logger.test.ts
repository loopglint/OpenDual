import { describe, expect, it } from 'vitest';
import { formatDiagLogsText, redactSecrets } from '@/src/core/debug/logger';

describe('Diagnostic Logger Secret Redaction & Formatting', () => {
  it('redacts OpenAI/DeepSeek/Groq/Anthropic/Bearer secrets cleanly', () => {
    const raw =
      'Auth failed with Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc and key sk-1234567890abcdef and gsk_abcdefgh123456';
    const cleaned = redactSecrets(raw);
    expect(cleaned).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(cleaned).not.toContain('1234567890abcdef');
    expect(cleaned).not.toContain('abcdefgh123456');
    expect(cleaned).toContain('Bearer [REDACTED]');
    expect(cleaned).toContain('sk-[REDACTED]');
    expect(cleaned).toContain('gsk-[REDACTED]');
  });

  it('formats structured logs cleanly for copy/paste or runtime.log', () => {
    const out = formatDiagLogsText([
      {
        ts: '2026-11-21T12:00:00.000Z',
        level: 'error',
        source: 'background',
        message: 'TRANSLATE_BATCH failed',
        detail: 'HTTP 403',
        url: 'https://x.com/home',
      },
    ]);
    expect(out).toContain('[ERROR] [background] TRANSLATE_BATCH failed');
    expect(out).toContain('url: https://x.com/home');
    expect(out).toContain('detail: HTTP 403');
  });
});
