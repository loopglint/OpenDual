import type { VideoSubtitleSettings } from '../../config/types';
import type { SubtitleCue, WordToken } from '../core/types';

interface WhisperWord {
  word: string;
  start: number;
  end: number;
}

interface WhisperSegment {
  id?: number;
  start: number;
  end: number;
  text: string;
  words?: WhisperWord[];
}

interface WhisperVerboseResponse {
  text?: string;
  segments?: WhisperSegment[];
  words?: WhisperWord[];
}

/**
 * Transcribes an audio/media Blob using any OpenAI-compatible Audio Transcriptions endpoint:
 * - Groq Whisper (`https://api.groq.com/openai/v1/audio/transcriptions`, `whisper-large-v3-turbo`)
 * - OpenAI Whisper (`https://api.openai.com/v1/audio/transcriptions`, `whisper-1`)
 * - Local Faster-Whisper / Whisper.cpp (`http://localhost:8000/v1/audio/transcriptions`)
 */
export async function transcribeAudioBlob(
  audioBlob: Blob,
  filename: string,
  settings: VideoSubtitleSettings,
  timeOffsetMs = 0,
  signal?: AbortSignal,
): Promise<SubtitleCue[]> {
  const url = (settings.asrBaseUrl || '').trim();
  if (!url) {
    throw new Error('请先在设置页「视频字幕与 ASR」中配置语音识别接口地址');
  }

  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(url);
  if (!settings.asrApiKey?.trim() && !isLocal) {
    throw new Error('请先在设置页填写 ASR 语音识别 API Key（推荐 Groq Whisper 或本地 Faster-Whisper）');
  }

  const form = new FormData();
  form.append('file', audioBlob, filename);
  form.append('model', settings.asrModel || 'whisper-large-v3-turbo');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'segment');
  form.append('timestamp_granularities[]', 'word');
  if (settings.asrLanguage?.trim()) {
    form.append('language', settings.asrLanguage.trim());
  }

  const headers: Record<string, string> = {};
  if (settings.asrApiKey?.trim()) {
    headers.Authorization = `Bearer ${settings.asrApiKey.trim()}`;
  }

  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: form,
    signal,
  });

  if (resp.status === 401 || resp.status === 403) {
    throw new Error(`ASR 接口鉴权失败 (${resp.status})，请检查 API Key 或本地 CORS 配置`);
  }
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`ASR 转写失败 (${resp.status}): ${errText.slice(0, 180)}`);
  }

  const data = (await resp.json()) as WhisperVerboseResponse;
  const cues: SubtitleCue[] = [];

  if (Array.isArray(data.segments) && data.segments.length > 0) {
    for (const seg of data.segments) {
      const text = (seg.text ?? '').trim();
      if (!text) continue;
      const words: WordToken[] | undefined = Array.isArray(seg.words)
        ? seg.words.map((w) => ({
            text: w.word.trim(),
            startMs: timeOffsetMs + Math.round(w.start * 1000),
            endMs: timeOffsetMs + Math.round(w.end * 1000),
          }))
        : undefined;

      cues.push({
        id: cues.length + 1,
        startMs: timeOffsetMs + Math.round(seg.start * 1000),
        endMs: timeOffsetMs + Math.round(seg.end * 1000),
        source: text,
        words,
      });
    }
  } else if (Array.isArray(data.words) && data.words.length > 0) {
    const words: WordToken[] = data.words.map((w) => ({
      text: w.word.trim(),
      startMs: timeOffsetMs + Math.round(w.start * 1000),
      endMs: timeOffsetMs + Math.round(w.end * 1000),
    }));
    const firstWord = words[0];
    const lastWord = words[words.length - 1];
    if (firstWord && lastWord) {
      cues.push({
        id: 1,
        startMs: firstWord.startMs,
        endMs: lastWord.endMs,
        source: words.map((w) => w.text).join(' '),
        words,
      });
    }
  } else if (data.text?.trim()) {
    cues.push({
      id: 1,
      startMs: timeOffsetMs,
      endMs: timeOffsetMs + 5000,
      source: data.text.trim(),
    });
  }

  return cues;
}
