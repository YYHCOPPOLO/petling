import { cloneJson } from './compat'
import type { PetCommand, PetOutcome, PetReply, PetRequest, PetSnapshot, PetUpdate } from './pet-command'
import type { SavePatch } from './save'

interface Transport {
  save(patch: SavePatch): Promise<PetSnapshot>
  command(request: PetRequest): Promise<PetReply>
}
const merge = (target: SavePatch, change: SavePatch): void => {
  for (const [key, value] of Object.entries(change)) {
    const group = key as keyof SavePatch
    if (value && typeof value === 'object' && !Array.isArray(value)) Object.assign(target, { [key]: { ...target[group] as object, ...value } })
    else Object.assign(target, { [key]: value })
  }
}

/** Serial transport, monotonic snapshots, and optimistic desktop preferences only. */
export class PetClient {
  private pending: SavePatch = {}
  private batches = new Set<SavePatch>()
  private tail: Promise<unknown> = Promise.resolve()
  private error: unknown
  constructor(private current: PetSnapshot, private readonly transport: Transport,
    private readonly publish: (update: PetUpdate) => void, private readonly report: (error: unknown) => void,
    private readonly requestId = () => `${Date.now()}:${crypto.randomUUID()}`) {}

  get hasError(): boolean { return this.error !== undefined }

  private project(events: PetUpdate['events'] = []): void {
    const projected = cloneJson(this.current)
    for (const patch of [...this.batches, this.pending]) {
      for (const [key, value] of Object.entries(patch)) Object.assign(projected.save[key as 'petInfo' | 'settings'], value)
    }
    this.publish({ snapshot: projected, events })
  }

  receive(update: PetUpdate): void {
    if (update.snapshot.epoch !== this.current.epoch || update.snapshot.revision <= this.current.revision) return
    this.current = cloneJson(update.snapshot)
    this.project(update.events)
  }

  update(patch: SavePatch): void {
    merge(this.pending, cloneJson(patch))
    this.project()
  }

  private queue<T>(run: () => Promise<T>): Promise<T> {
    const promise = this.tail.then(run)
    this.tail = promise.catch(error => { this.error = error; this.report(error) })
    return promise
  }

  flushPreferences(): void {
    if (!Object.keys(this.pending).length) return
    const patch = this.pending
    this.pending = {}
    this.batches.add(patch)
    void this.queue(async () => {
      try {
        const snapshot = await this.transport.save(patch)
        this.receive({ snapshot, events: [] })
        this.error = undefined
      } finally {
        this.batches.delete(patch)
        this.project()
      }
    }).catch(() => undefined)
  }

  command(command: PetCommand): Promise<PetOutcome<unknown>> {
    this.flushPreferences()
    const request = { ...cloneJson(command), requestId: this.requestId(), epoch: this.current.epoch } as PetRequest
    return this.queue(async () => {
      let reply: PetReply
      try { reply = await this.transport.command(request) }
      catch { reply = await this.transport.command(request) } // Lost acknowledgement: retry the identical ID once.
      this.receive({ snapshot: reply.snapshot, events: [] })
      return reply.result
    }).catch(() => ({ status: 'failed', error: { code: 'STORAGE_ERROR', message: '未能确认操作结果，请重新读取状态后重试' } }))
  }

  async flush(): Promise<void> {
    this.flushPreferences()
    await this.tail
    if (this.error) throw this.error
  }
}
