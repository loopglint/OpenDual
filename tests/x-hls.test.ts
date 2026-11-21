import { describe, expect, it } from 'vitest';
import {
  extractXMediaFromGraphQL,
  parseHlsMasterSubtitles,
  parseHlsVttSegments,
} from '@/src/core/video/x/hls-parser';

describe('X (Twitter) HLS & GraphQL Media / Subtitle Extraction', () => {
  it('parses #EXT-X-MEDIA:TYPE=SUBTITLES tracks from X HLS master playlists', () => {
    const master = `#EXTM3U
#EXT-X-VERSION:6
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",DEFAULT=YES,AUTOSELECT=YES,LANGUAGE="en",URI="/subtitles/12345/en.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="Japanese",DEFAULT=NO,LANGUAGE="ja",URI="https://video.twimg.com/subtitles/12345/ja.vtt"
#EXT-X-STREAM-INF:BANDWIDTH=1200000,SUBTITLES="subs"
video_720p.m3u8
`;
    const tracks = parseHlsMasterSubtitles(master, 'https://video.twimg.com/amplify_video/12345/pl/master.m3u8');
    expect(tracks.length).toBe(2);
    expect(tracks[0]).toEqual({
      lang: 'en',
      name: 'English',
      uri: 'https://video.twimg.com/subtitles/12345/en.m3u8',
      isDefault: true,
    });
    expect(tracks[1]?.uri).toBe('https://video.twimg.com/subtitles/12345/ja.vtt');
  });

  it('resolves relative .vtt segments from HLS subtitle sub-playlists', () => {
    const sub = `#EXTM3U
#EXTINF:6.000,
seg_000.vtt
#EXTINF:6.000,
seg_001.vtt
`;
    const urls = parseHlsVttSegments(sub, 'https://video.twimg.com/subtitles/12345/en.m3u8');
    expect(urls).toEqual([
      'https://video.twimg.com/subtitles/12345/seg_000.vtt',
      'https://video.twimg.com/subtitles/12345/seg_001.vtt',
    ]);
  });

  it('extracts sorted MP4 variants & HLS URLs from nested X GraphQL responses', () => {
    const graphql = {
      data: {
        home: {
          instructions: [
            {
              entry: {
                result: {
                  rest_id: '1987654321000',
                  core: {
                    user_results: { result: { legacy: { name: 'AI Research', screen_name: 'airesearch' } } },
                  },
                  legacy: {
                    full_text: 'Check out our new model demo!',
                    extended_entities: {
                      media: [
                        {
                          media_key: '7_1987654321000',
                          media_url_https: 'https://pbs.twimg.com/ext_tw_video_thumb/abc.jpg',
                          video_info: {
                            variants: [
                              { bitrate: 2176000, content_type: 'video/mp4', url: 'https://video.twimg.com/hd.mp4' },
                              { bitrate: 432000, content_type: 'video/mp4', url: 'https://video.twimg.com/sd.mp4' },
                              { content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/master.m3u8' },
                            ],
                          },
                        },
                      ],
                    },
                  },
                },
              },
            },
          ],
        },
      },
    };

    const items = extractXMediaFromGraphQL(graphql);
    expect(items.length).toBe(1);
    expect(items[0]?.tweetId).toBe('1987654321000');
    expect(items[0]?.author).toBe('AI Research');
    // Lowest bitrate MP4 sorted first for ultra-fast Whisper ASR audio transfer
    expect(items[0]?.mp4Variants[0]?.url).toBe('https://video.twimg.com/sd.mp4');
    expect(items[0]?.hlsUrl).toBe('https://video.twimg.com/master.m3u8');
  });
});
