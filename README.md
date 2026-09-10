# 图片备忘站 ImageMemoBoard

<p align="center">
  <img src="docs/screenshot.png" width="420" alt="图片备忘站界面" />
</p>

一款 macOS 常驻桌面的效率工具：**图片/视频中转站 + 多模态备忘录 + DDL 日程管理** 三合一。以一颗浮窗小球为入口，截图自动进站、语音一键转备忘、AI 拆解待办、DDL 彩色进度环常驻桌面。

> 🙌 本项目基于 [zemei641-ship-it/image-staging-board](https://github.com/zemei641-ship-it/image-staging-board)（原"图片剪贴板"）深度改造而来，在原图片中转能力之上新增了备忘录、DDL 日程、语音转写与 AI 待办拆分等模块。感谢原作者的出色底子。

## ✨ 核心功能

### 🖼 图片/视频中转站

- 截图（`⌘J` / `⌘⇧X` / 系统原生快捷键）与复制的图片自动进入中转站
- 支持粘贴、拖入、批量导入、多文件粘贴
- Finder 式选择习惯：单击单选、`⌘` 点击增减、`Shift` 连选、空白处拖拽框选、`⌘A` 全选
- 所选项批量导出、批量删除（连同原文件一起移入系统废纸篓）、拖出即用
- 图片可经 macOS Vision 本地 OCR，一键转为文字备忘
- 图片/视频直接拖到浮窗小球上即可吸入中转站，带回弹动画反馈

### 📝 多模态备忘录

- 文字备忘、语音录音、本地语音文件导入
- macOS Speech 本地转写，语音变文字全程不出本机
- 图片直接转备忘，或 OCR 后转备忘
- 悬停小球即可在"图片中转站"和"待办"之间切换

### 🗓 DDL 日程管理

- 每项备忘可设置 DDL、提前提醒、完成/超时状态
- 月历 DDL 视图 + 今日 24 小时时钟视图
- 八种高区分度标记颜色，圆环叠加显示全部 DDL 的彩色进度弧
- 小球内每 10 秒轮播最近 DDL 倒计时与颜色圆点
- 悬停小球显示全部未完成待办，滚轮/滑动横向切换

### 🤖 DeepSeek AI 智能拆解

- 可配置 DeepSeek API，对 OCR、语音转写或文字内容进行精简总结
- AI 把语音、文字、OCR 内容拆成多个带优先级、DDL 与提醒的待办
- 预览确认后才会写入，AI 不越权
- API Key 通过 Electron `safeStorage` 接入 macOS 安全存储，不内置任何 Key

### 🎛 浮窗小球

- 默认位于主屏左下角，按住可自定义位置，重启/切换显示器后自动恢复
- 迷你时钟 + 最近 DDL 圆形进度环常驻桌面

## 🛠 本地开发

需要 Node.js 18+、npm 和 macOS Command Line Tools。

```bash
npm install

# 编译原生 OCR / 语音转写工具
mkdir -p native/bin
xcrun clang -O2 -fobjc-arc -framework Foundation -framework Vision \
  native/src/image-ocr.m -o native/bin/image-ocr
xcrun clang -O2 -fobjc-arc -framework Foundation -framework Speech \
  native/src/speech-transcribe.m -o native/bin/speech-transcribe

# 运行
npm start
```

## 📦 构建

```bash
npm run check      # 语法检查
npm test           # 单元测试（11 个）
npm run build:mac  # macOS Apple Silicon
npm run build:win  # Windows x64
```

Apple Silicon 应用生成在：

```text
dist/mac-arm64/ImageMemoBoard.app
```

## 📍 数据位置

- 图片：`~/Pictures/ImageClipboard/`
- 备忘、设置和录音：`~/Library/Application Support/ImageMemoBoard/`

提醒功能依赖应用在后台运行。窗口收起后应用仍保持运行，可在设置中"完全退出应用"。

## 🔐 隐私说明

- 图片、备忘、录音全部本地存储
- OCR 与语音转写使用 macOS 系统能力，离线可用
- 唯一可选的联网功能是 DeepSeek 总结/拆解，Key 由用户自行配置，明文不落盘

## License

MIT
