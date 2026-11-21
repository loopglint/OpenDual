import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [tailwindcss()],
    build: {
      sourcemap: false,
    },
  }),
  manifest: {
    name: 'OpenDual 开源双语 (Web & YouTube / X 字幕)',
    short_name: 'OpenDual',
    description:
      'OpenDual 开源双语 — 开源可控的 Chrome 双语网页翻译与 YouTube/X 视频字幕插件，支持生肉视频 AI 字幕、免费在线引擎、本地 Ollama、DeepSeek、OpenAI 及自定义 API。',
    version: '1.0.0',
    default_locale: 'zh_CN',
    icons: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
      48: 'icons/icon-48.png',
      128: 'icons/icon-128.png',
    },
    action: {
      default_title: 'OpenDual 开源双语 (Alt+A 切换当前页翻译)',
      default_icon: {
        16: 'icons/icon-16.png',
        32: 'icons/icon-32.png',
        48: 'icons/icon-48.png',
      },
    },
    permissions: [
      'storage',
      'declarativeNetRequest',
      'activeTab',
      'offscreen',
      'tabCapture',
    ],
    host_permissions: [
      'https://edge.microsoft.com/*',
      'https://api-edge.cognitive.microsofttranslator.com/*',
      'https://translate.googleapis.com/*',
      'https://api.deepseek.com/*',
      'https://api.openai.com/*',
      'https://api.anthropic.com/*',
      'https://api.groq.com/*',
      'https://api.siliconflow.cn/*',
      'https://openrouter.ai/*',
      'https://generativelanguage.googleapis.com/*',
      'https://video.twimg.com/*',
      'https://*.twimg.com/*',
      'http://localhost/*',
      'http://127.0.0.1/*',
    ],
    optional_host_permissions: ['https://*/*', 'http://*/*'],
    commands: {
      'toggle-page-translate': {
        suggested_key: {
          default: 'Alt+A',
          mac: 'Alt+A',
        },
        description: '一键开启/关闭当前网页双语翻译',
      },
    },
  },
});
