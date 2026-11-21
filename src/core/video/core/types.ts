export interface WordToken {
  text: string;
  startMs: number;
  endMs: number;
}

export interface SubtitleCue {
  id: number;
  startMs: number;
  endMs: number;
  source: string;
  target?: string;
  isNonSpeech?: boolean;
  words?: WordToken[];
}

export interface SubtitleTrackMeta {
  id: string;
  langCode: string;
  name: string;
  isAsr: boolean;
  baseUrl?: string;
}

export interface VideoMetadata {
  platform: 'youtube' | 'x';
  videoId: string;
  title?: string;
  author?: string;
  description?: string;
  durationSec?: number;
}

export interface YtJson3Segment {
  utf8?: string;
  tOffsetMs?: number;
  acAsrConf?: number;
}

export interface YtJson3Event {
  tStartMs?: number;
  dDurationMs?: number;
  wWinId?: number;
  aAppend?: number;
  segs?: YtJson3Segment[];
}

export interface YtJson3Payload {
  events?: YtJson3Event[];
}

export interface XInterceptedMediaInfo {
  tweetId: string;
  mediaKey?: string;
  author?: string;
  text?: string;
  posterUrl?: string;
  mp4Variants: Array<{ bitrate: number; url: string }>;
  hlsUrl?: string;
  subtitleUrls: Array<{ lang: string; name: string; url: string }>;
  capturedAt: number;
}
