import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, rmdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import test, { type TestContext } from 'node:test'
import { countGood } from '../src/core/pet/items'
import { PetHost } from '../src/main/pet-host'
import { SaveRepository } from '../src/main/save-repository'
import { PetClient } from '../src/shared/pet-client'
import { REQUEST_TTL_MS, type PetCommand, type PetRequest, type PetUpdate } from '../src/shared/pet-command'
import { fixture } from './fixtures'

function setup(context: TestContext) {
  const file = join(fixture(context), 'save.json')
  const repo = new SaveRepository(file)
  repo.load()
  repo.patch({ havePet: true, petInfo: { mood: 500, hunger: 100, growth: 1 } })
  let now = new Date('2026-10-21T12:00:00+08:00').getTime()
  const clock = () => now
  const host = new PetHost(repo, clock, () => 0.5)
  const request = (command: PetCommand): PetRequest => ({ ...command, epoch: repo.snapshot().epoch, requestId: `${now}:${randomUUID()}` })
  return { file, repo, host, request, clock, advance: (ms: number) => { now += ms } }
}
const feed: PetCommand = { name: 'pet.useItem', input: { type: 'food', id: '10013006', quantity: 1 } }

test('host commits one effect for concurrent duplicates and retains the receipt after restart', async context => {
  const { host, repo, request, file, clock } = setup(context)
  const input = request(feed)
  const replies = await Promise.all(Array.from({ length: 8 }, async () => host.execute(input)))
  assert.equal(replies.filter(reply => !reply.replayed).length, 1)
  assert.equal(countGood(repo.get(), 'food', '10013006'), 1)
  const second = new SaveRepository(file)
  second.load()
  const replay = new PetHost(second, clock).execute(input)
  assert.equal(replay.replayed, true)
  assert.deepEqual(replay.result, replies[0].result)
  assert.equal(countGood(second.get(), 'food', '10013006'), 1)
  const conflict = host.execute({ ...input, input: { ...feed.input, quantity: 2 } })
  assert.equal(conflict.result.status === 'failed' && conflict.result.error.code, 'REQUEST_CONFLICT')
})

test('all callers share current inventory, and failed results are also idempotent', context => {
  const { host, repo, request } = setup(context)
  const calls = [request(feed), request(feed), request(feed)]
  assert.equal(host.execute(calls[0]).result.status, 'succeeded')
  assert.equal(host.execute(calls[1]).result.status, 'succeeded')
  const failed = host.execute(calls[2])
  assert.equal(failed.result.status === 'failed' && failed.result.error.code, 'INSUFFICIENT_ITEMS')
  repo.patch({ selfGoodDatas: { food: ['_10013006*8'] } })
  assert.deepEqual(host.execute(calls[2]).result, failed.result)
  assert.equal(countGood(repo.get(), 'food', '10013006'), 8)
})

test('failed storage installs neither effects nor receipts, so retry can commit once', context => {
  const { host, repo, request, file } = setup(context)
  const input = request(feed)
  const before = readFileSync(file, 'utf8')
  mkdirSync(`${file}.tmp`)
  const failed = host.execute(input)
  assert.equal(failed.result.status === 'failed' && failed.result.error.code, 'STORAGE_ERROR')
  assert.equal(countGood(repo.get(), 'food', '10013006'), 2)
  assert.equal(readFileSync(file, 'utf8'), before)
  rmdirSync(`${file}.tmp`)
  assert.equal(host.execute(input).result.status, 'succeeded')
  assert.equal(host.execute(input).replayed, true)
  assert.equal(countGood(repo.get(), 'food', '10013006'), 1)
})

test('expired IDs and old pet epochs cannot replay effects; exports omit the receipt ledger', context => {
  const { host, repo, request, advance, file } = setup(context)
  const input = request(feed)
  host.execute(input)
  advance(REQUEST_TTL_MS + 1)
  const expired = host.execute(input)
  assert.equal(expired.result.status === 'failed' && expired.result.error.code, 'REQUEST_EXPIRED')
  const exported = join(file, '..', 'export.json')
  repo.export(exported)
  assert.equal(Object.hasOwn(JSON.parse(readFileSync(exported, 'utf8')), '_agentPetRuntime'), false)
  repo.import(exported)
  const stale = host.execute(input)
  assert.equal(stale.result.status === 'failed' && stale.result.error.code, 'STALE_PET')
})

test('the UI preferences bridge rejects gameplay writes and malformed commands before any commit', context => {
  const { host, repo, request } = setup(context)
  const before = repo.snapshot()
  for (const patch of [{ petInfo: { yb: 9999 } }, { activeOption: { study: 'xx-chinese' } }, { selfGoodDatas: { food: [] } }, { settings: { paused: 'yes' } }, { settings: { opacity: 4 } }]) {
    assert.throws(() => host.preferences(patch))
  }
  for (const invalid of [{ ...request(feed), input: { ...feed.input, extra: true } }, { ...request(feed), name: 'pet.patch' }, { ...request(feed), input: { ...feed.input, type: '__proto__' } }]) {
    const result = host.execute(invalid).result
    assert.equal(result.status === 'failed' && result.error.code, 'INVALID_REQUEST')
  }
  assert.deepEqual(repo.snapshot(), before)
  host.preferences({ settings: { hidden: true }, petInfo: { lastX: -200, name: '主进程小企鹅' } })
  assert.equal(repo.get().settings.hidden, true)
  assert.equal(repo.get().petInfo.yb, before.save.petInfo.yb)
  const exposed = repo.get()
  exposed.petInfo.yb = 0
  assert.notEqual(repo.get().petInfo.yb, 0)
})

test('host clock advances hidden pets, pauses without catch-up, and persists activity completion once', context => {
  const { host, repo, request, advance, file, clock } = setup(context)
  const events: PetUpdate['events'] = []
  host.subscribe(update => events.push(...update.events))
  host.start()
  assert.equal(host.execute(request({ name: 'pet.startActivity', input: { kind: 'study', id: 'xx-chinese' } })).result.status, 'succeeded')
  host.preferences({ settings: { hidden: true } })
  advance(60_000)
  host.tick()
  assert.equal(repo.get().saveJsonData.activity, '1')
  host.preferences({ settings: { paused: true } })
  advance(3_600_000)
  host.tick()
  assert.equal(repo.get().saveJsonData.activity, '1')
  host.preferences({ settings: { paused: false } })
  advance(60_000)
  host.tick()
  assert.equal(repo.get().saveJsonData.activity, '2')
  repo.patch({ saveJsonData: { activity: '44.5' }, petInfo: { mood: 900 } })
  advance(60_000)
  host.tick()
  assert.equal(repo.get().activeOption.study, null)
  assert.equal(repo.get().studyInfo.chinese, 1)
  assert.equal(events.filter(event => event.type === 'activity').length, 1)
  const restored = new SaveRepository(file)
  restored.load()
  new PetHost(restored, clock, () => 0.5).start()
  assert.equal(restored.get().studyInfo.chinese, 1)
})

test('dead pets discard activities atomically and sweetheart purchase cannot split payment from service', context => {
  const { host, repo, request } = setup(context)
  host.start()
  const buy = request({ name: 'pet.sweetheart', input: { days: 2 } })
  assert.equal(host.execute(buy).result.status, 'succeeded')
  host.execute(buy)
  assert.equal(repo.get().petInfo.yb, 4400)
  assert.equal(repo.get().petInfo.sweetHeart, true)
  repo.patch({ petInfo: { yb: 1 } })
  const before = repo.get()
  assert.equal(host.execute(request({ name: 'pet.sweetheart', input: { days: 2 } })).result.status, 'failed')
  assert.deepEqual(repo.get(), before)
  repo.patch({ petInfo: { health: 0 }, activeOption: { study: 'xx-chinese' }, saveJsonData: { activity: '44' } })
  host.tick()
  assert.equal(repo.get().activeOption.study, null)
  assert.equal(repo.get().studyInfo.chinese, 0)
})

test('client retries a lost acknowledgement with the same ID and never overlays stale gameplay', async context => {
  const { host, repo, request } = setup(context)
  let lost = false
  let view = repo.snapshot()
  const client = new PetClient(repo.snapshot(), {
    save: async patch => host.preferences(patch),
    command: async input => {
      const reply = host.execute(input)
      if (!lost) { lost = true; throw new Error('lost acknowledgement') }
      return reply
    },
  }, update => { view = update.snapshot }, error => { throw error }, () => request(feed).requestId)
  host.subscribe(update => client.receive(update))
  client.update({ petInfo: { lastX: 80 } })
  const feeding = client.command(feed)
  client.update({ petInfo: { lastX: 120 } })
  assert.equal((await feeding).status, 'succeeded')
  assert.equal(view.save.petInfo.lastX, 120)
  await client.flush()
  assert.equal(repo.get().petInfo.lastX, 120)
  assert.equal(countGood(view.save, 'food', '10013006'), 1)
  const stale = { ...repo.snapshot(), revision: 0, save: { ...repo.get(), petInfo: { ...repo.get().petInfo, yb: 1 } } }
  client.receive({ snapshot: stale, events: [] })
  assert.equal(view.save.petInfo.yb, 5000)
})

test('corrupt durable receipts fail closed instead of allowing duplicate execution', context => {
  const { file, host, request } = setup(context)
  host.execute(request(feed))
  const data = JSON.parse(readFileSync(file, 'utf8'))
  data._agentPetRuntime.receipts.invalid = {}
  writeFileSync(file, JSON.stringify(data))
  assert.throws(() => new SaveRepository(file).load(), /回执损坏/)
  assert.equal(JSON.parse(readFileSync(file, 'utf8'))._agentPetRuntime.receipts.invalid !== undefined, true)
})
