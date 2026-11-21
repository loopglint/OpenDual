import { loadSettings, subscribeSettings } from '@/src/core/config/storage';
import { WebpageTranslator } from '@/src/core/dom/translator';
import type { PageTabState, RuntimeRequest } from '@/src/core/messaging/protocol';
import { isDomainInList } from '@/src/core/rules/matcher';
import { YouTubeSubtitleController } from '@/src/core/video/youtube/controller';
import { XVideoSubtitleController } from '@/src/core/video/x/controller';
import { FloatingBallWidget } from '@/src/ui/FloatingBall';
import { installGlobalErrorHooks } from '@/src/core/debug/logger';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',

  async main() {
    // Only run in top-level HTML documents
    if (window.self !== window.top) return;
    if (!document.body) return;
    installGlobalErrorHooks('content');

    let settings = await loadSettings();
    const host = window.location.hostname.toLowerCase();
    const isYoutube = host === 'youtube.com' || host.endsWith('.youtube.com');
    const isX = host === 'x.com' || host.endsWith('.x.com') || host === 'twitter.com' || host.endsWith('.twitter.com');

    const pageTranslator = new WebpageTranslator(settings);

    let ytController: YouTubeSubtitleController | null = null;
    let xController: XVideoSubtitleController | null = null;

    if (isYoutube && settings.video.enabledYoutube) {
      ytController = new YouTubeSubtitleController(settings);
    } else if (isX && settings.video.enabledX) {
      xController = new XVideoSubtitleController(settings);
    }

    const floatingBall = new FloatingBallWidget(settings.appearance, {
      onToggleTranslate: () => pageTranslator.toggle(),
      onToggleDisplayMode: (mode) => pageTranslator.setDisplayMode(mode),
      onOpenOptions: () => {
        chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS_PAGE' }).catch(() => {});
      },
      onHideTemporarily: () => {},
    });

    pageTranslator.onStatusChange((status) => {
      floatingBall.updateStatus(status);
    });
    floatingBall.updateStatus(pageTranslator.getStatus());

    // Auto-translate domain check (skip if explicitly in neverTranslateDomains)
    const neverTranslate = isDomainInList(window.location.href, settings.neverTranslateDomains);
    const autoTranslate =
      !neverTranslate && isDomainInList(window.location.href, settings.autoTranslateDomains);
    if (autoTranslate) {
      pageTranslator.start();
    }

    // Live-react to settings changes from Popup or Options page
    subscribeSettings((next) => {
      settings = next;
      pageTranslator.updateSettings(next);
      floatingBall.setVisible(next.appearance.showFloatingBall);

      if (isYoutube) {
        if (next.video.enabledYoutube && !ytController) {
          ytController = new YouTubeSubtitleController(next);
        } else if (!next.video.enabledYoutube && ytController) {
          ytController.destroy();
          ytController = null;
        } else {
          ytController?.updateSettings(next);
        }
      }

      if (isX) {
        if (next.video.enabledX && !xController) {
          xController = new XVideoSubtitleController(next);
        } else if (!next.video.enabledX && xController) {
          xController.destroy();
          xController = null;
        } else {
          xController?.updateSettings(next);
        }
      }
    });

    // Listen for Popup / Keyboard Shortcut / Background commands
    chrome.runtime.onMessage.addListener(
      (msg: RuntimeRequest, _sender, sendResponse: (res: unknown) => void) => {
        switch (msg.type) {
          case 'TOGGLE_PAGE_TRANSLATE':
            pageTranslator.toggle();
            sendResponse({ ok: true, state: buildTabState() });
            return false;

          case 'SET_PAGE_DISPLAY_MODE':
            pageTranslator.setDisplayMode(msg.mode);
            sendResponse({ ok: true, state: buildTabState() });
            return false;

          case 'RETRANSLATE_PAGE':
            pageTranslator.retranslate();
            sendResponse({ ok: true, state: buildTabState() });
            return false;

          case 'TOGGLE_VIDEO_SUBTITLE':
            if (ytController) {
              ytController.toggle();
            } else if (xController) {
              xController.toggle();
            }
            sendResponse({ ok: true, state: buildTabState() });
            return false;

          case 'GET_TAB_STATE':
            sendResponse(buildTabState());
            return false;

          default:
            return false;
        }
      },
    );

    function buildTabState(): PageTabState {
      const s = pageTranslator.getStatus();
      return {
        translated: s.active,
        translating: s.translating,
        displayMode: s.displayMode,
        matchedRuleName: s.matchedRuleName,
        translatedCount: s.translatedCount,
        domain: window.location.hostname,
        hasVideo: isYoutube || isX,
        videoPlatform: isYoutube ? 'youtube' : isX ? 'x' : null,
        videoSubtitleActive: ytController?.isActive() ?? xController?.isActive() ?? false,
      };
    }
  },
});
