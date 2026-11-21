import React, { useState } from 'react';
import { BookMarked, Code2, Globe, Plus, RotateCcw, Trash2 } from 'lucide-react';
import {
  DEFAULT_RESEGMENT_SYSTEM_PROMPT,
  DEFAULT_SUBTITLE_SYSTEM_PROMPT,
  DEFAULT_WEBPAGE_SYSTEM_PROMPT,
} from '@/src/core/config/defaults';
import type { ExtensionSettings, SiteRule } from '@/src/core/config/types';
import { BUILTIN_SITE_RULES } from '@/src/core/rules/builtin-rules';

interface Props {
  settings: ExtensionSettings;
  onChange: (next: ExtensionSettings) => void;
}

const SAMPLE_RULE_TEMPLATE: SiteRule = {
  id: 'my-custom-site',
  name: '自定义示例站点',
  matches: ['example.com', '*.example.org'],
  selectors: ['article p', 'article h1', 'article li'],
  excludeSelectors: ['pre', 'code', '.ad-banner'],
  stayOriginalSelectors: ['code', '.math-formula'],
  detectLanguagePerBlock: true,
};

export function RulesGlossaryTab({ settings, onChange }: Props) {
  const [rulesJson, setRulesJson] = useState(() => JSON.stringify(settings.userRules, null, 2));
  const [jsonErr, setJsonErr] = useState('');
  const [newSource, setNewSource] = useState('');
  const [newTarget, setNewTarget] = useState('');
  const [newKeepOrig, setNewKeepOrig] = useState(false);

  const toggleBuiltinRule = (id: string) => {
    const disabled = settings.disabledBuiltinRuleIds.includes(id);
    onChange({
      ...settings,
      disabledBuiltinRuleIds: disabled
        ? settings.disabledBuiltinRuleIds.filter((x) => x !== id)
        : [...settings.disabledBuiltinRuleIds, id],
    });
  };

  const applyUserRulesJson = () => {
    try {
      const parsed = JSON.parse(rulesJson) as unknown;
      if (!Array.isArray(parsed)) {
        setJsonErr('自定义规则必须是 JSON 数组 [...]');
        return;
      }
      for (const item of parsed) {
        if (!item || typeof item !== 'object' || !Array.isArray((item as SiteRule).matches)) {
          setJsonErr('每条规则必须包含 matches 字符串数组');
          return;
        }
      }
      setJsonErr('');
      onChange({ ...settings, userRules: parsed as SiteRule[] });
    } catch (err) {
      setJsonErr(`JSON 语法错误: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const insertSampleRule = () => {
    const next = [...settings.userRules, { ...SAMPLE_RULE_TEMPLATE, id: `custom_${Date.now()}` }];
    setRulesJson(JSON.stringify(next, null, 2));
    setJsonErr('');
    onChange({ ...settings, userRules: next });
  };

  const addGlossary = () => {
    if (!newSource.trim()) return;
    onChange({
      ...settings,
      glossary: [
        ...settings.glossary,
        {
          id: `g_${Date.now()}`,
          source: newSource.trim(),
          target: newKeepOrig ? '' : newTarget.trim(),
          keepOriginal: newKeepOrig,
          enabled: true,
        },
      ],
    });
    setNewSource('');
    setNewTarget('');
    setNewKeepOrig(false);
  };

  const removeGlossary = (id: string) => {
    onChange({
      ...settings,
      glossary: settings.glossary.filter((g) => g.id !== id),
    });
  };

  return (
    <div className="space-y-6">
      {/* Built-in Mainstream Site Rules */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-blue-400" />
          <h2 className="text-base font-semibold text-white">内置 12 套主流站点精细适配规则</h2>
        </div>
        <p className="mt-1 text-xs text-slate-400">
          针对主流技术、社交、学术与新闻网站定制选区、Shadow DOM 穿透、代码/数学公式保护与防截断样式。
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {BUILTIN_SITE_RULES.map((rule) => {
            const enabled = !settings.disabledBuiltinRuleIds.includes(rule.id);
            return (
              <div
                key={rule.id}
                className="flex items-start justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3"
              >
                <div>
                  <div className="text-xs font-semibold text-white">{rule.name}</div>
                  <div className="mt-0.5 text-[11px] text-slate-400">{rule.description}</div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {rule.matches.slice(0, 4).map((m) => (
                      <span
                        key={m}
                        className="rounded bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] text-cyan-300"
                      >
                        {m}
                      </span>
                    ))}
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={() => toggleBuiltinRule(rule.id)}
                  className="mt-0.5 accent-blue-500"
                />
              </div>
            );
          })}
        </div>
      </section>

      {/* Custom JSON Rules */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Code2 className="h-4 w-4 text-cyan-400" />
            <h2 className="text-base font-semibold text-white">自定义站点规则 (JSON，优先级高于内置规则)</h2>
          </div>
          <div className="flex gap-2">
            <button
              onClick={insertSampleRule}
              className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs text-slate-300 hover:text-white"
            >
              + 插入规则模板
            </button>
            <button
              onClick={applyUserRulesJson}
              className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-500"
            >
              校验并应用规则
            </button>
          </div>
        </div>
        <textarea
          rows={7}
          value={rulesJson}
          onChange={(e) => setRulesJson(e.target.value)}
          className="mt-3 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-slate-200 outline-none focus:border-blue-500"
        />
        {jsonErr && <p className="mt-1.5 text-xs text-rose-400">{jsonErr}</p>}

        {/* Auto / Never Domain Lists */}
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-300">
              自动翻译域名（每行一个，支持通配符如 `*.substack.com`）
            </label>
            <textarea
              rows={3}
              value={settings.autoTranslateDomains.join('\n')}
              onChange={(e) =>
                onChange({
                  ...settings,
                  autoTranslateDomains: e.target.value
                    .split('\n')
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
              className="w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 font-mono text-xs text-slate-200 outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-300">
              永不自动翻译域名（每行一个）
            </label>
            <textarea
              rows={3}
              value={settings.neverTranslateDomains.join('\n')}
              onChange={(e) =>
                onChange({
                  ...settings,
                  neverTranslateDomains: e.target.value
                    .split('\n')
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
              className="w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 font-mono text-xs text-slate-200 outline-none"
            />
          </div>
        </div>
      </section>

      {/* Glossary */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <div className="flex items-center gap-2">
          <BookMarked className="h-4 w-4 text-emerald-400" />
          <h2 className="text-base font-semibold text-white">领域术语表（自动注入 LLM System Prompt）</h2>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            value={newSource}
            onChange={(e) => setNewSource(e.target.value)}
            placeholder="源术语（如 Agent / Token）"
            className="flex-1 min-w-[140px] rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white outline-none"
          />
          <input
            value={newTarget}
            disabled={newKeepOrig}
            onChange={(e) => setNewTarget(e.target.value)}
            placeholder="目标译文（如 智能体）"
            className="flex-1 min-w-[140px] rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white outline-none disabled:opacity-40"
          />
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={newKeepOrig}
              onChange={(e) => setNewKeepOrig(e.target.checked)}
              className="accent-emerald-500"
            />
            保持原文不译
          </label>
          <button
            onClick={addGlossary}
            className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
          >
            <Plus className="h-3.5 w-3.5" />
            添加
          </button>
        </div>

        {settings.glossary.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {settings.glossary.map((g) => (
              <div
                key={g.id}
                className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 text-xs"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-cyan-300">{g.source}</span>
                  <span className="text-slate-500">→</span>
                  <span className="text-slate-100">
                    {g.keepOriginal ? '（保持原文）' : g.target}
                  </span>
                </div>
                <button
                  onClick={() => removeGlossary(g.id)}
                  className="text-slate-500 hover:text-rose-400"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Custom LLM System Prompts */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">LLM System Prompt 模板定制</h2>
          <button
            onClick={() =>
              onChange({
                ...settings,
                prompts: {
                  webpageSystemPrompt: DEFAULT_WEBPAGE_SYSTEM_PROMPT,
                  subtitleSystemPrompt: DEFAULT_SUBTITLE_SYSTEM_PROMPT,
                  resegmentSystemPrompt: DEFAULT_RESEGMENT_SYSTEM_PROMPT,
                },
              })
            }
            className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-white"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            恢复默认 Prompt
          </button>
        </div>

        <div className="mt-3 space-y-3">
          <div>
            <label className="mb-1 block text-xs text-slate-400">网页双语翻译 System Prompt</label>
            <textarea
              rows={5}
              value={settings.prompts.webpageSystemPrompt}
              onChange={(e) =>
                onChange({
                  ...settings,
                  prompts: { ...settings.prompts, webpageSystemPrompt: e.target.value },
                })
              }
              className="w-full rounded-xl border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-slate-200 outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">视频字幕翻译 System Prompt</label>
            <textarea
              rows={5}
              value={settings.prompts.subtitleSystemPrompt}
              onChange={(e) =>
                onChange({
                  ...settings,
                  prompts: { ...settings.prompts, subtitleSystemPrompt: e.target.value },
                })
              }
              className="w-full rounded-xl border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-slate-200 outline-none"
            />
          </div>
        </div>
      </section>
    </div>
  );
}
