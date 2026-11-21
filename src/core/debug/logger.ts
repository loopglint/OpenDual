export type LogLevel = 'info' | 'warn' | 'error';
export type LogSource = 'background' | 'content' | 'youtube' | 'x' | 'popup' | 'options' | 'offscreen';

export interface DiagLogEntry {
  ts: string;
  level: LogLevel;
  source: LogSource;
  message: string;
  detail?: string;
  url?: string;
}

const LOG_STORAGE_KEY = 'luminous_translator_diag_logs_v1';
const LOCAL_SINK_KEY = 'luminous_translator_local_log_sink_v1';
const LOCAL_SINK_URL = 'http://127.0.0.1:17321/log';
const MAX_LOGS = 200;

/**
 * Redacts API keys / Bearer tokens before storing or forwarding any diagnostic log.
 */
export function redactSecrets(raw: string): string {
  return raw
    .replace(/Bearer\s+[A-Za-z0-9._\-]{8,}/gi, 'Bearer [REDACTED]')
    .replace(/\b(sk|gsk|sk-ant|xai|AIza)[A-Za-z0-9_\-]{8,}\b/g, '$1-[REDACTED]');
}

let writeChain: Promise<void> = Promise.resolve();

export async function isLocalLogSinkEnabled(): Promise<boolean> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return false;
  try {
    const res = await chrome.storage.local.get(LOCAL_SINK_KEY);
    return Boolean(res[LOCAL_SINK_KEY]);
  } catch {
    return false;
  }
}

export async function setLocalLogSinkEnabled(enabled: boolean): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
  await chrome.storage.local.set({ [LOCAL_SINK_KEY]: enabled });
}

export function diagLog(
  source: LogSource,
  level: LogLevel,
  message: string,
  detail?: unknown,
): void {
  const detailStr =
    detail === undefined
      ? undefined
      : redactSecrets(
          detail instanceof Error
            ? `${detail.name}: ${detail.message}\n${detail.stack ?? ''}`.slice(0, 1200)
            : typeof detail === 'string'
              ? detail.slice(0, 1200)
              : JSON.stringify(detail).slice(0, 1200),
        );

  const entry: DiagLogEntry = {
    ts: new Date().toISOString(),
    level,
    source,
    message: redactSecrets(message),
    ...(detailStr ? { detail: detailStr } : {}),
    url: typeof location !== 'undefined' ? location.href.slice(0, 180) : undefined,
  };

  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;

  // Serialize writes in-context to minimize race conditions
  writeChain = writeChain
    .then(async () => {
      const stored = await chrome.storage.local.get([LOG_STORAGE_KEY, LOCAL_SINK_KEY]);
      const prev = Array.isArray(stored[LOG_STORAGE_KEY])
        ? (stored[LOG_STORAGE_KEY] as DiagLogEntry[])
        : [];
      const next = [...prev, entry].slice(-MAX_LOGS);
      await chrome.storage.local.set({ [LOG_STORAGE_KEY]: next });

      // Optional local dev log sink (127.0.0.1:17321) -> writes straight to workspace logs/runtime.log
      if (stored[LOCAL_SINK_KEY]) {
        fetch(LOCAL_SINK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(entry),
        }).catch(() => {});
      }
    })
    .catch(() => {});
}

export async function getDiagLogs(): Promise<DiagLogEntry[]> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return [];
  try {
    const res = await chrome.storage.local.get(LOG_STORAGE_KEY);
    return Array.isArray(res[LOG_STORAGE_KEY]) ? (res[LOG_STORAGE_KEY] as DiagLogEntry[]) : [];
  } catch {
    return [];
  }
}

export async function clearDiagLogs(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
  await chrome.storage.local.set({ [LOG_STORAGE_KEY]: [] });
}

export function formatDiagLogsText(logs: DiagLogEntry[]): string {
  if (logs.length === 0) return '(暂无错误或诊断日志)';
  return logs
    .map((l) => {
      const head = `[${l.ts}] [${l.level.toUpperCase()}] [${l.source}] ${l.message}`;
      const urlLine = l.url ? `  url: ${l.url}` : '';
      const detailLine = l.detail ? `  detail: ${l.detail}` : '';
      return [head, urlLine, detailLine].filter(Boolean).join('\n');
    })
    .join('\n\n');
}

export function installGlobalErrorHooks(source: LogSource): void {
  const g = globalThis as unknown as {
    addEventListener?: (type: string, fn: (ev: Event) => void) => void;
    __luminousErrorHookInstalled?: boolean;
  };
  if (g.__luminousErrorHookInstalled || typeof g.addEventListener !== 'function') return;
  g.__luminousErrorHookInstalled = true;

  g.addEventListener('error', (ev: Event) => {
    const errEv = ev as ErrorEvent;
    diagLog(source, 'error', errEv.message || 'Uncaught Error', errEv.error ?? `${errEv.filename}:${errEv.lineno}`);
  });

  g.addEventListener('unhandledrejection', (ev: Event) => {
    const rejEv = ev as PromiseRejectionEvent;
    diagLog(source, 'error', 'Unhandled Promise Rejection', rejEv.reason);
  });
}
