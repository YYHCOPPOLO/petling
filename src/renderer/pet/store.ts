import type { TrayState } from '../../shared/ipc'
import type { PetInfo, SaveData, SavePatch } from '../../shared/save'
import { petSizeFor } from '../../shared/layout'
import { stageOf, type Stage } from '../../core/pet/level'
import { growthPerMinute as growthRate, fatigue as petFatigue } from '../../core/pet/clock'
import { PetClient } from '../../shared/pet-client'
import type { PetEvent, PetUpdate } from '../../shared/pet-command'
import type { Mood } from './router'
import { viewportSize } from '../ui/viewport'

if (!window.__qqpetInitialSave) throw new Error('QQPet store must be loaded through bootstrap.ts')
export const save: SaveData = window.__qqpetInitialSave.save
export const info: PetInfo = save.petInfo
let flushTimer = 0
const changeListeners: ((patch: SavePatch) => void)[] = []
export const onSaveChange = (listener: (patch: SavePatch) => void): void => { changeListeners.push(listener) }
const eventListeners: ((event: PetEvent) => void)[] = []
export const onPetEvent = (listener: (event: PetEvent) => void): void => { eventListeners.push(listener) }
type Listener = (key: keyof PetInfo, prev: unknown) => void
const listeners: Listener[] = []
export const onInfoChange = (listener: Listener): void => { listeners.push(listener) }

function project(update: PetUpdate): void {
  if (!client.hasError) document.getElementById('save-error')?.remove()
  const before = { ...info }
  const change: SavePatch = {}
  for (const key of Object.keys(update.snapshot.save) as (keyof SaveData)[]) {
    const value = update.snapshot.save[key]
    if (JSON.stringify(save[key]) === JSON.stringify(value)) continue
    Object.assign(change, { [key]: value })
    if (value && typeof value === 'object' && !Array.isArray(value)) Object.assign(save[key] as object, value)
    else Object.assign(save, { [key]: value })
  }
  for (const listener of changeListeners) listener(change)
  for (const key of Object.keys(info) as (keyof PetInfo)[]) if (before[key] !== info[key]) for (const listener of listeners) listener(key, before[key])
  for (const event of update.events) for (const listener of eventListeners) listener(event)
}

export const client = new PetClient(structuredClone(window.__qqpetInitialSave), window.qqpet, project, error => {
  console.error('宠物状态提交失败：', error)
  const notice = document.getElementById('save-error') ?? document.body.appendChild(Object.assign(document.createElement('div'), { id: 'save-error' }))
  notice.setAttribute('role', 'alert')
  notice.style.cssText = 'position:fixed;top:16px;left:16px;padding:12px;background:white;color:#900;z-index:9999'
  notice.textContent = '状态提交未确认，请核对后重试。'
})
window.qqpet.onState(update => client.receive(update))

function flushPatch(): void {
  if (flushTimer) window.clearTimeout(flushTimer)
  flushTimer = 0
  client.flushPreferences()
}
export async function flushSave(): Promise<void> { flushPatch(); await client.flush() }
window.__qqpetFlush = flushSave
addEventListener('pagehide', () => {
  if (!window.__qqpetClosing) void flushSave().catch((error: unknown) => console.error('Save flush failed:', error))
})

/** Only desktop preferences are optimistic; gameplay waits for a host commit. */
export function update<K extends 'settings' | 'petInfo'>(key: K, value: SavePatch[K]): void {
  client.update({ [key]: value } as SavePatch)
  flushTimer ||= window.setTimeout(flushPatch, 200)
}
export function setInfo<K extends 'name' | 'host' | 'lastX' | 'lastY'>(key: K, value: PetInfo[K]): void {
  if (info[key] !== value) update('petInfo', { [key]: value })
}
type Activity = 'work' | 'study' | 'ill' | 'die'
export const activity = (key: Activity): string | null => save.activeOption[key] as string | null

const MOODS: [number, Mood, number][] = [
  [800, 'happy', 1],
  [500, 'peaceful', 0.9],
  [200, 'upset', 0.7],
  [-Infinity, 'sad', 0.5],
]
export const mood = (): Mood => MOODS.find(([min]) => info.mood >= min)![1]
export const stage = (): Stage => stageOf(save.petComputedlInfo.level)
/** The first frame of the pet's Stand.swf, framed like the original pet/info/*.svg portraits. */
export const avatar = (): string => `pet/avatar/${info.sex}${stage()}.png`

/** Size follows the active desktop display. */
export const petSize = (): number => petSizeFor(save.petComputedlInfo.level, viewportSize())

/** How close to a side counts as peeking. Hide_left/right SWFs assume the box sits on that edge. */
export const EDGE_NEAR = 36

export function edgeSide(): 'hideleft' | 'hideright' | null {
  const s = petSize()
  if (info.lastX <= EDGE_NEAR) return 'hideleft'
  if (info.lastX + s >= viewportSize().width - EDGE_NEAR) return 'hideright'
  return null
}

/** Snaps X onto the side it is already on. */
export function applyEdge(): 'hideleft' | 'hideright' | null {
  const edge = edgeSide()
  if (edge === 'hideleft') setInfo('lastX', 0)
  else if (edge === 'hideright') setInfo('lastX', viewportSize().width - petSize())
  return edge
}

export const growthPerMinute = (): number => growthRate(save)

export const busy = (): boolean => Boolean(activity('work') || activity('study'))

/** 0 (fresh) and up; drives random illness and health loss. */
export const fatigue = (): number => petFatigue(save)

/** 0..20: VIP flags, charm and intelligence help; fatigue hurts. */
export function luck(): number {
  let l = 1 + (info.pinkDiamond ? info.PDiamondLevel * 2 : 0) + (info.sweetHeart ? 2 : 0)
  l += [500, 5000, 50000].filter((v) => info.charm > v).length + [800, 8000, 80000].filter((v) => info.intel > v).length
  return Math.min(Math.max(0, l - (fatigue() >> 1)), 20)
}
let tray: TrayState | null = null

export function setTray(s: TrayState): void {
  // Hunger and dirt never replace the more urgent ill/dead icons.
  if (s === tray || ((s === 'hungry' || s === 'dirty') && (tray === 'ill' || tray === 'dead'))) return
  tray = s
  window.qqpet.setTrayState(s)
}

export function setPaused(on: boolean): void {
  update('settings', { paused: on })
  refreshTray()
}

export function refreshTray(): void {
  if (save.isBury || info.health === 0) setTray('dead')
  else if (save.settings.paused) setTray('pause')
  else if (info.health !== 5) setTray('ill')
  else if (activity('work')) setTray('work')
  else if (activity('study')) setTray('study')
  else if (info.clean < 300) setTray('dirty')
  else if (info.hunger < 300) setTray('hungry')
  else setTray('normal')
}

update('petInfo', { lastX: info.lastX | 0, lastY: info.lastY | 0 })
