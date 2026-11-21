import React, { useEffect, useState } from 'react';
import { Bug, Copy, Database, Download, RefreshCw, Trash2, Upload } from 'lucide-react';
import { mergeSettings } from '@/src/core/config/storage';
import type { ExtensionSettings } from '@/src/core/config/types';
import {
  clearDiagLogs,
  formatDiagLogsText,
  getDiagLogs,
  isLocalLogSinkEnabled,
  setLocalLogSinkEnabled,
  type DiagLogEntry,
} from '@/src/core/debug/logger';

interface Props {
  settings: ExtensionSettings;
  onChange: (next: ExtensionSettings) => void;
}

export function CacheBackupTab({ settings, onChange }: Props) {
  const [stats, setStats] = useState<{ pageEntries: number; subtitleEntries: number; asrEntries: number }>({
    pageEntries: 0,
    subtitleEntries: 0,
    asrEntries: 0,
  });
  const [logs, setLogs] = useState<DiagLogEntry[]>([]);
  const [localSink, setLocalSink] = useState(false);
  const [redactKeys, setRedactKeys] = useState(true);
  const [notice, setNotice] = useState('');

  const refreshStats = async () => {
    try {
      const res = (await chrome.runtime.sendMessage({ type: 'GET_CACHE_STATS' })) as {
        ok: boolean;
        stats?: typeof stats;
      };
      if (res?.ok && res.stats) setStats(res.stats);
    } catch {
      // Ignore
    }
  };

  const refreshLogs = async () => {
    const [entries, sink] = await Promise.all([getDiagLogs(), isLocalLogSinkEnabled()]);
    setLogs(entries);
    setLocalSink(sink);
  };

  useEffect(() => {
    void refreshStats();
    void refreshLogs();
  }, []);

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(''), 2600);
  };

  const handleToggleLocalSink = async (enabled: boolean) => {
    setLocalSink(enabled);
    await setLocalLogSinkEnabled(enabled);
    flash(
      enabled
        ? '已开启本地日志实时落盘（将上报至 http://127.0.0.1:17321/log -> logs/runtime.log）'
        : '已关闭本地日志落盘',
    );
  };

  const handleCopyLogs = async () => {
    const text = formatDiagLogsText(logs);
    await navigator.clipboard.writeText(text);
    flash(`已复制 ${logs.length} 条脱敏诊断日志`);
  };

  const handleClearLogs = async () => {
    await clearDiagLogs();
    setLogs([]);
    flash('诊断日志已清空');
  };

  const handleClear = async (target: 'all' | 'page' | 'subtitle' | 'asr') => {
    await chrome.runtime.sendMessage({ type: 'CLEAR_CACHE', target });
    await refreshStats();
    flash('缓存已清理完成');
  };

  const exportConfig = () => {
    const clone: ExtensionSettings = structuredClone(settings);
    if (redactKeys) {
      clone.engines = clone.engines.map((e) => ({ ...e, apiKey: e.apiKey ? '' : e.apiKey }));
      clone.video.asrApiKey = '';
    }
    const blob = new Blob([JSON.stringify(clone, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `opendual-config-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  const importConfig = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as Partial<ExtensionSettings>;
        onChange(mergeSettings(parsed));
        flash('配置已成功导入并生效');
      } catch {
        flash('导入失败：JSON 格式无效');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-6">
      {/* Runtime Diagnostic Logs */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Bug className="h-4 w-4 text-amber-400" />
            <h2 className="text-base font-semibold text-white">运行诊断日志（自动脱敏 API Key）</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => void refreshLogs()}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs text-slate-300 hover:text-white"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              刷新
            </button>
            <button
              onClick={() => void handleCopyLogs()}
              className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-500"
            >
              <Copy className="h-3.5 w-3.5" />
              一键复制日志 ({logs.length})
            </button>
            <button
              onClick={() => void handleClearLogs()}
              className="inline-flex items-center gap-1 rounded-lg border border-rose-800/70 bg-rose-950/30 px-2.5 py-1 text-xs text-rose-300 hover:bg-rose-900/40"
            >
              <Trash2 className="h-3.5 w-3.5" />
              清空
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/70 px-3.5 py-2.5 text-xs">
          <label className="inline-flex items-center gap-2 text-slate-200">
            <input
              type="checkbox"
              checked={localSink}
              onChange={(e) => void handleToggleLocalSink(e.target.checked)}
              className="accent-amber-500"
            />
            开启本地开发日志实时落盘（配合 `npm run logs` 自动写入项目 `logs/runtime.log`，AI 可直接读取定位）
          </label>
        </div>

        <pre className="mt-3 max-h-60 overflow-auto rounded-xl border border-slate-800 bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-slate-300">
          {formatDiagLogsText(logs)}
        </pre>
      </section>

      {/* Cache Stats */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-cyan-400" />
          <h2 className="text-base font-semibold text-white">IndexedDB 二级本地缓存管理</h2>
        </div>
        <p className="mt-1 text-xs text-slate-400">
          重复浏览同一网页或重看 YouTube/X 视频时直接零消耗命中本地缓存，大幅节省 API 费用与响应时间。
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5">
            <div className="text-xs text-slate-400">网页段落译文缓存</div>
            <div className="mt-1 text-2xl font-bold text-white">{stats.pageEntries}</div>
            <button
              onClick={() => void handleClear('page')}
              className="mt-2 text-[11px] text-rose-400 hover:underline"
            >
              清空网页缓存
            </button>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5">
            <div className="text-xs text-slate-400">视频双语字幕轨缓存</div>
            <div className="mt-1 text-2xl font-bold text-white">{stats.subtitleEntries}</div>
            <button
              onClick={() => void handleClear('subtitle')}
              className="mt-2 text-[11px] text-rose-400 hover:underline"
            >
              清空字幕缓存
            </button>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5">
            <div className="text-xs text-slate-400">AI 语音识别 (ASR) 缓存</div>
            <div className="mt-1 text-2xl font-bold text-white">{stats.asrEntries}</div>
            <button
              onClick={() => void handleClear('asr')}
              className="mt-2 text-[11px] text-rose-400 hover:underline"
            >
              清空 ASR 缓存
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t border-slate-800 pt-4">
          <div className="flex flex-wrap items-center gap-4 text-xs">
            <label className="inline-flex items-center gap-2 text-slate-200">
              <input
                type="checkbox"
                checked={settings.cacheEnabled}
                onChange={(e) => onChange({ ...settings, cacheEnabled: e.target.checked })}
                className="accent-cyan-500"
              />
              启用本地持久化缓存
            </label>
            <div className="flex items-center gap-2 text-slate-400">
              <span>有效期 (天):</span>
              <input
                type="number"
                min={1}
                max={90}
                value={settings.cacheTtlDays}
                onChange={(e) =>
                  onChange({ ...settings, cacheTtlDays: Math.max(1, Number(e.target.value) || 7) })
                }
                className="w-16 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
              />
            </div>
          </div>

          <button
            onClick={() => void handleClear('all')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-rose-800/70 bg-rose-950/40 px-3 py-1.5 text-xs font-medium text-rose-300 hover:bg-rose-900/50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            一键清空全部缓存
          </button>
        </div>
      </section>

      {/* Export / Import */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <h2 className="text-base font-semibold text-white">配置导入与备份导出</h2>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={redactKeys}
              onChange={(e) => setRedactKeys(e.target.checked)}
              className="accent-blue-500"
            />
            导出时自动移除所有 API Key（推荐分享规则时开启）
          </label>
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          <button
            onClick={exportConfig}
            className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500"
          >
            <Download className="h-3.5 w-3.5" />
            导出 JSON 配置
          </button>

          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-950 px-4 py-2 text-xs font-semibold text-slate-200 hover:border-blue-500 hover:text-white">
            <Upload className="h-3.5 w-3.5" />
            导入 JSON 配置
            <input type="file" accept="application/json" onChange={importConfig} className="hidden" />
          </label>
        </div>

        {notice && <p className="mt-3 text-xs text-emerald-400">{notice}</p>}
      </section>
    </div>
  );
}
