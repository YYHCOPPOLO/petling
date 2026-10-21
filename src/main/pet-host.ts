import { executePetCommand, validatePreferences, validCommand } from '../core/pet/commands'
import { tickPet } from '../core/pet/clock'
import { fail } from '../core/pet/result'
import type { PetReply, PetRequest, PetUpdate } from '../shared/pet-command'
import type { SavePatch } from '../shared/save'
import { isRecord } from '../shared/validation'
import type { SaveRepository } from './save-repository'

/** One owner of gameplay state, shared by the clock, UI commands and future adapters. */
export class PetHost {
  private previous: number | null = null
  private started = false
  private listeners = new Set<(update: PetUpdate) => void>()
  constructor(readonly repository: SaveRepository, private readonly now = Date.now, private readonly random = Math.random) {}

  subscribe(listener: (update: PetUpdate) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private publish(events: PetUpdate['events'] = []): void {
    const update = { snapshot: this.repository.snapshot(), events }
    for (const listener of this.listeners) {
      try { listener(update) } catch (error) { console.error('状态投影通知失败：', error) }
    }
  }

  execute(value: unknown): PetReply {
    if (!isRecord(value) || Object.keys(value).sort().join(',') !== 'epoch,input,name,requestId'
      || typeof value.requestId !== 'string' || typeof value.epoch !== 'string' || !validCommand({ name: value.name, input: value.input })) {
      return { result: fail('INVALID_REQUEST', '无效的宠物命令或参数'), snapshot: this.repository.snapshot(), replayed: false }
    }
    try {
      const before = this.repository.snapshot()
      const reply = this.repository.execute(value as PetRequest, state => executePetCommand(state, value as PetRequest, this.now() / 1000, this.random), this.now())
      if (reply.snapshot.revision !== before.revision) {
        if (before.save.petInfo.health <= 0 || !before.save.havePet) this.previous = Math.floor(this.now() / 1000)
        this.publish()
      }
      return reply
    } catch (error) {
      console.error('命令保存失败：', error)
      return { result: fail('STORAGE_ERROR', '操作尚未保存，请重试；宠物状态未修改'), snapshot: this.repository.snapshot(), replayed: false }
    }
  }

  preferences(value: unknown): ReturnType<SaveRepository['snapshot']> {
    const state = this.repository.get()
    validatePreferences(value, state)
    const patch: SavePatch = value
    if (patch.settings?.paused !== undefined && patch.settings.paused !== state.settings.paused) {
      patch.nowTimeLine = Math.floor(this.now() / 1000)
    }
    this.repository.patch(patch)
    if (patch.nowTimeLine !== undefined) this.previous = patch.nowTimeLine
    this.publish()
    return this.repository.snapshot()
  }

  /** Called once when the renderer has installed its presentation listeners. */
  start(): void {
    if (this.started) return
    this.tick()
    this.started = true
  }

  tick(): void {
    const now = Math.floor(this.now() / 1000)
    const state = this.repository.get()
    if (!state.havePet) { this.previous = now; return }
    const result = tickPet(state, now, this.previous, this.random)
    if (result.status === 'failed') return
    if (Object.keys(result.patch).length) this.repository.patch(result.patch)
    this.previous = now
    this.publish(result.data)
  }

  interval(): void { if (this.started) this.tick() }
}
