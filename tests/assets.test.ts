import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { AssetCatalog } from '../src/main/assets'
import { gamePath, webUrl } from '../src/shared/validation'
import { fixture } from './fixtures'

test('a resource pack can replace a single asset while retaining stable SWF and CSS URLs', context => {
  const directory = fixture(context)
  mkdirSync(join(directory, 'custom'))
  writeFileSync(join(directory, 'custom/avatar.png'), 'replacement')
  const catalog = new AssetCatalog(directory, { schemaVersion: 1, id: 'custom', name: '测试', root: 'pet', overrides: { 'avatar/GGEgg.png': 'custom/avatar.png' } })
  catalog.checkOverrides()
  assert.equal(catalog.resolve('/pet/avatar/GGEgg.png'), join(directory, 'custom/avatar.png'))
  assert.equal(catalog.resolve('pet/Action/GG/Egg/Stand.swf'), join(directory, 'pet/Action/GG/Egg/Stand.swf'))
  assert.equal(catalog.publicPath('/pet/avatar/GGEgg.png'), '/custom/avatar.png')
})

test('resource roots and overrides cannot escape the configured resource directory', context => {
  const directory = fixture(context)
  const base = { schemaVersion: 1, id: 'test', name: '测试', root: 'pet', overrides: {} }
  const catalog = new AssetCatalog(directory, base)
  for (const path of ['../save.json', 'pet/../../save.json', 'C:/Users/save.json', 'pet/a\\b', 'pet/a\u0000.png']) assert.throws(() => catalog.resolve(path))
  assert.throws(() => new AssetCatalog(directory, { ...base, root: '../outside' }))
  assert.throws(() => new AssetCatalog(directory, { ...base, overrides: { 'avatar.png': '../secret' } }))
})

test('legacy Flash requests with duplicate separators keep loading their original resources', context => {
  const directory = fixture(context)
  const catalog = new AssetCatalog(directory, { schemaVersion: 1, id: 'legacy', name: '测试', root: 'pet', overrides: {} })
  assert.equal(catalog.resolve('/pet//fishing//res//bg//1.swf'), join(directory, 'pet/fishing/res/bg/1.swf'))
  assert.throws(() => catalog.resolve('/pet//fishing//../save.json'))
})

test('case-sensitive systems resolve PetSoc URLs inside a replacement pack root', context => {
  const directory = fixture(context)
  mkdirSync(join(directory, 'custom-pet/petsoc/Data/UI/Effect'), { recursive: true })
  writeFileSync(join(directory, 'custom-pet/petsoc/Data/UI/Effect/cursorEffect.png'), 'image')
  const catalog = new AssetCatalog(directory, { schemaVersion: 1, id: 'custom', name: '测试', root: 'custom-pet', overrides: {} })
  assert.equal(catalog.publicPath('/pet/petsoc/data/ui/effect/cursoreffect.png'), '/custom-pet/petsoc/Data/UI/Effect/cursorEffect.png')
})

test('game and external navigation inputs accept Unicode games and reject unrelated files', () => {
  assert.equal(gamePath('企鹅/QQ宠物泡泡.swf'), '企鹅/QQ宠物泡泡.swf')
  for (const path of ['../../save.json', 'test.html', 'https://example.com/a.swf', 'a.swf?other=1']) assert.throws(() => gamePath(path))
  assert.equal(webUrl('https://example.com/releases'), 'https://example.com/releases')
  assert.throws(() => webUrl('file:///C:/secret'))
  assert.throws(() => webUrl('javascript:alert(1)'))
})
