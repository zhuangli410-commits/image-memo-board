const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('api', {
  listImages: () => ipcRenderer.invoke('list-images'),
  saveDropped: path => ipcRenderer.invoke('save-dropped', path),
  importMedia: () => ipcRenderer.invoke('import-media'),
  pasteClipboard: () => ipcRenderer.invoke('paste-clipboard'),
  copyToClipboard: path => ipcRenderer.invoke('copy-to-clipboard', path),
  deleteImage: path => ipcRenderer.invoke('delete-image', path),
  deleteMediaBatch: paths => ipcRenderer.invoke('delete-media-batch', paths),
  exportMediaBatch: paths => ipcRenderer.invoke('export-media-batch', paths),
  saveFromBuffer: (buffer, mime) => ipcRenderer.invoke('save-from-buffer', buffer, mime),
  saveFromUrl: url => ipcRenderer.invoke('save-from-url', url),
  pathForFile: file => webUtils.getPathForFile(file),
  openFolder: () => ipcRenderer.invoke('open-folder'),
  dragOut: path => ipcRenderer.send('drag-out', path),

  listMemos: () => ipcRenderer.invoke('list-memos'),
  saveMemo: memo => ipcRenderer.invoke('save-memo', memo),
  toggleMemoComplete: id => ipcRenderer.invoke('toggle-memo-complete', id),
  deleteMemo: id => ipcRenderer.invoke('delete-memo', id),
  runOcr: path => ipcRenderer.invoke('run-ocr', path),

  requestMicrophone: () => ipcRenderer.invoke('request-microphone'),
  importAudio: () => ipcRenderer.invoke('import-audio'),
  saveAudioBuffer: (buffer, mime) => ipcRenderer.invoke('save-audio-buffer', buffer, mime),
  transcribeAudio: path => ipcRenderer.invoke('transcribe-audio', path),

  getAiSettings: () => ipcRenderer.invoke('get-ai-settings'),
  saveAiSettings: settings => ipcRenderer.invoke('save-ai-settings', settings),
  summarizeMemo: id => ipcRenderer.invoke('summarize-memo', id),
  planMemoTasks: input => ipcRenderer.invoke('plan-memo-tasks', input),
  createPlannedMemos: input => ipcRenderer.invoke('create-planned-memos', input),

  widgetHover: entered => ipcRenderer.send('widget-hover', entered),
  setHoverHasTasks: hasTasks => ipcRenderer.send('hover-has-tasks', hasTasks),
  beginWidgetDrag: () => ipcRenderer.send('widget-drag-start'),
  endWidgetDrag: () => ipcRenderer.send('widget-drag-end'),
  openPanel: view => ipcRenderer.send('open-panel', view),
  collapseWindow: () => ipcRenderer.send('collapse-window'),
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  closeWindow: () => ipcRenderer.send('close-window'),
  captureScreenshot: () => ipcRenderer.send('capture-screenshot'),
  quitApp: () => ipcRenderer.send('quit-app'),

  onFileAdded: callback => ipcRenderer.on('file-added', (_, path) => callback(path)),
  onFileRemoved: callback => ipcRenderer.on('file-removed', (_, path) => callback(path)),
  onMemosChanged: callback => ipcRenderer.on('memos-changed', callback),
  onWindowMode: callback => ipcRenderer.on('window-mode', (_, payload) => callback(payload)),
  onShortcutStatus: callback => ipcRenderer.on('shortcut-status', (_, status) => callback(status)),
  onScreenshotCreated: callback => ipcRenderer.on('screenshot-created', (_, path) => callback(path)),
  onScreenshotError: callback => ipcRenderer.on('screenshot-error', (_, detail) => callback(detail))
})
