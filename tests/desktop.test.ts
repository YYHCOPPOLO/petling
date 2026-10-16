import assert from 'node:assert/strict'
import test from 'node:test'
import { desktopCursor, petDisplay } from '../src/main/desktop'
import { Lifetime } from '../src/main/lifecycle'
import { createPetInput } from '../src/renderer/pet/input'
import { levelOf, stageOf } from '../src/core/pet/level'
import { petSizeFor } from '../src/shared/layout'

test('a desktop drag crosses negative/vertical monitor coordinates in DIP, and unplug falls back', () => {
  const primary = { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }
  const left = { id: 2, workArea: { x: -1280, y: -200, width: 1280, height: 984 } }
  const above = { id: 3, workArea: { x: 0, y: -1440, width: 2560, height: 1400 } }
  let displays = [primary, left, above]
  let point = { x: -100, y: 100 }
  let bounds = primary.workArea
  const screen = {
    getAllDisplays: () => displays,
    getPrimaryDisplay: () => primary,
    getCursorScreenPoint: () => point,
    getDisplayNearestPoint: () => point.y < -200 ? above : left,
  }
  const position = desktopCursor({ getBounds: () => bounds, setBounds: value => { bounds = value } }, screen, 1)
  assert.equal(position(false).desktop?.id, 1)
  const shifted = position(true)
  assert.deepEqual({ x: shifted.x, y: shifted.y }, { x: 1180, y: 300 })
  assert.deepEqual(shifted.desktop?.offset, { x: 1280, y: 200 })
  point = { x: 600, y: -600 }
  const top = position(true)
  assert.deepEqual({ x: top.x, y: top.y }, { x: 600, y: 840 })
  assert.ok(top.desktop!.sequence > shifted.desktop!.sequence)
  assert.equal(petDisplay(screen, 3).id, 3)
  displays = [primary]
  assert.equal(position(false).desktop?.id, 1)
  assert.deepEqual(bounds, primary.workArea)
})

test('fractional grab position and fling velocity survive a display size change', () => {
  let box = { x: 500, y: 300, size: 144 }
  let release: number[] = []
  const input = createPetInput({
    position: () => box, begin: () => {}, active: () => {}, hold: () => {}, lift: () => null,
    move: (x, y) => { box.x = x; box.y = y },
    end: (_lifted, vx, vy) => { release = [vx, vy] },
  })
  input.send({ phase: 'begin', id: 1, x: 550, y: 340, globalX: 550, globalY: 340, scaleGrab: true, time: 0 })
  box = { ...box, size: 96 }
  input.send({ phase: 'move', id: 1, x: 1180, y: 300, globalX: -100, globalY: 100, scaleGrab: true, time: 16 })
  assert.ok(Math.abs(box.x + (50 / 144) * 96 - 1180) < 1e-8)
  assert.ok(Math.abs(box.y + (40 / 144) * 96 - 300) < 1e-8)
  input.send({ phase: 'end', id: 1, x: 1180, y: 300, globalX: -100, globalY: 100, time: 32 })
  assert.notEqual(release[0], 0)
  assert.equal(input.active, false)
})

test('cancelled and stale drags have no fling velocity', () => {
  let time = 0
  let velocity = 1
  const input = createPetInput({ position: () => ({ x: 0, y: 0, size: 144 }), begin: () => {}, active: () => {}, hold: () => {}, lift: () => null, move: () => {}, end: (_lifted, vx) => { velocity = vx }, clock: () => time })
  input.send({ phase: 'begin', id: 1, x: 10, y: 10 })
  time = 16
  input.send({ phase: 'move', id: 1, x: 30, y: 20 })
  time = 200
  input.send({ phase: 'end', id: 1, x: 30, y: 20 })
  assert.equal(velocity, 0)
  input.send({ phase: 'begin', id: 2, x: 30, y: 20 })
  time = 216
  input.send({ phase: 'move', id: 2, x: 60, y: 20 })
  input.cancel()
  assert.equal(velocity, 0)
})

test('desktop service cleanup is complete, ordered and idempotent', () => {
  const lifetime = new Lifetime()
  const cleaned: number[] = []
  lifetime.defer(() => cleaned.push(1))
  lifetime.defer(() => cleaned.push(2))
  lifetime.dispose()
  lifetime.dispose()
  lifetime.defer(() => cleaned.push(3))
  assert.deepEqual(cleaned, [2, 1, 3])
})

test('growth thresholds preserve upstream life stages and desktop scaling', () => {
  assert.deepEqual(levelOf(124), { level: 1, upGrowth: 0, nextGrowth: 125 })
  assert.equal(levelOf(125).level, 2)
  assert.equal(stageOf(4), 'Egg')
  assert.equal(stageOf(5), 'Kid')
  assert.equal(stageOf(16), 'Adult')
  assert.equal(petSizeFor(1, { width: 1920, height: 1080 }), 146)
  assert.equal(petSizeFor(16, { width: 2560, height: 1400 }), 164 * 2560 / 1920)
})
