import { countGood, purchase, spend, treatPet, unitPrice, usePetItem, type ItemReceipt } from '../../core/pet/items'
import { goodOf, type Good } from '../../core/pet/catalog'
import { DEAD, illOf } from '../../core/pet/illness'
import type { PetResult } from '../../core/pet/result'
import { floatMood } from '../ui/float'
import { windowView } from '../ui/window-view'
import { command } from './commands'
import { speak } from './pet'
import { info, save } from './store'

export function pay(amount: number): boolean {
  const result = command(state => spend(state, amount))
  if (result.status === 'failed') windowView({ msg: result.error.message })
  return result.status === 'succeeded'
}

function present(result: PetResult<ItemReceipt>, text?: string): void {
  if (result.status === 'failed') {
    speak({ s: result.error.message, now: true, ai: false }, 'speak')
    return
  }
  const { good, action, moodDelta, message } = result.data
  if (moodDelta) void floatMood(moodDelta)
  const categories: Partial<Record<Good['type'], string>> = { food: 'eat', clean: 'clean', toy: 'toy', background: 'pay' }
  const category = categories[good.type]
  const line = text ?? message
  speak(line ? { s: line, now: true, ai: false } : category ? { c: category, s: good.type, now: true } : { s: `[host]，使用了${good.name}~`, now: true }, action)
}

/** Dialogs collect input; the core commits effects before any animation starts. */
export function useItem(good: Good, text?: string): void {
  const use = (quantity = 1): void => present(command(state => usePetItem(state, good.type, good.id, quantity)), text)
  if (good.type === 'nums') {
    const count = countGood(save, good.type, good.id)
    if (!count) return use()
    return windowView({ title: `使用-${good.name}`, msg: '选择使用数量', goods: [good], max: count, ok: (close, quantity) => { close(); use(quantity) } })
  }
  if (good.type === 'medicine' && good.id === DEAD.cure.id && info.health > 0) {
    return windowView({ title: '使用还魂丹？', msg: '您的宠物未死亡，确定需要使用还魂丹进行治疗？', goods: [good], ok: close => { close(); use() } })
  }
  use()
}

export const discount = (amount: number): number => Math.round(amount * 0.8)
export const price = (good: Good): number => unitPrice(save, good)

/** All cart items succeed together, or leave inventory and balance unchanged. */
export function buyCart(items: [Good, number][]): boolean {
  const result = command(state => purchase(state, items.map(([good, quantity]) => ({ type: good.type, id: good.id, quantity }))))
  if (result.status === 'failed') windowView({ msg: result.error.message })
  return result.status === 'succeeded'
}

export function doctor(): void {
  if (info.health === 5) return speak({ s: '[host]，我现在很健康，不需要看病~', now: true, ai: false }, 'speak')
  const diagnose = (): void => {
    const illness = info.health === 0 ? DEAD : illOf(String(save.activeOption.ill ?? '1-') + info.health)
    const good = goodOf('medicine', illness.cure.id)
    const owned = countGood(save, 'medicine', good.id) > 0
    const cost = Math.round((good.price || 50) * 1.2)
    windowView({
      title: '诊断结果',
      msg: `${info.health === 0 ? '宠物已经死亡' : `宠物患上了${illness.name}`}，需要${good.name}。${owned ? '使用背包中的药品治疗？' : `花费${cost}元宝购买并治疗？`}`,
      goods: [good],
      ok: close => { close(); present(command(state => treatPet(state, good.id))) },
    })
  }
  if (info.health === 0) return diagnose()
  windowView({ title: '看病', msg: `花费${(5 - info.health) * 10}元宝进行诊断？`, ok: close => {
    close()
    if (info.health === 5) return
    if (pay((5 - info.health) * 10)) diagnose()
  } })
}
