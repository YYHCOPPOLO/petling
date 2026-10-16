import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { isRecord, relativeAssetPath } from '../shared/validation'

export interface AssetPack {
  schemaVersion: 1
  id: string
  name: string
  root: string
  overrides: Record<string, string>
}

/** Logical /pet/ URLs remain stable, including URLs embedded inside SWFs. */
export class AssetCatalog {
  readonly directory: string
  readonly pack: AssetPack
  private listings = new Map<string, string[]>()

  constructor(directory: string, manifest?: unknown) {
    this.directory = resolve(directory)
    const data: unknown = manifest ?? JSON.parse(readFileSync(resolve(directory, 'asset-pack.json'), 'utf8'))
    if (!isRecord(data) || data.schemaVersion !== 1 || typeof data.id !== 'string' || typeof data.name !== 'string' || !isRecord(data.overrides)) {
      throw new Error('无效资源包配置：asset-pack.json')
    }
    const root = relativeAssetPath(data.root)
    const overrides: Record<string, string> = {}
    for (const [logical, physical] of Object.entries(data.overrides)) overrides[relativeAssetPath(logical)] = relativeAssetPath(physical)
    this.pack = { schemaVersion: 1, id: data.id, name: data.name, root, overrides }
  }

  resolve(logical: string): string {
    // Original Flash XML/SWFs concatenate folders with repeated slashes.
    // Normalize separators for requests; manifest paths remain strictly validated.
    const key = relativeAssetPath(logical.replace(/\/+/g, '/').replace(/^\/?pet\//, ''))
    const community = key.toLowerCase().startsWith('petsoc/')
    const override = this.pack.overrides[key] ?? (community ? Object.entries(this.pack.overrides).find(([logical]) => logical.toLowerCase() === key.toLowerCase())?.[1] : undefined)
    const path = override ?? `${this.pack.root}/${key}`
    const file = resolve(this.directory, path)
    const inside = relative(this.directory, file)
    if (inside.startsWith('..' + sep) || inside === '..' || inside.includes(':')) throw new Error('资源路径超出资源目录')
    // PetSoc's embedded URLs use Windows casing, even when a new pack root is selected.
    return community ? this.matchCasing(file) : file
  }

  private matchCasing(file: string): string {
    let directory = this.directory
    for (const part of relative(this.directory, file).split(sep)) {
      let names = this.listings.get(directory)
      if (!names) {
        try { names = readdirSync(directory) } catch { return file }
        this.listings.set(directory, names)
      }
      const found = names.includes(part) ? part : names.find(name => name.toLowerCase() === part.toLowerCase())
      if (!found) return file
      directory = join(directory, found)
    }
    return directory
  }

  publicPath(logical: string): string {
    return '/' + relative(this.directory, this.resolve(logical)).split(sep).join('/')
  }

  checkOverrides(): void {
    for (const logical of Object.keys(this.pack.overrides)) {
      if (!existsSync(this.resolve(logical))) throw new Error(`替换资源不存在：${logical}`)
    }
  }
}
