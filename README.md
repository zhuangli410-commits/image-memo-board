# 图片备忘站

基于原“图片剪贴板”扩展的 macOS 常驻桌面备忘工具。保留截图/复制图片自动进入中转站、粘贴、拖入、复制和拖出功能，并增加多模态备忘、DDL 与桌面迷你组件。

## 初版功能

- 默认位于主屏左下角的迷你时钟与最近 DDL 圆形进度环
- 按住小球任意位置可自定义位置，重启和切换显示器后自动恢复
- 悬停显示“图片中转站”和“待办”入口
- 图片与视频中转站支持批量导入、多文件粘贴、所选项批量导出，以及拖入、复制、拖出、删除和直接创建备忘；图片额外支持 OCR
- 中转卡片沿用 macOS Finder 选择习惯：点击单选、`⌘` 点击增减、`Shift` 连选、空白处拖拽框选和 `⌘A` 全选
- 已选图片可一次批量 OCR，已选图片或视频可一次批量删除并移入系统废纸篓
- `⌘J` 打开苹果原生截屏工具（同时支持 `⌘⇧X` 和系统原生截屏快捷键），截图自动导入中转站
- 图片直接转备忘，或通过 macOS Vision 本地 OCR 后转备忘
- 删除新导入的图片或原生截屏时，中转站副本与原文件会一起移到系统废纸篓
- 文字备忘、语音录音、本地语音文件导入与 macOS Speech 本地转写
- 每项备忘可设置 DDL、提前提醒、完成/超时状态
- 月历 DDL 视图与今日 24 小时时钟视图
- 可配置 DeepSeek API，对 OCR、语音转写或文字进行精简总结
- DeepSeek 可把语音、文字和 OCR 内容拆成多个带优先级、DDL 与提醒的待办；预览确认后才会写入
- 每个待办可从八种高区分度标记颜色中选择；圆环从同一起点叠加显示全部 DDL 的彩色进度弧
- 小球内每 10 秒轮播有 DDL 待办的截止倒计时与颜色圆点
- 悬停小球时显示全部未完成待办的“颜色圆点＋标题”，支持滚轮或滑动横向切换
- 可把图片或视频直接拖到迷你球上吸入中转站，成功后播放一次短暂回弹动画
- DeepSeek API Key 使用 Electron `safeStorage` 接入 macOS 安全存储

## 本地开发

需要 Node.js 18+、npm 和 macOS Command Line Tools。

```bash
npm install
mkdir -p native/bin
xcrun clang -O2 -fobjc-arc -framework Foundation -framework Vision \
  native/src/image-ocr.m -o native/bin/image-ocr
xcrun clang -O2 -fobjc-arc -framework Foundation -framework Speech \
  native/src/speech-transcribe.m -o native/bin/speech-transcribe
npm start
```

## 构建

```bash
npm run check
npm run build:mac
```

Apple Silicon 应用生成在：

```text
dist/mac-arm64/ImageMemoBoard.app
```

## 数据位置

- 图片：`~/Pictures/ImageClipboard/`
- 备忘、设置和录音：`~/Library/Application Support/ImageMemoBoard/`

初版提醒依赖应用在后台运行。窗口收起后应用仍保持运行，可在设置中“完全退出应用”。

## DeepSeek

设置页可修改 API 地址、模型和 API Key。默认使用官方 Chat Completions 地址和 `deepseek-v4-flash`，但不内置任何 Key。发送总结前应用会再次确认。

## License

MIT
