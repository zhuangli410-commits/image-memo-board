let images = []

async function init() {
  images = await window.api.listImages()
  render()

  window.api.onFileAdded(async fp => {
    if (images.find(i => i.path === fp)) return
    const all = await window.api.listImages()
    const item = all.find(i => i.path === fp)
    if (item) { images.unshift(item); render() }
  })

  window.api.onFileRemoved(fp => {
    images = images.filter(i => i.path !== fp)
    render()
  })
}

function formatTime(mtime) {
  const d = new Date(mtime)
  const p = n => String(n).padStart(2, '0')
  return `${p(d.getMonth()+1)}/${p(d.getDate())}\n${p(d.getHours())}:${p(d.getMinutes())}`
}

function render() {
  const grid = document.getElementById('grid')
  const count = document.getElementById('count')
  const dropHint = document.getElementById('drop-hint')

  count.textContent = `${images.length} 张图`
  dropHint.textContent = images.length ? '拖入 · ⌘V · ⌘⇧X' : '拖入图片 · ⌘V 粘贴 · ⌘⇧X 截图'

  grid.innerHTML = ''
  images.forEach(img => {
    const div = document.createElement('div')
    div.className = 'thumb'
    div.draggable = true
    div.innerHTML = `
      <img src="file://${img.path}" draggable="false">
      <div class="overlay">
        <span class="ts">${formatTime(img.mtime)}</span>
        <button class="btn-copy">复制</button>
        <button class="btn-del">删除</button>
      </div>
    `

    div.addEventListener('dragstart', e => {
      e.preventDefault()
      window.api.dragOut(img.path)
    })

    div.querySelector('.btn-copy').addEventListener('click', async e => {
      e.stopPropagation()
      await window.api.copyToClipboard(img.path)
      showToast('已复制到剪贴板')
    })

    div.querySelector('.btn-del').addEventListener('click', async e => {
      e.stopPropagation()
      await window.api.deleteImage(img.path)
    })

    grid.appendChild(div)
  })
}

// Drop handling — covers files from Finder AND images dragged from browsers
document.addEventListener('dragover', e => {
  e.preventDefault()
  document.getElementById('drop-zone').classList.add('dragover')
})

document.addEventListener('dragleave', e => {
  if (e.relatedTarget === null)
    document.getElementById('drop-zone').classList.remove('dragover')
})

document.addEventListener('drop', async e => {
  e.preventDefault()
  document.getElementById('drop-zone').classList.remove('dragover')

  // 1. Local files (from Finder)
  const localFiles = Array.from(e.dataTransfer.files).filter(f =>
    /\.(png|jpg|jpeg|gif|webp)$/i.test(f.name) && f.path
  )
  for (const f of localFiles) {
    await window.api.saveDropped(f.path)
  }
  if (localFiles.length) return

  // 2. Image dragged from browser (DataTransfer items as file)
  const items = Array.from(e.dataTransfer.items)
  for (const item of items) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (file) {
        const buf = await file.arrayBuffer()
        await window.api.saveFromBuffer(Array.from(new Uint8Array(buf)), item.type)
      }
    }
  }

  // 3. URL dragged (e.g. img src from browser)
  const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain')
  if (url && /^https?:\/\/.+\.(png|jpg|jpeg|gif|webp)/i.test(url)) {
    await window.api.saveFromUrl(url)
  }
})

// Cmd+V paste
window.addEventListener('keydown', async e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'v') {
    const result = await window.api.pasteClipboard()
    if (!result) showToast('剪贴板中没有图片')
  }
})

// Toast
function showToast(msg) {
  let toast = document.getElementById('toast')
  if (!toast) {
    toast = document.createElement('div')
    toast.id = 'toast'
    document.body.appendChild(toast)
  }
  toast.textContent = msg
  toast.classList.add('show')
  setTimeout(() => toast.classList.remove('show'), 1800)
}

// Controls
document.getElementById('btn-close').addEventListener('click', () => window.api.closeWindow())
document.getElementById('btn-min').addEventListener('click', () => window.api.minimizeWindow())
document.getElementById('btn-folder').addEventListener('click', () => window.api.openFolder())

init()
