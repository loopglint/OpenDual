import { extractXMediaFromGraphQL } from '@/src/core/video/x/hls-parser';

/**
 * X (Twitter) MAIN World Content Script (document_start):
 * - Mirrors X GraphQL responses to index tweetId -> MP4/HLS video variants & tweet metadata.
 * - Mirrors video.twimg.com HLS Master Playlists (.m3u8) & WebVTT (.vtt) subtitle payloads.
 */

const CHANNEL = 'luminous-x-bridge-v1';

export default defineContentScript({
  matches: [
    'https://x.com/*',
    'https://*.x.com/*',
    'https://twitter.com/*',
    'https://*.twitter.com/*',
  ],
  world: 'MAIN',
  runAt: 'document_start',

  main() {
    if ((window as unknown as Record<string, boolean>).__luminousXMainInstalled) return;
    (window as unknown as Record<string, boolean>).__luminousXMainInstalled = true;

    const inspectResponseText = (url: string, text: string) => {
      if (!url || !text) return;
      try {
        if (url.includes('/i/api/graphql/') || url.includes('/2/timeline/')) {
          const json = JSON.parse(text);
          const items = extractXMediaFromGraphQL(json);
          if (items.length > 0) {
            window.postMessage({ channel: CHANNEL, type: 'GRAPHQL_MEDIA', items }, '*');
          }
        } else if (url.includes('twimg.com') && url.includes('.m3u8')) {
          if (text.includes('#EXT-X-MEDIA') && text.includes('SUBTITLES')) {
            window.postMessage({ channel: CHANNEL, type: 'HLS_MASTER', url, body: text }, '*');
          }
        } else if (url.includes('twimg.com') && (url.includes('.vtt') || text.trimStart().startsWith('WEBVTT'))) {
          window.postMessage({ channel: CHANNEL, type: 'VTT_CAPTURED', url, body: text }, '*');
        }
      } catch {
        // Never disrupt host app
      }
    };

    // 1. Hook window.fetch
    const origFetch = window.fetch;
    window.fetch = async function (...args: Parameters<typeof fetch>) {
      const response = await origFetch.apply(this, args);
      try {
        const url = typeof args[0] === 'string' ? args[0] : args[0] instanceof Request ? args[0].url : '';
        if (
          url &&
          (url.includes('/i/api/graphql/') ||
            url.includes('twimg.com') && (url.includes('.m3u8') || url.includes('.vtt')))
        ) {
          response
            .clone()
            .text()
            .then((txt) => inspectResponseText(url, txt))
            .catch(() => {});
        }
      } catch {
        // Ignore
      }
      return response;
    };

    // 2. Hook XMLHttpRequest (X GraphQL and HLS.js often use XHR!)
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
      if (
        reqUrl &&
        (reqUrl.includes('/i/api/graphql/') ||
          (reqUrl.includes('twimg.com') && (reqUrl.includes('.m3u8') || reqUrl.includes('.vtt'))))
      ) {
        this.addEventListener('load', () => {
          try {
            if (this.status === 200 && (this.responseType === '' || this.responseType === 'text')) {
              inspectResponseText(reqUrl, this.responseText);
            }
          } catch {
            // Ignore
          }
        });
      }
      return origSend.call(this, body);
    };
  },
});
