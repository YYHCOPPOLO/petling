import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { applyPatch, buried, petOf, startSave } from '../shared/save-logic'
import type { SaveData, SavePatch, Sex } from '../shared/save'
import { assertJson, isRecord } from '../shared/validation'
import { cloneJson } from '../shared/compat'

function readJson(file: string): Record<string, unknown> {
  const data: unknown = JSON.parse(readFileSync(file, 'utf8'))
  assertJson(data)
  if (!isRecord(data)) throw new Error('存档必须是 JSON 对象')
  return data
}

/** Persistence has no Electron dependency; migrations and failures can be tested on disk. */
export class SaveRepository {
  private state: SaveData | undefined

  constructor(readonly file: string, private readonly legacyFiles: string[] = []) {}

  private write(data: SaveData): void {
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 })
    const temporary = `${this.file}.tmp`
    writeFileSync(temporary, JSON.stringify(data), { mode: 0o600 })
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
    const next = startSave(stored)
    this.write(next)
    this.state = next
    return next
  }

  get(): SaveData {
    if (!this.state) throw new Error('存档尚未加载')
    return this.state
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
    this.write(next)
    this.state = next
  }

  export(file: string): void {
    const exported = cloneJson(this.get())
    exported.settings.aiKey = ''
    writeFileSync(file, JSON.stringify(exported, null, 2), { mode: 0o600 })
  }

  import(file: string): void {
    const incoming = petOf(readJson(file))
    if (incoming.havePet !== true || !isRecord(incoming.petInfo)) throw new Error('这不是有效的宠物存档')
    const next = startSave(incoming)
    if (existsSync(this.file)) copyFileSync(this.file, `${this.file}.bak`)
    this.write(next)
    this.state = next
  }

  reset(sex?: Sex): void {
    if (sex !== undefined && sex !== 'GG' && sex !== 'MM') throw new Error('无效宠物性别')
    copyFileSync(this.file, `${this.file}.bak`)
    const next = buried(cloneJson(this.get()), sex)
    this.write(next)
    this.state = next
  }
}
