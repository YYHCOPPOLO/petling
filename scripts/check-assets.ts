import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readSync, statSync, writeFileSync } from 'node:fs'
import { extname, join, relative, resolve, sep } from 'node:path'
import { AssetCatalog } from '../src/main/assets'
import { route, type Mood } from '../src/renderer/pet/router'
import type { Sex } from '../src/shared/save'
import type { Stage } from '../src/core/pet/level'

const root = resolve('resources')
const catalog = new AssetCatalog(root)
catalog.checkOverrides()
const critical = ['qqfont.ttf', 'reset/Adopt.swf', 'Action/drag.swf', 'float/mood.swf']
for (const skin of [1, 2, 3, 4]) for (const movie of ['talk', 'talk@2x']) critical.push(`talk/${skin}/${movie}.swf`)
for (const sex of ['GG', 'MM'] as Sex[]) {
  for (const stage of ['Egg', 'Kid', 'Adult'] as Stage[]) {
    for (const mood of ['happy', 'peaceful', 'upset', 'sad'] as Mood[]) critical.push(route(sex, stage, 'normal', mood).url)
    critical.push(`avatar/${sex}${stage}.png`)
  }
  critical.push(`img_res/Tray/${sex}/leave.png`)
}
for (const path of critical) if (!existsSync(catalog.resolve(path))) throw new Error(`必需资源缺失：${path}`)

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? walk(path) : [path]
  })
}

const files = [...new Set([...walk(join(root, catalog.pack.root)), ...Object.keys(catalog.pack.overrides).map(key => catalog.resolve(key))])]
const buckets: Record<string, { files: number; bytes: number }> = {}
let bytes = 0
const extensions: Record<string, number> = {}
for (const file of files) {
  const size = statSync(file).size
  if (size < 200) {
    const handle = openSync(file, 'r')
    const header = Buffer.alloc(128)
    try {
      readSync(handle, header, 0, header.length, 0)
      if (header.toString().startsWith('version https://git-lfs.github.com/spec/v1')) throw new Error(`发现 Git LFS 指针，尚未下载真实资源：${relative(root, file)}`)
    } finally { closeSync(handle) }
  }
  const category = relative(join(root, catalog.pack.root), file).split(sep)[0]
  const bucket = buckets[category] ??= { files: 0, bytes: 0 }
  bucket.files++
  bucket.bytes += size
  bytes += size
  const extension = extname(file).toLowerCase()
  extensions[extension] = (extensions[extension] ?? 0) + 1
}

const inventory = { pack: catalog.pack.id, profile: 'basic', files: files.length, bytes, extensions, categories: buckets }
if (process.argv.includes('--inventory')) {
  mkdirSync(resolve('docs'), { recursive: true })
  writeFileSync(resolve('docs/asset-inventory.json'), JSON.stringify(inventory, null, 2) + '\n')
}
console.log(`基础资源检查通过：保留 ${inventory.files} 个真实文件，${(bytes / 1024 / 1024).toFixed(1)} MiB；领养、动画、互动和养成关键资源齐全。`)
