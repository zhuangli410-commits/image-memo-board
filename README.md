# 图片剪贴板

一个 macOS 浮动图片剪贴板工具，截图/复制的图片自动出现在面板，随时单击复制或拖出使用。

<p align="center">
  <img src="docs/screenshot.png" width="300" alt="图片剪贴板界面" />
</p>

## 功能

- **自动捕获截图** — 使用 Mac 自带截图（⌘⇧3/⌘⇧4），图片自动进入面板
- **⌘⇧X 快速截图** — 应用内快捷键，框选截图直接保存
- **⌘V 粘贴** — 将剪贴板中的图片存入面板
- **拖入图片** — 从 Finder 或浏览器拖入图片
- **单击复制** — 点击缩略图上的复制按钮，图片回到剪贴板
- **拖出使用** — 直接把缩略图拖进其他 App
- **浮动置顶** — 窗口始终显示在最上层，切换 App 也不会消失

## 安装

**让 AI 帮你装**：把这个仓库链接发给 Claude Code 并说「帮我安装这个」

**手动安装**：

```bash
git clone https://github.com/zemei641-ship-it/image-clipboard.git
cd image-clipboard
npm install
npm start
```

需要 Node.js 18+ 和 npm。

## 打包为 .app

```bash
npm run build:mac
```

生成文件在 `dist/` 目录，DMG 可直接发给他人安装。

> 注意：未签名应用首次打开需右键 → 打开，或执行：
> ```bash
> xattr -cr /Applications/图片剪贴板.app
> ```

## 截图保存位置

所有图片保存在 `~/Pictures/ImageClipboard/`，可点击工具栏 📁 按钮直接打开。

## 技术栈

- Electron 35
- chokidar（文件监听）
- 原生 macOS clipboard API

## License

MIT
