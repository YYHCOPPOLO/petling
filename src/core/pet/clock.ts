import { cloneJson } from '../../shared/compat'
import type { PetEvent } from '../../shared/pet-command'
import type { SaveData } from '../../shared/save'
import { advanceActivity, currentActivity, resumeActivity, stopActivity } from './activities'
import { goodOf, lookupGood, type TimedType } from './catalog'
import { usePetItem } from './items'
import { levelOf } from './level'
import { succeed, type PetResult } from './result'

export const dayStart = (now = Date.now() / 1000): number => {
  const date = new Date(now * 1000)
  date.setHours(6, 0, 0, 0)
  if (date.getTime() > now * 1000) date.setDate(date.getDate() - 1)
  return date.getTime() / 1000
}

export function growthPerMinute(save: SaveData): number {
  const p = save.petInfo
  if (p.mood <= 0) return 10 / 60
  const rate = p.mood >= 800 ? 1 : p.mood >= 500 ? 0.9 : p.mood >= 200 ? 0.7 : 0.5
  let perHour = 80 * rate + (p.pinkDiamond ? 10 : 0)
  for (const [type, timed] of Object.entries(save.selfGoodUseOption)) if (timed) perHour += goodOf(type as TimedType, timed.id).group ?? 0
  return perHour * (p.sweetHeartOverTime ? 1.1 : 1) / 60
}

export function fatigue(save: SaveData): number {
  const p = save.petInfo
  const c = save.petComputedlInfo
  const m = p.mood / c.moodMax, cl = p.clean / c.cleanMax, h = p.hunger / c.hungerMax
  let f = (p.health !== 5 ? 2 : 0) + (m < 0.2 ? 3 : m < 0.5 ? 2 : 0) + (cl < 0.2 ? 2 : cl < 0.5 ? 1 : 0) + (h < 0.2 ? 2 : h < 0.5 ? 1 : 0)
  if (!f) return 0
  if (save.activeOption.work || save.activeOption.study) f += 2
  const relief = c.level < 10 ? (p.strong > 500 ? 2 : 0) : p.strong > 50000 ? 4 : p.strong > 5000 ? 2 : 0
  return Math.max(0, f - relief)
}

/** Enforce derived values in the same commit as medicine, growth or activity rewards. */
export function normalizePet(save: SaveData): void {
  const p = save.petInfo
  const level = levelOf(p.growth)
  const max = 1000 + Math.min(level.level, 70) * 100
  Object.assign(save.petComputedlInfo, level, { hungerMax: max, cleanMax: max })
  p.health = Math.min(5, Math.max(0, p.health))
  if (p.health === 5) save.activeOption.ill = null
  else if (!save.activeOption.ill) save.activeOption.ill = '1-'
  if (p.health === 0) {
    save.activeOption.work = save.activeOption.study = null
    save.saveJsonData.activity = '0'
  } else save.isBury = false
  for (const [type, timed] of Object.entries(save.selfGoodUseOption) as [TimedType, { id: string; left: number } | null][]) {
    if (timed && (!lookupGood(type, timed.id) || !Number.isFinite(timed.left) || timed.left <= 0)) {
      save.saveJsonData[`legacyTimed_${type}`] = JSON.stringify(timed)
      save.selfGoodUseOption[type as TimedType] = null
    }
  }
}

function newDay(save: SaveData, today: number): void {
  const p = save.petInfo
  p.onlineDataTime = 0
  if (p.pinkDiamond) {
    p.PDgrowth += p.PDgrowthValue * Math.max(0, Math.min(today, p.PDiamondExpirationDate) - p.PDiamondBeginDate) / 86400
    p.PDiamondBeginDate = today
    p.pinkDiamond = p.PDiamondExpirationDate > today
    if (!p.pinkDiamond) { p.PDiamondBeginDate = p.PDiamondExpirationDate = 0; p.PDiamondYear = false }
    const levels = [0, 100, 300, 800, 1200, 2800, 5800, 99999999]
    p.PDiamondLevel = Math.min(7, Math.max(1, levels.filter(value => p.PDgrowth >= value).length))
    p.PDgrowthValue_next = levels[p.PDiamondLevel]
  }
  if (p.sweetHeartOverTime <= today) { p.sweetHeartOverTime = 0; p.sweetHeart = false }
}

/** The first host tick resumes game progress; later ticks account only this process's elapsed time. */
export function tickPet(save: SaveData, now: number, previous: number | null, random = Math.random): PetResult<PetEvent[]> {
  const next = cloneJson(save)
  const events: PetEvent[] = []
  const p = next.petInfo
  if (!next.havePet || next.isBury) return succeed(save, save, events)
  const apply = <T>(result: PetResult<T>): T | undefined => {
    if (result.status === 'failed') return
    for (const [key, value] of Object.entries(result.patch)) {
      const current = next[key as keyof SaveData]
      if (current && value && typeof current === 'object' && !Array.isArray(current)) Object.assign(current, value)
      else (next as unknown as Record<string, unknown>)[key] = value
    }
    return result.data
  }
  const randomInt = (min: number, max: number): number => Math.floor(random() * (max - min + 1) + min)
  if (previous === null) {
    const progress = apply(resumeActivity(next, now))
    if (progress?.completed) events.push({ type: 'activity', progress })
  }
  if (p.health <= 0 || next.settings.paused) {
    next.nowTimeLine = now
    normalizePet(next)
    return succeed(save, next, events)
  }
  const today = dayStart(now)
  if (next.nowTimeLine <= today) { newDay(next, today); events.push({ type: 'new-day' }) }
  if (p.growth === 0) p.growth = 1
  if (previous !== null) {
    const minutes = +(Math.max(0, now - previous) / 60).toFixed(5)
    p.onlineDataTime += minutes
    p.onLineTime += minutes
    const extra = currentActivity(next) ? 1 : 0
    const moodRate = randomInt(1, 2) + extra
    const grown = Math.min(minutes, p.mood / moodRate)
    if (grown < minutes) {
      const stopped = apply(stopActivity(next))
      if (stopped?.kind) events.push({ type: 'mood-exhausted', kind: stopped.kind })
    }
    p.mood = Math.max(p.mood - moodRate * minutes, 0)
    p.hunger = Math.max(p.hunger - (randomInt(2, 3) + extra) * minutes, 0)
    p.clean = Math.max(p.clean - (randomInt(2, 3) + extra) * minutes, 0)
    p.growth += +(growthPerMinute(next) * grown).toFixed(8)
    normalizePet(next)
    if (p.sweetHeart) {
      const needs = [{ stat: 'hunger', type: 'food', action: '吃东西' }, { stat: 'clean', type: 'clean', action: '洗白白' }, { stat: 'mood', type: 'toy', action: '玩玩具' }] as const
      const need = needs.find(n => p[n.stat] / next.petComputedlInfo[`${n.stat}Max`] < 0.6)
      if (need) {
        const good = next.selfGoodDatas[need.type].map(entry => {
          const [id, count] = entry.slice(1).split('*')
          return Number(count) > 0 ? lookupGood(need.type, id) : undefined
        }).find(Boolean)
        if (good) {
          const receipt = apply(usePetItem(next, good.type, good.id))
          if (receipt) events.push({ type: 'self-care', receipt, action: need.action })
        }
      }
    }
    for (const [kind, timed] of Object.entries(next.selfGoodUseOption) as [TimedType, { id: string; left: number } | null][]) {
      if (!timed) continue
      timed.left -= grown
      if (timed.left <= 0) { next.selfGoodUseOption[kind] = null; events.push({ type: 'timed-expired', kind }) }
    }
    const activity = currentActivity(next)
    const early = activity?.kind === 'study' && activity.elapsed + grown > activity.minutes - 5 && randomInt(0, Math.max(200, 3000 - p.intel / 10)) <= 10
    const progress = apply(advanceActivity(next, grown, Boolean(early)))
    if (progress?.completed) events.push({ type: 'activity', progress })
  }
  const tired = fatigue(next)
  if (tired) {
    if (p.health !== 5) { if (randomInt(0, (700 - tired * 50) * 8) < 5) p.health-- }
    else if (random() < tired * tired / 100000) { next.activeOption.ill = `${randomInt(0, 2)}-`; p.health = 4 }
  }
  next.nowTimeLine = now
  normalizePet(next)
  return succeed(save, next, events)
}
