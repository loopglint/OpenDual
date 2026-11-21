import type { EngineProfile, ExtensionSettings, LanguageCode } from '../config/types';
import type { SubtitleCue, VideoMetadata } from '../video/core/types';

export const TRANSLATION_PORT_NAME = 'luminous-translation-port';

export type TaskPriority = 'high' | 'normal' | 'low';

export interface TranslateBatchPayload {
  requestId: string;
  scope: 'webpage' | 'subtitle';
  engineId?: string;
  sourceLang: LanguageCode;
  targetLang: LanguageCode;
  items: Array<{ i: number; text: string }>;
  priority: TaskPriority;
  // Subtitle context
  videoMeta?: VideoMetadata;
  prevContext?: Array<{ source: string; target?: string }>;
  // Webpage context
  pageTitle?: string;
  pageUrl?: string;
  // Cache hint
  bypassCache?: boolean;
}

export interface ResegmentPayload {
  requestId: string;
  engineId?: string;
  tokens: Array<{ idx: number; text: string }>;
}

export interface AsrDirectMediaPayload {
  requestId: string;
  mediaUrl: string;
  mediaKey: string;
  platform: 'x' | 'youtube';
}

export type PortClientMessage =
  | { type: 'TRANSLATE_BATCH'; payload: TranslateBatchPayload }
  | { type: 'RESEGMENT_ASR'; payload: ResegmentPayload }
  | { type: 'ASR_DIRECT_MEDIA'; payload: AsrDirectMediaPayload }
  | { type: 'CANCEL_REQUEST'; requestId: string }
  | { type: 'PING' };

export type PortServerMessage =
  | {
      type: 'TRANSLATE_RESULT';
      requestId: string;
      ok: true;
      translations: Array<{ i: number; text: string }>;
      usedEngineId: string;
      fallbackTriggered?: boolean;
      cachedCount: number;
    }
  | {
      type: 'TRANSLATE_ERROR';
      requestId: string;
      ok: false;
      error: string;
      errorCode?: string;
    }
  | {
      type: 'RESEGMENT_RESULT';
      requestId: string;
      ok: true;
      segments: Array<{ startIdx: number; endIdx: number; text: string }>;
    }
  | {
      type: 'RESEGMENT_ERROR';
      requestId: string;
      ok: false;
      error: string;
    }
  | {
      type: 'ASR_PROGRESS';
      requestId: string;
      stage: 'downloading' | 'decoding' | 'transcribing' | 'done';
      percent: number;
      message: string;
    }
  | {
      type: 'ASR_RESULT';
      requestId: string;
      ok: true;
      cues: SubtitleCue[];
      cached?: boolean;
    }
  | {
      type: 'ASR_ERROR';
      requestId: string;
      ok: false;
      error: string;
    }
  | { type: 'PONG' };

export type RuntimeRequest =
  | { type: 'TEST_ENGINE'; profile: EngineProfile }
  | { type: 'LIST_OLLAMA_MODELS'; baseUrl: string }
  | { type: 'TEST_ASR'; baseUrl: string; apiKey: string; model: string }
  | { type: 'GET_CACHE_STATS' }
  | { type: 'CLEAR_CACHE'; target?: 'all' | 'page' | 'subtitle' | 'asr' }
  | { type: 'SYNC_DNR_RULES' }
  | { type: 'GET_SUBTITLE_CACHE'; cacheKey: string }
  | { type: 'SET_SUBTITLE_CACHE'; cacheKey: string; cues: SubtitleCue[] }
  | { type: 'START_TAB_ASR'; tabId?: number }
  | { type: 'STOP_TAB_ASR' }
  | { type: 'GET_TAB_STATE' }
  | { type: 'TOGGLE_PAGE_TRANSLATE' }
  | { type: 'SET_PAGE_DISPLAY_MODE'; mode: 'bilingual' | 'replace' }
  | { type: 'RETRANSLATE_PAGE' }
  | { type: 'TOGGLE_VIDEO_SUBTITLE' }
  | { type: 'UPDATE_SETTINGS_PARTIAL'; patch: Partial<ExtensionSettings> };

export interface PageTabState {
  translated: boolean;
  translating: boolean;
  displayMode: 'bilingual' | 'replace';
  matchedRuleName: string;
  translatedCount: number;
  domain: string;
  hasVideo: boolean;
  videoPlatform: 'youtube' | 'x' | null;
  videoSubtitleActive: boolean;
}
