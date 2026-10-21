import type { ActivityKind, ActivityProgress, GameActivity } from '../core/pet/activities'
import type { GoodType, TimedType } from '../core/pet/catalog'
import type { ItemReceipt } from '../core/pet/items'
import type { PetResult } from '../core/pet/result'
import type { SaveData, Sex } from './save'

/** JSON-only commands. The host supplies time, randomness and the current pet. */
export interface PetCommands {
  'pet.useItem': { input: { type: GoodType; id: string; quantity: number }; output: ItemReceipt }
  'pet.purchase': { input: { items: { type: GoodType; id: string; quantity: number }[] }; output: { total: number } }
  'pet.diagnose': { input: Record<string, never>; output: { amount: number } }
  'pet.treat': { input: { medicineId: string }; output: ItemReceipt }
  'pet.startActivity': { input: { kind: ActivityKind; id: string }; output: GameActivity }
  'pet.stopActivity': { input: Record<string, never>; output: { kind: ActivityKind | null } }
  'pet.submitExam': { input: { topic: string; answers: { title: string; answer: string }[] }; output: { passed: boolean } }
  'pet.interact': { input: { face: boolean }; output: { moodDelta: number; first: boolean } }
  'pet.adopt': { input: { sex: Sex }; output: { sex: Sex } }
  'pet.bury': { input: Record<string, never>; output: Record<string, never> }
  'pet.sweetheart': { input: { days: number } | { enabled: boolean }; output: { expiresAt: number } }
}

export type PetCommandName = keyof PetCommands
export type PetCommand = { [K in PetCommandName]: { name: K; input: PetCommands[K]['input'] } }[PetCommandName]
export type PetRequest = PetCommand & { requestId: string; epoch: string }
export type PetOutcome<T> = Omit<Extract<PetResult<T>, { status: 'succeeded' }>, 'patch'> | Extract<PetResult<T>, { status: 'failed' }>
export interface PetSnapshot { revision: number; epoch: string; save: SaveData }
export interface PetReply<T = unknown> { result: PetOutcome<T>; snapshot: PetSnapshot; replayed: boolean }

export type PetEvent =
  | { type: 'activity'; progress: ActivityProgress }
  | { type: 'mood-exhausted'; kind: ActivityKind }
  | { type: 'timed-expired'; kind: TimedType }
  | { type: 'self-care'; receipt: ItemReceipt; action: string }
  | { type: 'new-day' }

export interface PetUpdate { snapshot: PetSnapshot; events: PetEvent[] }

/** Expired IDs are rejected, never re-executed after their receipt has been reclaimed. */
export const REQUEST_TTL_MS = 24 * 60 * 60 * 1000
export const MAX_REQUEST_RECEIPTS = 1024

