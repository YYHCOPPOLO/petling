import { cloneJson } from '../../shared/compat'
import type { PetInfo, SaveData } from '../../shared/save'
import { goodOf, lookupGood, type Good, type GoodType, type TimedType } from './catalog'
import SHOP from './data/shop.json'
import { DEAD, illOf } from './illness'
import { fail, succeed, validQuantity, type PetResult } from './result'

const SOLD = new Set(Object.values(SHOP).flatMap(tab => Object.values(tab).flat(2)))
const DAILY: Partial<Record<GoodType, { extra: number; action: string; paused: boolean }>> = {
  food: { extra: 20, action: 'eat', paused: true },
  clean: { extra: 20, action: 'clean', paused: true },
  toy: { extra: 0, action: 'speak', paused: true },
  background: { extra: 0, action: 'speak', paused: false },
}

export interface ItemReceipt {
  good: Good
  quantity: number
  action: string
  moodDelta: number
  message?: string
}

export function countGood(save: SaveData, type: GoodType, id: string): number {
  return save.selfGoodDatas[type].reduce((sum, entry) => {
    if (typeof entry !== 'string') return sum
    const [key, count] = entry.slice(1).split('*')
    const n = Number(count)
    return key === id && Number.isSafeInteger(n) && n > 0 ? sum + n : sum
  }, 0)
}

/** Internal draft mutation; callers validate quantities before changing inventory. */
export function changeGood(save: SaveData, type: GoodType, id: string, delta: number): void {
  const count = countGood(save, type, id) + delta
  const entries = save.selfGoodDatas[type].filter(entry => typeof entry !== 'string' || !entry.startsWith(`_${id}*`))
  if (count > 0) entries.push(`_${id}*${count}`)
  save.selfGoodDatas[type] = entries
  if (delta > 0 && !save.illustrated.includes(id)) save.illustrated.push(id)
}

/** Business effects run on a draft, independently of animation loading and completion. */
export function applyGood(save: SaveData, good: Good, extraMood = 0): void {
  const p = save.petInfo
  const caps = save.petComputedlInfo
  p.hunger = Math.min(Math.max(p.hunger + (good.hunger ?? 0), 0), caps.hungerMax)
  p.clean = Math.min(Math.max(p.clean + (good.clean ?? 0), 0), caps.cleanMax)
  p.mood = Math.min(Math.max(p.mood + (good.mood ?? 0) + extraMood, 0), caps.moodMax)
  p.intel += good.intel ?? 0
  p.charm += good.charm ?? 0
  p.strong += good.strong ?? 0
}

export const unitPrice = (save: SaveData, good: Good): number => save.petInfo.pinkDiamond ? Math.round(good.price! * 0.8) : good.price!

/** Validates the whole cart before deducting any money or adding any goods. */
export function purchase(save: SaveData, items: { type: GoodType; id: string; quantity: number }[]): PetResult<{ total: number }> {
  if (!items.length) return fail('INVALID_QUANTITY', '购物车是空的')
  let total = 0
  const quantities = new Map<string, number>()
  for (const item of items) {
    if (!validQuantity(item.quantity)) return fail('INVALID_QUANTITY', '请选择有效的购买数量')
    const good = lookupGood(item.type, item.id)
    if (!good || !SOLD.has(good.id) || !Number.isFinite(good.price) || good.price! < 0) return fail('INVALID_ITEM', '这件物品当前不出售')
    if ((good.needLevel ?? 0) > save.petComputedlInfo.level) return fail('LEVEL_REQUIRED', '宠物等级不足，暂时不能购买')
    if (good.PD && !save.petInfo.pinkDiamond) return fail('MEMBERSHIP_REQUIRED', '这件物品需要粉钻会员')
    const key = `${item.type}/${item.id}`
    const quantity = (quantities.get(key) ?? 0) + item.quantity
    if (!validQuantity(quantity) || !Number.isSafeInteger(countGood(save, item.type, item.id) + quantity)) return fail('INVALID_QUANTITY', '购买数量过大')
    quantities.set(key, quantity)
    total += unitPrice(save, good) * item.quantity
  }
  if (!Number.isSafeInteger(total)) return fail('INVALID_QUANTITY', '购买金额无效')
  if (save.petInfo.yb < total) return fail('INSUFFICIENT_FUNDS', '抱歉您的余额不足')
  const next = cloneJson(save)
  next.petInfo.yb -= total
  for (const item of items) changeGood(next, item.type, item.id, item.quantity)
  return succeed(save, next, { total })
}

/** A negative price can never credit the balance. */
export function spend(save: SaveData, amount: number): PetResult<{ amount: number }> {
  if (!Number.isSafeInteger(amount) || amount < 0) return fail('INVALID_QUANTITY', '消费金额无效')
  if (save.petInfo.yb < amount) return fail('INSUFFICIENT_FUNDS', '抱歉您的余额不足')
  const next = cloneJson(save)
  next.petInfo.yb -= amount
  return succeed(save, next, { amount })
}

export function usePetItem(save: SaveData, type: GoodType, id: string, quantity = 1): PetResult<ItemReceipt> {
  const good = lookupGood(type, id)
  if (!good || (type !== 'nums' && type !== 'medicine' && !DAILY[type])) return fail('INVALID_ITEM', '这件物品不能直接使用')
  if (!validQuantity(quantity) || (type !== 'nums' && quantity !== 1)) return fail('INVALID_QUANTITY', '请选择有效的使用数量')
  if (countGood(save, type, id) < quantity) return fail('INSUFFICIENT_ITEMS', '背包里的物品不足')
  if (type !== 'medicine' && save.petInfo.health === 0) return fail('PET_DEAD', '宠物已经死亡，需要先复活')
  const daily = DAILY[type]
  if (daily?.paused && save.settings.paused) return fail('PAUSED', '宠物暂停成长，暂时不能使用这件物品')
  const next = cloneJson(save)
  let message: string | undefined
  let action = daily?.action ?? 'speak'
  if (type === 'nums') {
    const key = (good.useId ?? good.id) as keyof PetInfo
    if (!['yb', 'growth', 'health'].includes(key) || !Number.isFinite(good.value)) return fail('INVALID_ITEM', '物品属性无效')
    const stat = key as 'yb' | 'growth' | 'health'
    next.petInfo[stat] = Math.max(next.petInfo[stat] + quantity * good.value!, 0)
    if (stat === 'health') next.petInfo.health = Math.min(next.petInfo.health, 5)
  } else if (type === 'medicine') {
    if (id === DEAD.cure.id) {
      next.petInfo.health = 5
      message = '[host]，再次见到你很高兴~~'
    } else {
      if (save.petInfo.health === 5) return fail('REQUIREMENTS_NOT_MET', '宠物现在很健康，不需要吃药')
      if (save.petInfo.health === 0) return fail('PET_DEAD', '这种药不能复活宠物，请使用还魂丹')
      const illness = illOf(String(save.activeOption.ill ?? '1-') + save.petInfo.health)
      const right = id === illness.cure.id
      next.petInfo.health = right ? 5 : Math.max(save.petInfo.health - 1, 0)
      message = right ? illness.successTolk : illness.errTolk
    }
    if (next.petInfo.health === 5) next.activeOption.ill = null
    action = 'cure'
    applyGood(next, good)
  } else {
    applyGood(next, good, daily!.extra)
    if (good.useTimeing) next.selfGoodUseOption[type as TimedType] = { id, left: good.useTimeing }
  }
  changeGood(next, type, id, -quantity)
  return succeed(save, next, { good, quantity, action, moodDelta: next.petInfo.mood - save.petInfo.mood, message })
}

/** Rechecks the prescription and pays for a missing medicine in the same change as treatment. */
export function treatPet(save: SaveData, medicineId: string): PetResult<ItemReceipt> {
  const illness = save.petInfo.health === 0 ? DEAD : illOf(String(save.activeOption.ill ?? '1-') + save.petInfo.health)
  if (save.petInfo.health === 5 || illness.cure.id !== medicineId) return fail('REQUIREMENTS_NOT_MET', '宠物病情已改变，请重新看病')
  const next = cloneJson(save)
  if (!countGood(next, 'medicine', medicineId)) {
    const cost = Math.round((goodOf('medicine', medicineId).price || 50) * 1.2)
    if (next.petInfo.yb < cost) return fail('INSUFFICIENT_FUNDS', '抱歉您的余额不足')
    next.petInfo.yb -= cost
    changeGood(next, 'medicine', medicineId, 1)
  }
  const result = usePetItem(next, 'medicine', medicineId)
  if (result.status === 'failed') return result
  return succeed(save, { ...next, ...result.patch } as SaveData, result.data)
}
