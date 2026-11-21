import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  Loader2,
  RefreshCw,
  Plus,
  Trash2,
  ShieldCheck,
  Terminal,
  Sparkles,
  Copy,
  X,
  ChevronRight,
  ChevronDown,
  SlidersHorizontal,
} from 'lucide-react';
import { CUSTOM_ENGINE_PRESETS, type CustomEnginePreset } from '@/src/core/config/defaults';
import type { EngineProfile, ExtensionSettings } from '@/src/core/config/types';
import { ensureHostPermissionForUrl } from '@/src/core/network/permissions';

interface TestState {
  loading: boolean;
  ok?: boolean;
  latencyMs?: number;
  sample?: string;
  error?: string;
  errorCode?: string;
}

type StatusCode = 'ready' | 'unconfigured' | 'disabled';

interface EngineStatusMeta {
  code: StatusCode;
  label: string;
  dotClass: string;
  textClass: string;
}

interface Props {
  settings: ExtensionSettings;
  onChange: (next: ExtensionSettings) => void;
}

const MODEL_SUGGESTIONS: Partial<Record<EngineProfile['kind'], string[]>> = {
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  openai: ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4.1-nano'],
  anthropic: ['claude-3-5-haiku-latest', 'claude-3-7-sonnet-latest'],
};

function isLocalUrl(raw?: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test((raw ?? '').trim());
}

function getEngineStatus(engine: EngineProfile, test?: TestState): EngineStatusMeta {
  if (!engine.enabled) {
    return {
      code: 'disabled',
      label: '已停用',
      dotClass: 'bg-slate-500',
      textClass: 'text-slate-500',
    };
  }

  if (test?.ok && test.latencyMs !== undefined) {
    return {
      code: 'ready',
      label: `已连通 · ${test.latencyMs}ms`,
      dotClass: 'bg-emerald-400',
      textClass: 'text-emerald-400',
    };
  }

  if (
    engine.kind === 'edge-free' ||
    engine.kind === 'google-free' ||
    engine.kind === 'chrome-builtin'
  ) {
    return {
      code: 'ready',
      label: '免 Key 可用',
      dotClass: 'bg-emerald-400',
      textClass: 'text-emerald-400',
    };
  }

  if (engine.kind === 'ollama') {
    if (engine.baseUrl?.trim() && engine.model?.trim()) {
      return {
        code: 'ready',
        label: '本地已配置',
        dotClass: 'bg-emerald-400',
        textClass: 'text-emerald-400',
      };
    }
    return {
      code: 'unconfigured',
      label: '待选择模型',
      dotClass: 'bg-amber-400',
      textClass: 'text-amber-400',
    };
  }

  if (engine.kind === 'deeplx') {
    if (engine.baseUrl?.trim()) {
      return {
        code: 'ready',
        label: '已配置地址',
        dotClass: 'bg-emerald-400',
        textClass: 'text-emerald-400',
      };
    }
    return {
      code: 'unconfigured',
      label: '待填接口',
      dotClass: 'bg-amber-400',
      textClass: 'text-amber-400',
    };
  }

  if (engine.kind === 'openai-compatible' && isLocalUrl(engine.baseUrl)) {
    if (engine.model?.trim()) {
      return {
        code: 'ready',
        label: '本地已配置',
        dotClass: 'bg-emerald-400',
        textClass: 'text-emerald-400',
      };
    }
    return {
      code: 'unconfigured',
      label: '待填模型',
      dotClass: 'bg-amber-400',
      textClass: 'text-amber-400',
    };
  }

  if (engine.apiKey?.trim()) {
    return {
      code: 'ready',
      label: '已填 Key',
      dotClass: 'bg-emerald-400',
      textClass: 'text-emerald-400',
    };
  }

  return {
    code: 'unconfigured',
    label: '未填 Key',
    dotClass: 'bg-amber-400',
    textClass: 'text-amber-400',
  };
}

function getEngineSubtitle(engine: EngineProfile): string {
  if (engine.kind === 'edge-free' || engine.kind === 'google-free') return '免 Key 免费在线';
  if (engine.kind === 'chrome-builtin') return 'Chrome 138+ 本地免 Key';
  if (engine.kind === 'deeplx') return engine.baseUrl || '自建 DeepLX';
  return engine.model?.trim() || '未指定模型';
}

export function EnginesTab({ settings, onChange }: Props) {
  const [filter, setFilter] = useState<'all' | 'ready' | 'unconfigured'>('all');
  const [editingEngineId, setEditingEngineId] = useState<string | null>(null);
  const [showPresetModal, setShowPresetModal] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [testStates, setTestStates] = useState<Record<string, TestState>>({});
  const [ollamaModels, setOllamaModels] = useState<Array<{ name: string; parameterSize?: string }>>(
    [],
  );
  const [loadingOllamaModels, setLoadingOllamaModels] = useState(false);
  const [ollamaModelErr, setOllamaModelErr] = useState('');
  const [copiedCmd, setCopiedCmd] = useState('');

  // Close modals on Escape key
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setEditingEngineId(null);
        setShowPresetModal(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const updateEngine = (id: string, patch: Partial<EngineProfile>) => {
    onChange({
      ...settings,
      engines: settings.engines.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    });
  };

  const addCustomEngine = (preset?: CustomEnginePreset) => {
    const id = `custom_${Date.now()}`;
    const nextEngine: EngineProfile = {
      id,
      name: preset ? preset.label : '自定义 OpenAI 兼容接口',
      kind: preset ? preset.kind : 'openai-compatible',
      enabled: true,
      builtin: false,
      baseUrl: preset?.baseUrl ?? 'https://api.openai.com/v1',
      apiKey: '',
      model: preset?.defaultModel ?? 'gpt-4o-mini',
      temperature: 0.1,
      maxCharsPerBatch: 2800,
      maxItemsPerBatch: 14,
      concurrency: 4,
      timeoutMs: 60000,
      streaming: preset?.kind !== 'deeplx',
    };
    onChange({
      ...settings,
      engines: [...settings.engines, nextEngine],
    });
    setShowPresetModal(false);
    setShowAdvanced(false);
    setEditingEngineId(id);
  };

  const removeCustomEngine = (id: string) => {
    const remaining = settings.engines.filter((e) => e.id !== id);
    onChange({
      ...settings,
      engines: remaining,
      activePageEngineId:
        settings.activePageEngineId === id ? 'edge-free' : settings.activePageEngineId,
      activeVideoEngineId:
        settings.activeVideoEngineId === id ? 'edge-free' : settings.activeVideoEngineId,
    });
    setEditingEngineId(null);
  };

  const runTest = async (profile: EngineProfile) => {
    setTestStates((prev) => ({ ...prev, [profile.id]: { loading: true } }));
    try {
      if (profile.baseUrl) {
        await ensureHostPermissionForUrl(profile.baseUrl);
      }
      const res = (await chrome.runtime.sendMessage({
        type: 'TEST_ENGINE',
        profile,
      })) as {
        ok: boolean;
        latencyMs?: number;
        sample?: string;
        error?: string;
        errorCode?: string;
      };
      setTestStates((prev) => ({
        ...prev,
        [profile.id]: {
          loading: false,
          ok: res.ok,
          latencyMs: res.latencyMs,
          sample: res.sample,
          error: res.error,
          errorCode: res.errorCode,
        },
      }));
    } catch (err) {
      setTestStates((prev) => ({
        ...prev,
        [profile.id]: {
          loading: false,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        },
      }));
    }
  };

  const fetchOllamaModels = async (baseUrl: string) => {
    setLoadingOllamaModels(true);
    setOllamaModelErr('');
    try {
      await ensureHostPermissionForUrl(baseUrl);
      const res = (await chrome.runtime.sendMessage({
        type: 'LIST_OLLAMA_MODELS',
        baseUrl,
      })) as {
        ok: boolean;
        models?: Array<{ name: string; parameterSize?: string }>;
        error?: string;
      };
      if (res.ok && res.models) {
        setOllamaModels(res.models);
        if (res.models.length === 0) {
          setOllamaModelErr('已连接 Ollama，但本地暂无已拉取模型（请先执行 ollama pull qwen2.5:7b）');
        }
      } else {
        setOllamaModelErr(res.error || '无法读取 Ollama 模型列表');
      }
    } catch (err) {
      setOllamaModelErr(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingOllamaModels(false);
    }
  };

  const copyCommand = (label: string, cmd: string) => {
    void navigator.clipboard.writeText(cmd);
    setCopiedCmd(label);
    setTimeout(() => setCopiedCmd(''), 2000);
  };

  const openEditor = (id: string) => {
    setShowAdvanced(false);
    setOllamaModelErr('');
    setEditingEngineId(id);
  };

  const enabledEngines = settings.engines.filter((e) => e.enabled);
  const readyEngines = settings.engines.filter((e) => getEngineStatus(e, testStates[e.id]).code === 'ready');
  const otherEngines = settings.engines.filter((e) => getEngineStatus(e, testStates[e.id]).code !== 'ready');

  const editingEngine = editingEngineId
    ? settings.engines.find((e) => e.id === editingEngineId) ?? null
    : null;

  const renderCard = (engine: EngineProfile) => {
    const status = getEngineStatus(engine, testStates[engine.id]);
    const isPagePrimary = settings.activePageEngineId === engine.id;
    const isVideoPrimary = settings.activeVideoEngineId === engine.id;

    return (
      <div
        key={engine.id}
        onClick={() => openEditor(engine.id)}
        className={`group flex cursor-pointer flex-col justify-between gap-3 rounded-2xl border p-4 transition ${
          isPagePrimary || isVideoPrimary
            ? 'border-blue-500/45 bg-slate-900/85 hover:border-blue-400/80'
            : 'border-slate-800 bg-slate-900/55 hover:border-slate-600 hover:bg-slate-900/85'
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 shrink-0 rounded-full ${status.dotClass}`} />
              <span
                className={`truncate text-sm font-semibold ${
                  engine.enabled ? 'text-white' : 'text-slate-500 line-through'
                }`}
              >
                {engine.name}
              </span>
            </div>
            <div className="mt-0.5 truncate pl-4 text-xs text-slate-400">
              {getEngineSubtitle(engine)}
            </div>
          </div>

          {/* Inline toggle switch without opening modal */}
          <button
            type="button"
            role="switch"
            aria-checked={engine.enabled}
            title={engine.enabled ? '点击停用此引擎' : '点击启用此引擎'}
            onClick={(e) => {
              e.stopPropagation();
              updateEngine(engine.id, { enabled: !engine.enabled });
            }}
            className={`relative h-5 w-9 shrink-0 rounded-full transition ${
              engine.enabled ? 'bg-blue-600' : 'bg-slate-700'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                engine.enabled ? 'translate-x-4' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-1.5 border-t border-slate-800/90 pt-2.5 text-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`font-medium ${status.textClass}`}>{status.label}</span>
            {isPagePrimary && (
              <span className="rounded-md bg-blue-500/20 px-1.5 py-0.5 text-[11px] font-medium text-blue-300">
                网页主力
              </span>
            )}
            {isVideoPrimary && (
              <span className="rounded-md bg-cyan-500/20 px-1.5 py-0.5 text-[11px] font-medium text-cyan-300">
                视频主力
              </span>
            )}
          </div>
          <span className="inline-flex items-center gap-0.5 text-slate-500 transition group-hover:text-slate-200">
            配置
            <ChevronRight className="h-3.5 w-3.5" />
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {/* Compact Top Routing Bar */}
      <section className="grid items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/65 p-4 md:grid-cols-12">
        <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/80 px-3.5 py-2.5 md:col-span-5">
          <div className="min-w-0">
            <div className="text-[11px] text-slate-400">网页双语主力</div>
            <div className="truncate text-xs font-semibold text-white">
              {settings.engines.find((e) => e.id === settings.activePageEngineId)?.name ?? '未选择'}
            </div>
          </div>
          <select
            value={settings.activePageEngineId}
            onChange={(e) => onChange({ ...settings, activePageEngineId: e.target.value })}
            className="max-w-[160px] rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-blue-500"
          >
            {enabledEngines.map((e) => {
              const ready = getEngineStatus(e, testStates[e.id]).code === 'ready';
              return (
                <option key={e.id} value={e.id}>
                  {ready ? '● ' : '○ '}
                  {e.name}
                </option>
              );
            })}
          </select>
        </div>

        <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/80 px-3.5 py-2.5 md:col-span-5">
          <div className="min-w-0">
            <div className="text-[11px] text-slate-400">视频字幕主力 (YouTube / X)</div>
            <div className="truncate text-xs font-semibold text-white">
              {settings.engines.find((e) => e.id === settings.activeVideoEngineId)?.name ?? '未选择'}
            </div>
          </div>
          <select
            value={settings.activeVideoEngineId}
            onChange={(e) => onChange({ ...settings, activeVideoEngineId: e.target.value })}
            className="max-w-[160px] rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-cyan-500"
          >
            {enabledEngines.map((e) => {
              const ready = getEngineStatus(e, testStates[e.id]).code === 'ready';
              return (
                <option key={e.id} value={e.id}>
                  {ready ? '● ' : '○ '}
                  {e.name}
                </option>
              );
            })}
          </select>
        </div>

        <div className="flex justify-end md:col-span-2">
          <button
            onClick={() => setShowPresetModal(true)}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2.5 text-xs font-semibold text-white transition hover:bg-blue-500 md:w-auto"
          >
            <Plus className="h-3.5 w-3.5" />
            添加引擎
          </button>
        </div>
      </section>

      {/* Filter & Status Legend Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 rounded-xl border border-slate-800 bg-slate-900/70 p-1 text-xs">
          <button
            onClick={() => setFilter('all')}
            className={`rounded-lg px-3 py-1 font-medium transition ${
              filter === 'all' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            全部 ({settings.engines.length})
          </button>
          <button
            onClick={() => setFilter('ready')}
            className={`rounded-lg px-3 py-1 font-medium transition ${
              filter === 'ready' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            已配置可用 ({readyEngines.length})
          </button>
          <button
            onClick={() => setFilter('unconfigured')}
            className={`rounded-lg px-3 py-1 font-medium transition ${
              filter === 'unconfigured' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            未配置 / 停用 ({otherEngines.length})
          </button>
        </div>

        <div className="flex items-center gap-3 text-xs text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            已就绪
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-amber-400" />
            待填 Key
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-slate-500" />
            已停用
          </span>
        </div>
      </div>

      {/* Grouped Compact Status Cards */}
      {(filter === 'all' || filter === 'ready') && readyEngines.length > 0 && (
        <section className="space-y-2.5">
          <div className="text-xs font-semibold text-emerald-400/90">
            已配置可用 ({readyEngines.length})
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {readyEngines.map(renderCard)}
          </div>
        </section>
      )}

      {(filter === 'all' || filter === 'unconfigured') && otherEngines.length > 0 && (
        <section className="space-y-2.5">
          <div className="text-xs font-semibold text-slate-400">
            待配置 / 已停用 ({otherEngines.length})
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {otherEngines.map(renderCard)}
          </div>
        </section>
      )}

      {/* ==================== ENGINE CONFIG MODAL ==================== */}
      {editingEngine && (() => {
        const engine = editingEngine;
        const st = testStates[engine.id];
        const status = getEngineStatus(engine, st);
        const isFree =
          engine.kind === 'edge-free' ||
          engine.kind === 'google-free' ||
          engine.kind === 'chrome-builtin';
        const isOllama = engine.kind === 'ollama';
        const isDeepSeek = engine.kind === 'deepseek';
        const isPagePrimary = settings.activePageEngineId === engine.id;
        const isVideoPrimary = settings.activeVideoEngineId === engine.id;
        const suggestions = MODEL_SUGGESTIONS[engine.kind] ?? [];

        return (
          <div
            onClick={() => setEditingEngineId(null)}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-xs"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="max-h-[88vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-slate-700/80 bg-slate-900 p-5 shadow-2xl"
            >
              {/* Modal Header */}
              <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-4">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {engine.builtin ? (
                      <h3 className="text-base font-bold text-white">{engine.name}</h3>
                    ) : (
                      <input
                        value={engine.name}
                        onChange={(e) => updateEngine(engine.id, { name: e.target.value })}
                        className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1 text-sm font-bold text-white outline-none focus:border-blue-500"
                      />
                    )}
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-950 px-2.5 py-0.5 text-xs">
                      <span className={`h-2 w-2 rounded-full ${status.dotClass}`} />
                      <span className={status.textClass}>{status.label}</span>
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">
                    {isFree
                      ? engine.kind === 'chrome-builtin'
                        ? 'Chrome 138+ / Edge 148+ 端侧本地模型，100% 离线免费。'
                        : '免 Key 即用免费翻译服务，触发限流时自动按免费降级链切换。'
                      : isOllama
                        ? '本地隐私大模型：内置 declarativeNetRequest 自动解决 403 CORS 限制。'
                        : isDeepSeek
                          ? '已固定静态 System Prompt 前缀，长文与视频分批翻译自动命中 Context Caching 降本。'
                          : '密钥仅存储在本地 chrome.storage.local，直连所配接口不经任何中转。'}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {!engine.builtin && (
                    <button
                      onClick={() => removeCustomEngine(engine.id)}
                      className="rounded-lg border border-rose-900/70 bg-rose-950/30 p-1.5 text-rose-400 transition hover:bg-rose-900/40"
                      title="删除此自定义引擎"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    onClick={() => setEditingEngineId(null)}
                    className="rounded-lg border border-slate-700 bg-slate-950 p-1.5 text-slate-400 transition hover:text-white"
                    title="关闭弹窗 (Esc)"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Quick Actions Strip: Set Primary & Test Connection */}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/75 px-3.5 py-2.5">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <button
                    onClick={() => {
                      onChange({
                        ...settings,
                        engines: settings.engines.map((e) =>
                          e.id === engine.id ? { ...e, enabled: true } : e,
                        ),
                        activePageEngineId: engine.id,
                      });
                    }}
                    className={`rounded-lg border px-2.5 py-1 font-medium transition ${
                      isPagePrimary
                        ? 'border-blue-500 bg-blue-600 text-white'
                        : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-blue-500 hover:text-white'
                    }`}
                  >
                    {isPagePrimary ? '✓ 网页主力' : '设为网页主力'}
                  </button>
                  <button
                    onClick={() => {
                      onChange({
                        ...settings,
                        engines: settings.engines.map((e) =>
                          e.id === engine.id ? { ...e, enabled: true } : e,
                        ),
                        activeVideoEngineId: engine.id,
                      });
                    }}
                    className={`rounded-lg border px-2.5 py-1 font-medium transition ${
                      isVideoPrimary
                        ? 'border-cyan-500 bg-cyan-600 text-white'
                        : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-cyan-500 hover:text-white'
                    }`}
                  >
                    {isVideoPrimary ? '✓ 视频主力' : '设为视频主力'}
                  </button>
                </div>

                <button
                  onClick={() => void runTest(engine)}
                  disabled={st?.loading}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-100 transition hover:border-emerald-500 hover:text-white disabled:opacity-50"
                >
                  {st?.loading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                  )}
                  测试连接
                </button>
              </div>

              {/* Test Result Feedback */}
              {st && !st.loading && (
                <div
                  className={`mt-3 flex items-start gap-2 rounded-xl border px-3 py-2 text-xs ${
                    st.ok
                      ? 'border-emerald-800/70 bg-emerald-950/35 text-emerald-300'
                      : 'border-rose-800/70 bg-rose-950/35 text-rose-300'
                  }`}
                >
                  {st.ok ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  ) : (
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  )}
                  <div>
                    {st.ok ? (
                      <>
                        <span className="font-semibold">连接成功 ({st.latencyMs}ms)</span>
                        {st.sample && (
                          <span className="ml-2 text-emerald-200/90">示例译文：{st.sample}</span>
                        )}
                      </>
                    ) : (
                      <span>{st.error || '连接失败'}</span>
                    )}
                  </div>
                </div>
              )}

              {/* Primary Core Form Fields */}
              {!isFree && (
                <div className="mt-4 space-y-3.5">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-300">
                      接口地址 (Base URL)
                    </label>
                    <input
                      value={engine.baseUrl ?? ''}
                      onChange={(e) => updateEngine(engine.id, { baseUrl: e.target.value })}
                      placeholder={isOllama ? 'http://localhost:11434' : 'https://api.openai.com/v1'}
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 outline-none focus:border-blue-500"
                    />
                  </div>

                  {!isOllama && (
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-slate-300">
                        API Key{' '}
                        {engine.kind === 'openai-compatible' || engine.kind === 'deeplx'
                          ? '（本地模型可留空）'
                          : ''}
                      </label>
                      <input
                        type="password"
                        value={engine.apiKey ?? ''}
                        onChange={(e) => updateEngine(engine.id, { apiKey: e.target.value })}
                        placeholder="sk-..."
                        className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 outline-none focus:border-blue-500"
                      />
                    </div>
                  )}

                  {engine.kind !== 'deeplx' && (
                    <div>
                      <div className="mb-1.5 flex items-center justify-between">
                        <label className="text-xs font-medium text-slate-300">模型名称 (Model)</label>
                        {isOllama && (
                          <button
                            onClick={() =>
                              void fetchOllamaModels(engine.baseUrl || 'http://localhost:11434')
                            }
                            disabled={loadingOllamaModels}
                            className="inline-flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300"
                          >
                            <RefreshCw
                              className={`h-3 w-3 ${loadingOllamaModels ? 'animate-spin' : ''}`}
                            />
                            一键拉取本地模型列表
                          </button>
                        )}
                      </div>
                      <input
                        value={engine.model ?? ''}
                        onChange={(e) => updateEngine(engine.id, { model: e.target.value })}
                        placeholder={
                          isOllama
                            ? 'qwen2.5:7b / qwen3:8b / gemma3:12b'
                            : isDeepSeek
                              ? 'deepseek-chat'
                              : 'gpt-4o-mini'
                        }
                        className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 outline-none focus:border-blue-500"
                      />

                      {/* Quick model suggestion chips */}
                      {suggestions.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {suggestions.map((m) => (
                            <button
                              key={m}
                              onClick={() => updateEngine(engine.id, { model: m })}
                              className={`rounded-lg border px-2.5 py-1 text-xs transition ${
                                engine.model === m
                                  ? 'border-blue-500 bg-blue-500/20 text-blue-300'
                                  : 'border-slate-700 bg-slate-950 text-slate-400 hover:text-white'
                              }`}
                            >
                              {m}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Discovered Ollama local models */}
                      {isOllama && ollamaModels.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {ollamaModels.map((m) => (
                            <button
                              key={m.name}
                              onClick={() => updateEngine(engine.id, { model: m.name })}
                              className={`rounded-lg border px-2.5 py-1 text-xs transition ${
                                engine.model === m.name
                                  ? 'border-cyan-400 bg-cyan-500/20 text-cyan-200'
                                  : 'border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500'
                              }`}
                            >
                              {m.name}
                              {m.parameterSize ? ` (${m.parameterSize})` : ''}
                            </button>
                          ))}
                        </div>
                      )}
                      {isOllama && ollamaModelErr && (
                        <p className="mt-1.5 text-xs text-amber-400">{ollamaModelErr}</p>
                      )}
                    </div>
                  )}

                  {/* Collapsible Advanced Tuning Section */}
                  <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/60">
                    <button
                      type="button"
                      onClick={() => setShowAdvanced((prev) => !prev)}
                      className="flex w-full items-center justify-between px-3.5 py-2.5 text-xs font-medium text-slate-400 transition hover:text-slate-100"
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <SlidersHorizontal className="h-3.5 w-3.5" />
                        高级参数与网络调优（并发 {engine.concurrency ?? (isOllama ? 1 : 4)}
                        {engine.kind !== 'deeplx' ? ` · 温度 ${engine.temperature ?? 0.1}` : ''}
                        {isOllama ? ' · CORS 自动修复' : ''}）
                      </span>
                      {showAdvanced ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </button>

                    {(showAdvanced || st?.errorCode === 'CORS_OLLAMA') && (
                      <div className="space-y-3 border-t border-slate-800 p-3.5 text-xs">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="mb-1 block text-slate-400">最大并发数</label>
                            <input
                              type="number"
                              min={1}
                              max={12}
                              value={engine.concurrency ?? (isOllama ? 1 : 4)}
                              onChange={(e) =>
                                updateEngine(engine.id, {
                                  concurrency: Math.max(1, Number(e.target.value) || 1),
                                })
                              }
                              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-slate-100 outline-none"
                            />
                          </div>
                          {engine.kind !== 'deeplx' && (
                            <div>
                              <label className="mb-1 block text-slate-400">Temperature</label>
                              <input
                                type="number"
                                min={0}
                                max={1}
                                step={0.05}
                                value={engine.temperature ?? 0.1}
                                onChange={(e) =>
                                  updateEngine(engine.id, { temperature: Number(e.target.value) })
                                }
                                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-slate-100 outline-none"
                              />
                            </div>
                          )}
                        </div>

                        {isOllama && (
                          <div className="space-y-2.5 pt-1">
                            <label className="flex items-center gap-2 text-slate-200">
                              <input
                                type="checkbox"
                                checked={engine.ollamaAutoFixCors !== false}
                                onChange={(e) =>
                                  updateEngine(engine.id, { ollamaAutoFixCors: e.target.checked })
                                }
                                className="accent-cyan-500"
                              />
                              <ShieldCheck className="h-3.5 w-3.5 text-cyan-400" />
                              自动修复 Chrome 403 CORS (declarativeNetRequest 改写 Origin)
                            </label>
                            <label className="flex items-center gap-2 text-slate-200">
                              <input
                                type="checkbox"
                                checked={engine.ollamaDisableThinking !== false}
                                onChange={(e) =>
                                  updateEngine(engine.id, {
                                    ollamaDisableThinking: e.target.checked,
                                  })
                                }
                                className="accent-cyan-500"
                              />
                              关闭思考模式 &amp; 自动剥离 &lt;think&gt; 标签（显著提速）
                            </label>
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="mb-1 block text-slate-400">接口协议</label>
                                <select
                                  value={engine.ollamaApiMode ?? 'native'}
                                  onChange={(e) =>
                                    updateEngine(engine.id, {
                                      ollamaApiMode: e.target.value as 'native' | 'openai',
                                    })
                                  }
                                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-slate-200"
                                >
                                  <option value="native">原生 /api/chat（推荐）</option>
                                  <option value="openai">OpenAI 兼容 /v1</option>
                                </select>
                              </div>
                              <div>
                                <label className="mb-1 block text-slate-400">keep_alive</label>
                                <input
                                  value={engine.ollamaKeepAlive ?? '10m'}
                                  onChange={(e) =>
                                    updateEngine(engine.id, { ollamaKeepAlive: e.target.value })
                                  }
                                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-slate-200"
                                />
                              </div>
                            </div>

                            <div className="space-y-1.5 rounded-lg border border-slate-800 bg-slate-900/90 p-2.5 font-mono text-[11px] text-slate-300">
                              <div className="flex items-center gap-1 font-sans text-cyan-300">
                                <Terminal className="h-3 w-3" />
                                远程局域网 Ollama 或 403 CORS 兜底变量：
                              </div>
                              <div className="flex items-center justify-between gap-2">
                                <span className="truncate">
                                  Win: [Environment]::SetEnvironmentVariable(&quot;OLLAMA_ORIGINS&quot;, &quot;chrome-extension://*&quot;, &quot;User&quot;)
                                </span>
                                <button
                                  onClick={() =>
                                    copyCommand(
                                      'win',
                                      '[Environment]::SetEnvironmentVariable("OLLAMA_ORIGINS", "chrome-extension://*", "User")',
                                    )
                                  }
                                  className="shrink-0 text-cyan-400 hover:text-cyan-300"
                                >
                                  {copiedCmd === 'win' ? '已复制' : <Copy className="h-3.5 w-3.5" />}
                                </button>
                              </div>
                              <div className="flex items-center justify-between gap-2">
                                <span className="truncate">
                                  macOS: launchctl setenv OLLAMA_ORIGINS &quot;chrome-extension://*&quot;
                                </span>
                                <button
                                  onClick={() =>
                                    copyCommand(
                                      'mac',
                                      'launchctl setenv OLLAMA_ORIGINS "chrome-extension://*"',
                                    )
                                  }
                                  className="shrink-0 text-cyan-400 hover:text-cyan-300"
                                >
                                  {copiedCmd === 'mac' ? '已复制' : <Copy className="h-3.5 w-3.5" />}
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Modal Footer */}
              <div className="mt-5 flex items-center justify-between border-t border-slate-800 pt-3.5">
                <label className="inline-flex items-center gap-2 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={engine.enabled}
                    onChange={(e) => updateEngine(engine.id, { enabled: e.target.checked })}
                    className="accent-blue-500"
                  />
                  在快捷下拉菜单中启用此引擎
                </label>
                <button
                  onClick={() => setEditingEngineId(null)}
                  className="rounded-xl bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-500"
                >
                  完成
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ==================== ADD CUSTOM ENGINE PRESET MODAL ==================== */}
      {showPresetModal && (
        <div
          onClick={() => setShowPresetModal(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-xs"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg space-y-4 rounded-2xl border border-slate-700/80 bg-slate-900 p-5 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-1.5 text-sm font-bold text-white">
                  <Sparkles className="h-4 w-4 text-cyan-400" />
                  添加自定义翻译引擎
                </div>
                <p className="mt-0.5 text-xs text-slate-400">
                  选择常用 OpenAI 兼容预设或新建空白接口，创建后自动弹出配置窗
                </p>
              </div>
              <button
                onClick={() => setShowPresetModal(false)}
                className="rounded-lg border border-slate-700 bg-slate-950 p-1.5 text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {CUSTOM_ENGINE_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => addCustomEngine(preset)}
                  className="rounded-xl border border-slate-800 bg-slate-950/80 p-3 text-left transition hover:border-blue-500/70 hover:bg-slate-950"
                >
                  <div className="text-xs font-semibold text-white">{preset.label}</div>
                  <div className="mt-0.5 text-[11px] text-slate-400">{preset.note}</div>
                  {preset.defaultModel && (
                    <div className="mt-1 truncate font-mono text-[10px] text-cyan-400/80">
                      {preset.defaultModel}
                    </div>
                  )}
                </button>
              ))}
              <button
                onClick={() => addCustomEngine()}
                className="flex flex-col justify-center rounded-xl border border-dashed border-slate-700 bg-slate-950/40 p-3 text-left transition hover:border-blue-500 hover:bg-slate-950"
              >
                <div className="text-xs font-semibold text-blue-300">+ 空白 OpenAI 兼容接口</div>
                <div className="mt-0.5 text-[11px] text-slate-400">
                  自由填入任意中转站、One-API 或自建服务地址
                </div>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
