let images = []
let memos = []
let activeView = 'board'
let toastTimer
let mediaRecorder
let mediaStream
let audioChunks = []
let recordingStartedAt = 0
let recordingTicker
let calendarCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
let selectedDay = dateKey(new Date())
let shortcutStatus = { commandJ: false, legacy: false }
let miniPointer = null
let miniPointerCompletedAt = 0
const miniRotationStartedAt = Date.now()
const DEFAULT_MEMO_COLOR = '#5b9cf6'
let lastHoverHasTasks = null
let miniHoverSignature = ''
let miniDropAnimationTimer
let miniHoverWheelLastAt = 0
let selectedMediaPaths = new Set()
let selectionAnchorPath = null
let marqueeSelection = null
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

const $ = selector => document.querySelector(selector)
const $$ = selector => Array.from(document.querySelectorAll(selector))

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function dateKey(value) {
  const date = value instanceof Date ? value : new Date(value)
  const pad = number => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function formatDateTime(value) {
  if (!value) return '未设置 DDL'
  const date = new Date(value)
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date)
}

function toLocalInput(value) {
  if (!value) return ''
  const date = new Date(value)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

function countdownInfo(memo, now = Date.now()) {
  if (memo.completedAt) return { text: '已完成', className: 'completed' }
  if (!memo.dueAt) return { text: '无 DDL', className: '' }
  const delta = new Date(memo.dueAt).getTime() - now
  const absolute = Math.abs(delta)
  const days = Math.floor(absolute / 86400000)
  const hours = Math.floor((absolute % 86400000) / 3600000)
  const minutes = Math.floor((absolute % 3600000) / 60000)
  const seconds = Math.floor((absolute % 60000) / 1000)
  let detail
  if (days > 0) detail = `${days}天${hours}小时`
  else if (hours > 0) detail = `${hours}小时${minutes}分`
  else detail = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  if (delta < 0) return { text: `超时 ${detail}`, className: 'overdue' }
  return {
    text: `剩 ${detail}`,
    className: delta <= 3600000 ? 'soon' : ''
  }
}

function showToast(message, isError = false) {
  const toast = $('#toast')
  toast.textContent = message
  toast.style.background = isError ? 'rgba(224,85,85,.94)' : 'rgba(91,156,246,.92)'
  toast.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => toast.classList.remove('show'), isError ? 7000 : 2400)
}

async function reloadImages() {
  images = await window.api.listImages()
  const availablePaths = new Set(images.map(item => item.path))
  selectedMediaPaths = new Set([...selectedMediaPaths].filter(filePath => availablePaths.has(filePath)))
  if (selectionAnchorPath && !availablePaths.has(selectionAnchorPath)) selectionAnchorPath = null
  renderImages()
}

async function reloadMemos() {
  memos = await window.api.listMemos()
  renderMemos()
  renderCalendar()
  renderClock()
  renderMini()
}

function showView(view) {
  activeView = ['board', 'memos', 'calendar', 'clock'].includes(view) ? view : 'board'
  $$('.tab').forEach(tab => tab.classList.toggle('active', tab.dataset.view === activeView))
  $$('.view').forEach(section => section.classList.toggle('active', section.id === `view-${activeView}`))
  if (activeView === 'calendar') renderCalendar()
  if (activeView === 'clock') renderClock()
}

function applyWindowMode(payload) {
  const mode = payload?.mode || 'mini'
  if (mode !== document.body.dataset.mode) resetMiniDropAnimation()
  document.body.dataset.mode = mode
  document.body.dataset.placement = payload?.placement || 'right'
  if (mode === 'panel') showView(payload?.view || activeView)
}

function memoProgress(memo, now = Date.now()) {
  if (!memo.dueAt) return null
  const start = new Date(memo.createdAt).getTime()
  const end = new Date(memo.dueAt).getTime()
  return Math.max(0, Math.min(1, (now - start) / Math.max(1, end - start)))
}

function memoColor(memo) {
  return /^#[0-9a-f]{6}$/i.test(memo?.color || '') ? memo.color : DEFAULT_MEMO_COLOR
}

function colorWithAlpha(hex, alpha) {
  const value = hex.replace('#', '')
  const red = Number.parseInt(value.slice(0, 2), 16)
  const green = Number.parseInt(value.slice(2, 4), 16)
  const blue = Number.parseInt(value.slice(4, 6), 16)
  return `rgba(${red},${green},${blue},${alpha})`
}

function renderOverlaidRing(ring, ddlMemos, now) {
  if (!ddlMemos.length) return false
  const progressLayers = ddlMemos.map(memo => {
    const end = memoProgress(memo, now) * 360
    const color = colorWithAlpha(memoColor(memo), 0.78)
    return `conic-gradient(${color} 0deg ${end}deg, transparent ${end}deg 360deg)`
  })
  progressLayers.push('conic-gradient(rgba(255,255,255,0.10) 0deg 360deg)')
  ring.style.background = progressLayers.join(', ')
  ring.style.backgroundBlendMode = 'screen'
  return true
}

function renderMiniHoverTasks(pending) {
  const signature = pending.map(memo => `${memo.id}:${memo.updatedAt}:${memo.color}`).join('|')
  const track = $('#mini-hover-track')
  if (signature !== miniHoverSignature) {
    miniHoverSignature = signature
    track.replaceChildren()
    pending.forEach(memo => {
      const color = memoColor(memo)
      const card = document.createElement('article')
      card.className = 'mini-hover-card'
      card.dataset.id = memo.id
      card.innerHTML = `
        <div class="mini-hover-card-head">
          <i style="background:${escapeHtml(color)}" aria-hidden="true"></i>
          <strong>${escapeHtml(memo.title)}</strong>
        </div>
      `
      track.appendChild(card)
    })
  }
}

function renderMini() {
  const now = new Date()
  $('#mini-time').textContent = new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(now)

  const pendingDdl = memos
    .filter(memo => !memo.completedAt && memo.dueAt)
    .sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt))
  const pendingAll = memos
    .filter(memo => !memo.completedAt)
    .sort((a, b) => {
      if (a.dueAt && b.dueAt) return new Date(a.dueAt) - new Date(b.dueAt)
      if (a.dueAt) return -1
      if (b.dueAt) return 1
      return new Date(b.createdAt) - new Date(a.createdAt)
    })
  const rotationIndex = pendingDdl.length
    ? Math.floor((Date.now() - miniRotationStartedAt) / 10000) % pendingDdl.length
    : 0
  const next = pendingDdl[rotationIndex]
  if (lastHoverHasTasks !== Boolean(pendingAll.length)) {
    lastHoverHasTasks = Boolean(pendingAll.length)
    window.api.setHoverHasTasks(lastHoverHasTasks)
  }
  renderMiniHoverTasks(pendingAll)
  const ring = $('#mini-ring')
  const ddlDot = $('#mini-ddl-dot')
  const ddlText = $('#mini-ddl-text')
  if (next) {
    const info = countdownInfo(next)
    const color = memoColor(next)
    ddlDot.hidden = false
    ddlDot.style.backgroundColor = color
    ddlText.textContent = info.text.replace('剩 ', '')
  } else {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const end = start + 86400000
    ddlDot.hidden = true
    ddlText.textContent = `${now.getMonth() + 1}/${now.getDate()}`
    const dayProgress = (Date.now() - start) / (end - start)
    ring.style.background = `conic-gradient(var(--accent) 0deg ${dayProgress * 360}deg, rgba(255,255,255,0.10) ${dayProgress * 360}deg 360deg)`
    ring.style.backgroundBlendMode = 'normal'
  }
  renderOverlaidRing(ring, pendingDdl, now.getTime())
}

function formatImageTime(mtime) {
  const date = new Date(mtime)
  const pad = number => String(number).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())}\n${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function selectedMedia() {
  return images.filter(item => selectedMediaPaths.has(item.path))
}

function updateSelectionUi() {
  const selected = selectedMedia()
  $$('#grid .thumb').forEach(card => {
    const isSelected = selectedMediaPaths.has(card.dataset.path)
    card.classList.toggle('selected', isSelected)
    card.setAttribute('aria-selected', String(isSelected))
  })
  const batchActions = $('#batch-actions')
  const entryActions = $('#board-entry-actions')
  batchActions.hidden = selected.length === 0
  entryActions.hidden = selected.length > 0
  $('#selection-count').textContent = `已选 ${selected.length} 项`
  const imageCount = selected.filter(item => item.kind !== 'video').length
  const ocrButton = $('#btn-batch-ocr')
  ocrButton.disabled = imageCount === 0
  ocrButton.title = imageCount ? `识别所选的 ${imageCount} 张图片` : '视频不能进行 OCR'
}

function clearMediaSelection() {
  selectedMediaPaths.clear()
  selectionAnchorPath = null
  updateSelectionUi()
}

function selectMediaPath(filePath, event = {}) {
  const index = images.findIndex(item => item.path === filePath)
  if (index < 0) return
  if (event.shiftKey && selectionAnchorPath) {
    const anchorIndex = images.findIndex(item => item.path === selectionAnchorPath)
    if (anchorIndex >= 0) {
      if (!event.metaKey && !event.ctrlKey) selectedMediaPaths.clear()
      const start = Math.min(anchorIndex, index)
      const end = Math.max(anchorIndex, index)
      images.slice(start, end + 1).forEach(item => selectedMediaPaths.add(item.path))
    }
  } else if (event.metaKey || event.ctrlKey) {
    if (selectedMediaPaths.has(filePath)) selectedMediaPaths.delete(filePath)
    else selectedMediaPaths.add(filePath)
    selectionAnchorPath = filePath
  } else {
    selectedMediaPaths = new Set([filePath])
    selectionAnchorPath = filePath
  }
  updateSelectionUi()
}

async function importMediaFromPicker() {
  try {
    const result = await window.api.importMedia()
    const count = result?.imported?.length || 0
    if (!count && !result?.failed?.length) return
    await reloadImages()
    showToast(result.failed?.length
      ? `已导入 ${count} 项，${result.failed.length} 项失败`
      : `已批量导入 ${count} 项`, Boolean(result.failed?.length))
  } catch (error) {
    showToast(error.message || '批量导入失败', true)
  }
}

async function pasteMediaFromClipboard() {
  try {
    const imported = await window.api.pasteClipboard()
    const count = Array.isArray(imported) ? imported.length : imported ? 1 : 0
    if (!count) {
      showToast('剪贴板中没有图片或视频文件', true)
      return
    }
    await reloadImages()
    showToast(count > 1 ? `已粘贴 ${count} 项` : '已粘贴到图片中转站')
  } catch (error) {
    showToast(error.message || '粘贴失败', true)
  }
}

async function exportSelectedMedia() {
  const selected = selectedMedia()
  if (!selected.length) return
  try {
    const result = await window.api.exportMediaBatch(selected.map(item => item.path))
    if (result) showToast(`已导出 ${result.count} 项`)
  } catch (error) {
    showToast(error.message || '批量导出失败', true)
  }
}

async function deleteSelectedMedia() {
  const selected = selectedMedia()
  if (!selected.length) return
  const withOriginal = selected.filter(item => item.hasOriginal).length
  const detail = withOriginal
    ? `其中 ${withOriginal} 项有关联原文件，副本和原文件都会移到系统废纸篓。`
    : '所选文件会移到系统废纸篓，可恢复。'
  if (!confirm(`删除所选的 ${selected.length} 项？\n${detail}`)) return
  try {
    const result = await window.api.deleteMediaBatch(selected.map(item => item.path))
    clearMediaSelection()
    await reloadImages()
    showToast(result.failed?.length
      ? `已删除 ${result.trashed} 项，${result.failed.length} 项失败`
      : `已将 ${result.trashed} 项移到废纸篓`, Boolean(result.failed?.length))
  } catch (error) {
    showToast(error.message || '批量删除失败', true)
  }
}

async function runBatchOcr() {
  const selectedImages = selectedMedia().filter(item => item.kind !== 'video')
  if (!selectedImages.length) return
  showToast(`正在识别 ${selectedImages.length} 张图片…`)
  const sections = []
  const failed = []
  for (const image of selectedImages) {
    try {
      const text = await window.api.runOcr(image.path)
      sections.push(`【${image.name}】\n${text}`)
    } catch (error) {
      failed.push(image.name)
    }
  }
  if (!sections.length) {
    showToast('所选图片均未识别到文字', true)
    return
  }
  openMemoDialog({
    type: 'ocr',
    title: `批量 OCR（${sections.length} 张）`,
    content: sections.join('\n\n────────\n\n')
  })
  if (failed.length) showToast(`${failed.length} 张图片未识别到文字`, true)
}

function renderImages() {
  const grid = $('#grid')
  const imageCount = images.filter(item => item.kind !== 'video').length
  const videoCount = images.filter(item => item.kind === 'video').length
  $('#image-count').textContent = `${imageCount} 张图 · ${videoCount} 个视频`
  $('#drop-hint').textContent = images.length
    ? '拖入 · ⌘V · ⌘J'
    : '拖入图片或视频 · ⌘V 粘贴 · ⌘J 苹果截屏'
  grid.replaceChildren()

  for (const image of images) {
    const isVideo = image.kind === 'video'
    const card = document.createElement('article')
    card.className = `thumb${isVideo ? ' media-video' : ''}${selectedMediaPaths.has(image.path) ? ' selected' : ''}`
    card.dataset.path = image.path
    card.tabIndex = 0
    card.setAttribute('role', 'option')
    card.setAttribute('aria-label', image.name)
    card.setAttribute('aria-selected', String(selectedMediaPaths.has(image.path)))
    card.draggable = true
    card.innerHTML = `
      ${isVideo
        ? `<video src="${escapeHtml(image.url)}" draggable="false" controls playsinline preload="metadata" aria-label="${escapeHtml(image.name)}"></video>`
        : `<img src="${escapeHtml(image.url)}" draggable="false" alt="${escapeHtml(image.name)}">`}
      <span class="selection-check" aria-hidden="true">✓</span>
      <div class="overlay${isVideo ? ' no-ocr' : ''}">
        <span class="ts">${escapeHtml(formatImageTime(image.mtime))}</span>
        <button class="btn-copy">复制</button>
        <button class="btn-memo">备忘</button>
        ${isVideo ? '' : '<button class="btn-ocr">OCR</button>'}
        <button class="btn-del">删除</button>
      </div>
    `

    if (!isVideo) {
      const imageElement = card.querySelector('img')
      imageElement.addEventListener('load', function downscale() {
        const size = 180
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const context = canvas.getContext('2d')
        const scale = Math.max(size / this.naturalWidth, size / this.naturalHeight)
        const width = this.naturalWidth * scale
        const height = this.naturalHeight * scale
        context.drawImage(this, (size - width) / 2, (size - height) / 2, width, height)
        this.src = canvas.toDataURL('image/jpeg', 0.82)
      }, { once: true })
    }

    card.addEventListener('dragstart', event => {
      event.preventDefault()
      window.api.dragOut(image.path)
    })
    card.addEventListener('click', event => {
      if (event.target.closest('button, video')) return
      selectMediaPath(image.path, event)
    })
    card.addEventListener('keydown', event => {
      if (!['Enter', ' '].includes(event.key)) return
      event.preventDefault()
      selectMediaPath(image.path, event)
    })
    card.querySelector('.btn-copy').addEventListener('click', async event => {
      event.stopPropagation()
      const success = await window.api.copyToClipboard(image.path)
      showToast(success ? `${isVideo ? '视频文件' : '图片'}已复制到剪贴板` : '复制失败', !success)
    })
    card.querySelector('.btn-memo').addEventListener('click', event => {
      event.stopPropagation()
      openMemoDialog({
        type: isVideo ? 'video' : 'image',
        title: isVideo ? '视频备忘' : '图片备忘',
        content: '',
        imagePath: image.path,
        imageUrl: image.url,
        mediaKind: image.kind
      })
    })
    card.querySelector('.btn-ocr')?.addEventListener('click', async event => {
      event.stopPropagation()
      await createOcrMemo(image)
    })
    card.querySelector('.btn-del').addEventListener('click', async event => {
      event.stopPropagation()
      const detail = image.hasOriginal
        ? '中转站副本和电脑上的原文件都会移到废纸篓，可恢复。'
        : `这个${isVideo ? '视频' : '图片'}会从中转站移到系统废纸篓，可恢复。`
      if (!confirm(`删除“${image.name}”？\n${detail}`)) return
      try {
        const result = await window.api.deleteImage(image.path)
        showToast(result?.originalTrashed ? '副本和原文件已移到废纸篓' : `${isVideo ? '视频' : '图片'}已移到废纸篓`)
      } catch (error) {
        showToast(error.message || '删除失败', true)
      }
    })
    grid.appendChild(card)
  }
  updateSelectionUi()
}

async function createOcrMemo(image) {
  showToast('正在本地 OCR…')
  try {
    const text = await window.api.runOcr(image.path)
    openMemoDialog({
      type: 'ocr',
      title: 'OCR 备忘',
      content: text,
      imagePath: image.path,
      imageUrl: image.url
    })
  } catch (error) {
    showToast(error.message || 'OCR 失败', true)
  }
}

const typeNames = {
  image: '图片',
  video: '视频',
  text: '文字',
  voice: '语音',
  ocr: 'OCR',
  summary: '总结'
}

function renderMemos() {
  const list = $('#memo-list')
  const now = Date.now()
  const sorted = [...memos].sort((a, b) => {
    if (Boolean(a.completedAt) !== Boolean(b.completedAt)) return a.completedAt ? 1 : -1
    const priorityRank = { high: 0, medium: 1, low: 2 }
    const priorityA = priorityRank[a.priority] ?? 1
    const priorityB = priorityRank[b.priority] ?? 1
    if (priorityA !== priorityB) {
      return priorityA - priorityB
    }
    if (!a.dueAt && !b.dueAt) return new Date(b.createdAt) - new Date(a.createdAt)
    if (!a.dueAt) return 1
    if (!b.dueAt) return -1
    return new Date(a.dueAt) - new Date(b.dueAt)
  })
  const pending = sorted.filter(memo => !memo.completedAt)
  const overdue = pending.filter(memo => memo.dueAt && new Date(memo.dueAt).getTime() < now)
  $('#memo-summary').innerHTML = `
    <span>待办 ${pending.length}</span>
    <span>超时 ${overdue.length}</span>
    <span>全部 ${memos.length}</span>
  `
  list.replaceChildren()
  if (!sorted.length) {
    list.innerHTML = '<div class="empty-state">还没有备忘事项<br>可从图片、视频、文字或语音开始</div>'
    return
  }

  for (const memo of sorted) {
    const info = countdownInfo(memo, now)
    const card = document.createElement('article')
    card.className = `memo-card ${info.className}${memo.parentId ? ' child' : ''}`
    card.dataset.id = memo.id
    card.style.setProperty('--memo-color', memo.color || DEFAULT_MEMO_COLOR)
    card.innerHTML = `
      <div class="memo-card-head">
        <input type="checkbox" class="memo-check" ${memo.completedAt ? 'checked' : ''} aria-label="标记完成">
        <div class="memo-main">
          <div class="memo-title-row">
            <span class="type-chip">${escapeHtml(typeNames[memo.type] || memo.type)}</span>
            <i class="memo-color-dot" style="background:${escapeHtml(memo.color || DEFAULT_MEMO_COLOR)}" aria-label="待办颜色"></i>
            <span class="priority-chip ${escapeHtml(memo.priority || 'medium')}">${escapeHtml({ high: '高', medium: '中', low: '低' }[memo.priority] || '中')}</span>
            <strong>${escapeHtml(memo.title)}</strong>
            <span class="countdown">${escapeHtml(info.text)}</span>
          </div>
          ${memo.content ? `<div class="memo-content">${escapeHtml(memo.content)}</div>` : ''}
          ${memo.imageUrl
            ? memo.mediaKind === 'video'
              ? `<video class="memo-video" controls playsinline preload="metadata" src="${escapeHtml(memo.imageUrl)}"></video>`
              : `<img class="memo-image" src="${escapeHtml(memo.imageUrl)}" alt="">`
            : ''}
          ${memo.audioUrl ? `<audio class="memo-audio" controls src="${escapeHtml(memo.audioUrl)}"></audio>` : ''}
          <div class="memo-meta">${escapeHtml(formatDateTime(memo.dueAt))}</div>
        </div>
      </div>
      <div class="memo-actions">
        ${memo.content && memo.type !== 'summary' ? '<button class="summarize">DeepSeek 精简</button>' : ''}
        ${memo.content ? '<button class="ai-plan">AI 排待办</button>' : ''}
        <button class="edit">编辑</button>
        <button class="delete">删除</button>
      </div>
    `
    card.querySelector('.memo-check').addEventListener('change', async () => {
      await window.api.toggleMemoComplete(memo.id)
      await reloadMemos()
    })
    card.querySelector('.edit').addEventListener('click', () => openMemoDialog(memo))
    card.querySelector('.delete').addEventListener('click', async () => {
      if (!confirm(`删除备忘“${memo.title}”？关联的图片、视频或语音文件不会被删除。`)) return
      await window.api.deleteMemo(memo.id)
      await reloadMemos()
    })
    card.querySelector('.summarize')?.addEventListener('click', async () => {
      if (!confirm('将当前文字发送给已配置的 DeepSeek API 进行精简，是否继续？')) return
      showToast('DeepSeek 正在总结…')
      try {
        await window.api.summarizeMemo(memo.id)
        await reloadMemos()
        showToast('已生成总结备忘')
      } catch (error) {
        showToast(error.message || '总结失败', true)
      }
    })
    card.querySelector('.ai-plan')?.addEventListener('click', () => planTasksWithDeepSeek({
      title: memo.title,
      content: memo.content,
      sourceType: memo.type
    }))
    list.appendChild(card)
  }
}

function setMemoColor(value) {
  const normalized = String(value || '').toLowerCase()
  const selectedColor = MEMO_COLOR_PALETTE.includes(normalized) ? normalized : DEFAULT_MEMO_COLOR
  const option = $(`input[name="memo-color"][value="${selectedColor}"]`)
  if (option) option.checked = true
}

function selectedMemoColor() {
  return $('input[name="memo-color"]:checked')?.value || DEFAULT_MEMO_COLOR
}

function openMemoDialog(data = {}) {
  $('#memo-id').value = data.id || ''
  $('#memo-type').value = data.type || 'text'
  $('#memo-image-path').value = data.imagePath || ''
  $('#memo-audio-path').value = data.audioPath || ''
  $('#memo-parent-id').value = data.parentId || ''
  $('#memo-title-input').value = data.title || ''
  $('#memo-content-input').value = data.content || ''
  $('#memo-due-input').value = toLocalInput(data.dueAt)
  $('#memo-remind-input').value = String(data.remindMinutes || 0)
  $('#memo-priority-input').value = data.priority || 'medium'
  setMemoColor(data.color)
  $('#memo-dialog-title').textContent = data.id ? '编辑备忘' : '新建备忘'
  const preview = $('#memo-preview')
  preview.innerHTML = data.imageUrl
    ? data.mediaKind === 'video' || data.type === 'video'
      ? `<video controls playsinline preload="metadata" src="${escapeHtml(data.imageUrl)}"></video>`
      : `<img src="${escapeHtml(data.imageUrl)}" alt="关联图片">`
    : data.audioUrl || data.audioPath
      ? '<span class="form-tip">已关联一段录音</span>'
      : ''
  $('#memo-dialog').showModal()
  setTimeout(() => $('#memo-title-input').focus(), 0)
}

function closeMemoDialog() {
  $('#memo-dialog').close()
}

async function submitMemo(event) {
  event.preventDefault()
  const dueValue = $('#memo-due-input').value
  const memo = {
    id: $('#memo-id').value || null,
    type: $('#memo-type').value || 'text',
    imagePath: $('#memo-image-path').value || null,
    audioPath: $('#memo-audio-path').value || null,
    parentId: $('#memo-parent-id').value || null,
    title: $('#memo-title-input').value,
    content: $('#memo-content-input').value,
    dueAt: dueValue ? new Date(dueValue).toISOString() : null,
    remindMinutes: Number($('#memo-remind-input').value) || 0,
    priority: $('#memo-priority-input').value || 'medium',
    color: selectedMemoColor()
  }
  try {
    await window.api.saveMemo(memo)
    closeMemoDialog()
    await reloadMemos()
    showView('memos')
    showToast('备忘已保存')
  } catch (error) {
    showToast(error.message || '保存失败', true)
  }
}

async function planTasksWithDeepSeek(input) {
  if (!input.content?.trim() && !input.title?.trim()) {
    showToast('请先输入要安排的事情', true)
    return
  }
  if (!confirm('将当前文字发送给已配置的 DeepSeek，由它拆分并排序待办，是否继续？')) return
  showToast('DeepSeek 正在规划待办…')
  try {
    const tasks = await window.api.planMemoTasks(input)
    const priorityName = { high: '高', medium: '中', low: '低' }
    const preview = tasks.map((task, index) => {
      const due = task.dueAt ? formatDateTime(task.dueAt) : '无 DDL'
      return `${index + 1}. [${priorityName[task.priority]}] ${task.title} · ${due}`
    }).join('\n')
    if (!confirm(`DeepSeek 建议创建以下 ${tasks.length} 个待办：\n\n${preview}\n\n确认写入？`)) return
    await window.api.createPlannedMemos({ tasks })
    closeMemoDialog()
    await reloadMemos()
    showView('memos')
    showToast(`已创建 ${tasks.length} 个待办`)
  } catch (error) {
    showToast(error.message || '待办规划失败', true)
  }
}

function renderCalendar() {
  const grid = $('#calendar-grid')
  if (!grid) return
  const year = calendarCursor.getFullYear()
  const month = calendarCursor.getMonth()
  $('#calendar-title').textContent = `${year} 年 ${month + 1} 月`
  const first = new Date(year, month, 1)
  const mondayOffset = (first.getDay() + 6) % 7
  const start = new Date(year, month, 1 - mondayOffset)
  const dueByDay = new Map()
  for (const memo of memos.filter(item => item.dueAt && !item.completedAt)) {
    const key = dateKey(memo.dueAt)
    if (!dueByDay.has(key)) dueByDay.set(key, [])
    dueByDay.get(key).push(memo)
  }
  grid.replaceChildren()
  for (let index = 0; index < 42; index += 1) {
    const day = new Date(start)
    day.setDate(start.getDate() + index)
    const key = dateKey(day)
    const items = dueByDay.get(key) || []
    const button = document.createElement('button')
    button.className = [
      'calendar-cell',
      day.getMonth() !== month ? 'outside' : '',
      key === dateKey(new Date()) ? 'today' : '',
      key === selectedDay ? 'selected' : ''
    ].filter(Boolean).join(' ')
    const dots = items.slice(0, 4).map(item => {
      const overdue = new Date(item.dueAt).getTime() < Date.now()
      return `<i class="day-dot${overdue ? ' overdue' : ''}"></i>`
    }).join('')
    button.innerHTML = `<span>${day.getDate()}</span><span class="day-dots">${dots}</span>`
    button.addEventListener('click', () => {
      selectedDay = key
      renderCalendar()
    })
    grid.appendChild(button)
  }
  renderCalendarDayList()
}

function renderCalendarDayList() {
  const list = $('#calendar-day-list')
  const items = memos
    .filter(memo => memo.dueAt && dateKey(memo.dueAt) === selectedDay)
    .sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt))
  list.innerHTML = items.length
    ? items.map(memo => `
      <div class="day-item">
        <time>${new Date(memo.dueAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}</time>
        <span>${escapeHtml(memo.title)}</span>
        <small>${memo.completedAt ? '✓' : escapeHtml(countdownInfo(memo).text)}</small>
      </div>
    `).join('')
    : `<div class="empty-state">${escapeHtml(selectedDay)} 没有 DDL</div>`
}

function renderClock() {
  const taskLayer = $('#clock-tasks')
  if (!taskLayer) return
  const today = dateKey(new Date())
  const tasks = memos
    .filter(memo => memo.dueAt && dateKey(memo.dueAt) === today && !memo.completedAt)
    .sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt))
  taskLayer.innerHTML = tasks.map(memo => {
    const date = new Date(memo.dueAt)
    const fraction = (date.getHours() + date.getMinutes() / 60) / 24
    const angle = fraction * 360
    const overdue = date.getTime() < Date.now()
    return `<i class="clock-task-dot${overdue ? ' overdue' : ''}" style="--angle:${angle}deg" title="${escapeHtml(memo.title)}"></i>`
  }).join('')
  $('#clock-list').innerHTML = tasks.length
    ? tasks.map(memo => `
      <div class="day-item">
        <time>${new Date(memo.dueAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}</time>
        <span>${escapeHtml(memo.title)}</span>
        <small>${escapeHtml(countdownInfo(memo).text)}</small>
      </div>
    `).join('')
    : '<div class="empty-state">今天没有设置 DDL 的待办</div>'
}

function updateLiveTime() {
  const now = new Date()
  $('#dial-time').textContent = now.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
  $('#dial-date').textContent = `${now.getMonth() + 1}月${now.getDate()}日 星期${'日一二三四五六'[now.getDay()]}`
  renderMini()
  $$('.memo-card').forEach(card => {
    const memo = memos.find(item => item.id === card.dataset.id)
    if (!memo) return
    const info = countdownInfo(memo)
    card.classList.remove('overdue', 'soon', 'completed')
    if (info.className) card.classList.add(info.className)
    card.querySelector('.countdown').textContent = info.text
  })
}

async function importVoiceFile() {
  try {
    const audio = await window.api.importAudio()
    if (!audio) return
    showToast('语音已导入，正在尝试本地转写…')
    let transcript = ''
    try {
      transcript = await window.api.transcribeAudio(audio.path)
    } catch {
      showToast('语音已保留；转写暂不可用', true)
    }
    openMemoDialog({
      type: 'voice',
      title: audio.name.replace(/\.[^.]+$/, '') || '导入语音备忘',
      content: transcript,
      audioPath: audio.path,
      audioUrl: audio.url
    })
  } catch (error) {
    showToast(error.message || '导入语音失败', true)
  }
}

async function toggleRecording() {
  if (mediaRecorder?.state === 'recording') {
    mediaRecorder.stop()
    return
  }
  try {
    const allowed = await window.api.requestMicrophone()
    if (!allowed) throw new Error('未获得麦克风权限')
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const mimeChoices = [
      'audio/mp4;codecs=mp4a.40.2',
      'audio/mp4',
      'audio/webm;codecs=opus',
      'audio/webm'
    ]
    const mimeType = mimeChoices.find(type => MediaRecorder.isTypeSupported(type)) || ''
    mediaRecorder = mimeType
      ? new MediaRecorder(mediaStream, { mimeType })
      : new MediaRecorder(mediaStream)
    audioChunks = []
    mediaRecorder.ondataavailable = event => {
      if (event.data.size) audioChunks.push(event.data)
    }
    mediaRecorder.onstop = finishRecording
    mediaRecorder.start(500)
    recordingStartedAt = Date.now()
    $('#btn-voice').classList.add('recording')
    $('#btn-voice').textContent = '■ 停止'
    recordingTicker = setInterval(() => {
      const seconds = Math.floor((Date.now() - recordingStartedAt) / 1000)
      $('#recording-state').textContent = `录音 ${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
    }, 250)
  } catch (error) {
    showToast(error.message || '无法开始录音', true)
  }
}

async function finishRecording() {
  clearInterval(recordingTicker)
  $('#btn-voice').classList.remove('recording')
  $('#btn-voice').textContent = '🎙 语音'
  $('#recording-state').textContent = ''
  mediaStream?.getTracks().forEach(track => track.stop())
  const mime = mediaRecorder.mimeType || audioChunks[0]?.type || 'audio/webm'
  const blob = new Blob(audioChunks, { type: mime })
  try {
    const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()))
    const audioPath = await window.api.saveAudioBuffer(bytes, mime)
    showToast('录音完成，正在尝试本地转写…')
    let transcript = ''
    try {
      transcript = await window.api.transcribeAudio(audioPath)
    } catch (error) {
      showToast(`录音已保留；转写暂不可用`, true)
    }
    openMemoDialog({
      type: 'voice',
      title: '语音备忘',
      content: transcript,
      audioPath,
      audioUrl: audioPath
    })
  } catch (error) {
    showToast(error.message || '保存录音失败', true)
  } finally {
    mediaRecorder = null
    mediaStream = null
    audioChunks = []
  }
}

async function openSettings() {
  try {
    const settings = await window.api.getAiSettings()
    $('#ai-endpoint').value = settings.endpoint
    $('#ai-model').value = settings.model
    $('#ai-key').value = ''
    $('#ai-clear-key').checked = false
    $('#ai-key').placeholder = settings.hasKey ? '已安全保存；留空则不修改' : '输入 DeepSeek API Key'
    $('#shortcut-note').textContent = shortcutStatus.commandJ
      ? '⌘J 可打开苹果原生截屏工具，无需为本应用授予录屏权限。'
      : '⌘J 被其他应用占用，可使用界面按钮、⌘⇧X 或苹果原生截屏快捷键。'
    $('#settings-dialog').showModal()
  } catch (error) {
    showToast(error.message || '无法读取设置', true)
  }
}

async function submitSettings(event) {
  event.preventDefault()
  try {
    await window.api.saveAiSettings({
      endpoint: $('#ai-endpoint').value,
      model: $('#ai-model').value,
      apiKey: $('#ai-key').value,
      clearKey: $('#ai-clear-key').checked
    })
    $('#settings-dialog').close()
    showToast('DeepSeek 设置已保存')
  } catch (error) {
    showToast(error.message || '设置保存失败', true)
  }
}

function updateSelectionMarquee(event) {
  if (!marqueeSelection || marqueeSelection.pointerId !== event.pointerId) return
  const left = Math.min(marqueeSelection.startX, event.clientX)
  const top = Math.min(marqueeSelection.startY, event.clientY)
  const right = Math.max(marqueeSelection.startX, event.clientX)
  const bottom = Math.max(marqueeSelection.startY, event.clientY)
  const marquee = $('#selection-marquee')
  marquee.classList.add('active')
  marquee.style.left = `${left}px`
  marquee.style.top = `${top}px`
  marquee.style.width = `${right - left}px`
  marquee.style.height = `${bottom - top}px`
  selectedMediaPaths = new Set(marqueeSelection.basePaths)
  $$('#grid .thumb').forEach(card => {
    const bounds = card.getBoundingClientRect()
    const intersects = bounds.right >= left && bounds.left <= right &&
      bounds.bottom >= top && bounds.top <= bottom
    if (intersects) selectedMediaPaths.add(card.dataset.path)
  })
  updateSelectionUi()
}

function finishSelectionMarquee(event) {
  if (!marqueeSelection || marqueeSelection.pointerId !== event.pointerId) return
  const grid = $('#grid')
  if (grid.hasPointerCapture(event.pointerId)) grid.releasePointerCapture(event.pointerId)
  marqueeSelection = null
  $('#selection-marquee').classList.remove('active')
}

function setupEvents() {
  const hoverTasks = $('#mini-hover-tasks')
  hoverTasks.addEventListener('wheel', event => {
    const cards = $$('#mini-hover-track .mini-hover-card')
    if (!cards.length) return
    event.preventDefault()
    const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX)
      ? event.deltaY
      : event.deltaX
    if (Math.abs(delta) < 2) return
    const now = performance.now()
    const beginsNewGesture = now - miniHoverWheelLastAt > 280
    miniHoverWheelLastAt = now
    if (!beginsNewGesture) return
    const currentIndex = cards.reduce((nearest, card, index) => (
      Math.abs(card.offsetLeft - hoverTasks.scrollLeft) <
        Math.abs(cards[nearest].offsetLeft - hoverTasks.scrollLeft)
        ? index
        : nearest
    ), 0)
    const targetIndex = Math.max(0, Math.min(cards.length - 1, currentIndex + Math.sign(delta)))
    hoverTasks.scrollTo({ left: cards[targetIndex].offsetLeft, behavior: 'smooth' })
  }, { passive: false })
  $('#mini-shell').addEventListener('mouseenter', () => {
    miniHoverWheelLastAt = 0
    window.api.widgetHover(true)
  })
  $('#mini-shell').addEventListener('mouseleave', () => {
    window.api.widgetHover(false)
  })
  const miniRing = $('#mini-ring')
  miniRing.addEventListener('pointerdown', event => {
    if (event.button !== 0) return
    event.preventDefault()
    miniPointer = {
      id: event.pointerId,
      startX: event.screenX,
      startY: event.screenY,
      moved: false
    }
    miniRing.setPointerCapture(event.pointerId)
    resetMiniDropAnimation()
  })
  miniRing.addEventListener('pointermove', event => {
    if (!miniPointer || miniPointer.id !== event.pointerId) return
    if (!miniPointer.moved && Math.hypot(
      event.screenX - miniPointer.startX,
      event.screenY - miniPointer.startY
    ) >= 4) {
      miniPointer.moved = true
      window.api.beginWidgetDrag()
    }
  })
  const finishMiniPointer = event => {
    if (!miniPointer || miniPointer.id !== event.pointerId) return
    const moved = miniPointer.moved
    miniPointer = null
    if (miniRing.hasPointerCapture(event.pointerId)) {
      miniRing.releasePointerCapture(event.pointerId)
    }
    if (moved) window.api.endWidgetDrag()
    miniPointerCompletedAt = performance.now()
    if (!moved && event.type === 'pointerup') window.api.openPanel('memos')
  }
  miniRing.addEventListener('pointerup', finishMiniPointer)
  miniRing.addEventListener('pointercancel', finishMiniPointer)
  miniRing.addEventListener('lostpointercapture', finishMiniPointer)
  miniRing.addEventListener('click', event => {
    event.preventDefault()
    if (performance.now() - miniPointerCompletedAt > 300) window.api.openPanel('memos')
  })
  window.addEventListener('blur', () => {
    if (!miniPointer) return
    miniPointer = null
    window.api.endWidgetDrag()
  })
  $('#btn-open-board').addEventListener('click', () => window.api.openPanel('board'))
  $('#btn-open-memos').addEventListener('click', () => window.api.openPanel('memos'))
  $$('.tab').forEach(tab => tab.addEventListener('click', () => showView(tab.dataset.view)))
  $('#btn-folder').addEventListener('click', () => window.api.openFolder())
  $('#btn-settings').addEventListener('click', openSettings)
  $('#btn-min').addEventListener('click', () => window.api.minimizeWindow())
  $('#btn-close').addEventListener('click', () => window.api.closeWindow())
  $('#btn-shot').addEventListener('click', () => window.api.captureScreenshot())
  $('#btn-text').addEventListener('click', () => openMemoDialog({ type: 'text', title: '文字备忘' }))
  $('#btn-voice').addEventListener('click', toggleRecording)
  $('#btn-voice-import').addEventListener('click', importVoiceFile)
  $('#btn-media-import').addEventListener('click', importMediaFromPicker)
  $('#btn-board-paste').addEventListener('click', pasteMediaFromClipboard)
  $('#btn-batch-export').addEventListener('click', exportSelectedMedia)
  $('#btn-batch-ocr').addEventListener('click', runBatchOcr)
  $('#btn-batch-delete').addEventListener('click', deleteSelectedMedia)
  $('#btn-selection-clear').addEventListener('click', clearMediaSelection)

  const grid = $('#grid')
  grid.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.target.closest('.thumb')) return
    event.preventDefault()
    const additive = event.metaKey || event.ctrlKey
    marqueeSelection = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      basePaths: additive ? new Set(selectedMediaPaths) : new Set()
    }
    if (!additive) selectedMediaPaths.clear()
    selectionAnchorPath = null
    updateSelectionUi()
    grid.setPointerCapture(event.pointerId)
  })
  grid.addEventListener('pointermove', updateSelectionMarquee)
  grid.addEventListener('pointerup', finishSelectionMarquee)
  grid.addEventListener('pointercancel', finishSelectionMarquee)

  $('#memo-form').addEventListener('submit', submitMemo)
  $('#memo-cancel').addEventListener('click', closeMemoDialog)
  $('#memo-cancel-top').addEventListener('click', closeMemoDialog)
  $('#memo-ai-plan').addEventListener('click', () => planTasksWithDeepSeek({
    title: $('#memo-title-input').value,
    content: $('#memo-content-input').value,
    sourceType: $('#memo-type').value
  }))
  $('#settings-form').addEventListener('submit', submitSettings)
  $('#settings-cancel').addEventListener('click', () => $('#settings-dialog').close())
  $('#settings-cancel-top').addEventListener('click', () => $('#settings-dialog').close())
  $('#btn-quit').addEventListener('click', () => window.api.quitApp())

  $('#cal-prev').addEventListener('click', () => {
    calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() - 1, 1)
    renderCalendar()
  })
  $('#cal-next').addEventListener('click', () => {
    calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + 1, 1)
    renderCalendar()
  })

  document.addEventListener('dragover', event => {
    const mode = document.body.dataset.mode
    if (mode === 'panel') {
      event.preventDefault()
      $('#drop-zone').classList.add('dragover')
      return
    }
    if ((mode === 'mini' || mode === 'hover') && event.target.closest?.('#mini-ring')) {
      event.preventDefault()
      if (!document.body.classList.contains('image-dragover')) resetMiniDropAnimation()
      document.body.classList.add('image-dragover')
    }
  })
  document.addEventListener('dragleave', event => {
    if (event.relatedTarget !== null) return
    $('#drop-zone').classList.remove('dragover')
    document.body.classList.remove('image-dragover')
  })
  document.addEventListener('drop', handleDrop)
  window.addEventListener('keydown', async event => {
    const editing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'v' && !editing) {
      event.preventDefault()
      await pasteMediaFromClipboard()
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a' && !editing && activeView === 'board') {
      event.preventDefault()
      selectedMediaPaths = new Set(images.map(item => item.path))
      selectionAnchorPath = images[0]?.path || null
      updateSelectionUi()
    }
    if (event.key === 'Escape' && document.body.dataset.mode === 'panel' && !document.querySelector('dialog[open]')) {
      if (selectedMediaPaths.size) {
        event.preventDefault()
        clearMediaSelection()
        return
      }
      window.api.collapseWindow()
    }
  })

  window.api.onFileAdded(reloadImages)
  window.api.onFileRemoved(reloadImages)
  window.api.onMemosChanged(reloadMemos)
  window.api.onWindowMode(applyWindowMode)
  window.api.onShortcutStatus(status => {
    shortcutStatus = status
  })
  window.api.onScreenshotCreated(() => {
    showToast('苹果原生截图已进入图片中转站')
    reloadImages()
  })
  window.api.onScreenshotError(detail => {
    showToast(detail?.message || '截图没有完成', true)
  })
}

function resetMiniDropAnimation() {
  clearTimeout(miniDropAnimationTimer)
  document.body.classList.remove('image-dragover', 'image-drop-success')
}

async function handleDrop(event) {
  const mode = document.body.dataset.mode
  const droppedOnBall = (mode === 'mini' || mode === 'hover') &&
    Boolean(event.target.closest?.('#mini-ring'))
  if (mode !== 'panel' && !droppedOnBall) return
  event.preventDefault()
  $('#drop-zone').classList.remove('dragover')
  document.body.classList.remove('image-dragover')
  try {
    let imported = 0
    const files = Array.from(event.dataTransfer.files).filter(file =>
      /\.(png|jpg|jpeg|gif|webp|mp4|mov|m4v|webm|mkv|avi)$/i.test(file.name)
    )
    for (const file of files) {
      const filePath = window.api.pathForFile(file)
      if (filePath) {
        await window.api.saveDropped(filePath)
        imported += 1
      }
    }
    if (!imported) {
      for (const item of Array.from(event.dataTransfer.items)) {
        if (item.kind === 'file' && /^(image|video)\//.test(item.type)) {
          const file = item.getAsFile()
          if (!file) continue
          const buffer = await file.arrayBuffer()
          await window.api.saveFromBuffer(Array.from(new Uint8Array(buffer)), item.type)
          imported = 1
          break
        }
      }
    }

    if (!imported) {
      const url = event.dataTransfer.getData('text/uri-list') ||
        event.dataTransfer.getData('text/plain')
      if (url && /^https?:\/\//i.test(url)) {
        await window.api.saveFromUrl(url)
        imported = 1
      }
    }

    if (droppedOnBall && imported && document.body.dataset.mode !== 'panel' && !miniPointer) {
      resetMiniDropAnimation()
      void $('#mini-ring').offsetWidth
      document.body.classList.add('image-drop-success')
      miniDropAnimationTimer = setTimeout(
        () => document.body.classList.remove('image-drop-success'),
        900
      )
      showToast(`已吸入中转站${imported > 1 ? ` · ${imported} 项` : ''}`)
    }
  } catch (error) {
    document.body.classList.remove('image-drop-success')
    showToast(error.message || '导入图片或视频失败', true)
  }
}

async function init() {
  setupEvents()
  await Promise.all([reloadImages(), reloadMemos()])
  updateLiveTime()
  setInterval(updateLiveTime, 1000)
}

init().catch(error => showToast(error.message || '初始化失败', true))
