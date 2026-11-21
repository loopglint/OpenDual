import React, { useEffect, useState } from 'react';
import {
  Languages,
  Settings,
  RefreshCw,
  Subtitles,
  Sparkles,
  Globe,
  Ban,
  CheckCircle2,
  Cpu,
} from 'lucide-react';
import { LANGUAGE_OPTIONS } from '@/src/core/config/defaults';
import { loadSettings, updateSettings } from '@/src/core/config/storage';
import type { DisplayMode, ExtensionSettings, LanguageCode } from '@/src/core/config/types';
import type { PageTabState } from '@/src/core/messaging/protocol';

export default function App() {
  const [settings, setSettings] = useState<ExtensionSettings | null>(null);
  const [tabState, setTabState] = useState<PageTabState | null>(null);
  const [tabId, setTabId] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');

  useEffect(() => {
    void (async () => {
      const s = await loadSettings();
      setSettings(s);

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        setTabId(tab.id);
        try {
          const state = (await chrome.tabs.sendMessage(tab.id, {
            type: 'GET_TAB_STATE',
          })) as PageTabState;
          if (state) setTabState(state);
        } catch {
          setErrorMsg('当前页面为浏览器受限页，无法注入翻译脚本');
        }
      }
    })();
  }, []);

  const sendToTab = async (msg: Record<string, unknown>) => {
    if (!tabId) return;
    try {
      const res = (await chrome.tabs.sendMessage(tabId, msg)) as { state?: PageTabState } | undefined;
      if (res?.state) setTabState(res.state);
      setErrorMsg('');
    } catch {
      setErrorMsg('页面尚未就绪，请刷新标签页后重试');
    }
  };

  const handleToggleTranslate = () => void sendToTab({ type: 'TOGGLE_PAGE_TRANSLATE' });
  const handleRetranslate = () => void sendToTab({ type: 'RETRANSLATE_PAGE' });
  const handleToggleVideoSub = () => void sendToTab({ type: 'TOGGLE_VIDEO_SUBTITLE' });

  const handleDisplayMode = async (mode: DisplayMode) => {
    const next = await updateSettings((prev) => ({
      ...prev,
      appearance: { ...prev.appearance, displayMode: mode },
    }));
    setSettings(next);
    await sendToTab({ type: 'SET_PAGE_DISPLAY_MODE', mode });
  };

  const handleTargetLang = async (targetLang: LanguageCode) => {
    const next = await updateSettings((prev) => ({ ...prev, targetLang }));
    setSettings(next);
  };

  const handlePageEngine = async (engineId: string) => {
    const next = await updateSettings((prev) => ({ ...prev, activePageEngineId: engineId }));
    setSettings(next);
  };

  const handleVideoEngine = async (engineId: string) => {
    const next = await updateSettings((prev) => ({ ...prev, activeVideoEngineId: engineId }));
    setSettings(next);
  };

  const toggleDomainPolicy = async (listKey: 'autoTranslateDomains' | 'neverTranslateDomains') => {
    if (!tabState?.domain) return;
    const domain = tabState.domain;
    const otherKey =
      listKey === 'autoTranslateDomains' ? 'neverTranslateDomains' : 'autoTranslateDomains';

    const next = await updateSettings((prev) => {
      const exists = prev[listKey].includes(domain);
      return {
        ...prev,
        [listKey]: exists
          ? prev[listKey].filter((d) => d !== domain)
          : [...prev[listKey], domain],
        [otherKey]: prev[otherKey].filter((d) => d !== domain),
      };
    });
    setSettings(next);
  };

  if (!settings) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-slate-400">
        正在加载配置...
      </div>
    );
  }

  const enabledEngines = settings.engines.filter((e) => e.enabled);
  const domain = tabState?.domain ?? '';
  const isAutoDomain = domain ? settings.autoTranslateDomains.includes(domain) : false;
  const isNeverDomain = domain ? settings.neverTranslateDomains.includes(domain) : false;

  return (
    <div className="flex flex-col gap-3.5 bg-slate-950 p-4 text-slate-100">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-cyan-500 shadow-lg shadow-blue-950/60">
            <Languages className="h-4 w-4 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-tight text-white">OpenDual 开源双语</h1>
            <p className="text-[11px] text-slate-400">
              {tabState ? `适配规则: ${tabState.matchedRuleName}` : 'Web & YouTube / X 字幕'}
            </p>
          </div>
        </div>
        <button
          onClick={() => chrome.runtime.openOptionsPage()}
          className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-300 transition hover:border-slate-700 hover:bg-slate-800 hover:text-white"
          title="打开完整设置中心"
        >
          <Settings className="h-3.5 w-3.5" />
          设置
        </button>
      </div>

      {/* Primary Action Card */}
      <div className="rounded-xl border border-slate-800/90 bg-slate-900/70 p-3">
        <div className="flex items-center gap-2">
          <button
            onClick={handleToggleTranslate}
            disabled={!!errorMsg && !tabState}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3.5 py-2.5 text-sm font-semibold transition disabled:opacity-50 ${
              tabState?.translated
                ? 'bg-emerald-600/90 text-white hover:bg-emerald-500'
                : 'bg-gradient-to-r from-blue-600 to-cyan-600 text-white hover:from-blue-500 hover:to-cyan-500'
            }`}
          >
            <Sparkles className="h-4 w-4" />
            {tabState?.translated ? '恢复原文 (Alt+A)' : '双语翻译此页 (Alt+A)'}
          </button>
          {tabState?.translated && (
            <button
              onClick={handleRetranslate}
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-slate-200 transition hover:bg-slate-700 hover:text-white"
              title="清除页面缓存并重新翻译"
            >
              <RefreshCw className={`h-4 w-4 ${tabState.translating ? 'animate-spin' : ''}`} />
            </button>
          )}
        </div>

        {/* Display mode switch */}
        <div className="mt-2.5 grid grid-cols-2 gap-1.5 rounded-lg bg-slate-950/80 p-1">
          <button
            onClick={() => void handleDisplayMode('bilingual')}
            className={`rounded-md py-1.5 text-xs font-medium transition ${
              settings.appearance.displayMode === 'bilingual'
                ? 'bg-blue-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            双语对照
          </button>
          <button
            onClick={() => void handleDisplayMode('replace')}
            className={`rounded-md py-1.5 text-xs font-medium transition ${
              settings.appearance.displayMode === 'replace'
                ? 'bg-blue-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            仅显示译文
          </button>
        </div>

        {errorMsg && <p className="mt-2 text-[11px] text-amber-400">{errorMsg}</p>}
      </div>

      {/* Video Subtitle Quick Banner (YouTube / X) */}
      {tabState?.hasVideo && (
        <div className="flex items-center justify-between rounded-xl border border-cyan-500/30 bg-cyan-950/30 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <Subtitles className="h-4 w-4 text-cyan-400" />
            <div>
              <div className="text-xs font-semibold text-cyan-200">
                {tabState.videoPlatform === 'youtube' ? 'YouTube 双语字幕' : 'X 视频双语字幕'}
              </div>
              <div className="text-[11px] text-cyan-300/75">
                {tabState.videoSubtitleActive ? '智能断句双语字幕运行中' : '已暂停显示'}
              </div>
            </div>
          </div>
          <button
            onClick={handleToggleVideoSub}
            className={`rounded-lg px-3 py-1 text-xs font-semibold transition ${
              tabState.videoSubtitleActive
                ? 'bg-cyan-500 text-slate-950 hover:bg-cyan-400'
                : 'border border-cyan-500/40 bg-slate-900 text-cyan-300 hover:bg-slate-800'
            }`}
          >
            {tabState.videoSubtitleActive ? '已开启' : '开启'}
          </button>
        </div>
      )}

      {/* Engine & Language Controls */}
      <div className="space-y-2.5 rounded-xl border border-slate-800/90 bg-slate-900/50 p-3">
        <div className="flex items-center justify-between gap-2">
          <label className="text-xs text-slate-400">目标语言</label>
          <select
            value={settings.targetLang}
            onChange={(e) => void handleTargetLang(e.target.value as LanguageCode)}
            className="w-48 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-100 outline-none focus:border-blue-500"
          >
            {LANGUAGE_OPTIONS.map((opt) => (
              <option key={opt.code} value={opt.code}>
                {opt.label} ({opt.nativeLabel})
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-1 text-xs text-slate-400">
            <Cpu className="h-3.5 w-3.5 text-blue-400" />
            网页引擎
          </label>
          <select
            value={settings.activePageEngineId}
            onChange={(e) => void handlePageEngine(e.target.value)}
            className="w-48 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-100 outline-none focus:border-blue-500"
          >
            {enabledEngines.map((eng) => (
              <option key={eng.id} value={eng.id}>
                {eng.name}
                {eng.model ? ` (${eng.model})` : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-1 text-xs text-slate-400">
            <Subtitles className="h-3.5 w-3.5 text-cyan-400" />
            视频引擎
          </label>
          <select
            value={settings.activeVideoEngineId}
            onChange={(e) => void handleVideoEngine(e.target.value)}
            className="w-48 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-100 outline-none focus:border-blue-500"
          >
            {enabledEngines.map((eng) => (
              <option key={eng.id} value={eng.id}>
                {eng.name}
                {eng.model ? ` (${eng.model})` : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Site Domain Quick Policy */}
      {domain && (
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => void toggleDomainPolicy('autoTranslateDomains')}
            className={`flex items-center justify-center gap-1.5 rounded-lg border px-2.5 py-2 text-[11px] font-medium transition ${
              isAutoDomain
                ? 'border-blue-500/60 bg-blue-500/15 text-blue-300'
                : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700 hover:text-slate-200'
            }`}
          >
            {isAutoDomain ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Globe className="h-3.5 w-3.5" />}
            总是自动翻译本站
          </button>
          <button
            onClick={() => void toggleDomainPolicy('neverTranslateDomains')}
            className={`flex items-center justify-center gap-1.5 rounded-lg border px-2.5 py-2 text-[11px] font-medium transition ${
              isNeverDomain
                ? 'border-rose-500/60 bg-rose-500/15 text-rose-300'
                : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700 hover:text-slate-200'
            }`}
          >
            <Ban className="h-3.5 w-3.5" />
            永不自动翻译本站
          </button>
        </div>
      )}

      {/* Footer status */}
      <div className="flex items-center justify-between border-t border-slate-800/80 pt-2 text-[11px] text-slate-500">
        <span>按住 {settings.appearance.hoverTriggerKey === 'none' ? '未开启' : settings.appearance.hoverTriggerKey} 悬停可单段翻译</span>
        <button
          onClick={() => chrome.runtime.openOptionsPage()}
          className="text-blue-400 hover:text-blue-300 hover:underline"
        >
          配置 Ollama / DeepSeek / OpenAI →
        </button>
      </div>
    </div>
  );
}
