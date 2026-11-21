import type { ExtensionSettings } from '../config/types';

const DNR_RULE_ID_BASE = 8100;
const MAX_DNR_RULES = 20;

function extractOriginRuleFilter(rawUrl?: string): { filter: string; originValue: string } | null {
  if (!rawUrl) return null;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    // Only apply automatic Origin rewrite to local / LAN endpoints (Ollama, LM Studio, Faster-Whisper)
    const host = parsed.hostname.toLowerCase();
    const isLocal =
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '[::1]' ||
      host.startsWith('192.168.') ||
      host.startsWith('10.') ||
      host.endsWith('.local');
    if (!isLocal) return null;
    const origin = `${parsed.protocol}//${parsed.host}`;
    return {
      filter: `${origin}/*`,
      originValue: origin,
    };
  } catch {
    return null;
  }
}

/**
 * Automatically fixes HTTP 403 CORS rejections from local Ollama / Faster-Whisper servers
 * by rewriting the `Origin` header via MV3 declarativeNetRequest dynamic rules.
 */
export async function syncLocalCorsDnrRules(settings: ExtensionSettings): Promise<number> {
  if (typeof chrome === 'undefined' || !chrome.declarativeNetRequest?.updateDynamicRules) {
    return 0;
  }

  const targets = new Map<string, string>();

  for (const engine of settings.engines) {
    if (!engine.enabled) continue;
    if (engine.kind === 'ollama' && engine.ollamaAutoFixCors !== false) {
      const target = extractOriginRuleFilter(engine.baseUrl ?? 'http://localhost:11434');
      if (target) targets.set(target.filter, target.originValue);
    } else if (engine.kind === 'openai-compatible' || engine.kind === 'deeplx') {
      const target = extractOriginRuleFilter(engine.baseUrl);
      if (target) targets.set(target.filter, target.originValue);
    }
  }

  if (settings.video.asrEnabled && settings.video.asrAutoFixLocalCors) {
    const asrTarget = extractOriginRuleFilter(settings.video.asrBaseUrl);
    if (asrTarget) targets.set(asrTarget.filter, asrTarget.originValue);
  }

  const removeRuleIds: number[] = [];
  for (let i = 0; i < MAX_DNR_RULES; i++) {
    removeRuleIds.push(DNR_RULE_ID_BASE + i);
  }

  const addRules: chrome.declarativeNetRequest.Rule[] = [];
  let idx = 0;
  for (const [filter, originValue] of targets.entries()) {
    if (idx >= MAX_DNR_RULES) break;
    addRules.push({
      id: DNR_RULE_ID_BASE + idx,
      priority: 1,
      action: {
        type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
        requestHeaders: [
          {
            header: 'Origin',
            operation: chrome.declarativeNetRequest.HeaderOperation.SET,
            value: originValue,
          },
        ],
      },
      condition: {
        urlFilter: filter,
        resourceTypes: [
          chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST,
          chrome.declarativeNetRequest.ResourceType.OTHER,
        ],
      },
    });
    idx++;
  }

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds,
    addRules,
  });

  return addRules.length;
}
