<div align="center">

# OpenDual 开源双语

**开源、可控、无订阅绑架的 Chrome 双语网页翻译 & YouTube / X 视频字幕插件**

*网页非破坏性双语对照 · YouTube / X 智能断句双语字幕 · 生肉视频一键 AI 字幕 · 本地 Ollama 一等公民*

![Chrome MV3](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?style=flat-square&logo=googlechrome&logoColor=white)
![WXT](https://img.shields.io/badge/Built%20with-WXT%20%2B%20React%2019-10B981?style=flat-square&logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Ollama Ready](https://img.shields.io/badge/Local%20AI-Ollama%20Ready-111827?style=flat-square)
![License: MIT](https://img.shields.io/badge/License-MIT-F59E0B?style=flat-square)

[核心亮点](#-核心亮点) · [视频双语字幕](#-youtube--x-视频双语字幕) · [翻译与语音引擎](#-多引擎自由生态) · [快速开始](#-快速开始) · [快捷键与交互](#️-快捷键与交互) · [技术架构](#️-技术栈与项目结构)

</div>

---

## ✨ 为什么选择 OpenDual？

市面上优秀的双语翻译插件不少，但你是否也遇到过这些痛点：
- 高级引擎和视频字幕功能被锁进**按月付费订阅**，自带 API Key 或本地模型反而受限；
- 强行改写网页 DOM 文本节点，导致 GitHub、X、Reddit、Notion 等现代前端站点**页面错乱甚至崩溃**；
- 看 YouTube 时字幕频频空白（PoToken 拦截）或一句拆成七八段碎词；看 X (Twitter) 上的英文原声生肉视频更是**完全没有字幕**；
- 想用本地 **Ollama** 保护隐私，却被浏览器的 `HTTP 403 CORS` 报错劝退，还要手动改系统环境变量。

**OpenDual** 正是为此而生——**完全开源、策略透明、所有 Key 与配置由你掌控**，把网页深度阅读与视频双语字幕打磨到真正顺手。

---

## 🚀 核心亮点

### 🌐 网页非破坏性双语翻译
- **零侵入式 DOM 注入**：通过自定义 `<x-trans-wrap>` 容器挂载译文，不篡改原始文本节点，安全兼容 React / Vue Hydration；按 `Alt + A` 在 **双语对照 / 仅译文 / 恢复原文** 之间顺滑切换。
- **行内格式保真 & 零 `innerHTML` 防 XSS**：段落内的超链接 `<a>`、加粗 `<strong>`、行内代码 `<code>`、数学公式（`.katex` / `.MathJax`）自动编码为 `<g>` / `<v/>` 占位符，译后以纯 `createTextNode` + `cloneNode` 安全重建。
- **内置 12 套主流站点精细排版规则**：
  - **社区与资讯**：X (Twitter)、Reddit（支持穿透新版 `shreddit-*` Shadow DOM）、Hacker News、YouTube（页面与评论区）
  - **开发与学术**：GitHub、Stack Overflow / Stack Exchange、MDN / React / Python Docs / ArXiv HTML、Wikipedia
  - **长文与协作**：Medium / Substack / Dev.to、BBC / NYTimes / Reuters / TechCrunch / The Verge、Gmail、Discord / Notion
  - 支持编写 **自定义 JSON 站点规则** 自由覆写与扩展。
- **为高频阅读而生的细节体验**：
  - `IntersectionObserver` 视口优先懒加载 + 逐块语种检测（中英混排自动跳过中文）；
  - **7 套双语阅读主题**（默认柔和 / 下划线 / 虚线 / 渐变高亮 / 引用竖线 / **模糊学习模式**（悬停揭晓译文）/ 弱化原文）+ 自定义 CSS；
  - 边缘悬浮球 + 修饰键（默认 `Alt`）悬停单段翻译 + 自定义术语表 + Dexie IndexedDB 本地缓存（默认 7 天）。

---

### 🎬 YouTube & X 视频双语字幕

#### YouTube 原生级双语字幕
- **原生规避 PoToken 空响应**：通过 MV3 `world: "MAIN"`（`document_start`）脚本旁路镜像播放器自身发出的 `/api/timedtext` 请求，天然携带合法 PoToken；完整支持标准页、剧场模式、全屏与 Shorts。
- **三阶段智能断句与时间轴重组**：解析 YouTube `json3` 词级时间戳与 WebVTT，自动分离 `[Music]` 等非人声标注、将碎片化自动字幕合并为完整意群、按停顿/标点/阅读速度（CPS）智能切分，并可选开启 **LLM 语义重断句** 精准回映词级时间戳。
- **播放游标滑动窗口调度**：优先翻译 `[currentTime - 5s, currentTime + 90s]`（首句秒出），附带视频标题元信息与前 3 句只读上下文，拖拽进度条即时中断过期预取；支持**悬停暂停、自由拖拽字幕位置、一键导出双语 `.srt`**。

#### X (Twitter) 双层级字幕引擎
| 层级 | 适用场景 | 核心能力 |
| :--- | :--- | :--- |
| **Tier 1 · 零费用原生字幕** | 自带字幕 / 外挂字幕的视频 | 拦截 GraphQL 元数据与 `video.twimg.com` `.m3u8` / `.vtt`，按 Tweet ID / Poster Media ID 精确绑定虚拟滚动列表中的视频，**不串台、不泄漏** |
| **Tier 2 · 生肉一键 AI 字幕** | 无字幕英文/外语原声视频 | 直取低码率 MP4 音频流（长视频经 Offscreen Document 重采样为 16kHz 单声道 WAV 60s 切片），接入 Whisper 转写后无缝送入智能断句与双语翻译管线并缓存 |

---

### ⚡ 多引擎自由生态

不绑架任何单一服务商——从**零配置免费引擎**、**纯离线本地大模型**到**商业 API** 全面打通，支持网页与视频字幕**独立指定引擎**：

| 类别 | 已内置 / 预设支持 | 专属工程优化 |
| :--- | :--- | :--- |
| **开箱即用免费** | Microsoft Edge 免费翻译、Google 免费翻译、Chrome 138+ 端侧内置 `Translator` API | 免费引擎间支持**自动降级链**与指数退避重试，稳如磐石 |
| **本地 AI 一等公民** | **Ollama**、LM Studio、vLLM / SGLang、本地 Faster-Whisper / Whisper.cpp | 内置 MV3 `declarativeNetRequest` 自动改写本地 `Origin` 头，**免改环境变量根治 Ollama 403 CORS**；一键拉取 `/api/tags` 模型列表、原生 `/api/chat`（禁用思考标签 + `keep_alive`）、并发=1 显存保护与 Port 长连接保活 |
| **主流商业 & 聚合 API** | DeepSeek、OpenAI、Anthropic Claude、硅基流动 (SiliconFlow)、OpenRouter、Groq Cloud、Google Gemini、DeepLX、任意 OpenAI-Compatible 接口 | DeepSeek 固定静态 System Prompt 前缀吃满 **Context Caching** 降本并自动过滤 `reasoning_content`；结构化 JSON 响应缺失条目支持**二分自愈重试** |
| **生肉视频 ASR** | Groq Whisper（`whisper-large-v3-turbo`，约 100x 实时速度）、OpenAI Whisper、本地 Faster-Whisper | 支持 `verbose_json` 词级时间戳，3 分钟视频数秒完成转写 |

---

## 📦 快速开始

> 当前为开发者源码构建模式，克隆后 1 分钟即可在 Chrome 中加载体验。

### 环境要求
- Node.js `>= 20`
- Chrome / Edge / Brave 等 Chromium 内核浏览器（支持 Manifest V3）

### 本地构建与安装

```bash
# 1. 克隆仓库
git clone https://github.com/loopglint/OpenDual.git
cd OpenDual

# 2. 安装依赖
npm install

# 3. 类型检查与单元测试
npm run typecheck
npm test

# 4. 构建 Chrome MV3 扩展产物
npm run build
```

构建完成后，在浏览器中加载扩展：
1. 地址栏输入 `chrome://extensions/` 并回车；
2. 打开右上角 **开发者模式（Developer mode）**；
3. 点击左上角 **加载已解压的扩展程序（Load unpacked）**；
4. 选择项目生成的 `.output/chrome-mv3` 目录，即可立即使用！

---

## ⌨️ 快捷键与交互

| 操作 | 功能说明 |
| :--- | :--- |
| `Alt + A` | 一键开启 / 关闭当前网页双语翻译 |
| 按住 `Alt` + 鼠标悬停段落 | 仅翻译鼠标指向的单个段落（可在设置中自定义修饰键） |
| 页面边缘悬浮球 | 快捷切换「双语对照 / 仅译文 / 原文」与快捷打开设置 |
| 视频字幕浮层 | 支持悬停自动暂停、上下位置拖拽、切换译文在上/原文在上、一键导出双语 `.srt` |
| 扩展图标 → **设置** | 配置 Ollama / DeepSeek / OpenAI / Groq Whisper、7 种双语主题、术语表与自定义站点规则 |

---

## 🏗️ 技术栈与项目结构

- **核心框架**：[WXT](https://wxt.dev/) (Chrome Manifest V3) · React 19 · TypeScript 5.8 · Tailwind CSS v4
- **数据与测试**：Dexie (IndexedDB 缓存) · Lucide React · Vitest + Happy DOM

```text
OpenDual/
├── entrypoints/
│   ├── background.ts              # MV3 Service Worker：引擎调度、DNR CORS 修正与 Port 长连接
│   ├── content.ts                 # 网页双语翻译主入口与站点规则执行
│   ├── youtube-main.content.ts    # MAIN world YouTube /api/timedtext 镜像拦截
│   ├── x-main.content.ts          # MAIN world X GraphQL 与视频流/字幕元数据捕获
│   ├── offscreen/                 # Offscreen Document：长视频音频 16kHz WAV 切片重采样
│   ├── popup/                     # 扩展弹窗控制面板
│   └── options/                   # 完整配置中心（引擎、主题、字幕、术语表、站点规则）
├── src/
│   ├── core/
│   │   ├── dom/                   # 文本提取、行内标签编解码、语种检测、7 套双语主题
│   │   ├── engines/               # Edge/Google/Chrome/Ollama/DeepSeek/OpenAI/Claude/DeepLX 适配与降级链
│   │   ├── rules/                 # 12 套内置主流站点规则与匹配器
│   │   ├── video/                 # YouTube & X 字幕控制、三阶段智能断句、滑动窗口翻译、Whisper ASR、SRT 导出
│   │   ├── cache/                 # Dexie IndexedDB 翻译与字幕缓存
│   │   ├── network/               # DNR 本地 CORS 规则与按需权限管理
│   │   └── scheduler/             # 并发限流与任务调度队列
│   └── ui/                        # 页面边缘悬浮球组件
└── tests/                         # Vitest 单元测试
```

---

## 📄 开源协议

本项目基于 [MIT License](./LICENSE) 开源，欢迎自由使用、修改与分发。

---

## 🤝 参与贡献

欢迎提交 Issue 反馈新站点排版适配需求、Bug 或功能建议，也欢迎直接发起 Pull Request 共建开源双语阅读体验！

如果 **OpenDual** 对你有帮助，欢迎点亮一颗 ⭐ **Star** 支持项目发展！
