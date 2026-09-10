const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'renderer.js'), 'utf8')

function pointerHarness() {
  const handlers = new Map()
  const calls = []
  let captured = false
  const ring = {
    addEventListener: (name, fn) => handlers.set(name, fn),
    setPointerCapture: () => { captured = true },
    hasPointerCapture: () => captured,
    releasePointerCapture: () => { captured = false }
  }
  vm.runInNewContext(`let miniPointer=null, miniPointerCompletedAt=0;
    ${source.slice(source.indexOf("  const miniRing = $('#mini-ring')"), source.indexOf("  $('#btn-open-board').addEventListener"))}
  `, {
    $: () => ring, performance: { now: () => 1000 },
    resetMiniDropAnimation: () => calls.push('cancel-animation'),
    window: {
      addEventListener: (name, fn) => handlers.set(name, fn),
      api: {
        beginWidgetDrag: () => calls.push('drag-start'),
        endWidgetDrag: () => calls.push('drag-end'),
        openPanel: () => calls.push('open-panel')
      }
    }
  })
  return {
    calls,
    emit(type, x = 100, y = 100) {
      handlers.get(type)({ type, button: 0, pointerId: 1, screenX: x, screenY: y, preventDefault() {} })
    }
  }
}

test('ordinary click opens once without starting drag or retreat animations', () => {
  const h = pointerHarness()
  h.emit('pointerdown')
  h.emit('pointermove', 102)
  h.emit('pointerup')
  h.emit('click')
  assert.deepEqual(h.calls, ['cancel-animation', 'open-panel'])
})

test('crossing drag threshold starts exactly once and does not open panel', () => {
  const h = pointerHarness()
  h.emit('pointerdown')
  h.emit('pointermove', 104)
  h.emit('pointermove', 140)
  h.emit('pointerup', 140)
  h.emit('lostpointercapture')
  h.emit('click')
  assert.deepEqual(h.calls, ['cancel-animation', 'drag-start', 'drag-end'])
})

test('cancelled pointer never opens a panel', () => {
  const h = pointerHarness()
  h.emit('pointerdown')
  h.emit('pointercancel')
  assert.deepEqual(h.calls, ['cancel-animation'])
})
