import { createPetInput, type PetPointerInput } from './pet/input'
import { clipAsk, IDLE, note } from './pet/ai'
import { resumeTask } from './pet/jobs'
import { machine, speak, startPet } from './pet/pet'
import { applyEdge, info, onInfoChange, petSize, save, setInfo, stage, update } from './pet/store'
import type { DesktopCursor } from '../shared/ipc'
import { setDesktopSize, viewportSize } from './ui/viewport'
import { adopt } from './ui/adopt'
import { catchDiudiule, releaseDiudiule } from './ui/diudiule'
import { scheduleHide, showControl } from './ui/control'
import { pageX, pageY } from './ui/dom'
import './ui/background'
import './ui/face'
import { closeMenu, openMenu } from './ui/menu'
import { openState } from './ui/state'
import { startAutoUpdate } from './ui/update'
import { windowView } from './ui/window-view'

let lastPlatformError = ''
let lastPlatformErrorAt = -Infinity
// The native adapter reports errors before and after bootstrap; only the initialized UI opens dialogs.
window.qqpet.onPlatformError((detail) => {
  if (!detail || typeof detail.message !== 'string') return
  const message = typeof detail.operation === 'string' ? `${detail.operation}：${detail.message}` : detail.message
  const now = performance.now()
  // A failed periodic save should leave one readable alert instead of replacing it on every tick.
  if (message === lastPlatformError && now - lastPlatformErrorAt < 10_000) return
  lastPlatformError = message
  lastPlatformErrorAt = now
  windowView({ title: '平台操作失败', msg: message })
})

const petEl = document.getElementById('pet')!
let dragging = false
let desktopOffset = { x: 0, y: 0 }
let desktopSequence = 0
let dragMove: ((point: DesktopCursor) => void) | null = null

function clampOnScreen(): void {
  const s = petSize()
  const area = viewportSize()
  setInfo('lastX', Math.min(Math.max(info.lastX, 0), Math.max(0, area.width - s)))
  setInfo('lastY', Math.min(Math.max(info.lastY, 0), Math.max(0, area.height - s)))
}

/** Left/right: keep the box on-screen. Hide_left/right already peek from the sprite edge. */
function snapEdge(): 'hideleft' | 'hideright' | null {
  const edge = applyEdge()
  if (!edge) clampOnScreen()
  return edge
}

let size = petSize()
function layout(): void {
  // A pet that grows keeps its center.
  const shift = dragging ? 0 : (petSize() - size) / 2
  size = petSize()
  if (shift) {
    setInfo('lastX', info.lastX - shift)
    setInfo('lastY', info.lastY - shift)
    clampOnScreen()
  }
  petEl.style.width = petEl.style.height = `${size}px`
  petEl.style.left = `${info.lastX}px`
  petEl.style.top = `${info.lastY}px`
}

if (info.lastX === -1 && info.lastY === -1) {
  setInfo('lastX', (innerWidth - size) / 2)
  setInfo('lastY', (innerHeight - size) / 2)
}
// A save from another screen can leave the pet outside the current viewport.
clampOnScreen()
addEventListener('resize', () => { if (!dragging) clampOnScreen() })
layout()
onInfoChange((key) => {
  if (key === 'lastX' || key === 'lastY' || key === 'growth') layout()
})

const cursor = { x: 0, y: 0 }
window.API = {
  GetCursorPosition: () => `${cursor.x},${cursor.y},0`,
  GetWindowRect: () => `${info.lastX},${info.lastY},${size},${size}`,
  // No PetEden.ini: every key reads as its default, as the Windows call does for a missing file.
  GetPrivateProfileString: (_section, _key, fallback) => fallback,
}

// The window is click-through except while the cursor is over a [data-hit]
// element (or a drag is in progress).
let interactive = false
/** A click stepped the pet out of its peek; it slips back once the cursor leaves it and its bar. */
let out = false
/** A cursor overshooting the menu edge, or crossing to a submenu, may come back before this. */
const MENU_LEAVE_MS = 300
let menuLeave = 0
const syncDesktop = (p: DesktopCursor): boolean => {
  const area = p.desktop
  if (!area) return true
  if (area.sequence <= desktopSequence) return false
  desktopSequence = area.sequence
  const dx = area.offset.x - desktopOffset.x
  const dy = area.offset.y - desktopOffset.y
  desktopOffset = area.offset
  setDesktopSize(area)
  setInfo('lastX', info.lastX + dx)
  setInfo('lastY', info.lastY + dy)
  if (save.settings.petDisplayId !== area.id) update('settings', { petDisplayId: area.id })
  if (!dragging) clampOnScreen()
  layout()
  return true
}
window.qqpet.onCursor((p) => {
  if (!syncDesktop(p)) return
  dragMove?.(p)
  cursor.x = p.x
  cursor.y = p.y
  // The pet box is the hit target. elementFromPoint misses Ruffle's shadow canvas,
  // so the OS arrow shows until we also test the box itself.
  const overPet = !petEl.hidden && p.x >= info.lastX && p.x < info.lastX + size && p.y >= info.lastY && p.y < info.lastY + size
  const el = document.elementFromPoint(p.x, p.y)
  const root = el?.getRootNode()
  const host = root instanceof ShadowRoot ? root.host : el
  const hit = dragging || overPet || host?.closest('[data-hit]') != null
  // The menu closes once the cursor rests on the desktop; it may still be on the tray, outside the window.
  const inside = p.x >= 0 && p.y >= 0 && p.x < innerWidth && p.y < innerHeight
  if (!hit && inside) {
    menuLeave ||= setTimeout(() => {
      menuLeave = 0
      closeMenu()
    }, MENU_LEAVE_MS)
  } else if (menuLeave) {
    clearTimeout(menuLeave)
    menuLeave = 0
  }
  if (out && !hit) {
    out = false
    const edge = snapEdge()
    if (edge && machine.pose.a === 'normal') machine.play({ a: edge })
  }
  if (hit === interactive) return
  interactive = hit
  window.qqpet.setClickThrough(!hit)
})
// The store's asynchronous load may finish after the initial cursor broadcast.
if (window.qqpet.setDragging) void window.qqpet.setDragging(false).then(syncDesktop)

petEl.addEventListener('contextmenu', (e) => openMenu({ x: pageX(e), y: pageY(e), pet: true }, adoptPet))

let releaseDomInput = (): void => {}
const petInput = createPetInput({
  clock: () => performance.now(),
  position: () => ({ x: info.lastX, y: info.lastY, size }),
  begin: () => {
    closeMenu()
    if (save.settings.petBar) showControl()
    catchDiudiule()
  },
  active: (on) => { dragging = on; if (!on) releaseDomInput() },
  hold: (x, y) => openMenu({ x, y, pet: true }, adoptPet),
  lift: (s) => {
    // Preserve upstream: Adult uses the scruff; Egg/Kid keep their stage/sex and original grab point.
    if (stage() === 'Adult') {
      machine.play({ a: 'drag', opt: { url: 'pet/Action/drag.swf', opt: {} } })
      return { dx: s * 0.73, dy: s * 0.14 }
    }
    machine.play({ a: 'drag' })
    return null
  },
  move: (x, y, lifted) => {
    setInfo('lastX', x)
    setInfo('lastY', y)
    if (!lifted) clampOnScreen()
  },
  end: (lifted, vx, vy, cancelled) => {
    if (releaseDiudiule(cancelled ? false : lifted, vx, vy)) return scheduleHide()
    const edge = snapEdge()
    if (edge && !lifted && !cancelled && machine.pose.a === edge) {
      out = true
      machine.play({ a: 'normal' })
    } else if (edge) machine.play({ a: edge })
    else if (lifted || machine.pose.a === 'hideleft' || machine.pose.a === 'hideright') machine.play({ a: 'normal' })
    scheduleHide()
  },
})

addEventListener('pagehide', () => petInput.cancel())

petEl.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || (e.target as HTMLElement).closest('.point')) return
  if (petInput.active) return
  const nativeDrag = window.qqpet.setDragging
  let lastPoint: DesktopCursor = { x: pageX(e), y: pageY(e) }
  const sample = (phase: PetPointerInput['phase'], p: DesktopCursor): PetPointerInput => ({
    phase, id: e.pointerId, x: p.x, y: p.y, source: 'dom',
    ...(nativeDrag ? { globalX: p.x - desktopOffset.x, globalY: p.y - desktopOffset.y, scaleGrab: true } : {}),
  })
  petInput.send(sample('begin', lastPoint))
  if (!petInput.active) return
  let ending = false
  let disposed = false
  const fromDesktop = (p: DesktopCursor): void => {
    lastPoint = p
    petInput.send(sample('move', p))
  }
  const move = (m: PointerEvent): void => {
    if (nativeDrag || m.pointerId !== e.pointerId) return
    lastPoint = { x: pageX(m), y: pageY(m) }
    petInput.send(sample('move', lastPoint))
  }
  const failed = (error: unknown): void => {
    console.error('Native desktop drag failed:', error)
    if (!disposed) petInput.cancel()
  }
  const stopFollowing = (): void => {
    if (nativeDrag) void nativeDrag(false).then(syncDesktop).catch(failed)
  }
  const dispose = (): void => {
    if (disposed) return
    disposed = true
    petEl.removeEventListener('pointermove', move)
    petEl.removeEventListener('pointerup', end)
    petEl.removeEventListener('pointercancel', end)
    if (nativeDrag) {
      removeEventListener('pointerup', end)
      removeEventListener('pointercancel', end)
      if (dragMove === fromDesktop) dragMove = null
      if (!ending) { ending = true; stopFollowing() }
    }
    if (petEl.hasPointerCapture(e.pointerId)) petEl.releasePointerCapture(e.pointerId)
    releaseDomInput = () => {}
  }
  const end = (m: PointerEvent): void => {
    if (m.pointerId !== e.pointerId || ending || disposed) return
    ending = true
    if (m.type === 'pointercancel') {
      petInput.send(sample('cancel', lastPoint))
      stopFollowing()
      return
    }
    if (nativeDrag) {
      // Resolve the target display and final sample before releasing or clamping the pet.
      void nativeDrag(false).then((p) => {
        if (disposed) return
        if (syncDesktop(p)) fromDesktop(p)
        petInput.send(sample('end', lastPoint))
      }).catch(failed)
    } else {
      lastPoint = { x: pageX(m), y: pageY(m) }
      petInput.send(sample('end', lastPoint))
    }
  }
  releaseDomInput = dispose
  if (nativeDrag) {
    dragMove = fromDesktop
    // Native cursor updates survive losing pointer capture during a display/DPI transfer.
    void nativeDrag(true).then((p) => { if (!disposed && !ending && syncDesktop(p)) fromDesktop(p) }).catch(failed)
  }
  petEl.setPointerCapture(e.pointerId)
  petEl.addEventListener('pointermove', move)
  petEl.addEventListener('pointerup', end)
  petEl.addEventListener('pointercancel', end)
  if (nativeDrag) {
    addEventListener('pointerup', end)
    addEventListener('pointercancel', end)
  }
})

const begin = (): void => {
  petEl.hidden = false
  startPet()
}
const adoptPet = (): void => adopt(begin)

// Fall back to the top right when a native tray event has no coordinates.
window.qqpet.onTrayClick((c) => {
  const x = c.x ?? innerWidth - 60
  const y = c.y ?? 0
  if (c.kind === 'menu') openMenu({ x, y, pet: false }, adoptPet)
  else if (save.havePet) openState(x, y)
  else adoptPet()
})

const CLIP_MAX = 60
window.qqpet.onClipboard((text) => {
  if (!save.havePet) return
  note('主人刚复制了一段文字')
  speak({ s: text.length > CLIP_MAX ? `${text.slice(0, CLIP_MAX)}…` : text, b: '当前复制的文字', now: true, ai: clipAsk(text) }, 'speak')
})

window.qqpet.onPresence((gone) => {
  if (!save.havePet) return
  if (gone) {
    note('主人离开了一会儿')
    return
  }
  note('主人回来了')
  speak({ s: '[host]，你回来啦~', now: true, ai: IDLE }, 'appear')
})

const DWELL = 10 * 60 * 1000
let front = ''
let frontSince = 0
let frontNoted = ''
window.qqpet.onFront((name) => {
  front = name
  frontSince = Date.now()
})
setInterval(() => {
  if (!save.settings.watchApp || !save.havePet || !front || front === frontNoted || Date.now() - frontSince < DWELL) return
  frontNoted = front
  note(/[A-Za-z]/.test(front) ? `主人在用「${front}」` : `主人在${front}`)
}, 15_000)

if (save.havePet) {
  resumeTask()
  begin()
} else adoptPet()
startAutoUpdate()
