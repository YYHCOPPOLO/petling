import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { SaveRepository } from '../src/main/save-repository'
import { startSave } from '../src/shared/save-logic'
import { fixture } from './fixtures'

test('first launch creates a complete save, and patches survive an independent reload', context => {
  const file = join(fixture(context), 'nested/save.json')
  const repository = new SaveRepository(file)
  const initial = repository.load()
  assert.equal(initial.havePet, false)
  assert.equal(initial.settings.autoUpdate, false)
  repository.patch({ havePet: true, petInfo: { name: '小企鹅', yb: 1234 }, settings: { quiet: true } })
  const reloaded = new SaveRepository(file).load()
  assert.equal(reloaded.petInfo.name, '小企鹅')
  assert.equal(reloaded.petInfo.yb, 1234)
  assert.equal(reloaded.settings.quiet, true)
  assert.equal(reloaded.petInfo.health, 5)
  assert.equal(existsSync(`${file}.tmp`), false)
})

test('migrates upstream and Arctic Penguin saves without changing the source file', context => {
  const directory = fixture(context)
  const old = startSave(null)
  old.havePet = true
  old.petInfo.sex = 'MM'
  old.activeOption.trip = '上海'
  old.saveJsonData.activity = '12.5'
  old.saveJsonData.farm = '{"wealth":"99"}'
  old.settings.petDisplayId = -45
  const legacy = join(directory, 'config.json')
  const original = JSON.stringify({ petInfoData: { ...old, machineId: 'legacy-id' } })
  writeFileSync(legacy, original)
  const save = new SaveRepository(join(directory, 'new/save.json'), [legacy]).load()
  assert.equal(save.petInfo.sex, 'MM')
  assert.equal(save.activeOption.trip, null)
  assert.equal(save.saveJsonData.activity, '0')
  assert.deepEqual(JSON.parse(save.saveJsonData.legacyTrip), { destination: '上海', elapsed: '12.5' })
  assert.equal(save.saveJsonData.farm, old.saveJsonData.farm)
  assert.equal(save.settings.petDisplayId, -45)
  assert.equal(Object.hasOwn(save, 'machineId'), false)
  assert.equal(readFileSync(legacy, 'utf8'), original)
})

test('import validates first, backs up the old pet and exports the new pet', context => {
  const directory = fixture(context)
  const file = join(directory, 'save.json')
  const repository = new SaveRepository(file)
  repository.load()
  repository.patch({ havePet: true, petInfo: { name: '原宠物' } })
  const original = readFileSync(file, 'utf8')
  const incoming = startSave(null)
  incoming.havePet = true
  incoming.petInfo.name = '新宠物'
  const imported = join(directory, 'incoming.json')
  writeFileSync(imported, JSON.stringify(incoming))
  repository.import(imported)
  assert.equal(readFileSync(`${file}.bak`, 'utf8'), original)
  assert.equal(repository.get().petInfo.name, '新宠物')
  const exported = join(directory, 'export.json')
  repository.export(exported)
  assert.equal(JSON.parse(readFileSync(exported, 'utf8')).petInfo.name, '新宠物')
  writeFileSync(imported, '[]')
  assert.throws(() => repository.import(imported), /JSON 对象/)
  assert.equal(repository.get().petInfo.name, '新宠物')
})

test('malformed field groups are repaired; corrupt files remain available for recovery', context => {
  const directory = fixture(context)
  const file = join(directory, 'save.json')
  writeFileSync(file, JSON.stringify({ havePet: true, petInfo: 'bad', settings: [], selfGoodDatas: null, illustrated: false }))
  const repaired = new SaveRepository(file).load()
  assert.equal(repaired.petInfo.name, '宠宝~')
  assert.equal(repaired.settings.opacity, 1)
  assert.deepEqual(repaired.selfGoodDatas.food, [])
  writeFileSync(file, '{ broken')
  const fresh = new SaveRepository(file).load()
  assert.equal(fresh.havePet, false)
  const backup = readdirSync(directory).find(name => name.startsWith('save.json.corrupt-'))
  assert.ok(backup)
  assert.equal(readFileSync(join(directory, backup), 'utf8'), '{ broken')
})

test('a failed disk write preserves the in-memory pet and the existing file', context => {
  const directory = fixture(context)
  const file = join(directory, 'save.json')
  const repository = new SaveRepository(file)
  repository.load()
  const original = readFileSync(file, 'utf8')
  mkdirSync(`${file}.tmp`)
  assert.throws(() => repository.patch({ petInfo: { yb: 1 } }))
  assert.equal(repository.get().petInfo.yb, 5000)
  assert.equal(readFileSync(file, 'utf8'), original)
})

test('prototype keys, invalid groups and unknown fields cannot corrupt a save', context => {
  const repository = new SaveRepository(join(fixture(context), 'save.json'))
  repository.load()
  assert.throws(() => repository.patch(JSON.parse('{"petInfo":{"__proto__":{"polluted":true}}}')))
  assert.throws(() => repository.patch(JSON.parse('{"settings":null}')))
  assert.throws(() => repository.patch(JSON.parse('{"unknown":1}')))
  assert.equal(({} as Record<string, unknown>).polluted, undefined)
  assert.equal(repository.get().petInfo.yb, 5000)
})

test('rebirth keeps preferences, resets gameplay and preserves a backup', context => {
  const file = join(fixture(context), 'save.json')
  const repository = new SaveRepository(file)
  repository.load()
  repository.patch({ havePet: true, settings: { quiet: true, paused: true, hidden: true }, petInfo: { yb: 20 } })
  repository.reset('MM')
  const next = repository.get()
  assert.equal(next.havePet, true)
  assert.equal(next.petInfo.sex, 'MM')
  assert.equal(next.petInfo.yb, 5000)
  assert.equal(next.settings.quiet, true)
  assert.equal(next.settings.hidden, false)
  assert.equal(next.settings.paused, false)
  assert.ok(existsSync(`${file}.bak`))
})

test('export omits the API key without mutating local preferences or dormant legacy data', context => {
  const directory = fixture(context)
  const repository = new SaveRepository(join(directory, 'save.json'))
  repository.load()
  repository.patch({ settings: { aiKey: 'local-only-key' }, saveJsonData: { farm: '{"wealth":"42"}' } })
  const file = join(directory, 'export.json')
  repository.export(file)
  const exported = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(exported.settings.aiKey, '')
  assert.equal(exported.saveJsonData.farm, '{"wealth":"42"}')
  assert.equal(repository.get().settings.aiKey, 'local-only-key')
})
