export interface PetPointerInput {
  phase: 'begin' | 'move' | 'end' | 'cancel'
  id: number
  /** Coordinates within the desktop overlay. */
  x: number
  y: number
  /** Stable desktop coordinates for movement/velocity while the page origin changes. */
  globalX?: number
  globalY?: number
  /** Desktop display changes resize the pet; preserve the fractional grab point. */
  scaleGrab?: boolean
  /** Optional performance.now() milliseconds; omit if the native clock differs. */
  time?: number
  source?: 'dom' | 'native'
}

export interface PetInputActions {
  position(): { x: number; y: number; size: number }
  begin(): void
  lift(size: number): { dx: number; dy: number } | null
  move(x: number, y: number, lifted: boolean): void
  end(lifted: boolean, vx: number, vy: number, cancelled: boolean): void
  hold(x: number, y: number): void
  active(on: boolean): void
  clock?(): number
}

/** Both DOM and native gestures use the same grab point, lift threshold and velocity accounting. */
export function createPetInput(actions: PetInputActions, holdMilliseconds = 0) {
  let press: { id: number; source: string; x: number; y: number; startX: number; startY: number; dx: number; dy: number; grabX: number; grabY: number; scaleGrab: boolean; px: number; py: number; at: number; vx: number; vy: number; lifted: boolean } | null = null
  let hold: ReturnType<typeof setTimeout> | null = null
  const clock = actions.clock ?? (() => performance.now())
  const clearHold = (): void => { if (hold !== null) clearTimeout(hold); hold = null }
  const finish = (cancelled: boolean, now: number): void => {
    if (!press) return
    const over = press
    press = null
    clearHold()
    actions.active(false)
    const stale = cancelled || now - over.at > 80
    actions.end(over.lifted, stale ? 0 : over.vx, stale ? 0 : over.vy, cancelled)
  }
  return {
    get active(): boolean { return press !== null },
    cancel(): void { finish(true, clock()) },
    send(input: PetPointerInput): void {
      if (!['begin', 'move', 'end', 'cancel'].includes(input.phase) || ![input.id, input.x, input.y].every(Number.isFinite)) return
      const globalX = input.globalX ?? input.x
      const globalY = input.globalY ?? input.y
      if (![globalX, globalY].every(Number.isFinite)) return
      const now = input.time !== undefined && Number.isFinite(input.time) ? input.time : clock()
      const source = input.source ?? 'dom'
      if (input.phase === 'cancel' && input.id === -1) return finish(true, now)
      if (input.phase === 'begin') {
        if (press) return
        actions.begin()
        const box = actions.position()
        const dx = input.x - box.x, dy = input.y - box.y
        press = { id: input.id, source, x: input.x, y: input.y, startX: globalX, startY: globalY, dx, dy, grabX: dx / box.size, grabY: dy / box.size, scaleGrab: Boolean(input.scaleGrab), px: globalX, py: globalY, at: now, vx: 0, vy: 0, lifted: false }
        actions.active(true)
        if (holdMilliseconds > 0) hold = setTimeout(() => { if (press) actions.hold(press.x, press.y) }, holdMilliseconds)
        return
      }
      if (!press || input.id !== press.id || source !== press.source) return
      if (input.phase === 'cancel') return finish(true, now)
      const dt = (now - press.at) / 1000
      // A stationary final native sample must not erase a recent fling or refresh its age.
      if (dt > 0 && (globalX !== press.px || globalY !== press.py)) {
        press.vx = (globalX - press.px) / dt
        press.vy = (globalY - press.py) / dt
        press.at = now
      }
      press.px = globalX
      press.py = globalY
      const box = actions.position()
      if (!press.lifted && Math.hypot(globalX - press.startX, globalY - press.startY) > 8) {
        clearHold()
        press.lifted = true
        const anchor = actions.lift(box.size)
        if (anchor) { press.dx = anchor.dx; press.dy = anchor.dy; press.grabX = anchor.dx / box.size; press.grabY = anchor.dy / box.size }
      }
      actions.move(input.x - (press.scaleGrab ? press.grabX * box.size : press.dx), input.y - (press.scaleGrab ? press.grabY * box.size : press.dy), press.lifted)
      if (input.phase === 'end') finish(false, now)
    },
  }
}
