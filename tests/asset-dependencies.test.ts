import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { deflateSync } from 'node:zlib'
import test from 'node:test'
import { collectDependencies, embeddedReferences, unusedAssets } from '../scripts/asset-dependencies'
import { AssetCatalog } from '../src/main/assets'
import { routedAssetUrls } from '../src/renderer/pet/router'
import { fixture } from './fixtures'

test('the basic dependency closure retains rare actions, imported goods and HiDPI variants', () => {
  const project = resolve('.')
  const catalog = new AssetCatalog(join(project, 'resources'))
  const dependencies = collectDependencies(project, catalog)
  for (const path of [
    'Action/GG/Adult/peaceful/play/P100.swf',
    'Action/MM/Kid/play/P111.swf',
    'Action/MM/Adult/sad/interact/M9.swf',
    'img_res/food/100010031.gif', // Not sold by the current shop, but valid in old saves.
    'img_res/study/dx-chinese.png',
    'windowTip/normal/beijing1.svg',
    'talk/4/talk@2x.swf',
  ]) assert.ok(dependencies.logical.has(path), `未覆盖的基础依赖：${path}`)
  assert.ok(dependencies.files.has(catalog.resolve('img_res/food/100010031@2x.png')))
  assert.deepEqual(unusedAssets(catalog, dependencies), [])
  assert.ok([...dependencies.logical.keys()].every(path => !/^(petsoc|game|fishing|qqfarm|album)\//.test(path)))
  assert.equal(routedAssetUrls().filter(url => url.includes('/play/')).length, 664)
})

test('dependency checks reject a missing random animation and discover SVG child references', context => {
  const directory = fixture(context)
  mkdirSync(join(directory, 'custom'))
  writeFileSync(join(directory, 'custom/avatar.svg'), '<svg><image href="missing.png"/></svg>')
  const root = resolve('resources')
  const missing = new AssetCatalog(root, {
    schemaVersion: 1, id: 'broken', name: 'test', root: 'pet',
    overrides: { 'Action/MM/Kid/play/P111.swf': 'absent/action.swf' },
  })
  assert.throws(() => collectDependencies(resolve('.'), missing), /必需资源缺失.*P111/)
  assert.deepEqual(embeddedReferences(join(directory, 'custom/avatar.svg')), ['missing.png'])
})

test('compressed Flash references include child movies without treating flash.xml as a file', context => {
  const file = join(fixture(context), 'movie.swf')
  const body = Buffer.from('\0flash.xml\0child.swf\0images/food.png\0API.swfSay\0', 'ascii')
  const header = Buffer.alloc(8)
  header.write('CWS')
  header[3] = 9
  header.writeUInt32LE(body.length + 8, 4)
  writeFileSync(file, Buffer.concat([header, deflateSync(body)]))
  assert.deepEqual(embeddedReferences(file), ['child.swf', 'images/food.png'])
})
