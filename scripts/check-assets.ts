import { copyFileSync, existsSync, mkdirSync, openSync, closeSync, readSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import { AssetCatalog } from '../src/main/assets'
import { collectDependencies, slash, unusedAssets } from './asset-dependencies'

const project = resolve('.')
const root = join(project, 'resources')
const catalog = new AssetCatalog(root)
catalog.checkOverrides()
const dependencies = collectDependencies(project, catalog)
const files = [...dependencies.files].sort()
const unused = unusedAssets(catalog, dependencies)

function statistics(paths: string[]) {
  const categories: Record<string, { files: number; bytes: number }> = {}
  const extensions: Record<string, number> = {}
  let bytes = 0
  for (const file of paths) {
    const size = statSync(file).size
    if (size < 200) {
      const handle = openSync(file, 'r')
      const header = Buffer.alloc(128)
      try {
        readSync(handle, header, 0, header.length, 0)
        if (header.toString().startsWith('version https://git-lfs.github.com/spec/v1')) {
          throw new Error(`发现 Git LFS 指针，尚未下载真实资源：${relative(root, file)}`)
        }
      } finally { closeSync(handle) }
    }
    const category = slash(relative(join(root, catalog.pack.root), file)).split('/')[0]
    const bucket = categories[category] ??= { files: 0, bytes: 0 }
    bucket.files++
    bucket.bytes += size
    bytes += size
    const extension = extname(file).toLowerCase()
    extensions[extension] = (extensions[extension] ?? 0) + 1
  }
  return { files: paths.length, bytes, extensions, categories }
}

const inventory = {
  pack: catalog.pack.id,
  profile: 'basic',
  logicalAssets: dependencies.logical.size,
  ...statistics(files),
}
if (process.argv.includes('--audit')) {
  const output = join(project, '.verification/assets')
  mkdirSync(output, { recursive: true })
  writeFileSync(join(output, 'dependencies.json'), JSON.stringify({
    ...inventory,
    assets: [...dependencies.logical].sort(([a], [b]) => a.localeCompare(b)).map(([path, reasons]) => ({
      path,
      resolved: slash(relative(root, catalog.resolve(path))),
      reasons: [...reasons].sort(),
    })),
    retainedFiles: files.map(file => slash(relative(root, file))),
    unused: { ...statistics(unused), paths: unused.map(file => slash(relative(root, file))) },
  }, null, 2) + '\n')
  console.log(`依赖审计：${inventory.logicalAssets} 个逻辑资源，${files.length} 个实际文件；${unused.length} 个未引用文件。清单：.verification/assets/dependencies.json`)
} else if (unused.length) {
  throw new Error(`存在 ${unused.length} 个未引用资源；运行 npm run assets:audit 查看清单，确认用途后再清理。`)
}

if (process.argv.includes('--inventory')) {
  mkdirSync(join(project, 'docs'), { recursive: true })
  writeFileSync(join(project, 'docs/asset-inventory.json'), JSON.stringify(inventory, null, 2) + '\n')
}

if (process.argv.includes('--stage')) {
  // A fixed, workspace-contained output is rebuilt so deleted assets cannot survive in an old package.
  const stage = resolve(project, 'out/asset-pack')
  const actual = existsSync(stage) ? realpathSync(stage) : existsSync(dirname(stage)) ? join(realpathSync(dirname(stage)), 'asset-pack') : stage
  const inside = relative(realpathSync(project), actual)
  if (inside !== ['out', 'asset-pack'].join(sep)) throw new Error(`资源输出目录不在预期位置：${actual}`)
  rmSync(stage, { force: true, recursive: true })
  mkdirSync(stage, { recursive: true })
  copyFileSync(join(root, 'asset-pack.json'), join(stage, 'asset-pack.json'))
  for (const file of files) {
    const destination = join(stage, relative(root, file))
    mkdirSync(dirname(destination), { recursive: true })
    copyFileSync(file, destination)
  }
  console.log(`发行资源已准备：${files.length} 个依赖文件及资源包配置。`)
}

console.log(`基础资源检查通过：${inventory.logicalAssets} 个逻辑资源，${inventory.files} 个真实文件，${(inventory.bytes / 1024 / 1024).toFixed(1)} MiB；已检查动态动作、旧物品、高清副本和嵌入引用。`)
