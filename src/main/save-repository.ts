import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { applyPatch, buried, petOf, startSave } from '../shared/save-logic'
import type { SaveData, SavePatch, Sex } from '../shared/save'
import { assertJson, isRecord } from '../shared/validation'
import { cloneJson } from '../shared/compat'
import { createHash, randomUUID } from 'node:crypto'
import { MAX_REQUEST_RECEIPTS, REQUEST_TTL_MS, type PetOutcome, type PetReply, type PetRequest, type PetSnapshot } from '../shared/pet-command'
import { fail, type PetResult } from '../core/pet/result'

interface Runtime {
  version: 1
  epoch: string
  revision: number
  time: number
  receipts: Record<string, { fingerprint: string; result: PetOutcome<unknown> }>
}
const freshRuntime = (): Runtime => ({ version: 1, epoch: randomUUID(), revision: 0, time: 0, receipts: {} })
const canonical = (value: unknown): string => JSON.stringify(value, (_key, entry: unknown) => isRecord(entry)
  ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))) : entry)

function readJson(file: string): Record<string, unknown> {
  const data: unknown = JSON.parse(readFileSync(file, 'utf8'))
  assertJson(data)
  if (!isRecord(data)) throw new Error('存档必须是 JSON 对象')
  return data
}

/** Persistence has no Electron dependency; migrations and failures can be tested on disk. */
export class SaveRepository {
  private state: SaveData | undefined
  private runtime = freshRuntime()

  constructor(readonly file: string, private readonly legacyFiles: string[] = []) {}

  private write(data: SaveData, runtime = this.runtime): void {
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 })
    const temporary = `${this.file}.tmp`
    // Effects and receipts share one replacement; a failed write installs neither in memory.
    writeFileSync(temporary, JSON.stringify({ ...data, _agentPetRuntime: runtime }), { mode: 0o600, flush: true })
    renameSync(temporary, this.file)
  }

  load(): SaveData {
    let stored: Record<string, unknown> | null = null
    const candidate = existsSync(this.file) ? this.file : this.legacyFiles.find(existsSync)
    if (candidate) {
      try { stored = petOf(readJson(candidate)) }
      catch (error) {
        if (candidate === this.file) renameSync(candidate, `${candidate}.corrupt-${Date.now()}`)
        console.error('存档读取失败，已保留原文件：', candidate, error)
      }
    }
    if (stored && Object.hasOwn(stored, '_agentPetRuntime')) {
      const runtime = stored._agentPetRuntime
      if (candidate === this.file) {
        if (!isRecord(runtime) || runtime.version !== 1 || typeof runtime.epoch !== 'string' || !Number.isSafeInteger(runtime.revision)
          || Number(runtime.revision) < 0 || typeof runtime.time !== 'number' || !isRecord(runtime.receipts)
          || Object.keys(runtime.receipts).length > MAX_REQUEST_RECEIPTS) throw new Error('命令记录损坏，请从备份恢复存档')
        for (const [id, receipt] of Object.entries(runtime.receipts)) {
          if (!/^\d{13}:[0-9a-f-]{36}$/.test(id) || !isRecord(receipt) || typeof receipt.fingerprint !== 'string'
            || !isRecord(receipt.result) || !['succeeded', 'failed'].includes(String(receipt.result.status))) throw new Error('命令回执损坏，请从备份恢复存档')
        }
        this.runtime = runtime as unknown as Runtime
      }
      delete stored._agentPetRuntime
    }
    const next = startSave(stored)
    this.write(next)
    this.state = next
    return cloneJson(next)
  }

  get(): SaveData {
    if (!this.state) throw new Error('存档尚未加载')
    return cloneJson(this.state)
  }

  snapshot(): PetSnapshot { return { revision: this.runtime.revision, epoch: this.runtime.epoch, save: this.get() } }

  /** A synchronous host transaction: no await between reading current state and replacing it. */
  execute(request: PetRequest, run: (state: SaveData) => PetResult<unknown>, now = Date.now()): PetReply {
    const reply = (result: PetOutcome<unknown>, replayed = false): PetReply => ({ result, replayed, snapshot: this.snapshot() })
    if (request.epoch !== this.runtime.epoch) return reply(fail('STALE_PET', '存档已导入或重生，请重新读取宠物状态'))
    if (!/^\d{13}:[0-9a-f-]{36}$/.test(request.requestId)) return reply(fail('INVALID_REQUEST', '请求标识无效'))
    const time = Math.max(now, this.runtime.time)
    const issuedAt = Number(request.requestId.split(':')[0])
    if (issuedAt <= time - REQUEST_TTL_MS) return reply(fail('REQUEST_EXPIRED', '请求已超过 24 小时；请核对状态后发起新操作'))
    if (issuedAt > time + 60_000) return reply(fail('INVALID_REQUEST', '请求时间超出允许范围'))
    const fingerprint = createHash('sha256').update(canonical({ name: request.name, input: request.input })).digest('hex')
    const prior = this.runtime.receipts[request.requestId]
    if (prior) return prior.fingerprint === fingerprint
      ? reply(cloneJson(prior.result), true)
      : reply(fail('REQUEST_CONFLICT', '同一个请求标识不能用于不同操作'))
    const receipts = Object.fromEntries(Object.entries(this.runtime.receipts).filter(([id]) => Number(id.split(':')[0]) > time - REQUEST_TTL_MS))
    if (Object.keys(receipts).length >= MAX_REQUEST_RECEIPTS) return reply(fail('REQUEST_LIMIT', '今日操作记录已达上限，请在旧记录过期后重试'))
    const result = run(this.get())
    const outcome: PetOutcome<unknown> = result.status === 'succeeded' ? { status: 'succeeded', data: result.data } : result
    const next = this.get()
    if (result.status === 'succeeded') applyPatch(next, result.patch)
    const runtime = { ...this.runtime, revision: this.runtime.revision + 1, time, receipts: { ...receipts, [request.requestId]: { fingerprint, result: outcome } } }
    this.write(next, runtime)
    this.state = next
    this.runtime = runtime
    return reply(cloneJson(outcome))
  }

  patch(patch: SavePatch): void {
    assertJson(patch)
    if (!isRecord(patch)) throw new Error('无效存档修改')
    const current = this.get()
    for (const [key, value] of Object.entries(patch)) {
      if (!Object.hasOwn(current, key)) throw new Error(`未知存档字段：${key}`)
      const before = current[key as keyof SaveData]
      if (isRecord(before) && !isRecord(value)) throw new Error(`无效存档分组：${key}`)
      if (Array.isArray(before) && !Array.isArray(value)) throw new Error(`无效存档列表：${key}`)
      if (typeof before === 'boolean' && typeof value !== 'boolean') throw new Error(`无效存档字段：${key}`)
      if (typeof before === 'number' && typeof value !== 'number') throw new Error(`无效存档字段：${key}`)
    }
    const next = cloneJson(current)
    applyPatch(next, patch)
    const runtime = { ...this.runtime, revision: this.runtime.revision + 1 }
    this.write(next, runtime)
    this.state = next
    this.runtime = runtime
  }

  export(file: string): void {
    const exported = cloneJson(this.get())
    exported.settings.aiKey = ''
    writeFileSync(file, JSON.stringify(exported, null, 2), { mode: 0o600 })
  }

  import(file: string): void {
    const incoming = petOf(readJson(file))
    delete incoming._agentPetRuntime
    if (incoming.havePet !== true || !isRecord(incoming.petInfo)) throw new Error('这不是有效的宠物存档')
    const next = startSave(incoming)
    if (existsSync(this.file)) copyFileSync(this.file, `${this.file}.bak`)
    const runtime = freshRuntime()
    this.write(next, runtime)
    this.state = next
    this.runtime = runtime
  }

  reset(sex?: Sex): void {
    if (sex !== undefined && sex !== 'GG' && sex !== 'MM') throw new Error('无效宠物性别')
    copyFileSync(this.file, `${this.file}.bak`)
    const next = buried(cloneJson(this.get()), sex)
    const runtime = freshRuntime()
    this.write(next, runtime)
    this.state = next
    this.runtime = runtime
  }
}
