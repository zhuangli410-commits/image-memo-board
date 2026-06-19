const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  listImages:       ()       => ipcRenderer.invoke('list-images'),
  saveDropped:      (p)      => ipcRenderer.invoke('save-dropped', p),
  pasteClipboard:   ()       => ipcRenderer.invoke('paste-clipboard'),
  copyToClipboard:  (p)      => ipcRenderer.invoke('copy-to-clipboard', p),
  deleteImage:      (p)      => ipcRenderer.invoke('delete-image', p),
  saveFromBuffer:   (buf, mime) => ipcRenderer.invoke('save-from-buffer', buf, mime),
  saveFromUrl:      (url)   => ipcRenderer.invoke('save-from-url', url),
  openFolder:       ()       => ipcRenderer.invoke('open-folder'),
  dragOut:          (p)      => ipcRenderer.send('drag-out', p),
  closeWindow:      ()       => ipcRenderer.send('close-window'),
  minimizeWindow:   ()       => ipcRenderer.send('minimize-window'),
  onFileAdded:      (cb)     => ipcRenderer.on('file-added',   (_, fp) => cb(fp)),
  onFileRemoved:    (cb)     => ipcRenderer.on('file-removed',  (_, fp) => cb(fp)),
})
