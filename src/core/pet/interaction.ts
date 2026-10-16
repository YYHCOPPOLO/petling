import { cloneJson } from '../../shared/compat'
import type { SaveData } from '../../shared/save'
import { fail, succeed, type PetResult } from './result'

export function interact(save: SaveData, amount: number, face = false): PetResult<{ moodDelta: number; first: boolean }> {
  if (!save.petInfo.health) return fail('PET_DEAD', '宠物已经死亡，需要先复活')
  if (!Number.isInteger(amount) || amount < 5 || amount > 15) return fail('INVALID_QUANTITY', '互动参数无效')
  const next = cloneJson(save)
  next.petInfo.mood = Math.min(save.petInfo.mood + amount, save.petComputedlInfo.moodMax)
  if (face) next.gameSaveDatas.ddw++
  return succeed(save, next, { moodDelta: next.petInfo.mood - save.petInfo.mood, first: face && !save.gameSaveDatas.ddw })
}
