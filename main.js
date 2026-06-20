const { app, BrowserWindow, globalShortcut, ipcMain, nativeImage, shell, clipboard } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { exec } = require('child_process')
const crypto = require('crypto')

const CLIPBOARD_DIR = path.join(os.homedir(), 'Pictures', 'ImageClipboard')
fs.mkdirSync(CLIPBOARD_DIR, { recursive: true })

let mainWindow
let lastClipboardHash = null
let lastClipboardSize = null

function getImageHash(img) {
  return crypto.createHash('md5').update(img.toPNG()).digest('hex')
}

function startClipboardWatcher() {
  const existing = clipboard.readImage()
  if (!existing.isEmpty()) {
    lastClipboardHash = getImageHash(existing)
    lastClipboardSize = existing.getSize()
  }

  setInterval(() => {
    try {
      const img = clipboard.readImage()
      if (img.isEmpty()) return
      const size = img.getSize()
      // cheap size pre-check before the expensive toPNG
      if (lastClipboardSize && size.width === lastClipboardSize.width && size.height === lastClipboardSize.height) {
        const pngBytes = img.toPNG()
        const hash = crypto.createHash('md5').update(pngBytes).digest('hex')
        if (hash === lastClipboardHash) return
        lastClipboardHash = hash
        lastClipboardSize = size
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
        fs.writeFileSync(path.join(CLIPBOARD_DIR, `${ts}.png`), pngBytes)
      } else {
        // size changed → definitely new image, no need for hash comparison
        const pngBytes = img.toPNG()
        lastClipboardHash = crypto.createHash('md5').update(pngBytes).digest('hex')
        lastClipboardSize = size
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
        fs.writeFileSync(path.join(CLIPBOARD_DIR, `${ts}.png`), pngBytes)
      }
    } catch {}
  }, 1500)
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 300,
    height: 520,
    alwaysOnTop: true,
    frame: false,
    transparent: true,
    resizable: true,
    minWidth: 240,
    minHeight: 300,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true
    }
  })
  mainWindow.loadFile('renderer/index.html')
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  mainWindow.on('closed', () => { mainWindow = null })
}

app.whenReady().then(() => {
  createWindow()
  startClipboardWatcher()

  const chokidar = require('chokidar')
  chokidar.watch(CLIPBOARD_DIR, { ignoreInitial: true })
    .on('add', fp => {
      if (/\.(png|jpg|jpeg|gif|webp)$/i.test(fp) && mainWindow && !mainWindow.isDestroyed())
        mainWindow.webContents.send('file-added', fp)
    })
    .on('unlink', fp => {
      if (mainWindow && !mainWindow.isDestroyed())
        mainWindow.webContents.send('file-removed', fp)
    })

  // Watch the macOS screenshot save folder (default: Desktop)
  let screenshotDir
  try {
    const out = require('child_process').execSync('defaults read com.apple.screencapture location 2>/dev/null', { encoding: 'utf8' }).trim()
    screenshotDir = (out && fs.existsSync(out)) ? out : path.join(os.homedir(), 'Desktop')
  } catch {
    screenshotDir = path.join(os.homedir(), 'Desktop')
  }
  if (screenshotDir !== CLIPBOARD_DIR) {
    chokidar.watch(screenshotDir, { ignoreInitial: true, depth: 0 })
      .on('add', fp => {
        if (!/\.(png|jpg|jpeg)$/i.test(fp)) return
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
        const dest = path.join(CLIPBOARD_DIR, `${ts}${path.extname(fp)}`)
        try { fs.copyFileSync(fp, dest) } catch {}
      })
  }

  globalShortcut.register('CommandOrControl+Shift+X', () => {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    exec(`screencapture -i "${path.join(CLIPBOARD_DIR, ts + '.png')}"`)
  })
})

app.on('activate', () => {
  if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.restore() }
  else createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => globalShortcut.unregisterAll())

ipcMain.handle('list-images', () => {
  try {
    return fs.readdirSync(CLIPBOARD_DIR)
      .filter(f => /\.(png|jpg|jpeg|gif|webp)$/i.test(f))
      .map(f => {
        const fp = path.join(CLIPBOARD_DIR, f)
        return { name: f, path: fp, mtime: fs.statSync(fp).mtime.getTime() }
      })
      .sort((a, b) => b.mtime - a.mtime)
  } catch { return [] }
})

ipcMain.handle('save-dropped', (_, srcPath) => {
  const ext = path.extname(srcPath) || '.png'
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const dest = path.join(CLIPBOARD_DIR, `${ts}${ext}`)
  fs.copyFileSync(srcPath, dest)
  return dest
})

ipcMain.handle('paste-clipboard', () => {
  const img = clipboard.readImage()
  if (!img.isEmpty()) {
    const pngBytes = img.toPNG()
    lastClipboardHash = crypto.createHash('md5').update(pngBytes).digest('hex')
    lastClipboardSize = img.getSize()
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const dest = path.join(CLIPBOARD_DIR, `${ts}.png`)
    fs.writeFileSync(dest, pngBytes)
    return dest
  }
  return null
})

ipcMain.handle('copy-to-clipboard', (_, fp) => {
  const img = nativeImage.createFromPath(fp)
  if (!img.isEmpty()) {
    const pngBytes = img.toPNG()
    lastClipboardHash = crypto.createHash('md5').update(pngBytes).digest('hex')
    lastClipboardSize = img.getSize()
    clipboard.writeImage(img)
  }
})

ipcMain.handle('delete-image', (_, fp) => {
  try { fs.unlinkSync(fp) } catch {}
})

ipcMain.handle('save-from-buffer', (_, bufArray, mime) => {
  const ext = mime.split('/')[1]?.replace('jpeg', 'jpg') || 'png'
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const dest = path.join(CLIPBOARD_DIR, `${ts}.${ext}`)
  fs.writeFileSync(dest, Buffer.from(bufArray))
  return dest
})

ipcMain.handle('save-from-url', (_, url) => {
  return new Promise((resolve, reject) => {
    const https = require('https')
    const http = require('http')
    const ext = (url.match(/\.(png|jpg|jpeg|gif|webp)/i) || ['', 'png'])[1]
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const dest = path.join(CLIPBOARD_DIR, `${ts}.${ext}`)
    const client = url.startsWith('https') ? https : http
    client.get(url, res => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => { fs.writeFileSync(dest, Buffer.concat(chunks)); resolve(dest) })
    }).on('error', reject)
  })
})

ipcMain.handle('open-folder', () => shell.openPath(CLIPBOARD_DIR))

ipcMain.on('drag-out', (event, fp) => {
  const img = nativeImage.createFromPath(fp)
  if (img.isEmpty()) return
  event.sender.startDrag({ file: fp, icon: img.resize({ width: 64, height: 64 }) })
})

ipcMain.on('close-window', () => mainWindow && mainWindow.close())
ipcMain.on('minimize-window', () => mainWindow && mainWindow.minimize())
