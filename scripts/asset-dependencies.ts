import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import { inflateSync } from 'node:zlib'
import GOODS from '../src/core/pet/data/goods.json'
import { AssetCatalog } from '../src/main/assets'
import { FACE } from '../src/renderer/pet/data/face'
import { routedAssetUrls } from '../src/renderer/pet/router'
import { TRAY_STATES } from '../src/shared/tray'

export const slash = (path: string): string => path.split(sep).join('/')

export function walk(directory: string): string[] {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = join(directory, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`资源检查不接受符号链接：${file}`)
    return entry.isDirectory() ? walk(file) : [file]
  })
}

export interface AssetDependencies {
  /** Logical URLs with the source or runtime rule that needs each one. */
  logical: Map<string, Set<string>>
  /** Resolved files, including optional HiDPI siblings of the selected replacement. */
  files: Set<string>
}

/** Finite runtime asset families supplement literal URLs in the active source tree. */
export function collectDependencies(project: string, catalog: AssetCatalog): AssetDependencies {
  const logical = new Map<string, Set<string>>()
  const files = new Set<string>()
  const add = (url: string, reason: string): void => {
    const key = url.replace(/^(?:\.\/|\/)?pet\//, '')
    const reasons = logical.get(key) ?? new Set<string>()
    reasons.add(reason)
    logical.set(key, reasons)
  }
  const literals = /(?:\.\/|\/)?pet\/[\w/@.-]+\.(?:png|gif|bmp|jpe?g|svg|ttf|swf|cur|ico|webp)\b/g
  for (const file of walk(join(project, 'src')).filter(file => /\.(ts|css|html)$/.test(file))) {
    const source = readFileSync(file, 'utf8')
    for (const url of source.match(literals) ?? []) add(url, slash(relative(project, file)))
  }

  // All inventory goods remain reachable through imported saves, including retired merchandise.
  // service/trip have no basic UI entry and their legacy image URLs were already absent upstream.
  for (const type of ['food', 'clean', 'medicine', 'background', 'toy', 'nums', 'work', 'study'] as const) {
    for (const good of Object.values(GOODS[type])) add(good.url, `catalog:${type}`)
  }
  for (const url of routedAssetUrls()) add(url, 'animation:router')
  for (const sex of ['GG', 'MM'] as const) {
    for (const stage of ['Egg', 'Kid', 'Adult'] as const) {
      add(`avatar/${sex}${stage}.png`, 'avatar:stage')
      for (const direction of ['left', 'right']) add(`Action/${sex}/${stage}/walk/walk_${direction}.swf`, 'animation:walk')
      const groups = stage === 'Adult' ? Object.entries(FACE[sex].Adult) : [['', FACE[sex][stage]]] as const
      for (const [mood, points] of groups) {
        for (const [key, point] of Object.entries(points)) {
          for (let n = point.s ?? 1; n <= (point.e ?? point.s ?? 1); n++) {
            add(`Action/${sex}/${stage}/${mood ? mood + '/' : ''}interact/${key}${n}.swf`, 'animation:face')
          }
        }
      }
    }
    // Preserve every state still accepted by the tray IPC contract.
    for (const [state, { frames }] of Object.entries(TRAY_STATES)) {
      if (!frames) add(`img_res/Tray/${sex}/${state}.png`, 'tray:states')
      for (let frame = 1; frame <= frames; frame++) add(`img_res/Tray/${sex}/${state}/${frame}.png`, 'tray:states')
    }
  }
  for (let skin = 1; skin <= 4; skin++) {
    for (const name of ['talk', 'talk@2x']) add(`talk/${skin}/${name}.swf`, 'ui:talk')
  }
  const control = readFileSync(join(project, 'src/renderer/ui/control.ts'), 'utf8')
  for (const match of control.matchAll(/icon:\s*'([\w.-]+\.(?:png|svg))'/g)) add(`control/icons/${match[1]}`, 'ui:control')
  for (const icon of [18, 20, 22, 24, 26, 28]) add(`control/icons/active/${icon}.svg`, 'ui:control')
  const box = readFileSync(join(project, 'src/renderer/ui/box.ts'), 'utf8')
  for (const match of box.matchAll(/'(normal\/[\w.-]+|vip\/[\w.-]+)'/g)) {
    add(`windowTip/${match[1]}`, 'ui:box')
    add(`windowTip/${match[1].replace(/\.\w+$/, '.svg')}`, 'ui:box:hd')
  }
  for (const prefix of ['u', 'n']) {
    for (let level = 1; level <= 7; level++) add(`info/${prefix}${level}.svg`, 'ui:diamond')
  }
  for (const name of ['dengji', ...Array.from({ length: 7 }, (_, i) => `dengji${i + 1}`), 'h_up', 'h_down']) {
    add(`stateInfo/${name}.png`, 'ui:state')
  }
  for (const color of ['luse', 'blue', 'huangse', 'hongse']) {
    for (const part of ['00', '01', '02']) add(`stateInfo/${color}jindutiao${part}.png`, 'ui:progress')
  }
  for (const directory of ['stateInfo', 'Menu']) {
    for (let slice = 1; slice <= 9; slice++) add(`${directory}/ditu0${slice}.png`, 'ui:frame')
  }

  // Follow literal subresources in retained SVGs and SWFs, never the archived source tree.
  // SWF string inspection is conservative, not a general ActionScript dependency evaluator.
  const scanned = new Set<string>()
  for (const key of logical.keys()) {
    const file = catalog.resolve(key)
    if (!existsSync(file)) throw new Error(`必需资源缺失：${key}（${[...logical.get(key)!].join(', ')}）`)
    files.add(file)
    const hi = file.replace(/\.(png|gif|bmp|jpg)$/i, '@2x.png')
    if (hi !== file && existsSync(hi)) files.add(hi)
    if (scanned.has(file)) continue
    scanned.add(file)
    for (const url of embeddedReferences(file)) {
      if (/^(?:https?:|data:|#)/i.test(url)) continue
      const dependency = url.startsWith('pet/') || url.startsWith('/pet/')
        ? url
        : slash(join(dirname(key), url))
      add(dependency, `embedded:${key}`)
    }
  }
  return { logical, files }
}

export function embeddedReferences(file: string): string[] {
  const extension = extname(file).toLowerCase()
  if (extension === '.svg') {
    return [...readFileSync(file, 'utf8').matchAll(/(?:href|xlink:href)=["']([^"']+)["']/g)].map(match => match[1])
  }
  if (extension !== '.swf') return []
  let data = readFileSync(file)
  const signature = data.toString('ascii', 0, 3)
  if (signature === 'CWS') data = inflateSync(data.subarray(8))
  else if (signature !== 'FWS') throw new Error(`无法检查 SWF 依赖：${file}（${signature}）`)
  const strings = data.toString('latin1').match(/[\x20-\x7e]{4,}/g) ?? []
  return [...new Set(strings.filter(value =>
    value !== 'flash.xml' && /^(?:\.{0,2}\/|\/)?[\w/ .@-]+\.(?:swf|xml|png|gif|jpe?g|mp3|ttf)$/i.test(value),
  ))]
}

export function unusedAssets(catalog: AssetCatalog, dependencies: AssetDependencies): string[] {
  return walk(catalog.directory).filter(file =>
    file !== resolve(catalog.directory, 'asset-pack.json') && !dependencies.files.has(file),
  ).sort()
}
