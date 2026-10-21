import { cloneJson } from '../../shared/compat'
import type { PetCommand, PetCommandName } from '../../shared/pet-command'
import type { SaveData, SavePatch } from '../../shared/save'
import { assertJson, isRecord } from '../../shared/validation'
import { startActivity, stopActivity, submitExam } from './activities'
import { dayStart, normalizePet } from './clock'
import { interact } from './interaction'
import { purchase, spend, treatPet, usePetItem } from './items'
import { fail, succeed, type PetResult } from './result'

type Validator = (value: unknown) => boolean
const text: Validator = value => typeof value === 'string' && value.length > 0 && value.length <= 512
const number: Validator = value => typeof value === 'number' && Number.isFinite(value)
const boolean: Validator = value => typeof value === 'boolean'
const oneOf = (...values: unknown[]): Validator => value => values.includes(value)
const fields = (shape: Record<string, Validator>): Validator => value => isRecord(value)
  && Object.keys(value).length === Object.keys(shape).length
  && Object.entries(shape).every(([key, validate]) => Object.hasOwn(value, key) && validate(value[key]))
const list = (validate: Validator, max: number): Validator => value => Array.isArray(value) && value.length <= max && value.every(validate)
const item = fields({ type: oneOf('food', 'clean', 'medicine', 'background', 'toy', 'nums', 'service', 'work', 'study', 'trip'), id: text, quantity: number })

/** Registry is shared by UI IPC and future authenticated adapters; no raw state write tool. */
export const PET_TOOLS: Record<PetCommandName, { description: string; validate: Validator }> = {
  'pet.useItem': { description: '使用背包物品', validate: item },
  'pet.purchase': { description: '原子购买整车商品', validate: fields({ items: list(item, 100) }) },
  'pet.diagnose': { description: '按当前病情支付诊断费用', validate: fields({}) },
  'pet.treat': { description: '复核处方并购买或使用药品', validate: fields({ medicineId: text }) },
  'pet.startActivity': { description: '开始学习或打工', validate: fields({ kind: oneOf('work', 'study'), id: text }) },
  'pet.stopActivity': { description: '停止当前游戏活动', validate: fields({}) },
  'pet.submitExam': { description: '按题库与当前进度判定考试', validate: fields({ topic: text, answers: list(fields({ title: text, answer: text }), 3) }) },
  'pet.interact': { description: '互动增加心情', validate: fields({ face: boolean }) },
  'pet.adopt': { description: '首次领养宠物', validate: fields({ sex: oneOf('GG', 'MM') }) },
  'pet.bury': { description: '埋葬已死亡的宠物', validate: fields({}) },
  'pet.sweetheart': { description: '购买或切换自动照料', validate: value => fields({ days: number })(value) || fields({ enabled: boolean })(value) },
}

export function validCommand(value: unknown): value is PetCommand {
  try {
    assertJson(value)
    return isRecord(value) && typeof value.name === 'string' && Object.hasOwn(PET_TOOLS, value.name)
      && PET_TOOLS[value.name as PetCommandName].validate(value.input)
  } catch { return false }
}

export function executePetCommand(save: SaveData, command: PetCommand, now = Date.now() / 1000, random = Math.random): PetResult<unknown> {
  if (!save.havePet && command.name !== 'pet.adopt') return fail('PET_NOT_ADOPTED', '请先领养宠物')
  let result: PetResult<unknown>
  switch (command.name) {
    case 'pet.useItem': result = usePetItem(save, command.input.type, command.input.id, command.input.quantity); break
    case 'pet.purchase': result = purchase(save, command.input.items); break
    case 'pet.diagnose': result = spend(save, (5 - save.petInfo.health) * 10); break
    case 'pet.treat': result = treatPet(save, command.input.medicineId); break
    case 'pet.startActivity': result = startActivity(save, command.input.kind, command.input.id); break
    case 'pet.stopActivity': result = stopActivity(save); break
    case 'pet.submitExam': result = submitExam(save, command.input.topic, command.input.answers); break
    case 'pet.interact': result = interact(save, Math.floor(random() * 11) + 5, command.input.face); break
    case 'pet.adopt': {
      if (save.havePet) return fail('REQUIREMENTS_NOT_MET', '已经领养宠物，不能重复领养')
      const next = cloneJson(save)
      next.havePet = true
      next.petInfo.sex = command.input.sex
      next.nowTimeLine = now
      result = succeed(save, next, { sex: command.input.sex })
      break
    }
    case 'pet.bury': {
      if (save.petInfo.health > 0) return fail('REQUIREMENTS_NOT_MET', '只能埋葬已死亡的宠物')
      result = succeed(save, { ...save, isBury: true }, {})
      break
    }
    case 'pet.sweetheart': {
      const next = cloneJson(save)
      if ('days' in command.input) {
        const days = command.input.days
        if (!Number.isSafeInteger(days) || days < 1 || days > 30) return fail('INVALID_QUANTITY', '托管天数应为 1–30 天')
        if (next.petInfo.yb < days * 300) return fail('INSUFFICIENT_FUNDS', '抱歉您的余额不足')
        next.petInfo.yb -= days * 300
        next.petInfo.sweetHeartOverTime = Math.max(dayStart(now), next.petInfo.sweetHeartOverTime) + days * 86400
        next.petInfo.sweetHeart = true
      } else {
        if (command.input.enabled && next.petInfo.sweetHeartOverTime <= dayStart(now)) return fail('REQUIREMENTS_NOT_MET', '请先购买有效的托管时间')
        next.petInfo.sweetHeart = command.input.enabled
      }
      result = succeed(save, next, { expiresAt: next.petInfo.sweetHeartOverTime })
      break
    }
  }
  if (result.status === 'failed') return result
  const next = cloneJson(save)
  for (const [key, value] of Object.entries(result.patch)) {
    if (isRecord(value)) Object.assign(next[key as keyof SaveData] as object, value)
    else (next as unknown as Record<string, unknown>)[key] = value
  }
  normalizePet(next)
  return succeed(save, next, result.data)
}

/** Transitional UI adapter only permits absolute preferences and desktop placement. */
export function validatePreferences(patch: unknown, current: SaveData): asserts patch is SavePatch {
  assertJson(patch)
  if (!isRecord(patch) || Object.keys(patch).some(key => !['petInfo', 'settings'].includes(key))) throw new Error('只能修改桌面偏好；养成状态必须通过业务命令提交')
  for (const [group, values] of Object.entries(patch)) {
    if (!isRecord(values)) throw new Error('无效偏好分组')
    for (const [key, value] of Object.entries(values)) {
      const before = (current[group as 'petInfo' | 'settings'] as unknown as Record<string, unknown>)[key]
      if (group === 'petInfo' && !['lastX', 'lastY', 'name', 'host'].includes(key)) throw new Error('不能从界面覆盖养成属性')
      if (!Object.hasOwn(current[group as 'petInfo' | 'settings'], key)) throw new Error('未知偏好字段')
      if (key === 'petDisplayId') {
        if (value !== null && !Number.isSafeInteger(value)) throw new Error('无效显示器编号')
      } else if (typeof value !== typeof before) throw new Error('偏好类型不匹配')
      if (typeof value === 'string' && (value.length > 8192 || (['name', 'host'].includes(key) && !value.trim()))) throw new Error('偏好文本无效')
      if (['opacity', 'music'].includes(key) && (Number(value) < 0 || Number(value) > 1)) throw new Error('无效音量或透明度')
      if (key === 'faceClick' && ![0, 1, 2].includes(Number(value))) throw new Error('无效互动设置')
    }
  }
}
