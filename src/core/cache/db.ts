import Dexie, { type Table } from 'dexie';
import type { SubtitleCue } from '../video/core/types';

export interface PageCacheRecord {
  key: string;
  translation: string;
  engineId: string;
  updatedAt: number;
}

export interface SubtitleCacheRecord {
  key: string;
  cues: SubtitleCue[];
  updatedAt: number;
}

export interface AsrCacheRecord {
  key: string;
  cues: SubtitleCue[];
  updatedAt: number;
}

class TranslatorCacheDB extends Dexie {
  pageTranslations!: Table<PageCacheRecord, string>;
  subtitleTracks!: Table<SubtitleCacheRecord, string>;
  asrTranscripts!: Table<AsrCacheRecord, string>;

  constructor() {
    super('LuminousTranslatorCacheV1');
    this.version(1).stores({
      pageTranslations: 'key, updatedAt, engineId',
      subtitleTracks: 'key, updatedAt',
      asrTranscripts: 'key, updatedAt',
    });
  }
}

let dbInstance: TranslatorCacheDB | null = null;

function getDb(): TranslatorCacheDB | null {
  if (typeof indexedDB === 'undefined') return null;
  if (!dbInstance) {
    dbInstance = new TranslatorCacheDB();
  }
  return dbInstance;
}

/**
 * Fast, deterministic SHA-256 hex digest using Web Crypto API (falls back to FNV-1a 64-bit string in non-crypto env).
 */
export async function hashCacheKey(parts: string[]): Promise<string> {
  const input = parts.join('\u001f');
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoded = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 0x01000193);
    h2 = Math.imul(h2 ^ (ch + i), 0x01000193);
  }
  return `${(h1 >>> 0).toString(16)}${(h2 >>> 0).toString(16)}`;
}

const MAX_PAGE_CACHE_ENTRIES = 15000;
const MAX_SUBTITLE_CACHE_ENTRIES = 200;

export async function getPageCacheMany(
  keys: string[],
  ttlDays: number,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const db = getDb();
  if (!db || keys.length === 0) return result;
  const cutoff = Date.now() - Math.max(1, ttlDays) * 86_400_000;
  try {
    const rows = await db.pageTranslations.bulkGet(keys);
    for (const row of rows) {
      if (row && row.updatedAt >= cutoff) {
        result.set(row.key, row.translation);
      }
    }
  } catch {
    // Graceful cache miss on IDB failure
  }
  return result;
}

export async function setPageCacheMany(records: PageCacheRecord[]): Promise<void> {
  const db = getDb();
  if (!db || records.length === 0) return;
  try {
    await db.pageTranslations.bulkPut(records);
    const count = await db.pageTranslations.count();
    if (count > MAX_PAGE_CACHE_ENTRIES) {
      const oldest = await db.pageTranslations
        .orderBy('updatedAt')
        .limit(count - Math.floor(MAX_PAGE_CACHE_ENTRIES * 0.85))
        .primaryKeys();
      await db.pageTranslations.bulkDelete(oldest);
    }
  } catch {
    // Ignore cache write errors
  }
}

export async function getSubtitleCache(key: string, ttlDays: number): Promise<SubtitleCue[] | null> {
  const db = getDb();
  if (!db) return null;
  try {
    const row = await db.subtitleTracks.get(key);
    const cutoff = Date.now() - Math.max(1, ttlDays) * 86_400_000;
    if (row && row.updatedAt >= cutoff) {
      return row.cues;
    }
  } catch {
    // Ignore
  }
  return null;
}

export async function setSubtitleCache(key: string, cues: SubtitleCue[]): Promise<void> {
  const db = getDb();
  if (!db) return;
  try {
    await db.subtitleTracks.put({ key, cues, updatedAt: Date.now() });
    const count = await db.subtitleTracks.count();
    if (count > MAX_SUBTITLE_CACHE_ENTRIES) {
      const oldest = await db.subtitleTracks
        .orderBy('updatedAt')
        .limit(count - Math.floor(MAX_SUBTITLE_CACHE_ENTRIES * 0.8))
        .primaryKeys();
      await db.subtitleTracks.bulkDelete(oldest);
    }
  } catch {
    // Ignore
  }
}

export async function getAsrCache(key: string): Promise<SubtitleCue[] | null> {
  const db = getDb();
  if (!db) return null;
  try {
    const row = await db.asrTranscripts.get(key);
    return row ? row.cues : null;
  } catch {
    return null;
  }
}

export async function setAsrCache(key: string, cues: SubtitleCue[]): Promise<void> {
  const db = getDb();
  if (!db) return;
  try {
    await db.asrTranscripts.put({ key, cues, updatedAt: Date.now() });
  } catch {
    // Ignore
  }
}

export async function getCacheStats(): Promise<{
  pageEntries: number;
  subtitleEntries: number;
  asrEntries: number;
}> {
  const db = getDb();
  if (!db) return { pageEntries: 0, subtitleEntries: 0, asrEntries: 0 };
  const [pageEntries, subtitleEntries, asrEntries] = await Promise.all([
    db.pageTranslations.count(),
    db.subtitleTracks.count(),
    db.asrTranscripts.count(),
  ]);
  return { pageEntries, subtitleEntries, asrEntries };
}

export async function clearCache(target: 'all' | 'page' | 'subtitle' | 'asr' = 'all'): Promise<void> {
  const db = getDb();
  if (!db) return;
  if (target === 'all' || target === 'page') await db.pageTranslations.clear();
  if (target === 'all' || target === 'subtitle') await db.subtitleTracks.clear();
  if (target === 'all' || target === 'asr') await db.asrTranscripts.clear();
}
