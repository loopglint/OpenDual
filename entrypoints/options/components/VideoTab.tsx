import React, { useState } from 'react';
import { CheckCircle2, Loader2, Mic, Subtitles, XCircle } from 'lucide-react';
import { ASR_PRESETS } from '@/src/core/config/defaults';
import type { AsrProviderKind, ExtensionSettings, SubtitleBilingualOrder } from '@/src/core/config/types';
import { ensureHostPermissionForUrl } from '@/src/core/network/permissions';

interface Props {
  settings: ExtensionSettings;
  onChange: (next: ExtensionSettings) => void;
}

export function VideoTab({ settings, onChange }: Props) {
  const v = settings.video;
  const [asrTest, setAsrTest] = useState<{ loading: boolean; ok?: boolean; latencyMs?: number; error?: string } | null>(
    null,
  );

  const patchVideo = (patch: Partial<ExtensionSettings['video']>) => {
    onChange({
      ...settings,
      video: { ...settings.video, ...patch },
    });
  };

  const selectAsrPreset = (provider: AsrProviderKind) => {
    const preset = ASR_PRESETS[provider];
    patchVideo({
      asrProvider: provider,
      asrBaseUrl: preset.baseUrl,
      asrModel: preset.model,
    });
  };

  const runAsrTest = async () => {
    setAsrTest({ loading: true });
    try {
      await ensureHostPermissionForUrl(v.asrBaseUrl);
      const res = (await chrome.runtime.sendMessage({
        type: 'TEST_ASR',
        baseUrl: v.asrBaseUrl,
        apiKey: v.asrApiKey,
        model: v.asrModel,
      })) as { ok: boolean; latencyMs?: number; error?: string };
      setAsrTest({ loading: false, ok: res.ok, latencyMs: res.latencyMs, error: res.error });
    } catch (err) {
      setAsrTest({ loading: false, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <div className="space-y-6">
      {/* Platform & Smart Segmentation */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <div className="flex items-center gap-2">
          <Subtitles className="h-4 w-4 text-cyan-400" />
          <h2 className="text-base font-semibold text-white">YouTube & X 视频双语字幕引擎</h2>
        </div>
        <p className="mt-1 text-xs text-slate-400">
          YouTube 采用 MAIN world 旁路镜像原生 `timedtext` 请求（天然继承 PoToken 零空响应）；X 采用 GraphQL + HLS `.m3u8`/`.vtt` 精准绑定，无字幕生肉视频自动提供一键 AI 字幕。
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="flex items-start gap-2.5 rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-xs">
            <input
              type="checkbox"
              checked={v.enabledYoutube}
              onChange={(e) => patchVideo({ enabledYoutube: e.target.checked })}
              className="mt-0.5 accent-blue-500"
            />
            <div>
              <div className="font-semibold text-slate-100">启用 YouTube 双语字幕</div>
              <div className="text-slate-400">支持普通页、剧场模式、全屏与 Shorts</div>
            </div>
          </label>

          <label className="flex items-start gap-2.5 rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-xs">
            <input
              type="checkbox"
              checked={v.enabledX}
              onChange={(e) => patchVideo({ enabledX: e.target.checked })}
              className="mt-0.5 accent-blue-500"
            />
            <div>
              <div className="font-semibold text-slate-100">启用 X (Twitter) 视频双语字幕</div>
              <div className="text-slate-400">自动捕获 HLS/VTT 字幕轨并按推文精确绑定</div>
            </div>
          </label>

          <label className="flex items-start gap-2.5 rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-xs">
            <input
              type="checkbox"
              checked={v.smartSegmentation}
              onChange={(e) => patchVideo({ smartSegmentation: e.target.checked })}
              className="mt-0.5 accent-cyan-500"
            />
            <div>
              <div className="font-semibold text-slate-100">智能断句与时间轴重组（强烈推荐）</div>
              <div className="text-slate-400">合并碎片化 ASR 滚动字幕为完整意群，按停顿/语速控制展示时长</div>
            </div>
          </label>

          <label className="flex items-start gap-2.5 rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-xs">
            <input
              type="checkbox"
              checked={v.llmSemanticResegment}
              onChange={(e) => patchVideo({ llmSemanticResegment: e.target.checked })}
              className="mt-0.5 accent-cyan-500"
            />
            <div>
              <div className="font-semibold text-slate-100">LLM 语义重断句增强（需 LLM 引擎）</div>
              <div className="text-slate-400">针对完全无标点的自动字幕先由大模型恢复标点断句再回映词级时间戳</div>
            </div>
          </label>

          <label className="flex items-start gap-2.5 rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-xs">
            <input
              type="checkbox"
              checked={v.autoEnableOnPlay}
              onChange={(e) => patchVideo({ autoEnableOnPlay: e.target.checked })}
              className="mt-0.5 accent-blue-500"
            />
            <div>
              <div className="font-semibold text-slate-100">打开视频自动挂载双语字幕</div>
              <div className="text-slate-400">关闭后需点击播放器栏「双语」按钮手动触发</div>
            </div>
          </label>

          <label className="flex items-start gap-2.5 rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-xs">
            <input
              type="checkbox"
              checked={v.hoverPause}
              onChange={(e) => patchVideo({ hoverPause: e.target.checked })}
              className="mt-0.5 accent-blue-500"
            />
            <div>
              <div className="font-semibold text-slate-100">鼠标悬停字幕自动暂停</div>
              <div className="text-slate-400">方便精读长难句或复制生词，移开自动续播</div>
            </div>
          </label>
        </div>
      </section>

      {/* Live Visual Style Preview */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <h2 className="text-base font-semibold text-white">双语字幕视觉样式（实时预览）</h2>

        {/* Preview Stage */}
        <div className="relative mt-4 flex h-44 flex-col justify-end overflow-hidden rounded-xl border border-slate-800 bg-gradient-to-br from-slate-800 via-slate-900 to-indigo-950 p-4">
          <div className="absolute left-3 top-3 rounded bg-black/40 px-2 py-0.5 text-[10px] text-slate-300">
            16:9 播放器预览画面（字幕在播放时支持上下拖拽微调）
          </div>
          <div
            className="mx-auto flex max-w-[90%] flex-col items-center gap-1 rounded-lg px-4 py-2 text-center shadow-xl"
            style={{
              backgroundColor: `rgba(10, 14, 23, ${v.bgOpacity})`,
              marginBottom: `${Math.min(35, v.verticalOffsetPercent) * 0.6}px`,
            }}
          >
            {v.bilingualOrder === 'source-top' && (
              <div style={{ fontSize: `${Math.round(v.fontSize * v.sourceFontScale)}px`, color: v.sourceColor }}>
                Attention is all you need to build scalable language models.
              </div>
            )}
            <div
              className="font-semibold"
              style={{ fontSize: `${v.fontSize}px`, color: v.targetColor }}
            >
              构建可扩展大语言模型，你所需要的正是注意力机制。
            </div>
            {v.bilingualOrder === 'target-top' && (
              <div style={{ fontSize: `${Math.round(v.fontSize * v.sourceFontScale)}px`, color: v.sourceColor }}>
                Attention is all you need to build scalable language models.
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs text-slate-400">双语排布顺序</label>
            <select
              value={v.bilingualOrder}
              onChange={(e) => patchVideo({ bilingualOrder: e.target.value as SubtitleBilingualOrder })}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
            >
              <option value="target-top">上译下原（中文在上，推荐）</option>
              <option value="source-top">上原下译（外文在上）</option>
              <option value="target-only">仅显示译文</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-400">译文字号 ({v.fontSize}px)</label>
            <input
              type="range"
              min={14}
              max={34}
              value={v.fontSize}
              onChange={(e) => patchVideo({ fontSize: Number(e.target.value) })}
              className="w-full accent-blue-500"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-400">
              背景遮罩透明度 ({Math.round(v.bgOpacity * 100)}%)
            </label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={v.bgOpacity}
              onChange={(e) => patchVideo({ bgOpacity: Number(e.target.value) })}
              className="w-full accent-blue-500"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-400">译文颜色</label>
            <input
              type="color"
              value={v.targetColor}
              onChange={(e) => patchVideo({ targetColor: e.target.value })}
              className="h-8 w-full cursor-pointer rounded-lg border border-slate-700 bg-slate-950 p-1"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-400">原文颜色</label>
            <input
              type="color"
              value={v.sourceColor}
              onChange={(e) => patchVideo({ sourceColor: e.target.value })}
              className="h-8 w-full cursor-pointer rounded-lg border border-slate-700 bg-slate-950 p-1"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-400">
              默认底部距离 ({v.verticalOffsetPercent}%)
            </label>
            <input
              type="range"
              min={3}
              max={35}
              value={v.verticalOffsetPercent}
              onChange={(e) => patchVideo({ verticalOffsetPercent: Number(e.target.value) })}
              className="w-full accent-blue-500"
            />
          </div>
        </div>
      </section>

      {/* ASR for Captionless ("生肉") X/YouTube Videos */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Mic className="h-4 w-4 text-emerald-400" />
            <h2 className="text-base font-semibold text-white">无字幕“生肉”视频 AI 语音识别 (ASR)</h2>
          </div>
          <label className="inline-flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={v.asrEnabled}
              onChange={(e) => patchVideo({ asrEnabled: e.target.checked })}
              className="accent-emerald-500"
            />
            在 X 无字幕视频上显示「一键 AI 字幕」
          </label>
        </div>
        <p className="mt-1 text-xs text-slate-400">
          当 X 视频没有任何原生 `.vtt` 字幕时，插件可自动直取音频流并交由用户配置的 Whisper 接口（Groq / OpenAI / 本地 Faster-Whisper）转写，再接入双语智能断句管线并永久缓存。
        </p>

        <div className="mt-4 grid gap-2.5 sm:grid-cols-3">
          {(Object.keys(ASR_PRESETS) as AsrProviderKind[]).map((key) => {
            const preset = ASR_PRESETS[key];
            const selected = v.asrProvider === key;
            return (
              <button
                key={key}
                onClick={() => selectAsrPreset(key)}
                className={`rounded-xl border p-3 text-left transition ${
                  selected
                    ? 'border-emerald-500 bg-emerald-950/30 text-white'
                    : 'border-slate-800 bg-slate-950/60 text-slate-300 hover:border-slate-700'
                }`}
              >
                <div className="text-xs font-semibold">{preset.name}</div>
                <div className="mt-1 text-[11px] text-slate-400">{preset.note}</div>
              </button>
            );
          })}
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs text-slate-400">ASR 接口地址 (OpenAI Audio Transcriptions 兼容)</label>
            <input
              value={v.asrBaseUrl}
              onChange={(e) => patchVideo({ asrBaseUrl: e.target.value })}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 outline-none focus:border-emerald-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">ASR API Key（本地 Faster-Whisper 可留空）</label>
            <input
              type="password"
              value={v.asrApiKey}
              onChange={(e) => patchVideo({ asrApiKey: e.target.value })}
              placeholder="gsk_... 或 sk-..."
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 outline-none focus:border-emerald-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">模型名 (Model)</label>
            <input
              value={v.asrModel}
              onChange={(e) => patchVideo({ asrModel: e.target.value })}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 outline-none focus:border-emerald-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">源视频语言提示（留空为自动检测，如 en / ja）</label>
            <input
              value={v.asrLanguage}
              onChange={(e) => patchVideo({ asrLanguage: e.target.value })}
              placeholder="自动检测"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 outline-none focus:border-emerald-500"
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <label className="inline-flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={v.asrAutoFixLocalCors}
              onChange={(e) => patchVideo({ asrAutoFixLocalCors: e.target.checked })}
              className="accent-emerald-500"
            />
            自动修复本地 Faster-Whisper CORS 跨域限制
          </label>
          <button
            onClick={() => void runAsrTest()}
            disabled={asrTest?.loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-700/70 bg-emerald-950/40 px-3 py-1.5 text-xs font-medium text-emerald-300 transition hover:bg-emerald-900/50"
          >
            {asrTest?.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            测试 ASR 接口连通性
          </button>
        </div>

        {asrTest && !asrTest.loading && (
          <div
            className={`mt-3 flex items-center gap-2 rounded-xl border px-3 py-2 text-xs ${
              asrTest.ok
                ? 'border-emerald-800 bg-emerald-950/30 text-emerald-300'
                : 'border-rose-800 bg-rose-950/30 text-rose-300'
            }`}
          >
            {asrTest.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
            <span>{asrTest.ok ? `ASR 接口可用 (${asrTest.latencyMs}ms)` : asrTest.error}</span>
          </div>
        )}
      </section>
    </div>
  );
}
