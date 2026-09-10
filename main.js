const {
  app,
  BrowserWindow,
  Notification,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  nativeImage,
  net,
  protocol,
  safeStorage,
  screen,
  session,
  shell,
  systemPreferences
} = require('electron')
const { execFile, execFileSync } = require('child_process')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { Readable } = require('stream')
const { pathToFileURL } = require('url')

app.setName('ImageMemoBoard')
protocol.registerSchemesAsPrivileged([{
  scheme: 'imagememo',
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: false
  }
}])
if (process.env.IMAGE_MEMO_DEV_USER_DATA) {
  app.setPath('userData', path.resolve(process.env.IMAGE_MEMO_DEV_USER_DATA))
}

const startupLogFile = path.join(app.getPath('userData'), 'startup.log')
function startupLog(message) {
  try {
    fs.mkdirSync(path.dirname(startupLogFile), { recursive: true })
    if (fs.existsSync(startupLogFile) && fs.statSync(startupLogFile).size > 128 * 1024) {
      fs.writeFileSync(startupLogFile, '')
    }
    fs.appendFileSync(startupLogFile, `${new Date().toISOString()} ${message}\n`, { mode: 0o600 })
  } catch {}
}

startupLog(`launch packaged=${app.isPackaged} pid=${process.pid} exec=${process.execPath}`)
const hasSingleInstanceLock = app.requestSingleInstanceLock()
startupLog(`single-instance-lock=${hasSingleInstanceLock}`)
if (!hasSingleInstanceLock) {
  startupLog('quit: another instance owns the lock')
  app.quit()
}

const CLIPBOARD_DIR = path.join(os.homedir(), 'Pictures', 'ImageClipboard')
const NATIVE_SCREENSHOT_APP = '/System/Applications/Utilities/Screenshot.app'
const IMAGE_EXT_RE = /\.(png|jpg|jpeg|gif|webp)$/i
const VIDEO_EXT_RE = /\.(mp4|mov|m4v|webm|mkv|avi)$/i
const MEDIA_EXT_RE = /\.(png|jpg|jpeg|gif|webp|mp4|mov|m4v|webm|mkv|avi)$/i
const AUDIO_EXT_RE = /\.(m4a|mp3|ogg|wav|webm|aac|aif|aiff|flac)$/i
const SCREENSHOT_NAME_RE = /^(截屏|屏幕快照|Screenshot|Screen Shot)[\s\d_-]/i
const DEFAULT_MEMO_COLOR = '#5b9cf6'
const MEMO_COLOR_PALETTE = [
  '#5b9cf6',
  '#ff453a',
  '#ff9f0a',
  '#ffd60a',
  '#30d158',
  '#32c7d9',
  '#bf5af2',
  '#ff4fa3'
]
const WINDOW_SIZES = {
  mini: { width: 64, height: 64 },
  hover: { width: 410, height: 64 },
  panel: { width: 380, height: 640 }
}
const EDGE_DOCK_SNAP_DISTANCE = 18
const EDGE_DOCK_VISIBLE_WIDTH = 14

fs.mkdirSync(CLIPBOARD_DIR, { recursive: true })

let mainWindow
let windowMode = 'mini'
let lastClipboardHash = null
let lastClipboardSize = null
let memoFile
let settingsFile
let imageOriginFile
let audioDir
let reminderTimer
let visibilityTimer
let clipboardTimer
let shortcutStatus = { commandJ: false, legacy: false }
let pendingPanelOpen = false
let positionSaveTimer
let positionSaveSuppressed = false
let positionSuppressTimer
let hoverPlacement = 'right'
let imageWatchers = []
let quitting = false
let widgetDrag = null
let widgetDragTimer = null
let hoverHasTasks = false
let widgetDockSide
let windowMotionTimer = null
let hoverMonitorTimer = null
let hoverOutsideSince = null

function uniqueName(ext = '.png') {
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  return `${ts}-${crypto.randomBytes(3).toString('hex')}${ext.toLowerCase()}`
}

function isInside(baseDir, targetPath) {
  const base = `${path.resolve(baseDir)}${path.sep}`
  return path.resolve(targetPath).startsWith(base)
}

function isImagePath(filePath) {
  return typeof filePath === 'string' && IMAGE_EXT_RE.test(filePath)
}

function isVideoPath(filePath) {
  return typeof filePath === 'string' && VIDEO_EXT_RE.test(filePath)
}

function isMediaPath(filePath) {
  return typeof filePath === 'string' && MEDIA_EXT_RE.test(filePath)
}

function internalMediaUrl(filePath) {
  return `imagememo://media/file?path=${encodeURIComponent(path.resolve(filePath))}`
}

function contentTypeFor(filePath) {
  if (path.extname(filePath).toLowerCase() === '.webm') {
    return audioDir && isInside(audioDir, filePath) ? 'audio/webm' : 'video/webm'
  }
  return {
    '.css': 'text/css; charset=utf-8',
    '.gif': 'image/gif',
    '.html': 'text/html; charset=utf-8',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.js': 'text/javascript; charset=utf-8',
    '.m4a': 'audio/mp4',
    '.m4v': 'video/mp4',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.mkv': 'video/x-matroska',
    '.avi': 'video/x-msvideo',
    '.aac': 'audio/aac',
    '.aif': 'audio/aiff',
    '.aiff': 'audio/aiff',
    '.flac': 'audio/flac',
    '.ogg': 'audio/ogg',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.wav': 'audio/wav',
    '.webp': 'image/webp'
  }[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
}

function registerInternalProtocol() {
  const rendererDir = path.resolve(__dirname, 'renderer')
  protocol.handle('imagememo', request => {
    try {
      const url = new URL(request.url)
      startupLog(`protocol-request host=${url.hostname} path=${cleanText(url.pathname, 160)}`)
      let filePath
      if (url.hostname === 'app') {
        const relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html'
        filePath = path.resolve(rendererDir, relativePath)
        if (filePath !== rendererDir && !isInside(rendererDir, filePath)) {
          return new Response('Forbidden', { status: 403 })
        }
      } else if (url.hostname === 'media') {
        filePath = path.resolve(url.searchParams.get('path') || '')
        if (!MEDIA_EXT_RE.test(filePath) && !AUDIO_EXT_RE.test(filePath)) {
          return new Response('Forbidden', { status: 403 })
        }
      } else {
        return new Response('Not Found', { status: 404 })
      }
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        startupLog(`protocol-not-found file=${cleanText(filePath, 240)}`)
        return new Response('Not Found', { status: 404 })
      }
      startupLog(`protocol-response file=${cleanText(filePath, 240)}`)
      const stat = fs.statSync(filePath)
      const commonHeaders = {
        'Content-Type': contentTypeFor(filePath),
        'Cache-Control': 'no-store'
      }
      if (url.hostname === 'media') {
        const range = request.headers.get('range')
        if (range) {
          const match = /^bytes=(\d*)-(\d*)$/i.exec(range)
          if (!match) return new Response(null, { status: 416 })
          let start = match[1] ? Number(match[1]) : 0
          let end = match[2] ? Number(match[2]) : stat.size - 1
          if (!match[1] && match[2]) {
            start = Math.max(0, stat.size - Number(match[2]))
            end = stat.size - 1
          }
          if (
            !Number.isSafeInteger(start) ||
            !Number.isSafeInteger(end) ||
            start < 0 ||
            start >= stat.size ||
            end < start
          ) {
            return new Response(null, {
              status: 416,
              headers: { 'Content-Range': `bytes */${stat.size}` }
            })
          }
          end = Math.min(end, stat.size - 1)
          return new Response(Readable.toWeb(fs.createReadStream(filePath, { start, end })), {
            status: 206,
            headers: {
              ...commonHeaders,
              'Accept-Ranges': 'bytes',
              'Content-Length': String(end - start + 1),
              'Content-Range': `bytes ${start}-${end}/${stat.size}`
            }
          })
        }
        return new Response(
          request.method === 'HEAD' ? null : Readable.toWeb(fs.createReadStream(filePath)),
          {
            headers: {
              ...commonHeaders,
              'Accept-Ranges': 'bytes',
              'Content-Length': String(stat.size)
            }
          }
        )
      }
      return new Response(fs.readFileSync(filePath), {
        headers: commonHeaders
      })
    } catch (error) {
      startupLog(`protocol-error ${cleanText(error?.message || error, 300)}`)
      return new Response('Bad Request', { status: 400 })
    }
  })
}

function mediaInfo(filePath) {
  const stat = fs.statSync(filePath)
  const origins = loadImageOrigins()
  const originalPath = origins[path.resolve(filePath)]
  return {
    name: path.basename(filePath),
    path: filePath,
    url: internalMediaUrl(filePath),
    kind: isVideoPath(filePath) ? 'video' : 'image',
    mtime: stat.mtime.getTime(),
    hasOriginal: Boolean(originalPath && fs.existsSync(originalPath))
  }
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${process.pid}.tmp`
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 })
  fs.renameSync(temporary, filePath)
}

function loadImageOrigins() {
  if (!imageOriginFile) return {}
  const data = readJson(imageOriginFile, { version: 1, origins: {} })
  return data.origins && typeof data.origins === 'object' ? data.origins : {}
}

function rememberImageOrigin(destination, source) {
  if (!imageOriginFile || !source || path.resolve(destination) === path.resolve(source)) return
  const origins = loadImageOrigins()
  origins[path.resolve(destination)] = path.resolve(source)
  writeJsonAtomic(imageOriginFile, { version: 1, origins })
}

function forgetImageOrigin(destination) {
  if (!imageOriginFile) return null
  const origins = loadImageOrigins()
  const key = path.resolve(destination)
  const source = origins[key] || null
  if (Object.hasOwn(origins, key)) {
    delete origins[key]
    writeJsonAtomic(imageOriginFile, { version: 1, origins })
  }
  return source
}

function imageOrigin(destination) {
  return loadImageOrigins()[path.resolve(destination)] || null
}

function importMediaFile(sourcePath) {
  if (!isMediaPath(sourcePath) || !fs.existsSync(sourcePath)) {
    throw new Error('不是可用的图片或视频文件')
  }
  const stat = fs.statSync(sourcePath)
  if (!stat.isFile()) throw new Error('不是可用的图片或视频文件')
  const destination = path.join(
    CLIPBOARD_DIR,
    uniqueName(path.extname(sourcePath) || '.png')
  )
  fs.copyFileSync(sourcePath, destination)
  rememberImageOrigin(destination, sourcePath)
  return mediaInfo(destination)
}

async function trashMediaFile(filePath) {
  if (!isInside(CLIPBOARD_DIR, filePath) || !fs.existsSync(filePath)) return null
  const originalPath = imageOrigin(filePath)
  let originalTrashed = false
  if (
    originalPath &&
    fs.existsSync(originalPath) &&
    !isInside(CLIPBOARD_DIR, originalPath)
  ) {
    await shell.trashItem(originalPath)
    originalTrashed = true
  }
  await shell.trashItem(filePath)
  forgetImageOrigin(filePath)
  return { success: true, originalTrashed }
}

function availableExportPath(directory, preferredName) {
  const parsed = path.parse(preferredName)
  let candidate = path.join(directory, preferredName)
  let index = 2
  while (fs.existsSync(candidate)) {
    candidate = path.join(directory, `${parsed.name} ${index}${parsed.ext}`)
    index += 1
  }
  return candidate
}

function decodeClipboardFileUrl(value) {
  try {
    const url = new URL(String(value).replace(/\0/g, '').trim())
    return url.protocol === 'file:' ? decodeURIComponent(url.pathname) : null
  } catch {
    return null
  }
}

function clipboardFilePaths() {
  const candidates = []
  if (process.platform === 'darwin') {
    const filenames = clipboard.readBuffer('NSFilenamesPboardType')
    if (filenames.length) {
      try {
        const output = execFileSync(
          '/usr/bin/plutil',
          ['-convert', 'json', '-o', '-', '--', '-'],
          { input: filenames, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }
        )
        const values = JSON.parse(output)
        if (Array.isArray(values)) candidates.push(...values)
      } catch {}
    }
    for (const format of ['public.file-url', 'text/uri-list']) {
      const value = clipboard.readBuffer(format).toString('utf8')
      for (const line of value.split(/[\r\n]+/)) {
        const filePath = decodeClipboardFileUrl(line)
        if (filePath) candidates.push(filePath)
      }
    }
  }
  return [...new Set(candidates.map(value => path.resolve(String(value))))]
    .filter(filePath => fs.existsSync(filePath))
}

function clipboardMediaPaths() {
  return clipboardFilePaths().filter(isMediaPath)
}

function loadMemos() {
  const data = readJson(memoFile, { version: 1, memos: [] })
  return Array.isArray(data.memos) ? data.memos : []
}

function saveMemos(memos) {
  writeJsonAtomic(memoFile, { version: 1, memos })
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('memos-changed')
  }
}

function publicMemo(memo) {
  return {
    ...memo,
    mediaKind: isVideoPath(memo.imagePath) ? 'video' : 'image',
    imageUrl: memo.imagePath && fs.existsSync(memo.imagePath)
      ? internalMediaUrl(memo.imagePath)
      : null,
    audioUrl: memo.audioPath && fs.existsSync(memo.audioPath)
      ? internalMediaUrl(memo.audioPath)
      : null
  }
}

function cleanText(value, maxLength = 100000) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function normalizeDueAt(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function normalizeMemoColor(value, fallback = DEFAULT_MEMO_COLOR) {
  const normalized = typeof value === 'string' ? value.toLowerCase() : ''
  if (MEMO_COLOR_PALETTE.includes(normalized)) return normalized
  const normalizedFallback = typeof fallback === 'string' ? fallback.toLowerCase() : ''
  return MEMO_COLOR_PALETTE.includes(normalizedFallback)
    ? normalizedFallback
    : DEFAULT_MEMO_COLOR
}

function saveMemo(input) {
  const memos = loadMemos()
  const now = new Date().toISOString()
  const existingIndex = input.id ? memos.findIndex(item => item.id === input.id) : -1
  const existing = existingIndex >= 0 ? memos[existingIndex] : null
  const dueAt = normalizeDueAt(input.dueAt)
  const remindMinutes = Math.max(0, Math.min(10080, Number(input.remindMinutes) || 0))
  const reminderAt = dueAt
    ? new Date(new Date(dueAt).getTime() - remindMinutes * 60000).toISOString()
    : null
  const imagePath = isMediaPath(input.imagePath) && fs.existsSync(input.imagePath)
    ? path.resolve(input.imagePath)
    : existing?.imagePath || null
  const audioPath = typeof input.audioPath === 'string' && fs.existsSync(input.audioPath)
    ? path.resolve(input.audioPath)
    : existing?.audioPath || null

  const memo = {
    id: existing?.id || crypto.randomUUID(),
    parentId: cleanText(input.parentId, 80) || existing?.parentId || null,
    type: ['image', 'video', 'text', 'voice', 'ocr', 'summary'].includes(input.type)
      ? input.type
      : existing?.type || 'text',
    title: cleanText(input.title, 120) || '未命名备忘',
    content: cleanText(input.content),
    imagePath,
    audioPath,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    dueAt,
    remindMinutes,
    reminderAt,
    priority: ['high', 'medium', 'low'].includes(input.priority)
      ? input.priority
      : existing?.priority || 'medium',
    color: normalizeMemoColor(input.color, existing?.color || DEFAULT_MEMO_COLOR),
    completedAt: existing?.completedAt || null,
    notifiedAt: existing?.dueAt === dueAt && existing?.reminderAt === reminderAt
      ? existing.notifiedAt || null
      : null
  }

  if (existingIndex >= 0) memos[existingIndex] = memo
  else memos.push(memo)
  saveMemos(memos)
  return publicMemo(memo)
}

function getSettings() {
  return readJson(settingsFile, {
    version: 1,
    deepseek: {
      endpoint: 'https://api.deepseek.com/chat/completions',
      model: 'deepseek-v4-flash',
      encryptedKey: null
    }
  })
}

function saveSettings(settings) {
  writeJsonAtomic(settingsFile, settings)
}

function getDeepSeekKey(settings) {
  const encrypted = settings?.deepseek?.encryptedKey
  if (!encrypted || !safeStorage.isEncryptionAvailable()) return null
  try {
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
  } catch {
    return null
  }
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value))
}

function savedWidgetPosition() {
  return getSettings().widgetPosition || null
}

function currentWidgetDockSide() {
  if (widgetDockSide !== undefined) return widgetDockSide
  const saved = getSettings().widgetDockSide
  widgetDockSide = saved === 'left' || saved === 'right' ? saved : null
  return widgetDockSide
}

function setWidgetDockSide(side) {
  widgetDockSide = side === 'left' || side === 'right' ? side : null
  const settings = getSettings()
  if (widgetDockSide) settings.widgetDockSide = widgetDockSide
  else delete settings.widgetDockSide
  saveSettings(settings)
}

function displayForWidgetPoint(x, y) {
  return screen.getDisplayNearestPoint({
    x: Math.round(x + WINDOW_SIZES.mini.width / 2),
    y: Math.round(y + WINDOW_SIZES.mini.height / 2)
  })
}

function savedWidgetDisplay(fallbackX, fallbackY) {
  const saved = savedWidgetPosition()
  return screen.getAllDisplays().find(display => String(display.id) === String(saved?.displayId)) ||
    displayForWidgetPoint(fallbackX, fallbackY)
}

function visibleDockX(side, area) {
  return side === 'left'
    ? area.x
    : area.x + area.width - WINDOW_SIZES.mini.width
}

function hiddenDockX(side, area) {
  return side === 'left'
    ? area.x - WINDOW_SIZES.mini.width + EDGE_DOCK_VISIBLE_WIDTH
    : area.x + area.width - EDGE_DOCK_VISIBLE_WIDTH
}

function saveWidgetPosition() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const bounds = mainWindow.getBounds()
  let widgetX = windowMode === 'hover' && hoverPlacement === 'left'
    ? bounds.x + bounds.width - WINDOW_SIZES.mini.width
    : bounds.x
  const dockSide = currentWidgetDockSide()
  const display = dockSide && windowMode === 'mini'
    ? savedWidgetDisplay(widgetX, bounds.y)
    : displayForWidgetPoint(widgetX, bounds.y)
  if (dockSide && windowMode === 'mini') widgetX = visibleDockX(dockSide, display.workArea)
  const settings = getSettings()
  settings.widgetPosition = {
    displayId: String(display.id),
    x: widgetX,
    y: bounds.y
  }
  saveSettings(settings)
}

function schedulePositionSave() {
  if (positionSaveSuppressed) return
  clearTimeout(positionSaveTimer)
  positionSaveTimer = setTimeout(() => {
    if (positionSaveSuppressed) return
    saveWidgetPosition()
  }, 250)
}

function setWindowBounds(bounds, animate = false) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  // Own the motion instead of queuing uncancellable AppKit resize animations.
  clearInterval(windowMotionTimer)
  windowMotionTimer = null
  clearTimeout(positionSaveTimer)
  positionSaveSuppressed = true
  clearTimeout(positionSuppressTimer)
  const current = mainWindow.getBounds()
  const finish = () => {
    clearInterval(windowMotionTimer)
    windowMotionTimer = null
    mainWindow.setBounds(bounds, false)
    positionSuppressTimer = setTimeout(() => { positionSaveSuppressed = false }, 120)
  }
  if (!animate || current.height !== bounds.height) return finish()
  // Resize in one frame, keeping the ball anchored; animate only translation.
  const startX = hoverPlacement === 'left'
    ? current.x + current.width - bounds.width : current.x
  const startY = current.y
  if (startX === bounds.x && startY === bounds.y) return finish()
  const startedAt = Date.now()
  mainWindow.setBounds({ ...bounds, x: startX, y: startY }, false)
  windowMotionTimer = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      clearInterval(windowMotionTimer)
      windowMotionTimer = null
      return
    }
    const progress = Math.min(1, (Date.now() - startedAt) / 160)
    if (progress === 1) return finish()
    const eased = 1 - Math.pow(1 - progress, 3)
    mainWindow.setBounds({
      ...bounds,
      x: Math.round(startX + (bounds.x - startX) * eased),
      y: Math.round(startY + (bounds.y - startY) * eased)
    }, false)
  }, 16)
  windowMotionTimer.unref()
}

function stopHoverMonitor() {
  clearInterval(hoverMonitorTimer)
  hoverMonitorTimer = null
  hoverOutsideSince = null
}

function monitorWidgetHover() {
  if (windowMode !== 'hover' || widgetDrag || !mainWindow || mainWindow.isDestroyed()) {
    stopHoverMonitor()
    return
  }
  const point = screen.getCursorScreenPoint()
  const target = windowBoundsFor('hover')
  const current = mainWindow.getBounds()
  // A stable bridge covers both ends of the slide, plus a small forgiving margin.
  // DOM mouseleave alone is not evidence that the user left a moving window.
  const left = Math.min(target.x, current.x) - 10
  const right = Math.max(target.x + target.width, current.x + current.width) + 10
  const top = Math.min(target.y, current.y) - 10
  const bottom = Math.max(target.y + target.height, current.y + current.height) + 10
  if (point.x >= left && point.x <= right && point.y >= top && point.y <= bottom) {
    hoverOutsideSince = null
  } else if (hoverOutsideSince === null) {
    hoverOutsideSince = Date.now()
  } else if (Date.now() - hoverOutsideSince >= 450 && !windowMotionTimer) {
    setWindowMode('mini')
  }
}

function startHoverMonitor() {
  hoverOutsideSince = null
  if (hoverMonitorTimer) return
  hoverMonitorTimer = setInterval(monitorWidgetHover, 60)
  hoverMonitorTimer.unref()
}

function widgetOrigin(bounds = mainWindow?.getBounds()) {
  if (!bounds) return null
  const dockSide = currentWidgetDockSide()
  if (windowMode === 'mini' && dockSide) {
    const display = savedWidgetDisplay(bounds.x, bounds.y)
    return {
      x: visibleDockX(dockSide, display.workArea),
      y: bounds.y
    }
  }
  return {
    x: windowMode === 'hover' && hoverPlacement === 'left'
      ? bounds.x + bounds.width - WINDOW_SIZES.mini.width
      : bounds.x,
    y: bounds.y
  }
}

function beginWidgetDrag() {
  if (!mainWindow || mainWindow.isDestroyed() || windowMode === 'panel') return
  endWidgetDrag()
  stopHoverMonitor()

  const bounds = mainWindow.getBounds()
  const origin = widgetOrigin(bounds)
  const cursor = screen.getCursorScreenPoint()
  widgetDockSide = null
  windowMode = 'mini'
  setWindowBounds({
    x: origin.x,
    y: origin.y,
    ...WINDOW_SIZES.mini
  })
  mainWindow.webContents.send('window-mode', {
    mode: 'mini',
    placement: hoverPlacement
  })

  widgetDrag = {
    offsetX: cursor.x - origin.x,
    offsetY: cursor.y - origin.y,
    lastX: origin.x,
    lastY: origin.y,
    startedAt: Date.now()
  }
  widgetDragTimer = setInterval(() => {
    if (!widgetDrag || !mainWindow || mainWindow.isDestroyed()) {
      endWidgetDrag()
      return
    }
    if (Date.now() - widgetDrag.startedAt > 30000) {
      endWidgetDrag()
      return
    }
    const point = screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(point)
    const area = display.workArea
    const x = clamp(
      Math.round(point.x - widgetDrag.offsetX),
      area.x,
      area.x + Math.max(0, area.width - WINDOW_SIZES.mini.width)
    )
    const y = clamp(
      Math.round(point.y - widgetDrag.offsetY),
      area.y,
      area.y + Math.max(0, area.height - WINDOW_SIZES.mini.height)
    )
    if (x === widgetDrag.lastX && y === widgetDrag.lastY) return
    widgetDrag.lastX = x
    widgetDrag.lastY = y
    setWindowBounds({ x, y, ...WINDOW_SIZES.mini })
  }, 16)
  widgetDragTimer.unref()
}

function endWidgetDrag() {
  if (widgetDragTimer) clearInterval(widgetDragTimer)
  widgetDragTimer = null
  if (!widgetDrag) return
  widgetDrag = null
  const bounds = mainWindow?.getBounds()
  if (!bounds) return
  const display = displayForWidgetPoint(bounds.x, bounds.y)
  const area = display.workArea
  const distanceToLeft = Math.abs(bounds.x - area.x)
  const distanceToRight = Math.abs(area.x + area.width - (bounds.x + bounds.width))
  const dockSide = Math.min(distanceToLeft, distanceToRight) <= EDGE_DOCK_SNAP_DISTANCE
    ? (distanceToLeft <= distanceToRight ? 'left' : 'right')
    : null
  // Save the actual release display before enabling the dock (multi-monitor).
  setWidgetDockSide(null)
  saveWidgetPosition()
  setWidgetDockSide(dockSide)
  if (dockSide) {
    // Do not retreat from the pointer immediately after the user releases it.
    setWindowMode('hover')
  }
}

function windowBoundsFor(mode) {
  const size = mode === 'hover' && !hoverHasTasks
    ? { width: 240, height: WINDOW_SIZES.hover.height }
    : WINDOW_SIZES[mode]
  const saved = savedWidgetPosition()
  const displays = screen.getAllDisplays()
  let display = saved
    ? displays.find(item => String(item.id) === String(saved.displayId))
    : null
  if (!display && saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    display = screen.getDisplayNearestPoint({ x: saved.x, y: saved.y })
  }
  if (!display) display = screen.getPrimaryDisplay()
  const area = display.workArea
  const defaultX = area.x + 12
  const defaultY = area.y + area.height - size.height - 12
  const widgetX = clamp(
    Number.isFinite(saved?.x) ? saved.x : defaultX,
    area.x,
    area.x + Math.max(0, area.width - WINDOW_SIZES.mini.width)
  )
  let windowX = widgetX

  if (mode === 'hover') {
    const expansion = size.width - WINDOW_SIZES.mini.width
    const roomOnRight = area.x + area.width - widgetX
    const roomOnLeft = widgetX + WINDOW_SIZES.mini.width - area.x
    hoverPlacement = roomOnRight >= size.width || roomOnRight >= roomOnLeft
      ? 'right'
      : 'left'
    windowX = hoverPlacement === 'left' ? widgetX - expansion : widgetX
  } else if (mode === 'mini' && currentWidgetDockSide()) {
    windowX = hiddenDockX(currentWidgetDockSide(), area)
  }

  return {
    x: mode === 'mini' && currentWidgetDockSide()
      ? windowX
      : clamp(
          windowX,
          area.x,
          area.x + Math.max(0, area.width - size.width)
        ),
    y: clamp(
      Number.isFinite(saved?.y) ? saved.y : defaultY,
      area.y,
      area.y + Math.max(0, area.height - size.height)
    ),
    width: size.width,
    height: size.height
  }
}

function showWindowSafely({ activate = false } = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.setAlwaysOnTop(true, 'floating', 1)
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  if (activate) {
    mainWindow.setFocusable(true)
    mainWindow.show()
    mainWindow.focus()
  } else {
    mainWindow.showInactive()
  }
}

function ensureWindowVisible() {
  if (quitting || widgetDrag || windowMotionTimer || !mainWindow || mainWindow.isDestroyed()) return
  const expected = windowBoundsFor(windowMode)
  mainWindow.webContents.send('window-mode', {
    mode: windowMode,
    placement: hoverPlacement
  })
  const current = mainWindow.getBounds()
  const isOnScreen = screen.getAllDisplays().some(display => {
    const area = display.workArea
    return (
      current.x < area.x + area.width &&
      current.x + current.width > area.x &&
      current.y < area.y + area.height &&
      current.y + current.height > area.y
    )
  })
  const dockPositionWasAdjusted = windowMode === 'mini' &&
    currentWidgetDockSide() &&
    (current.x !== expected.x || current.y !== expected.y)
  if (!isOnScreen || dockPositionWasAdjusted) setWindowBounds(expected, false)
  if (!mainWindow.isVisible()) showWindowSafely()
}

function setWindowMode(mode, { activate = false, view = null } = {}) {
  if (!mainWindow || mainWindow.isDestroyed() || !WINDOW_SIZES[mode]) return
  const sameMode = windowMode === mode
  windowMode = mode
  if (mode === 'hover') startHoverMonitor()
  else stopHoverMonitor()
  mainWindow.setResizable(mode === 'panel')
  const target = windowBoundsFor(mode)
  const current = mainWindow.getBounds()
  if (!sameMode || (!windowMotionTimer && ['x', 'y', 'width', 'height'].some(key => current[key] !== target[key]))) {
    setWindowBounds(target, true)
  }
  mainWindow.webContents.send('window-mode', {
    mode,
    view,
    placement: hoverPlacement
  })
  showWindowSafely({ activate })
  if (!activate && mode !== 'panel') {
    mainWindow.setFocusable(false)
  }
}

function createWindow() {
  startupLog(`create-window mode=${windowMode}`)
  const bounds = windowBoundsFor('mini')
  mainWindow = new BrowserWindow({
    ...bounds,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    frame: false,
    hasShadow: false,
    minWidth: 56,
    minHeight: 56,
    resizable: false,
    // A hidden transparent window can deadlock its first paint on some macOS
    // compositor versions, leaving the widget absent even though the app runs.
    // Its background is fully transparent, so showing it immediately does not
    // introduce a visible loading frame.
    show: true,
    skipTaskbar: true,
    transparent: true,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      // Chromium's renderer sandbox can indefinitely stall local app.asar
      // navigation on some macOS releases. The renderer remains isolated and
      // Node integration stays disabled.
      sandbox: false
    }
  })

  // Briefly activate the first transparent window so macOS does not suspend
  // its initial renderer navigation as a background-only app.
  if (process.platform === 'darwin') app.focus({ steal: true })
  mainWindow.setFocusable(true)
  mainWindow.show()
  mainWindow.focus()
  // Load the unpacked renderer directly. A custom-scheme navigation can block
  // synchronously after an in-place app update on recent macOS releases.
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html')).catch(error => {
    startupLog(`window-load-file-error ${cleanText(error?.message || error, 300)}`)
  })
  // An input event wakes Chromium's first transparent renderer even when the
  // accessory app is immediately backgrounded by Launch Services.
  mainWindow.webContents.focus()
  mainWindow.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' })
  mainWindow.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' })
  let rendererLoadComplete = false
  const rendererLoadRetry = setTimeout(() => {
    if (rendererLoadComplete || mainWindow?.isDestroyed()) return
    startupLog('window-load-retry')
    mainWindow.webContents.reload()
  }, 2500)
  mainWindow.setAlwaysOnTop(true, 'floating', 1)
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  mainWindow.on('closed', () => {
    clearTimeout(rendererLoadRetry)
    mainWindow = null
  })
  mainWindow.on('hide', () => {
    setTimeout(ensureWindowVisible, 150)
  })
  mainWindow.on('move', schedulePositionSave)
  mainWindow.once('ready-to-show', () => showWindowSafely())
  mainWindow.webContents.on('did-finish-load', () => {
    rendererLoadComplete = true
    clearTimeout(rendererLoadRetry)
    startupLog('window-did-finish-load')
    mainWindow.webContents.send('window-mode', {
      mode: windowMode,
      placement: hoverPlacement
    })
    mainWindow.webContents.send('shortcut-status', shortcutStatus)
    if (pendingPanelOpen) {
      pendingPanelOpen = false
      setWindowMode('panel', { activate: true, view: 'memos' })
    } else {
      showWindowSafely()
      // AppKit can pull a partially off-screen transparent window fully back
      // while showing it. Apply the saved dock position after that show pass
      // so edge hiding also survives an app restart.
      if (windowMode === 'mini' && currentWidgetDockSide()) {
        setTimeout(() => {
          if (windowMode === 'mini' && currentWidgetDockSide()) {
            setWindowBounds(windowBoundsFor('mini'), false)
          }
        }, 80)
        setTimeout(ensureWindowVisible, 600)
      }
      if (windowMode !== 'panel') mainWindow.setFocusable(false)
    }
  })
  mainWindow.webContents.on('did-fail-load', (_, code, description) => {
    startupLog(`window-did-fail-load code=${code} description=${cleanText(description, 200)}`)
  })
  mainWindow.webContents.on('render-process-gone', (_, details) => {
    startupLog(`render-process-gone reason=${details.reason} exitCode=${details.exitCode}`)
  })
}

function getImageHash(image) {
  return crypto.createHash('md5').update(image.toPNG()).digest('hex')
}

function startClipboardWatcher() {
  const existing = clipboard.readImage()
  if (!existing.isEmpty()) {
    lastClipboardHash = getImageHash(existing)
    lastClipboardSize = existing.getSize()
  }

  clipboardTimer = setInterval(() => {
    try {
      // Finder puts a rendered preview on the pasteboard alongside copied files.
      // Leave file imports to the explicit paste action so they are not duplicated.
      if (clipboardFilePaths().length) return
      const image = clipboard.readImage()
      if (image.isEmpty()) return
      const size = image.getSize()
      const bytes = image.toPNG()
      const hash = crypto.createHash('md5').update(bytes).digest('hex')
      if (
        lastClipboardSize &&
        size.width === lastClipboardSize.width &&
        size.height === lastClipboardSize.height &&
        hash === lastClipboardHash
      ) return
      lastClipboardHash = hash
      lastClipboardSize = size
      fs.writeFileSync(path.join(CLIPBOARD_DIR, uniqueName('.png')), bytes)
    } catch {}
  }, 1500)
  clipboardTimer.unref()
}

async function captureScreenshot() {
  startupLog('native-screenshot-request')
  if (process.platform !== 'darwin' || !fs.existsSync(NATIVE_SCREENSHOT_APP)) {
    mainWindow?.webContents.send('screenshot-error', {
      message: '没有找到苹果原生截屏工具。'
    })
    return
  }
  let error = ''
  try {
    error = await shell.openPath(NATIVE_SCREENSHOT_APP)
  } catch (openError) {
    error = cleanText(openError?.message, 240) || '未知错误'
  }
  startupLog(`native-screenshot-opened error=${cleanText(error, 240) || 'none'}`)
  if (error) {
    mainWindow?.webContents.send('screenshot-error', {
      message: `无法打开苹果截屏工具：${cleanText(error, 240)}`
    })
  }
}

function registerShortcuts() {
  shortcutStatus = {
    commandJ: globalShortcut.register('Command+J', captureScreenshot),
    legacy: globalShortcut.register('Command+Shift+X', captureScreenshot)
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('shortcut-status', shortcutStatus)
  }
}

function helperPath(name) {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'native', name)
    : path.join(__dirname, 'native', 'bin', name)
}

function runHelper(name, args, timeout = 90000) {
  return new Promise((resolve, reject) => {
    const executable = helperPath(name)
    if (!fs.existsSync(executable)) {
      reject(new Error(`缺少原生助手：${name}`))
      return
    }
    execFile(executable, args, { timeout, maxBuffer: 5 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(cleanText(stderr, 1000) || error.message))
        return
      }
      resolve(cleanText(stdout))
    })
  })
}

function startReminderService() {
  const check = () => {
    const now = Date.now()
    const memos = loadMemos()
    let changed = false
    for (const memo of memos) {
      if (
        memo.completedAt ||
        memo.notifiedAt ||
        !memo.reminderAt ||
        new Date(memo.reminderAt).getTime() > now
      ) continue

      memo.notifiedAt = new Date().toISOString()
      changed = true
      if (Notification.isSupported()) {
        const notification = new Notification({
          title: memo.dueAt && new Date(memo.dueAt).getTime() <= now ? 'DDL 已到' : '待办提醒',
          body: `${memo.title}${memo.content ? `\n${memo.content.slice(0, 80)}` : ''}`,
          sound: 'default'
        })
        notification.on('click', () => setWindowMode('panel', { activate: true, view: 'memos' }))
        notification.show()
      }
    }
    if (changed) saveMemos(memos)
  }
  check()
  reminderTimer = setInterval(check, 15000)
  reminderTimer.unref()
}

function watchImageSources() {
  const chokidar = require('chokidar')
  const clipboardWatcher = chokidar.watch(CLIPBOARD_DIR, {
    ignoreInitial: true,
    useFsEvents: false
  })
  imageWatchers.push(clipboardWatcher)
  clipboardWatcher
    .on('add', filePath => {
      if (
        isMediaPath(filePath) &&
        mainWindow &&
        !mainWindow.isDestroyed()
      ) mainWindow.webContents.send('file-added', filePath)
    })
    .on('unlink', filePath => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('file-removed', filePath)
      }
    })

  let screenshotDir
  try {
    const output = execFileSync(
      '/usr/bin/defaults',
      ['read', 'com.apple.screencapture', 'location'],
      { encoding: 'utf8' }
    ).trim()
    const expandedOutput = output.startsWith('~/')
      ? path.join(os.homedir(), output.slice(2))
      : output
    screenshotDir = expandedOutput && fs.existsSync(expandedOutput)
      ? expandedOutput
      : path.join(os.homedir(), 'Desktop')
  } catch {
    screenshotDir = path.join(os.homedir(), 'Desktop')
  }
  startupLog(`native-screenshot-watch dir=${screenshotDir}`)

  if (screenshotDir !== CLIPBOARD_DIR && fs.existsSync(screenshotDir)) {
    const screenshotWatcher = chokidar.watch(screenshotDir, {
      ignoreInitial: true,
      depth: 0,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100
      },
      useFsEvents: false
    })
    imageWatchers.push(screenshotWatcher)
    screenshotWatcher
      .on('add', filePath => {
        if (!isNativeScreenshot(filePath)) return
        const destination = path.join(
          CLIPBOARD_DIR,
          uniqueName(path.extname(filePath) || '.png')
        )
        try {
          fs.copyFileSync(filePath, destination)
          rememberImageOrigin(destination, filePath)
          startupLog(`native-screenshot-imported source=${path.basename(filePath)}`)
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('screenshot-created', destination)
          }
        } catch (error) {
          startupLog(`native-screenshot-import-error error=${cleanText(error?.message, 240)}`)
        }
      })
  }
}

function isNativeScreenshot(filePath) {
  if (!isImagePath(filePath) || !fs.existsSync(filePath)) return false
  try {
    execFileSync(
      '/usr/bin/xattr',
      ['-p', 'com.apple.metadata:kMDItemIsScreenCapture', filePath],
      { stdio: 'ignore' }
    )
    return true
  } catch {
    return SCREENSHOT_NAME_RE.test(path.basename(filePath))
  }
}

function registerIpc() {
  ipcMain.handle('list-images', () => {
    try {
      return fs.readdirSync(CLIPBOARD_DIR)
        .filter(name => MEDIA_EXT_RE.test(name))
        .map(name => mediaInfo(path.join(CLIPBOARD_DIR, name)))
        .sort((a, b) => b.mtime - a.mtime)
    } catch {
      return []
    }
  })

  ipcMain.handle('save-dropped', (_, sourcePath) => {
    return importMediaFile(sourcePath)
  })

  ipcMain.handle('import-media', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '批量导入图片或视频',
      properties: ['openFile', 'multiSelections'],
      filters: [{
        name: '图片与视频',
        extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi']
      }]
    })
    if (result.canceled) return { imported: [], failed: [] }
    const imported = []
    const failed = []
    for (const sourcePath of result.filePaths) {
      try {
        imported.push(importMediaFile(sourcePath))
      } catch (error) {
        failed.push({ name: path.basename(sourcePath), message: error.message })
      }
    }
    return { imported, failed }
  })

  ipcMain.handle('paste-clipboard', () => {
    const filePaths = clipboardMediaPaths()
    if (filePaths.length) {
      return filePaths.map(importMediaFile)
    }
    const image = clipboard.readImage()
    if (image.isEmpty()) return []
    const bytes = image.toPNG()
    lastClipboardHash = crypto.createHash('md5').update(bytes).digest('hex')
    lastClipboardSize = image.getSize()
    const destination = path.join(CLIPBOARD_DIR, uniqueName('.png'))
    fs.writeFileSync(destination, bytes)
    return [mediaInfo(destination)]
  })

  ipcMain.handle('copy-to-clipboard', (_, filePath) => {
    if (!isInside(CLIPBOARD_DIR, filePath) || !fs.existsSync(filePath)) return false
    if (isVideoPath(filePath)) {
      if (process.platform === 'darwin') {
        clipboard.writeBuffer('public.file-url', Buffer.from(pathToFileURL(filePath).href))
      } else {
        clipboard.writeText(filePath)
      }
      return true
    }
    const image = nativeImage.createFromPath(filePath)
    if (image.isEmpty()) return false
    const bytes = image.toPNG()
    lastClipboardHash = crypto.createHash('md5').update(bytes).digest('hex')
    lastClipboardSize = image.getSize()
    clipboard.writeImage(image)
    return true
  })

  ipcMain.handle('delete-image', async (_, filePath) => {
    return trashMediaFile(filePath)
  })

  ipcMain.handle('delete-media-batch', async (_, filePaths) => {
    const uniquePaths = [...new Set(Array.isArray(filePaths) ? filePaths : [])]
      .filter(filePath => isInside(CLIPBOARD_DIR, filePath) && fs.existsSync(filePath))
    const result = { trashed: 0, originalsTrashed: 0, failed: [] }
    for (const filePath of uniquePaths) {
      try {
        const item = await trashMediaFile(filePath)
        if (item) {
          result.trashed += 1
          if (item.originalTrashed) result.originalsTrashed += 1
        }
      } catch (error) {
        result.failed.push({ name: path.basename(filePath), message: error.message })
      }
    }
    return result
  })

  ipcMain.handle('export-media-batch', async (_, filePaths) => {
    const uniquePaths = [...new Set(Array.isArray(filePaths) ? filePaths : [])]
      .filter(filePath => isInside(CLIPBOARD_DIR, filePath) && fs.existsSync(filePath))
    if (!uniquePaths.length) return null
    const choice = await dialog.showOpenDialog(mainWindow, {
      title: `导出所选的 ${uniquePaths.length} 项`,
      properties: ['openDirectory', 'createDirectory']
    })
    if (choice.canceled || !choice.filePaths[0]) return null
    const directory = path.resolve(choice.filePaths[0])
    if (directory === path.resolve(CLIPBOARD_DIR)) {
      throw new Error('请选择图片中转站以外的导出文件夹')
    }
    const exported = []
    for (const filePath of uniquePaths) {
      const originalPath = imageOrigin(filePath)
      const preferredName = originalPath ? path.basename(originalPath) : path.basename(filePath)
      const destination = availableExportPath(directory, preferredName)
      fs.copyFileSync(filePath, destination)
      exported.push(destination)
    }
    return { count: exported.length, directory, files: exported }
  })

  ipcMain.handle('save-from-buffer', (_, bufferArray, mime) => {
    const normalizedMime = String(mime || '').toLowerCase().split(';')[0].trim()
    if (!/^(image\/(png|jpeg|gif|webp)|video\/(mp4|quicktime|webm))$/i.test(normalizedMime)) {
      throw new Error('不支持的图片或视频类型')
    }
    const ext = normalizedMime.includes('jpeg')
      ? '.jpg'
      : normalizedMime.includes('quicktime')
        ? '.mov'
        : `.${normalizedMime.split('/')[1]}`
    const bytes = Buffer.from(bufferArray)
    const limit = normalizedMime.startsWith('video/') ? 500 * 1024 * 1024 : 25 * 1024 * 1024
    if (bytes.length > limit) throw new Error(normalizedMime.startsWith('video/') ? '视频不能超过 500MB' : '图片不能超过 25MB')
    const destination = path.join(CLIPBOARD_DIR, uniqueName(ext))
    fs.writeFileSync(destination, bytes)
    return mediaInfo(destination)
  })

  ipcMain.handle('save-from-url', async (_, value) => {
    const url = new URL(value)
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('不支持的媒体地址')
    const response = await net.fetch(url.toString())
    if (!response.ok) throw new Error(`下载媒体失败：${response.status}`)
    const contentType = response.headers.get('content-type') || ''
    if (!/^(image|video)\//i.test(contentType)) throw new Error('链接返回的不是图片或视频')
    const declaredLength = Number(response.headers.get('content-length')) || 0
    const isVideo = contentType.startsWith('video/')
    const limit = isVideo ? 500 * 1024 * 1024 : 25 * 1024 * 1024
    if (declaredLength > limit) throw new Error(isVideo ? '视频不能超过 500MB' : '图片不能超过 25MB')
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > limit) throw new Error(isVideo ? '视频不能超过 500MB' : '图片不能超过 25MB')
    const subtype = (contentType.split('/')[1] || (isVideo ? 'mp4' : 'png')).split(';')[0]
    const ext = contentType.includes('jpeg')
      ? '.jpg'
      : contentType.includes('quicktime')
        ? '.mov'
        : contentType.includes('matroska')
          ? '.mkv'
          : contentType.includes('msvideo')
            ? '.avi'
            : `.${subtype}`
    const destination = path.join(CLIPBOARD_DIR, uniqueName(ext))
    fs.writeFileSync(destination, bytes)
    return mediaInfo(destination)
  })

  ipcMain.handle('open-folder', () => shell.openPath(CLIPBOARD_DIR))

  ipcMain.on('drag-out', (event, filePath) => {
    if (!isInside(CLIPBOARD_DIR, filePath) || !isMediaPath(filePath) || !fs.existsSync(filePath)) return
    let icon = nativeImage.createFromPath(filePath)
    if (icon.isEmpty()) icon = nativeImage.createFromPath(path.join(process.resourcesPath, 'electron.icns'))
    if (icon.isEmpty() && process.platform === 'darwin') {
      icon = nativeImage.createFromNamedImage('NSActionTemplate')
    }
    if (icon.isEmpty()) return
    event.sender.startDrag({
      file: filePath,
      icon: icon.resize({ width: 64, height: 64 })
    })
  })

  ipcMain.handle('list-memos', () => loadMemos().map(publicMemo))
  ipcMain.handle('save-memo', (_, input) => saveMemo(input || {}))
  ipcMain.handle('toggle-memo-complete', (_, id) => {
    const memos = loadMemos()
    const memo = memos.find(item => item.id === id)
    if (!memo) return null
    memo.completedAt = memo.completedAt ? null : new Date().toISOString()
    memo.updatedAt = new Date().toISOString()
    if (!memo.completedAt && memo.dueAt && new Date(memo.dueAt).getTime() > Date.now()) {
      memo.notifiedAt = null
    }
    saveMemos(memos)
    return publicMemo(memo)
  })
  ipcMain.handle('delete-memo', (_, id) => {
    const memos = loadMemos()
    const next = memos.filter(item => item.id !== id && item.parentId !== id)
    if (next.length === memos.length) return false
    saveMemos(next)
    return true
  })

  ipcMain.handle('run-ocr', async (_, filePath) => {
    if (!isInside(CLIPBOARD_DIR, filePath) || !isImagePath(filePath) || !fs.existsSync(filePath)) {
      throw new Error('只能识别中转站内的图片')
    }
    const text = await runHelper('image-ocr', [filePath], 60000)
    if (!text) throw new Error('没有识别到文字')
    return text
  })

  ipcMain.handle('request-microphone', async () => {
    if (process.platform !== 'darwin') return true
    const status = systemPreferences.getMediaAccessStatus('microphone')
    if (status === 'granted') return true
    return systemPreferences.askForMediaAccess('microphone')
  })

  ipcMain.handle('save-audio-buffer', (_, bufferArray, mime) => {
    const bytes = Buffer.from(bufferArray)
    if (!bytes.length || bytes.length > 100 * 1024 * 1024) {
      throw new Error('录音文件不可用')
    }
    let ext = '.webm'
    if ((mime || '').includes('mp4')) ext = '.m4a'
    else if ((mime || '').includes('wav')) ext = '.wav'
    const destination = path.join(audioDir, uniqueName(ext))
    fs.writeFileSync(destination, bytes)
    return destination
  })

  ipcMain.handle('import-audio', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '导入语音文件',
      properties: ['openFile'],
      filters: [
        {
          name: '语音文件',
          extensions: ['m4a', 'mp3', 'wav', 'aac', 'aif', 'aiff', 'flac', 'ogg', 'webm']
        }
      ]
    })
    if (result.canceled || !result.filePaths[0]) return null
    const sourcePath = result.filePaths[0]
    if (!AUDIO_EXT_RE.test(sourcePath) || !fs.existsSync(sourcePath)) {
      throw new Error('不是支持的语音文件')
    }
    const stat = fs.statSync(sourcePath)
    if (!stat.isFile() || stat.size > 500 * 1024 * 1024) {
      throw new Error('语音文件不能超过 500MB')
    }
    const destination = path.join(audioDir, uniqueName(path.extname(sourcePath)))
    fs.copyFileSync(sourcePath, destination)
    return {
      path: destination,
      url: internalMediaUrl(destination),
      name: path.basename(sourcePath)
    }
  })

  ipcMain.handle('transcribe-audio', async (_, filePath) => {
    if (!isInside(audioDir, filePath) || !fs.existsSync(filePath)) {
      throw new Error('录音文件不存在')
    }
    return runHelper('speech-transcribe', [filePath], 120000)
  })

  ipcMain.handle('get-ai-settings', () => {
    const settings = getSettings()
    return {
      endpoint: settings.deepseek?.endpoint || 'https://api.deepseek.com/chat/completions',
      model: settings.deepseek?.model || 'deepseek-v4-flash',
      hasKey: Boolean(getDeepSeekKey(settings))
    }
  })

  ipcMain.handle('save-ai-settings', (_, input) => {
    const settings = getSettings()
    const endpoint = cleanText(input.endpoint, 500)
    const endpointUrl = new URL(endpoint)
    if (endpointUrl.protocol !== 'https:') throw new Error('API 地址必须使用 HTTPS')
    settings.deepseek = {
      endpoint,
      model: cleanText(input.model, 100) || 'deepseek-v4-flash',
      encryptedKey: settings.deepseek?.encryptedKey || null
    }
    if (input.clearKey) settings.deepseek.encryptedKey = null
    if (cleanText(input.apiKey, 500)) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('macOS 钥匙串暂不可用')
      settings.deepseek.encryptedKey = safeStorage
        .encryptString(cleanText(input.apiKey, 500))
        .toString('base64')
    }
    saveSettings(settings)
    return { success: true, hasKey: Boolean(getDeepSeekKey(settings)) }
  })

  ipcMain.handle('summarize-memo', async (_, id) => {
    const memo = loadMemos().find(item => item.id === id)
    if (!memo) throw new Error('备忘录不存在')
    if (!memo.content) throw new Error('当前备忘没有可总结的文字')
    const settings = getSettings()
    const apiKey = getDeepSeekKey(settings)
    if (!apiKey) throw new Error('请先在设置中填写 DeepSeek API Key')
    const endpoint = new URL(settings.deepseek.endpoint)
    if (endpoint.protocol !== 'https:') throw new Error('API 地址必须使用 HTTPS')
    const response = await net.fetch(endpoint.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: settings.deepseek.model,
        messages: [
          {
            role: 'system',
            content: '你是桌面待办助手。请把输入压缩为简洁、可执行的中文备忘。保留关键人名、日期、金额和行动项，不编造截止时间。直接输出结果，不要解释。'
          },
          {
            role: 'user',
            content: `标题：${memo.title}\n内容：${memo.content}`
          }
        ],
        temperature: 0.2
      })
    })
    if (!response.ok) {
      const detail = cleanText(await response.text(), 800)
      throw new Error(`DeepSeek 请求失败（${response.status}）：${detail}`)
    }
    const result = await response.json()
    const content = cleanText(result?.choices?.[0]?.message?.content)
    if (!content) throw new Error('DeepSeek 没有返回总结')
    return saveMemo({
      parentId: memo.id,
      type: 'summary',
      title: `${memo.title} · 总结`,
      content,
      dueAt: memo.dueAt,
      remindMinutes: memo.remindMinutes,
      color: memo.color
    })
  })

  ipcMain.handle('plan-memo-tasks', async (_, input) => {
    const title = cleanText(input?.title, 120)
    const content = cleanText(input?.content, 12000)
    if (!title && !content) throw new Error('请先输入要安排的事情')
    const settings = getSettings()
    const apiKey = getDeepSeekKey(settings)
    if (!apiKey) throw new Error('请先在设置中填写 DeepSeek API Key')
    const endpoint = new URL(settings.deepseek.endpoint)
    if (endpoint.protocol !== 'https:') throw new Error('API 地址必须使用 HTTPS')
    const now = new Date()
    const response = await net.fetch(endpoint.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: settings.deepseek.model,
        messages: [
          {
            role: 'system',
            content: [
              '你是桌面待办规划助手。把用户输入拆成最多 12 个独立、可执行的中文待办。',
              '按重要性和紧急性判断 priority：high、medium、low。',
              '只有用户明确给出或可可靠推断时间时才填写 dueAt，否则为 null；不得编造日期。',
              'remindMinutes 只能是 0、5、30、60、1440。',
              '只输出严格 JSON：{"tasks":[{"title":"...","content":"...","priority":"high","dueAt":"ISO 8601 或 null","remindMinutes":30}]}。'
            ].join('\n')
          },
          {
            role: 'user',
            content: `当前本地时间：${now.toString()}\n来源：${cleanText(input?.sourceType, 20) || 'text'}\n标题：${title}\n内容：${content}`
          }
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' }
      })
    })
    if (!response.ok) {
      const detail = cleanText(await response.text(), 800)
      throw new Error(`DeepSeek 请求失败（${response.status}）：${detail}`)
    }
    const result = await response.json()
    const raw = cleanText(result?.choices?.[0]?.message?.content)
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new Error('DeepSeek 返回的待办格式无法识别，请重试')
    }
    const allowedReminders = new Set([0, 5, 30, 60, 1440])
    const tasks = (Array.isArray(parsed?.tasks) ? parsed.tasks : [])
      .slice(0, 12)
      .map(task => {
        const taskTitle = cleanText(task?.title, 120)
        if (!taskTitle) return null
        const priority = ['high', 'medium', 'low'].includes(task?.priority)
          ? task.priority
          : 'medium'
        const remindMinutes = allowedReminders.has(Number(task?.remindMinutes))
          ? Number(task.remindMinutes)
          : 0
        return {
          title: taskTitle,
          content: cleanText(task?.content, 2000),
          priority,
          dueAt: normalizeDueAt(task?.dueAt),
          remindMinutes
        }
      })
      .filter(Boolean)
    if (!tasks.length) throw new Error('DeepSeek 没有生成可用的待办')
    return tasks
  })

  ipcMain.handle('create-planned-memos', (_, input) => {
    const tasks = Array.isArray(input?.tasks) ? input.tasks.slice(0, 12) : []
    if (!tasks.length) throw new Error('没有可创建的待办')
    return tasks.map((task, index) => saveMemo({
      type: 'text',
      title: task.title,
      content: task.content,
      priority: task.priority,
      color: normalizeMemoColor(task.color, MEMO_COLOR_PALETTE[index % MEMO_COLOR_PALETTE.length]),
      dueAt: task.dueAt,
      remindMinutes: task.remindMinutes
    }))
  })

  ipcMain.on('widget-hover', (_, entered) => {
    if (windowMode === 'panel' || widgetDrag) return
    if (entered && !(windowMode === 'mini' && windowMotionTimer)) setWindowMode('hover')
    else if (!entered) monitorWidgetHover()
  })
  ipcMain.on('hover-has-tasks', (_, hasTasks) => {
    const nextValue = Boolean(hasTasks)
    if (hoverHasTasks === nextValue) return
    hoverHasTasks = nextValue
    if (windowMode === 'hover') setWindowMode('hover')
  })
  ipcMain.on('widget-drag-start', beginWidgetDrag)
  ipcMain.on('widget-drag-end', endWidgetDrag)
  ipcMain.on('open-panel', (_, view) => setWindowMode('panel', { activate: true, view }))
  ipcMain.on('collapse-window', () => setWindowMode('mini'))
  ipcMain.on('minimize-window', () => setWindowMode('mini'))
  ipcMain.on('close-window', () => setWindowMode('mini'))
  ipcMain.on('capture-screenshot', captureScreenshot)
  ipcMain.on('quit-app', () => app.quit())
}

app.whenReady().then(async () => {
  startupLog('app-ready')
  const userData = app.getPath('userData')
  memoFile = path.join(userData, 'memos.json')
  settingsFile = path.join(userData, 'settings.json')
  imageOriginFile = path.join(userData, 'image-origins.json')
  audioDir = path.join(userData, 'audio')
  fs.mkdirSync(audioDir, { recursive: true })

  session.defaultSession.setPermissionRequestHandler((_, permission, callback) => {
    callback(permission === 'media')
  })

  registerInternalProtocol()
  registerIpc()
  if (!mainWindow || mainWindow.isDestroyed()) createWindow()
  startClipboardWatcher()
  watchImageSources()
  registerShortcuts()
  startReminderService()

  const recoverWindow = () => ensureWindowVisible()
  screen.on('display-added', recoverWindow)
  screen.on('display-removed', recoverWindow)
  screen.on('display-metrics-changed', recoverWindow)
  visibilityTimer = setInterval(recoverWindow, 10000)
  visibilityTimer.unref()
  startupLog('startup-complete')
})

app.on('activate', () => {
  if (!app.isReady()) {
    pendingPanelOpen = true
    return
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    setWindowMode('panel', { activate: true, view: 'memos' })
  } else {
    pendingPanelOpen = true
    createWindow()
  }
})

app.on('did-become-active', () => ensureWindowVisible())

app.on('second-instance', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    setWindowMode('panel', { activate: true, view: 'memos' })
  } else {
    pendingPanelOpen = true
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', event => {
  if (quitting || imageWatchers.length === 0) return
  event.preventDefault()
  quitting = true
  startupLog(`closing-watchers count=${imageWatchers.length}`)
  const watchers = imageWatchers
  imageWatchers = []
  Promise.allSettled(watchers.map(watcher => watcher.close()))
    .finally(() => {
      startupLog('watchers-closed')
      app.exit(0)
    })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  if (reminderTimer) clearInterval(reminderTimer)
  if (visibilityTimer) clearInterval(visibilityTimer)
  if (clipboardTimer) clearInterval(clipboardTimer)
  if (widgetDragTimer) clearInterval(widgetDragTimer)
  clearInterval(windowMotionTimer)
  stopHoverMonitor()
  clearTimeout(positionSaveTimer)
  clearTimeout(positionSuppressTimer)
})
