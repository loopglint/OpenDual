import React, { useEffect, useState } from 'react';
import {
  Cpu,
  Subtitles,
  Palette,
  BookOpen,
  Database,
  Languages,
  Check,
} from 'lucide-react';
import { loadSettings, saveSettings } from '@/src/core/config/storage';
import type { ExtensionSettings } from '@/src/core/config/types';
import { AppearanceTab } from './components/AppearanceTab';
import { CacheBackupTab } from './components/CacheBackupTab';
import { EnginesTab } from './components/EnginesTab';
import { RulesGlossaryTab } from './components/RulesGlossaryTab';
import { VideoTab } from './components/VideoTab';

type TabKey = 'engines' | 'video' | 'appearance' | 'rules' | 'cache';

const NAV_ITEMS: Array<{ key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { key: 'engines', label: '翻译引擎与 API', icon: Cpu },
  { key: 'video', label: '视频字幕与 ASR', icon: Subtitles },
  { key: 'appearance', label: '网页样式与交互', icon: Palette },
  { key: 'rules', label: '站点规则与术语表', icon: BookOpen },
  { key: 'cache', label: '诊断日志与缓存', icon: Database },
];

export default function App() {
  const [settings, setSettings] = useState<ExtensionSettings | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('engines');
  const [savedFlag, setSavedFlag] = useState(false);

  useEffect(() => {
    void loadSettings().then(setSettings);
  }, []);

  const handleChange = (next: ExtensionSettings) => {
    setSettings(next);
    void saveSettings(next).then(() => {
      setSavedFlag(true);
      setTimeout(() => setSavedFlag(false), 1600);
    });
  };

  if (!settings) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-sm text-slate-400">
        正在加载配置中心...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 lg:flex-row">
        {/* Sidebar */}
        <aside className="w-full shrink-0 lg:w-64">
          <div className="sticky top-8 space-y-5">
            <div className="flex items-center gap-3 px-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-cyan-500 shadow-lg shadow-blue-950/60">
                <Languages className="h-5 w-5 text-white" />
              </div>
              <div>
                <h1 className="text-base font-bold tracking-tight text-white">OpenDual 开源双语</h1>
                <p className="text-[11px] text-slate-400">v1.0.0 · Web + YouTube + X</p>
              </div>
            </div>

            <nav className="space-y-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.key;
                return (
                  <button
                    key={item.key}
                    onClick={() => setActiveTab(item.key)}
                    className={`flex w-full items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-sm font-medium transition ${
                      active
                        ? 'bg-blue-600/20 text-blue-300 ring-1 ring-blue-500/40'
                        : 'text-slate-400 hover:bg-slate-900 hover:text-slate-100'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </button>
                );
              })}
            </nav>

            <div className="rounded-xl border border-slate-800/80 bg-slate-900/40 p-3.5 text-[11px] leading-relaxed text-slate-400">
              <div className="font-semibold text-slate-200">隐私承诺</div>
              所有 API Key 仅存储在本地浏览器；免费翻译直连官方接口；本地 Ollama 100% 离线隐私运行。
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <main className="min-w-0 flex-1">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-bold text-white">
              {NAV_ITEMS.find((n) => n.key === activeTab)?.label}
            </h2>
            <div
              className={`inline-flex items-center gap-1 rounded-full border border-emerald-700/50 bg-emerald-950/50 px-3 py-1 text-xs text-emerald-300 transition-opacity ${
                savedFlag ? 'opacity-100' : 'opacity-0'
              }`}
            >
              <Check className="h-3.5 w-3.5" />
              已自动保存
            </div>
          </div>

          {activeTab === 'engines' && <EnginesTab settings={settings} onChange={handleChange} />}
          {activeTab === 'video' && <VideoTab settings={settings} onChange={handleChange} />}
          {activeTab === 'appearance' && <AppearanceTab settings={settings} onChange={handleChange} />}
          {activeTab === 'rules' && <RulesGlossaryTab settings={settings} onChange={handleChange} />}
          {activeTab === 'cache' && <CacheBackupTab settings={settings} onChange={handleChange} />}
        </main>
      </div>
    </div>
  );
}
