import type { SubtitleBilingualOrder } from '../../config/types';
import type { SubtitleCue } from './types';

function formatSrtTime(ms: number): string {
  const clamped = Math.max(0, Math.round(ms));
  const h = Math.floor(clamped / 3600000);
  const m = Math.floor((clamped % 3600000) / 60000);
  const s = Math.floor((clamped % 60000) / 1000);
  const rem = clamped % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(rem).padStart(3, '0')}`;
}

function formatVttTime(ms: number): string {
  return formatSrtTime(ms).replace(',', '.');
}

function formatCueLines(cue: SubtitleCue, order: SubtitleBilingualOrder): string {
  if (order === 'target-only') {
    return cue.target || cue.source;
  }
  if (!cue.target) return cue.source;
  return order === 'target-top' ? `${cue.target}\n${cue.source}` : `${cue.source}\n${cue.target}`;
}

export function exportCuesToSrt(cues: SubtitleCue[], order: SubtitleBilingualOrder = 'target-top'): string {
  return cues
    .map((cue, idx) => {
      return `${idx + 1}\n${formatSrtTime(cue.startMs)} --> ${formatSrtTime(cue.endMs)}\n${formatCueLines(cue, order)}`;
    })
    .join('\n\n');
}

export function exportCuesToVtt(cues: SubtitleCue[], order: SubtitleBilingualOrder = 'target-top'): string {
  const body = cues
    .map((cue) => {
      return `${formatVttTime(cue.startMs)} --> ${formatVttTime(cue.endMs)}\n${formatCueLines(cue, order)}`;
    })
    .join('\n\n');
  return `WEBVTT\n\n${body}\n`;
}

export function downloadSubtitleFile(
  cues: SubtitleCue[],
  format: 'srt' | 'vtt',
  title: string,
  order: SubtitleBilingualOrder,
): void {
  const content = format === 'srt' ? exportCuesToSrt(cues, order) : exportCuesToVtt(cues, order);
  const safeTitle = (title || 'bilingual-subtitles').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 64);
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeTitle}.${format}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
