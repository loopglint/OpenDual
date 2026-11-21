import type { XInterceptedMediaInfo } from '../core/types';

export interface HlsSubtitleTrack {
  lang: string;
  name: string;
  uri: string;
  isDefault: boolean;
}

/**
 * Parses an HLS Master Playlist (.m3u8) for #EXT-X-MEDIA:TYPE=SUBTITLES tracks.
 */
export function parseHlsMasterSubtitles(m3u8Text: string, baseUrl: string): HlsSubtitleTrack[] {
  const tracks: HlsSubtitleTrack[] = [];
  const lines = m3u8Text.split(/\r?\n/);

  for (const line of lines) {
    if (!line.startsWith('#EXT-X-MEDIA:')) continue;
    if (!/TYPE=SUBTITLES/i.test(line)) continue;

    const uriMatch = line.match(/URI="([^"]+)"/i);
    if (!uriMatch || !uriMatch[1]) continue;

    const langMatch = line.match(/LANGUAGE="([^"]+)"/i);
    const nameMatch = line.match(/NAME="([^"]+)"/i);
    const defaultMatch = line.match(/DEFAULT=(YES|NO)/i);

    let resolvedUri = uriMatch[1];
    try {
      resolvedUri = new URL(resolvedUri, baseUrl).href;
    } catch {
      // Keep raw URI if relative resolution fails
    }

    tracks.push({
      lang: langMatch?.[1] ?? 'und',
      name: nameMatch?.[1] ?? langMatch?.[1] ?? 'Subtitle',
      uri: resolvedUri,
      isDefault: defaultMatch?.[1]?.toUpperCase() === 'YES',
    });
  }

  return tracks;
}

/**
 * Parses an HLS Subtitle Media Playlist (.m3u8) to extract ordered .vtt segment URLs.
 */
export function parseHlsVttSegments(subPlaylistText: string, baseUrl: string): string[] {
  const urls: string[] = [];
  const lines = subPlaylistText.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    try {
      urls.push(new URL(line, baseUrl).href);
    } catch {
      urls.push(line);
    }
  }
  return urls;
}

/**
 * Extracts X/Twitter media metadata (mp4 variants, HLS m3u8 URL, poster, tweet text)
 * recursively from arbitrary X GraphQL JSON payloads (HomeTimeline, TweetDetail, UserTweets, etc.).
 */
export function extractXMediaFromGraphQL(json: unknown): XInterceptedMediaInfo[] {
  const found = new Map<string, XInterceptedMediaInfo>();

  function visit(node: unknown, depth = 0): void {
    if (!node || typeof node !== 'object' || depth > 24) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }

    const rec = node as Record<string, unknown>;

    // Detect Tweet result object containing `legacy` + `rest_id`
    const legacy = rec.legacy as Record<string, unknown> | undefined;
    const tweetId =
      typeof rec.rest_id === 'string'
        ? rec.rest_id
        : typeof legacy?.id_str === 'string'
          ? legacy.id_str
          : undefined;

    if (tweetId && legacy) {
      const extEntities = (legacy.extended_entities ?? legacy.entities) as
        | { media?: Array<Record<string, unknown>> }
        | undefined;
      const mediaList = extEntities?.media;
      if (Array.isArray(mediaList)) {
        for (const media of mediaList) {
          const videoInfo = media.video_info as
            | { variants?: Array<{ bitrate?: number; content_type?: string; url?: string }> }
            | undefined;
          if (!videoInfo?.variants || !Array.isArray(videoInfo.variants)) continue;

          const mp4Variants: Array<{ bitrate: number; url: string }> = [];
          let hlsUrl: string | undefined;

          for (const v of videoInfo.variants) {
            if (!v.url) continue;
            if (v.content_type === 'application/x-mpegURL' || v.url.includes('.m3u8')) {
              hlsUrl = v.url;
            } else if (v.content_type === 'video/mp4' || v.url.includes('.mp4')) {
              mp4Variants.push({ bitrate: v.bitrate ?? 0, url: v.url });
            }
          }

          mp4Variants.sort((a, b) => a.bitrate - b.bitrate);

          const mediaKey =
            typeof media.media_key === 'string'
              ? media.media_key
              : typeof media.id_str === 'string'
                ? media.id_str
                : tweetId;

          const posterUrl = typeof media.media_url_https === 'string' ? media.media_url_https : undefined;
          const fullText = typeof legacy.full_text === 'string' ? legacy.full_text : undefined;

          const coreUser = (rec.core as Record<string, unknown> | undefined)?.user_results as
            | { result?: { legacy?: { screen_name?: string; name?: string } } }
            | undefined;
          const author = coreUser?.result?.legacy?.name || coreUser?.result?.legacy?.screen_name;

          if (mp4Variants.length > 0 || hlsUrl) {
            found.set(`${tweetId}:${mediaKey}`, {
              tweetId,
              mediaKey,
              author,
              text: fullText,
              posterUrl,
              mp4Variants,
              hlsUrl,
              subtitleUrls: [],
              capturedAt: Date.now(),
            });
          }
        }
      }
    }

    for (const val of Object.values(rec)) {
      if (val && typeof val === 'object') {
        visit(val, depth + 1);
      }
    }
  }

  visit(json);
  return Array.from(found.values());
}
