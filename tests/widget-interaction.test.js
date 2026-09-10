const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')

// Execute the production window controller with a deterministic clock/window.
// No Electron launch, user preferences, photos, or memo data are touched.
const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8')
function harness(side) {
  let now = 1000
  const timers = new Map()
  const addTimer = (fn, delay, repeat) => {
    const id = { unref() {} }
    timers.set(id, { fn, delay, repeat, at: now + delay })
    return id
  }
  const area = { x: 0, y: 25, width: 1440, height: 875 }
  const display = { id: 1, workArea: area }
  let settings = { widgetDockSide: side, widgetPosition: { displayId: '1', x: side === 'left' ? 0 : 1376, y: 300 } }
  let bounds = { x: side === 'left' ? -50 : 1426, y: 300, width: 64, height: 64 }
  const calls = []
  const context = vm.createContext({
    Date: { now: () => now },
    WINDOW_SIZES: { mini: { width: 64, height: 64 }, hover: { width: 410, height: 64 }, panel: { width: 380, height: 640 } },
    EDGE_DOCK_SNAP_DISTANCE: 18, EDGE_DOCK_VISIBLE_WIDTH: 14,
    setInterval: (fn, delay) => addTimer(fn, delay, true),
    setTimeout: (fn, delay) => addTimer(fn, delay, false),
    clearInterval: id => timers.delete(id), clearTimeout: id => timers.delete(id),
    getSettings: () => structuredClone(settings), saveSettings: next => { settings = structuredClone(next) },
    screen: { getAllDisplays: () => [display], getPrimaryDisplay: () => display, getDisplayNearestPoint: () => display, getCursorScreenPoint: () => context.cursor },
    cursor: { x: side === 'left' ? 5 : 1435, y: 332 },
    mainWindow: {
      isDestroyed: () => false, getBounds: () => ({ ...bounds }),
      setBounds: (next, animate) => { assert.equal(animate, false); bounds = { ...next }; calls.push(bounds) },
      webContents: { send() {} }, setResizable() {}, setAlwaysOnTop() {},
      setVisibleOnAllWorkspaces() {}, setFocusable() {}, show() {}, focus() {}, showInactive() {}, isVisible: () => true
    }
  })
  vm.runInContext(`let windowMode='mini', widgetDockSide, hoverPlacement='right', hoverHasTasks=true;
    let widgetDrag=null, widgetDragTimer=null, positionSaveTimer, positionSuppressTimer;
    let positionSaveSuppressed=false, windowMotionTimer=null, hoverMonitorTimer=null, hoverOutsideSince=null, quitting=false;
    ${source.slice(source.indexOf('function clamp('), source.indexOf('function createWindow('))}
  `, context)
  return {
    run: expression => vm.runInContext(expression, context),
    cursor: (x, y = 332) => { context.cursor = { x, y } },
    bounds: () => bounds, calls, settings: () => settings,
    tick(ms) {
      const end = now + ms
      for (;;) {
        const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
        if (!next) break
        const [id, timer] = next
        now = timer.at
        if (timer.repeat) timer.at += timer.delay
        else timers.delete(id)
        timer.fn()
      }
      now = end
    }
  }
}

for (const side of ['left', 'right']) {
  test(`${side}: edge-to-ball bridge stays open despite stale mouseleave`, () => {
    const h = harness(side)
    h.run("setWindowMode('hover')")
    h.run('monitorWidgetHover()')
    h.tick(1200)
    assert.equal(h.run('windowMode'), 'hover')
    h.cursor(side === 'left' ? 32 : 1408)
    h.tick(1000)
    assert.equal(h.run('windowMode'), 'hover')
    h.run("setWindowMode('panel', {activate:true, view:'memos'})")
    h.tick(1000)
    assert.equal(h.run('windowMode'), 'panel')
    assert.equal(h.bounds().height, 640)
  })
  test(`${side}: short leave/reentry cancels collapse, real leave retracts`, () => {
    const h = harness(side)
    h.run("setWindowMode('hover')")
    h.tick(200)
    h.cursor(700, 700)
    h.tick(300)
    h.cursor(side === 'left' ? 5 : 1435)
    h.tick(800)
    assert.equal(h.run('windowMode'), 'hover')
    h.cursor(700, 700)
    h.tick(1000)
    assert.equal(h.run('windowMode'), 'mini')
    assert.equal(h.bounds().x, side === 'left' ? -50 : 1426)
    assert.equal(h.run('hoverMonitorTimer'), null)
  })
  test(`${side}: only latest animation survives and layout never squeezes`, () => {
    const h = harness(side)
    h.run("setWindowMode('hover')")
    h.tick(32)
    const timer = h.run('windowMotionTimer')
    h.run("setWindowMode('hover')")
    assert.equal(h.run('windowMotionTimer'), timer)
    h.run("setWindowMode('mini')")
    h.tick(32)
    h.run("setWindowMode('hover')")
    h.tick(300)
    assert.equal(h.bounds().width, 410)
    assert.equal(h.bounds().x, side === 'left' ? 0 : 1030)
    assert.ok(h.calls.every(bounds => [64, 410].includes(bounds.width)))
    assert.equal(h.run('windowMotionTimer'), null)
  })
  test(`${side}: releasing at edge stays available until pointer leaves`, () => {
    const h = harness(side)
    h.run("setWindowMode('hover')")
    h.tick(200)
    h.cursor(side === 'left' ? 32 : 1408)
    h.run('beginWidgetDrag()')
    h.tick(32)
    h.run('endWidgetDrag()')
    h.tick(1000)
    assert.equal(h.settings().widgetDockSide, side)
    assert.equal(h.run('windowMode'), 'hover')
  })
}
