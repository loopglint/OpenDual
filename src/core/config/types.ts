export type LanguageCode =
  | 'auto'
  | 'zh-CN'
  | 'zh-TW'
  | 'en'
  | 'ja'
  | 'ko'
  | 'fr'
  | 'de'
  | 'es'
  | 'ru'
  | 'pt'
  | 'it';

export type EngineKind =
  | 'edge-free'
  | 'google-free'
  | 'chrome-builtin'
  | 'ollama'
  | 'deepseek'
  | 'openai'
  | 'anthropic'
  | 'deeplx'
  | 'openai-compatible';

export type DisplayMode = 'bilingual' | 'replace';

export type BilingualTheme =
  | 'default'
  | 'underline'
  | 'dashed'
  | 'highlight'
  | 'blockquote'
  | 'blur-learning'
  | 'weakened-original'
  | 'custom';

export type HoverTriggerKey = 'none' | 'Alt' | 'Control' | 'Shift';

export type SubtitleBilingualOrder = 'target-top' | 'source-top' | 'target-only';

export type AsrProviderKind = 'groq-whisper' | 'openai-whisper' | 'local-whisper';

export interface EngineProfile {
  id: string;
  name: string;
  kind: EngineKind;
  enabled: boolean;
  builtin?: boolean;
  // Network & auth
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  customHeaders?: Record<string, string>;
  extraBody?: Record<string, unknown>;
  // Ollama specific
  ollamaApiMode?: 'native' | 'openai';
  ollamaKeepAlive?: string;
  ollamaDisableThinking?: boolean;
  ollamaAutoFixCors?: boolean;
  ollamaNumCtx?: number;
  // Tuning
  temperature?: number;
  maxCharsPerBatch?: number;
  maxItemsPerBatch?: number;
  concurrency?: number;
  rpmLimit?: number;
  timeoutMs?: number;
  streaming?: boolean;
}

export interface SiteRule {
  id: string;
  name: string;
  description?: string;
  builtin?: boolean;
  enabled?: boolean;
  matches: string[];
  excludeMatches?: string[];
  selectors?: string[];
  excludeSelectors?: string[];
  stayOriginalSelectors?: string[];
  atomicBlockSelectors?: string[];
  extraBlockSelectors?: string[];
  extraInlineSelectors?: string[];
  shadowRootSelectors?: string[];
  injectCss?: string;
  detectLanguagePerBlock?: boolean;
  defaultMode?: DisplayMode;
}

export interface GlossaryEntry {
  id: string;
  source: string;
  target: string;
  keepOriginal?: boolean;
  caseSensitive?: boolean;
  enabled: boolean;
}

export interface VideoSubtitleSettings {
  enabledYoutube: boolean;
  enabledX: boolean;
  autoEnableOnPlay: boolean;
  bilingualOrder: SubtitleBilingualOrder;
  smartSegmentation: boolean;
  llmSemanticResegment: boolean;
  fontSize: number; // px for standard view
  sourceFontScale: number; // e.g. 0.82
  targetColor: string;
  sourceColor: string;
  bgOpacity: number; // 0..1
  verticalOffsetPercent: number; // 0..40 from bottom
  hoverPause: boolean;
  hideNativeCaptions: boolean;
  // ASR for captionless ("生肉") videos
  asrEnabled: boolean;
  asrProvider: AsrProviderKind;
  asrBaseUrl: string;
  asrApiKey: string;
  asrModel: string;
  asrLanguage: string; // '' = auto
  asrAutoFixLocalCors: boolean;
}

export interface AppearanceSettings {
  displayMode: DisplayMode;
  theme: BilingualTheme;
  customCss: string;
  showFloatingBall: boolean;
  floatingBallPositionY: number; // percent 10..90
  hoverTriggerKey: HoverTriggerKey;
  showLoadingSpinner: boolean;
}

export interface PromptSettings {
  webpageSystemPrompt: string;
  subtitleSystemPrompt: string;
  resegmentSystemPrompt: string;
}

export interface ExtensionSettings {
  version: number;
  sourceLang: LanguageCode;
  targetLang: LanguageCode;
  activePageEngineId: string;
  activeVideoEngineId: string;
  fallbackEngineIds: string[];
  engines: EngineProfile[];
  appearance: AppearanceSettings;
  video: VideoSubtitleSettings;
  prompts: PromptSettings;
  glossary: GlossaryEntry[];
  userRules: SiteRule[];
  disabledBuiltinRuleIds: string[];
  autoTranslateDomains: string[];
  neverTranslateDomains: string[];
  cacheEnabled: boolean;
  cacheTtlDays: number;
}
