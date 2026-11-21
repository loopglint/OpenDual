import { LANG_NAME_MAP, type TranslateBatchRequest } from './types';
import type { GlossaryEntry } from '../config/types';

export function buildGlossarySection(glossary: GlossaryEntry[]): string {
  const active = glossary.filter((g) => g.enabled && g.source.trim().length > 0);
  if (active.length === 0) return '';
  const lines = active.map((g) => {
    if (g.keepOriginal || !g.target.trim()) {
      return `- "${g.source.trim()}" -> KEEP ORIGINAL ("${g.source.trim()}")`;
    }
    return `- "${g.source.trim()}" -> "${g.target.trim()}"`;
  });
  return `\n\nMandatory Glossary (follow strictly):\n${lines.join('\n')}`;
}

/**
 * Builds a strictly static System Prompt prefix to maximize provider-side Context Caching
 * (DeepSeek Context Caching / OpenAI Prompt Caching / Anthropic Ephemeral Cache).
 */
export function buildSystemPrompt(req: TranslateBatchRequest): string {
  const template =
    req.scope === 'subtitle' ? req.prompts.subtitleSystemPrompt : req.prompts.webpageSystemPrompt;
  const targetLangLabel = LANG_NAME_MAP[req.targetLang] ?? req.targetLang;
  const glossaryBlock = buildGlossarySection(req.glossary);

  return template
    .replaceAll('{{targetLang}}', targetLangLabel)
    .replaceAll('{{glossaryBlock}}', glossaryBlock);
}

export function buildUserPayload(req: TranslateBatchRequest): string {
  const payload: Record<string, unknown> = {
    items: req.items.map((item) => ({ i: item.i, t: item.text })),
  };

  if (req.scope === 'subtitle') {
    if (req.videoMeta?.title || req.videoMeta?.author) {
      payload.video_meta = {
        title: req.videoMeta.title ?? '',
        author: req.videoMeta.author ?? '',
        description: (req.videoMeta.description ?? '').slice(0, 220),
      };
    }
    if (req.prevContext && req.prevContext.length > 0) {
      payload.prev_context_readonly = req.prevContext.slice(-3).map((c) => ({
        source: c.source,
        ...(c.target ? { target: c.target } : {}),
      }));
    }
  } else if (req.pageTitle) {
    payload.page_title = req.pageTitle.slice(0, 140);
  }

  return JSON.stringify(payload);
}
