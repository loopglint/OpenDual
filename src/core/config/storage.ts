import { DEFAULT_SETTINGS, BUILTIN_ENGINES } from './defaults';
import type { EngineProfile, ExtensionSettings } from './types';

const STORAGE_KEY = 'luminous_translator_settings_v1';

function mergeEngines(stored?: EngineProfile[]): EngineProfile[] {
  if (!stored || stored.length === 0) return BUILTIN_ENGINES.map((e) => ({ ...e }));
  const map = new Map<string, EngineProfile>();
  for (const builtin of BUILTIN_ENGINES) {
    map.set(builtin.id, { ...builtin });
  }
  for (const item of stored) {
    const existing = map.get(item.id);
    if (existing) {
      map.set(item.id, { ...existing, ...item, builtin: existing.builtin });
    } else {
      map.set(item.id, { ...item });
    }
  }
  return Array.from(map.values());
}

export function mergeSettings(partial?: Partial<ExtensionSettings> | null): ExtensionSettings {
  if (!partial) return structuredClone(DEFAULT_SETTINGS);
  return {
    ...DEFAULT_SETTINGS,
    ...partial,
    engines: mergeEngines(partial.engines),
    appearance: {
      ...DEFAULT_SETTINGS.appearance,
      ...(partial.appearance ?? {}),
    },
    video: {
      ...DEFAULT_SETTINGS.video,
      ...(partial.video ?? {}),
    },
    prompts: {
      ...DEFAULT_SETTINGS.prompts,
      ...(partial.prompts ?? {}),
    },
    glossary: Array.isArray(partial.glossary) ? partial.glossary : DEFAULT_SETTINGS.glossary,
    userRules: Array.isArray(partial.userRules) ? partial.userRules : DEFAULT_SETTINGS.userRules,
    disabledBuiltinRuleIds: Array.isArray(partial.disabledBuiltinRuleIds)
      ? partial.disabledBuiltinRuleIds
      : DEFAULT_SETTINGS.disabledBuiltinRuleIds,
    autoTranslateDomains: Array.isArray(partial.autoTranslateDomains)
      ? partial.autoTranslateDomains
      : DEFAULT_SETTINGS.autoTranslateDomains,
    neverTranslateDomains: Array.isArray(partial.neverTranslateDomains)
      ? partial.neverTranslateDomains
      : DEFAULT_SETTINGS.neverTranslateDomains,
    fallbackEngineIds:
      Array.isArray(partial.fallbackEngineIds) && partial.fallbackEngineIds.length > 0
        ? partial.fallbackEngineIds
        : DEFAULT_SETTINGS.fallbackEngineIds,
  };
}

export async function loadSettings(): Promise<ExtensionSettings> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return structuredClone(DEFAULT_SETTINGS);
  }
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return mergeSettings(result[STORAGE_KEY] as Partial<ExtensionSettings> | undefined);
}

export async function saveSettings(next: ExtensionSettings): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
}

export async function updateSettings(
  updater: (prev: ExtensionSettings) => ExtensionSettings,
): Promise<ExtensionSettings> {
  const current = await loadSettings();
  const next = mergeSettings(updater(current));
  await saveSettings(next);
  return next;
}

export function subscribeSettings(listener: (settings: ExtensionSettings) => void): () => void {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) {
    return () => {};
  }
  const handler = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string,
  ) => {
    if (areaName === 'local' && changes[STORAGE_KEY]) {
      listener(mergeSettings(changes[STORAGE_KEY].newValue as Partial<ExtensionSettings>));
    }
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}

export function getEngineById(settings: ExtensionSettings, id: string): EngineProfile {
  return (
    settings.engines.find((e) => e.id === id) ??
    settings.engines.find((e) => e.id === 'edge-free') ??
    settings.engines[0] ??
    BUILTIN_ENGINES[0]!
  );
}
