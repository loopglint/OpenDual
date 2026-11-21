/**
 * YouTube MAIN World Content Script (document_start):
 * - Passively mirrors `/api/timedtext` responses issued by YouTube's own player,
 *   naturally inheriting YouTube's PoToken (`&pot=`) and session integrity!
 * - Reads `movie_player.getPlayerResponse()` metadata and captionTracks.
 * - Cleanly activates native captions when requested by the Isolated controller.
 */

const CHANNEL = 'luminous-yt-bridge-v1';

interface CaptionTrackRaw {
  baseUrl?: string;
  vssId?: string;
  languageCode?: string;
  kind?: string;
  name?: { simpleText?: string; runs?: Array<{ text?: string }> };
}

interface MoviePlayerElement extends HTMLElement {
  getPlayerResponse?: () => {
    videoDetails?: {
      videoId?: string;
      title?: string;
      author?: string;
      shortDescription?: string;
      lengthSeconds?: string;
    };
    captions?: {
      playerCaptionsTracklistRenderer?: {
        captionTracks?: CaptionTrackRaw[];
      };
    };
  };
  loadModule?: (name: string) => void;
  setOption?: (module: string, option: string, value: unknown) => void;
  getOption?: (module: string, option: string) => unknown;
}

export default defineContentScript({
  matches: ['https://*.youtube.com/*', 'https://youtube.com/*'],
  world: 'MAIN',
  runAt: 'document_start',

  main() {
    if ((window as unknown as Record<string, boolean>).__luminousYtMainInstalled) return;
    (window as unknown as Record<string, boolean>).__luminousYtMainInstalled = true;

    const getVideoIdFromUrl = (rawUrl?: string): string => {
      try {
        const u = new URL(rawUrl || window.location.href);
        const v = u.searchParams.get('v');
        if (v) return v;
        const shortsMatch = u.pathname.match(/\/shorts\/([a-zA-Z0-9_-]{6,})/);
        if (shortsMatch?.[1]) return shortsMatch[1];
        const embedMatch = u.pathname.match(/\/embed\/([a-zA-Z0-9_-]{6,})/);
        if (embedMatch?.[1]) return embedMatch[1];
      } catch {
        // Ignore
      }
      return '';
    };

    const getMoviePlayer = (): MoviePlayerElement | null => {
      return (
        document.getElementById('movie_player') ||
        document.querySelector('.html5-video-player')
      ) as MoviePlayerElement | null;
    };

    const emitPlayerMeta = () => {
      const player = getMoviePlayer();
      const resp =
        player?.getPlayerResponse?.() ??
        (window as unknown as { ytInitialPlayerResponse?: ReturnType<NonNullable<MoviePlayerElement['getPlayerResponse']>> })
          .ytInitialPlayerResponse;

      const videoId = resp?.videoDetails?.videoId || getVideoIdFromUrl();
      if (!videoId) return;

      const rawTracks = resp?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
      const tracks = rawTracks.map((t, idx) => ({
        id: t.vssId || `track_${idx}`,
        langCode: t.languageCode || 'en',
        name:
          t.name?.simpleText ||
          t.name?.runs?.map((r) => r.text ?? '').join('') ||
          t.languageCode ||
          'Unknown',
        isAsr: t.kind === 'asr',
        baseUrl: t.baseUrl,
      }));

      window.postMessage(
        {
          channel: CHANNEL,
          type: 'PLAYER_META',
          videoId,
          title: resp?.videoDetails?.title,
          author: resp?.videoDetails?.author,
          description: resp?.videoDetails?.shortDescription,
          durationSec: resp?.videoDetails?.lengthSeconds
            ? Number(resp.videoDetails.lengthSeconds)
            : undefined,
          tracks,
        },
        '*',
      );
    };

    const emitTimedtextPayload = (reqUrl: string, bodyText: string) => {
      if (!bodyText || bodyText.trim().length < 2) return;
      try {
        const parsedUrl = new URL(reqUrl, window.location.origin);
        const videoId = parsedUrl.searchParams.get('v') || getVideoIdFromUrl();
        const lang = parsedUrl.searchParams.get('lang') || 'auto';
        const kind = parsedUrl.searchParams.get('kind') || '';
        const tlang = parsedUrl.searchParams.get('tlang');
        // Ignore YouTube's own machine-translated tracks if we want original source captions
        if (tlang) return;

        const trimmed = bodyText.trim();
        if (trimmed.startsWith('{')) {
          const json = JSON.parse(trimmed);
          if (json && Array.isArray(json.events)) {
            window.postMessage(
              {
                channel: CHANNEL,
                type: 'TIMEDTEXT_CAPTURED',
                videoId,
                url: reqUrl,
                lang,
                isAsr: kind === 'asr',
                format: 'json3',
                payload: json,
              },
              '*',
            );
          }
        } else if (trimmed.startsWith('WEBVTT')) {
          window.postMessage(
            {
              channel: CHANNEL,
              type: 'TIMEDTEXT_CAPTURED',
              videoId,
              url: reqUrl,
              lang,
              isAsr: kind === 'asr',
              format: 'vtt',
              payload: trimmed,
            },
            '*',
          );
        }
      } catch {
        // Ignore non-JSON or malformed timedtext responses
      }
    };

    // 1. Intercept window.fetch for /api/timedtext
    const origFetch = window.fetch;
    window.fetch = async function (...args: Parameters<typeof fetch>) {
      const response = await origFetch.apply(this, args);
      try {
        const url = typeof args[0] === 'string' ? args[0] : args[0] instanceof Request ? args[0].url : '';
        if (url && url.includes('/api/timedtext')) {
          const clone = response.clone();
          clone
            .text()
            .then((txt) => emitTimedtextPayload(url, txt))
            .catch(() => {});
        }
      } catch {
        // Never break native fetch
      }
      return response;
    };

    // 2. Intercept XMLHttpRequest for /api/timedtext (YouTube player frequently uses XHR!)
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (
      method: string,
      url: string | URL,
      async?: boolean,
      username?: string | null,
      password?: string | null,
    ) {
      (this as XMLHttpRequest & { __luminousUrl?: string }).__luminousUrl =
        typeof url === 'string' ? url : url.toString();
      return origOpen.call(this, method, url, async ?? true, username, password);
    };

    XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
      const reqUrl = (this as XMLHttpRequest & { __luminousUrl?: string }).__luminousUrl;
      if (reqUrl && reqUrl.includes('/api/timedtext')) {
        this.addEventListener('load', () => {
          try {
            if (this.status === 200 && typeof this.responseText === 'string') {
              emitTimedtextPayload(reqUrl, this.responseText);
            }
          } catch {
            // Ignore
          }
        });
      }
      return origSend.call(this, body);
    };

    // 3. Handle commands from Isolated Content Script (metadata query & native CC trigger)
    window.addEventListener('message', (event) => {
      if (event.source !== window || !event.data || event.data.channel !== CHANNEL) return;

      if (event.data.type === 'REQUEST_META') {
        setTimeout(emitPlayerMeta, 200);
      } else if (event.data.type === 'TRIGGER_CAPTIONS') {
        const player = getMoviePlayer();
        if (!player?.setOption) return;
        try {
          player.loadModule?.('captions');
          const trackList = (player.getOption?.('captions', 'tracklist') as Array<{
            languageCode?: string;
            kind?: string;
            vss_id?: string;
          }>) ?? [];

          // Prefer human-authored captions over ASR; avoid picking a track already in target language if others exist
          const targetPrefix = (String(event.data.targetLang || 'zh').split('-')[0] ?? 'zh').toLowerCase();
          const sorted = [...trackList].sort((a, b) => {
            const aManual = a.kind !== 'asr' ? 1 : 0;
            const bManual = b.kind !== 'asr' ? 1 : 0;
            if (aManual !== bManual) return bManual - aManual;
            const aForeign = a.languageCode?.toLowerCase().startsWith(targetPrefix) ? 0 : 1;
            const bForeign = b.languageCode?.toLowerCase().startsWith(targetPrefix) ? 0 : 1;
            return bForeign - aForeign;
          });

          const chosen = sorted[0];
          if (chosen) {
            player.setOption('captions', 'track', chosen);
          } else {
            // Fall back to toggling native CC button if tracklist wasn't populated yet
            const ccBtn = document.querySelector<HTMLButtonElement>('.ytp-subtitles-button');
            if (ccBtn && ccBtn.getAttribute('aria-pressed') === 'false') {
              ccBtn.click();
            }
          }
        } catch {
          // Ignore player API race conditions
        }
      }
    });

    // 4. Listen to YouTube SPA navigation & player ready events
    window.addEventListener('yt-navigate-finish', () => {
      const videoId = getVideoIdFromUrl();
      window.postMessage({ channel: CHANNEL, type: 'NAVIGATE', videoId }, '*');
      setTimeout(emitPlayerMeta, 450);
    });

    window.addEventListener('yt-player-updated', () => {
      setTimeout(emitPlayerMeta, 300);
    });

    if (document.readyState === 'complete') {
      setTimeout(emitPlayerMeta, 400);
    } else {
      window.addEventListener('DOMContentLoaded', () => setTimeout(emitPlayerMeta, 500));
    }
  },
});
