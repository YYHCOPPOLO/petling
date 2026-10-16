import type { SaveData, SavePatch } from '../../shared/save'

export type PetErrorCode = 'INVALID_ITEM' | 'INVALID_QUANTITY' | 'INSUFFICIENT_ITEMS' | 'INSUFFICIENT_FUNDS' | 'LEVEL_REQUIRED' | 'MEMBERSHIP_REQUIRED' | 'PET_DEAD' | 'PET_SICK' | 'PAUSED' | 'NO_MOOD' | 'ACTIVITY_CONFLICT' | 'REQUIREMENTS_NOT_MET' | 'EXAM_REQUIRED' | 'INVALID_ACTIVITY'

export type PetResult<T> =
  | { status: 'succeeded'; data: T; patch: SavePatch }
  | { status: 'failed'; error: { code: PetErrorCode; message: string } }

export const fail = (code: PetErrorCode, message: string): PetResult<never> => ({ status: 'failed', error: { code, message } })

/** Each operation builds a complete change before the UI publishes any of it. */
export function succeed<T>(before: SaveData, after: SaveData, data: T): PetResult<T> {
  const patch: Record<string, unknown> = {}
  for (const key of Object.keys(after) as (keyof SaveData)[]) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) patch[key] = after[key]
  }
  return { status: 'succeeded', data, patch: patch as SavePatch }
}

export const validQuantity = (quantity: number): boolean => Number.isSafeInteger(quantity) && quantity > 0 && quantity <= 1_000_000
