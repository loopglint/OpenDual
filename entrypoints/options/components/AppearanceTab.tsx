import React from 'react';
import { Palette } from 'lucide-react';
import type { BilingualTheme, ExtensionSettings, HoverTriggerKey } from '@/src/core/config/types';

interface Props {
  settings: ExtensionSettings;
  onChange: (next: ExtensionSettings) => void;
}

const THEMES: Array<{ id: BilingualTheme; name: string; desc: string; previewClass: string }> = [
  { id: 'default', name: '经典自然对照', desc: '贴合原站字体与配色，极少视觉干扰', previewClass: 'opacity-90' },
  {
    id: 'blockquote',
    name: '左侧竖线引用',
    desc: '经典沉浸阅读风，清晰区分原文与译文',
    previewClass: 'border-l-[3px] border-blue-500 pl-2.5',
  },
  {
    id: 'dashed',
    name: '虚线下划线',
    desc: '优雅轻量，适合长文与技术文档',
    previewClass: 'border-b border-dashed border-indigo-400 pb-0.5 inline-block',
  },
  {
    id: 'underline',
    name: '实线下划线',
    desc: '蓝调下划线标识译文区域',
    previewClass: 'underline decoration-blue-400/70 underline-offset-4',
  },
  {
    id: 'highlight',
    name: '柔和渐变高亮',
    desc: '浅色荧光背景块，适合快速扫读',
    previewClass: 'rounded bg-gradient-to-r from-blue-500/20 to-emerald-500/20 px-2 py-1',
  },
  {
    id: 'blur-learning',
    name: '外语学习模糊模式',
    desc: '译文默认模糊，鼠标悬停后清晰呈现',
    previewClass: 'blur-[4px] hover:blur-none transition cursor-pointer',
  },
  {
    id: 'weakened-original',
    name: '弱化原文突出译文',
    desc: '降低原文对比度，让中文译文成为视觉焦点',
    previewClass: 'text-white font-medium',
  },
];

export function AppearanceTab({ settings, onChange }: Props) {
  const a = settings.appearance;

  const patch = (next: Partial<ExtensionSettings['appearance']>) => {
    onChange({
      ...settings,
      appearance: { ...settings.appearance, ...next },
    });
  };

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <div className="flex items-center gap-2">
          <Palette className="h-4 w-4 text-blue-400" />
          <h2 className="text-base font-semibold text-white">网页双语译文样式主题</h2>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {THEMES.map((t) => {
            const selected = a.theme === t.id;
            return (
              <button
                key={t.id}
                onClick={() => patch({ theme: t.id })}
                className={`rounded-xl border p-3.5 text-left transition ${
                  selected
                    ? 'border-blue-500 bg-blue-950/30 ring-1 ring-blue-500/40'
                    : 'border-slate-800 bg-slate-950/60 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-white">{t.name}</span>
                  {selected && (
                    <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[10px] text-white">使用中</span>
                  )}
                </div>
                <p className="mt-0.5 text-[11px] text-slate-400">{t.desc}</p>
                <div className="mt-2.5 rounded-lg bg-slate-900/90 p-2.5 text-xs">
                  <div className={t.id === 'weakened-original' ? 'text-slate-500' : 'text-slate-300'}>
                    Bilingual reading preserves original layout cleanly.
                  </div>
                  <div className={`mt-1 text-slate-100 ${t.previewClass}`}>
                    双语对照阅读能够优雅地保留原始网页排版。
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <h2 className="text-base font-semibold text-white">交互与悬浮球设置</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-xs">
            <span>在网页右侧边缘显示悬浮翻译球</span>
            <input
              type="checkbox"
              checked={a.showFloatingBall}
              onChange={(e) => patch({ showFloatingBall: e.target.checked })}
              className="accent-blue-500"
            />
          </label>

          <label className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-xs">
            <span>翻译加载时显示旋转进度指示器</span>
            <input
              type="checkbox"
              checked={a.showLoadingSpinner}
              onChange={(e) => patch({ showLoadingSpinner: e.target.checked })}
              className="accent-blue-500"
            />
          </label>

          <div>
            <label className="mb-1 block text-xs text-slate-400">悬停单段快捷翻译修饰键</label>
            <select
              value={a.hoverTriggerKey}
              onChange={(e) => patch({ hoverTriggerKey: e.target.value as HoverTriggerKey })}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white"
            >
              <option value="Alt">按住 Alt + 鼠标悬停段落</option>
              <option value="Control">按住 Ctrl + 鼠标悬停段落</option>
              <option value="Shift">按住 Shift + 鼠标悬停段落</option>
              <option value="none">关闭悬停单段翻译</option>
            </select>
          </div>
        </div>

        <div className="mt-4">
          <label className="mb-1.5 block text-xs font-medium text-slate-300">
            自定义译文 CSS（作用于 `x-trans-wrap[data-xt-wrapper=&quot;1&quot;]`）
          </label>
          <textarea
            rows={4}
            value={a.customCss}
            onChange={(e) => patch({ customCss: e.target.value })}
            placeholder={`/* 例如修改译文字号与颜色 */\nx-trans-wrap[data-xt-wrapper="1"] {\n  font-size: 0.94em;\n  color: #38bdf8;\n}`}
            className="w-full rounded-xl border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-slate-200 outline-none focus:border-blue-500"
          />
        </div>
      </section>
    </div>
  );
}
