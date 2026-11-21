import type { EngineProfile, ExtensionSettings, LanguageCode } from './types';

export const LANGUAGE_OPTIONS: Array<{ code: LanguageCode; label: string; nativeLabel: string }> = [
  { code: 'zh-CN', label: '简体中文', nativeLabel: '简体中文' },
  { code: 'zh-TW', label: '繁體中文', nativeLabel: '繁體中文' },
  { code: 'en', label: '英语', nativeLabel: 'English' },
  { code: 'ja', label: '日语', nativeLabel: '日本語' },
  { code: 'ko', label: '韩语', nativeLabel: '한국어' },
  { code: 'fr', label: '法语', nativeLabel: 'Français' },
  { code: 'de', label: '德语', nativeLabel: 'Deutsch' },
  { code: 'es', label: '西班牙语', nativeLabel: 'Español' },
  { code: 'ru', label: '俄语', nativeLabel: 'Русский' },
  { code: 'pt', label: '葡萄牙语', nativeLabel: 'Português' },
  { code: 'it', label: '意大利语', nativeLabel: 'Italiano' },
];

export const DEFAULT_WEBPAGE_SYSTEM_PROMPT = `You are a professional bilingual web translator. Translate the user's JSON array of webpage text blocks into {{targetLang}}.
Strict rules:
1. Return ONLY a valid JSON object matching {"items":[{"i":<index>,"t":"<translation>"}]}. No markdown fences, no commentary, no extra keys.
2. Preserve EVERY inline placeholder tag verbatim with exact attributes and indices:
   - Keep <v id="N"/> unchanged in the grammatically natural position of the translation.
   - Keep <g id="N">...</g> tags wrapping the corresponding translated phrase.
3. Preserve technical identifiers, code tokens, brand names, and URLs unless standard localized names exist.
4. Keep the tone natural, accurate, concise, and faithful to the original text.
5. Every input index "i" MUST appear exactly once in the output array. Do not merge or drop items.{{glossaryBlock}}`;

export const DEFAULT_SUBTITLE_SYSTEM_PROMPT = `You are a professional video subtitle translator specializing in natural spoken {{targetLang}} subtitles.
Strict rules:
1. Return ONLY a valid JSON object matching {"items":[{"i":<index>,"t":"<translation>"}]}. No markdown fences, no explanations.
2. Use the provided video title/description and read-only previous context cues to ensure accurate terminology, pronoun resolution, and consistent tone. NEVER translate or include the previous context cues in the output.
3. Keep each subtitle concise, idiomatic, and comfortable to read on screen (avoid stiff literal translation).
4. Keep non-speech cues like [Music] or [Applause] brief in {{targetLang}} (e.g. [音乐], [掌声]).
5. Every input cue index "i" MUST appear exactly once in the output array. NEVER merge, split, or drop any index.{{glossaryBlock}}`;

export const DEFAULT_RESEGMENT_SYSTEM_PROMPT = `You are a transcript punctuation & subtitle segmentation assistant.
Given an unpunctuated ASR transcript containing numbered word tokens like [0]hello [1]world [2]how [3]are [4]you, split it into natural, grammatically complete subtitle sentences.
Rules:
1. Return ONLY valid JSON: {"segments":[{"startIdx":0,"endIdx":4,"text":"Hello world, how are you?"}]}.
2. Restore accurate capitalization and punctuation without inventing or omitting spoken words.
3. Keep each segment natural for subtitles (roughly 8 to 22 words, max ~110 chars).
4. Token index ranges must be strictly ascending, non-overlapping, and cover all tokens from start to end.`;

export const BUILTIN_ENGINES: EngineProfile[] = [
  {
    id: 'edge-free',
    name: 'Microsoft Edge 免费翻译',
    kind: 'edge-free',
    enabled: true,
    builtin: true,
    maxCharsPerBatch: 2800,
    maxItemsPerBatch: 20,
    concurrency: 3,
    rpmLimit: 90,
    timeoutMs: 15000,
  },
  {
    id: 'google-free',
    name: 'Google 免费翻译',
    kind: 'google-free',
    enabled: true,
    builtin: true,
    maxCharsPerBatch: 2400,
    maxItemsPerBatch: 15,
    concurrency: 3,
    rpmLimit: 80,
    timeoutMs: 15000,
  },
  {
    id: 'chrome-builtin',
    name: 'Chrome 内置端侧翻译 (本地免费)',
    kind: 'chrome-builtin',
    enabled: true,
    builtin: true,
    maxCharsPerBatch: 1800,
    maxItemsPerBatch: 10,
    concurrency: 2,
    timeoutMs: 20000,
  },
  {
    id: 'ollama',
    name: '本地 Ollama',
    kind: 'ollama',
    enabled: true,
    builtin: true,
    baseUrl: 'http://localhost:11434',
    model: 'qwen2.5:7b',
    ollamaApiMode: 'native',
    ollamaKeepAlive: '10m',
    ollamaDisableThinking: true,
    ollamaAutoFixCors: true,
    ollamaNumCtx: 4096,
    temperature: 0.1,
    maxCharsPerBatch: 1800,
    maxItemsPerBatch: 10,
    concurrency: 1,
    timeoutMs: 120000,
    streaming: true,
  },
  {
    id: 'deepseek',
    name: 'DeepSeek API',
    kind: 'deepseek',
    enabled: true,
    builtin: true,
    baseUrl: 'https://api.deepseek.com',
    apiKey: '',
    model: 'deepseek-chat',
    temperature: 0.1,
    maxCharsPerBatch: 3200,
    maxItemsPerBatch: 16,
    concurrency: 5,
    rpmLimit: 120,
    timeoutMs: 60000,
    streaming: true,
  },
  {
    id: 'openai',
    name: 'OpenAI API',
    kind: 'openai',
    enabled: true,
    builtin: true,
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
    temperature: 0.1,
    maxCharsPerBatch: 3200,
    maxItemsPerBatch: 16,
    concurrency: 5,
    rpmLimit: 120,
    timeoutMs: 60000,
    streaming: true,
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude API',
    kind: 'anthropic',
    enabled: true,
    builtin: true,
    baseUrl: 'https://api.anthropic.com',
    apiKey: '',
    model: 'claude-3-5-haiku-latest',
    temperature: 0.1,
    maxCharsPerBatch: 3200,
    maxItemsPerBatch: 16,
    concurrency: 4,
    rpmLimit: 80,
    timeoutMs: 60000,
    streaming: true,
  },
];

export interface CustomEnginePreset {
  label: string;
  kind: 'openai-compatible' | 'deeplx';
  baseUrl: string;
  defaultModel: string;
  note: string;
}

export const CUSTOM_ENGINE_PRESETS: CustomEnginePreset[] = [
  {
    label: '硅基流动 (SiliconFlow)',
    kind: 'openai-compatible',
    baseUrl: 'https://api.siliconflow.cn/v1',
    defaultModel: 'Qwen/Qwen2.5-7B-Instruct',
    note: '国内直连高性价比，支持 Qwen / DeepSeek 等众多开源模型',
  },
  {
    label: 'OpenRouter',
    kind: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'google/gemini-2.0-flash-001',
    note: '一站式聚合主流海外大模型，支持多种免费/低价模型',
  },
  {
    label: 'Groq Cloud',
    kind: 'openai-compatible',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    note: '极低延迟推理，适合实时视频字幕翻译',
  },
  {
    label: 'Google Gemini (OpenAI 兼容)',
    kind: 'openai-compatible',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.5-flash',
    note: 'Gemini 官方 OpenAI 兼容接口，长上下文与多语种能力强',
  },
  {
    label: 'LM Studio (本地)',
    kind: 'openai-compatible',
    baseUrl: 'http://localhost:1234/v1',
    defaultModel: 'local-model',
    note: '本地桌面端模型运行器，OpenAI 兼容协议',
  },
  {
    label: 'vLLM / SGLang (自建)',
    kind: 'openai-compatible',
    baseUrl: 'http://localhost:8000/v1',
    defaultModel: 'Qwen/Qwen2.5-14B-Instruct',
    note: '局域网或服务器高性能自建推理服务',
  },
  {
    label: 'DeepLX (自建)',
    kind: 'deeplx',
    baseUrl: 'http://localhost:1188/translate',
    defaultModel: '',
    note: '自建 DeepLX 接口，保持经典 DeepL 译风',
  },
];

export const ASR_PRESETS = {
  'groq-whisper': {
    name: 'Groq Whisper (极速推荐)',
    baseUrl: 'https://api.groq.com/openai/v1/audio/transcriptions',
    model: 'whisper-large-v3-turbo',
    note: '约 100x 实时速度，3 分钟视频 2 秒内完成词级转写',
  },
  'openai-whisper': {
    name: 'OpenAI Whisper API',
    baseUrl: 'https://api.openai.com/v1/audio/transcriptions',
    model: 'whisper-1',
    note: '官方高精度语音识别，支持 verbose_json 词级时间戳',
  },
  'local-whisper': {
    name: '本地 Faster-Whisper / Whisper.cpp',
    baseUrl: 'http://localhost:8000/v1/audio/transcriptions',
    model: 'Systran/faster-whisper-small',
    note: '100% 免费离线隐私保护，兼容 OpenAI Audio 协议',
  },
} as const;

export const DEFAULT_SETTINGS: ExtensionSettings = {
  version: 1,
  sourceLang: 'auto',
  targetLang: 'zh-CN',
  activePageEngineId: 'edge-free',
  activeVideoEngineId: 'edge-free',
  fallbackEngineIds: ['edge-free', 'google-free', 'chrome-builtin'],
  engines: BUILTIN_ENGINES,
  appearance: {
    displayMode: 'bilingual',
    theme: 'default',
    customCss: '',
    showFloatingBall: true,
    floatingBallPositionY: 62,
    hoverTriggerKey: 'Alt',
    showLoadingSpinner: true,
  },
  video: {
    enabledYoutube: true,
    enabledX: true,
    autoEnableOnPlay: true,
    bilingualOrder: 'target-top',
    smartSegmentation: true,
    llmSemanticResegment: false,
    fontSize: 20,
    sourceFontScale: 0.82,
    targetColor: '#ffffff',
    sourceColor: '#e2e8f0',
    bgOpacity: 0.72,
    verticalOffsetPercent: 8,
    hoverPause: true,
    hideNativeCaptions: true,
    asrEnabled: true,
    asrProvider: 'groq-whisper',
    asrBaseUrl: ASR_PRESETS['groq-whisper'].baseUrl,
    asrApiKey: '',
    asrModel: ASR_PRESETS['groq-whisper'].model,
    asrLanguage: '',
    asrAutoFixLocalCors: true,
  },
  prompts: {
    webpageSystemPrompt: DEFAULT_WEBPAGE_SYSTEM_PROMPT,
    subtitleSystemPrompt: DEFAULT_SUBTITLE_SYSTEM_PROMPT,
    resegmentSystemPrompt: DEFAULT_RESEGMENT_SYSTEM_PROMPT,
  },
  glossary: [],
  userRules: [],
  disabledBuiltinRuleIds: [],
  autoTranslateDomains: [],
  neverTranslateDomains: [],
  cacheEnabled: true,
  cacheTtlDays: 7,
};
