import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { CompanionRepository } from '../src/main/companion-repository'
import { CompanionHost, validateCompanion } from '../src/main/companion-host'
import type { CompanionStore } from '../src/main/companion-store'
import type { Backend, CompanionOperations } from '../src/shared/companion'
import { fixture } from './fixtures'

const backend: Backend = { id: 'openai-compatible', url: 'http://127.0.0.1:9999/v1', model: 'test-model' }
const memory = (): CompanionOperations['memory.put']['input'] => ({ id: randomUUID(), revision: 0, kind: 'preference', text: '喜欢短句和中文', source: '用户手动记录', project: '' })
const request = (sessionId: string) => ({ sessionId, requestId: randomUUID(), message: '你好' })
const asyncStore = (repo: CompanionRepository): CompanionStore => new Proxy({} as CompanionStore, { get: (_target, method: keyof CompanionRepository) => async (...args: unknown[]) => (repo[method] as (...args: unknown[]) => unknown).apply(repo, args) })
async function eventually(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) { if (predicate()) return; await new Promise<void>(resolve => setImmediate(resolve)) }
  assert.fail('condition did not become true')
}

test('SQLite retains identity, Chinese memory, sessions and deduplicated task facts across restart', context => {
  const file = join(fixture(context), 'companion.sqlite')
  let repo = new CompanionRepository(file)
  try {
    const identity = repo.identity()
    repo.putIdentity({ revision: identity.revision, personality: '温暖而坦诚', address: '小林' })
    repo.putMemory(memory())
    const session = repo.createSession(randomUUID()), input = request(session.id)
    const task = repo.createChat(input, backend)
    assert.equal(repo.createChat(input, backend).id, task.id)
    assert.throws(() => repo.createChat({ ...input, message: '不同内容' }, backend), /同一请求/)
    const running = repo.claim()!
    assert.equal(repo.finish(task.id, running.task.attempt, '你好，小林', null), true)
    assert.equal(repo.finish(task.id, running.task.attempt, '重复回复', null), false)
    repo.close(); repo = new CompanionRepository(file)
    assert.equal(repo.identity().id, identity.id)
    assert.equal(repo.identity().address, '小林')
    assert.equal(repo.memories('短句').length, 1)
    assert.equal(repo.history(session.id).length, 2)
    assert.equal(repo.tasks(session.id)[0].backend.model, 'test-model')
    assert.deepEqual(repo.events(task.id).map(event => event.state), ['queued', 'running', 'succeeded'])
    assert.equal(repo.createChat(input, backend).id, task.id)
  } finally { repo.close() }
})

test('task, user message and event commit together; a database failure leaves no partial task', context => {
  const file = join(fixture(context), 'companion.sqlite'), repo = new CompanionRepository(file)
  try {
    const session = repo.createSession(randomUUID()), input = request(session.id)
    const connection = new DatabaseSync(file)
    connection.exec("CREATE TRIGGER reject_message BEFORE INSERT ON messages BEGIN SELECT RAISE(ABORT, 'write failed'); END;")
    assert.throws(() => repo.createChat(input, backend), /write failed/)
    assert.equal(repo.tasks(session.id).length, 0)
    assert.equal(repo.history(session.id).length, 0)
    connection.exec('DROP TRIGGER reject_message'); connection.close()
    assert.equal(repo.createChat(input, backend).state, 'queued')
    assert.equal(repo.history(session.id).length, 1)
  } finally { repo.close() }
})

test('restart interrupts unfinished work; explicit resume fences previous attempts and keeps the exact session', context => {
  const file = join(fixture(context), 'companion.sqlite')
  let repo = new CompanionRepository(file)
  try {
    const session = repo.createSession(randomUUID()), task = repo.createChat(request(session.id), backend)
    const first = repo.claim()!
    repo.close(); repo = new CompanionRepository(file)
    assert.equal(repo.tasks(session.id)[0].state, 'interrupted')
    assert.equal(repo.tasks(session.id)[0].errorCode, 'APPLICATION_INTERRUPTED')
    assert.equal(repo.claim(), null)
    assert.throws(() => repo.resume(task.id, { ...backend, model: 'other' }), /模型配置/)
    repo.resume(task.id, backend)
    const second = repo.claim()!
    assert.equal(second.task.sessionId, session.id)
    assert.equal(repo.finish(task.id, first.task.attempt, '旧回复', null), false)
    assert.equal(repo.finish(task.id, second.task.attempt, '恢复的回复', null), true)
    assert.equal(repo.history(session.id).length, 2)
    assert.equal(repo.history(session.id)[1].content, '恢复的回复')
  } finally { repo.close() }
})

test('forgetting a memory fences running replies, excludes historical recall and rejects stale resurrection', context => {
  const repo = new CompanionRepository(join(fixture(context), 'companion.sqlite'))
  try {
    const input = memory(), saved = repo.putMemory(input), session = repo.createSession(randomUUID())
    repo.createChat(request(session.id), backend)
    const first = repo.claim()!
    repo.finish(first.task.id, first.task.attempt, '我记得你喜欢短句', null)
    const task = repo.createChat(request(session.id), backend), running = repo.claim()!
    assert.equal(running.messages.length, 2)
    repo.deleteMemory(saved.id, saved.revision)
    assert.throws(() => repo.putMemory({ ...input, revision: saved.revision }), /已遗忘/)
    assert.equal(repo.finish(task.id, running.task.attempt, '迟到的旧记忆', null), false)
    assert.equal(repo.tasks(session.id)[0].errorCode, 'CONTEXT_CHANGED')
    assert.equal(repo.memories('短句').length, 0)
    repo.resume(task.id, backend)
    const fresh = repo.claim()!
    assert.equal(fresh.memories.length, 0)
    assert.equal(fresh.messages.length, 0)
    assert.equal(repo.history(session.id).length, 3, 'history is viewable, not fed back to the model')
  } finally { repo.close() }
})

test('deleting a conversation clears text and prevents delayed create/completion from restoring it', context => {
  const file = join(fixture(context), 'companion.sqlite'), repo = new CompanionRepository(file)
  try {
    const session = repo.createSession(randomUUID()), input = { ...request(session.id), message: 'conversation-private-sentinel' }
    const task = repo.createChat(input, backend), running = repo.claim()!
    repo.deleteSession(session.id)
    assert.equal(repo.finish(task.id, running.task.attempt, 'late result', null), false)
    assert.throws(() => repo.createChat(input, backend), /已删除/)
    assert.throws(() => repo.createSession(session.id), /已删除/)
    assert.equal(repo.sessions().length, 0)
  } finally { repo.close() }
  assert.equal(readFileSync(file).includes(Buffer.from('conversation-private-sentinel')), false)
})

test('queue and pages are bounded; memory edits require the current revision and project material is not recalled globally', context => {
  const repo = new CompanionRepository(join(fixture(context), 'companion.sqlite'))
  try {
    const saved = repo.putMemory({ ...memory(), kind: 'project', project: 'project-a' })
    assert.throws(() => repo.putMemory({ ...saved, revision: 0, text: 'stale' }), /已变更/)
    const session = repo.createSession(randomUUID())
    for (let index = 0; index < 8; index++) repo.createChat(request(session.id), backend)
    assert.throws(() => repo.createChat(request(session.id), backend), /最多/)
    const running = repo.claim()!
    assert.equal(running.memories.length, 0)
    repo.cancel(running.task.id)
    assert.equal(repo.finish(running.task.id, running.task.attempt, 'late', null), false)
    assert.equal(repo.createChat(request(session.id), backend).state, 'queued')
  } finally { repo.close() }
})

test('host cancellation aborts the owned request and never persists late model text or credentials', async context => {
  const file = join(fixture(context), 'companion.sqlite'), repo = new CompanionRepository(file)
  let signal: AbortSignal | undefined, resolveReply: (value: string) => void = () => {}
  const host = new CompanionHost(asyncStore(repo), () => ({ ...backend, key: 'credential-must-not-enter-work-db', name: '企鹅' }), async (_config, _messages, cancellation) => {
    signal = cancellation
    return await new Promise<string>(resolve => { resolveReply = resolve })
  })
  try {
    const session = await host.invoke('session.create', { id: randomUUID() })
    const task = await host.invoke('chat.send', request(session.id))
    await eventually(() => Boolean(signal))
    await host.invoke('task.cancel', { id: task.id })
    assert.equal(signal!.aborted, true)
    resolveReply('must-not-be-persisted')
    await new Promise<void>(resolve => setImmediate(resolve))
    assert.equal(repo.tasks(session.id)[0].state, 'cancelled')
    assert.equal(repo.history(session.id).length, 1)
  } finally { resolveReply('late'); await host.close() }
  assert.equal(readFileSync(file).includes(Buffer.from('credential-must-not-enter-work-db')), false)
  assert.equal(readFileSync(file).includes(Buffer.from('must-not-be-persisted')), false)
})

test('companion bridge rejects unknown operations, extra authority and invalid bounded inputs', () => {
  assert.throws(() => validateCompanion('exec', { command: 'anything' }), /未知/)
  assert.throws(() => validateCompanion('chat.send', { ...request(randomUUID()), key: 'secret' }), /参数/)
  assert.throws(() => validateCompanion('memory.put', { ...memory(), kind: 'project' }), /参数/)
  assert.throws(() => validateCompanion('identity.put', { revision: 1, personality: 'a'.repeat(2001), address: '主人' }), /参数/)
  assert.throws(() => validateCompanion('task.cancel', { id: '../../file' }), /参数/)
})

test('newer schemas and corrupt databases fail without replacing user data', context => {
  const file = join(fixture(context), 'future.sqlite'), database = new DatabaseSync(file)
  database.exec('PRAGMA user_version=2; CREATE TABLE future(data TEXT); INSERT INTO future VALUES (\'preserve-me\');')
  database.close()
  assert.throws(() => new CompanionRepository(file), /更新版本/)
  const restored = new DatabaseSync(file)
  assert.equal(restored.prepare('SELECT data FROM future').get()!.data, 'preserve-me')
  restored.close()
  const corrupt = join(file, '..', 'corrupt.sqlite'), bytes = Buffer.from('not-a-database-preserve-original')
  writeFileSync(corrupt, bytes)
  assert.throws(() => new CompanionRepository(corrupt), /not a database/)
  assert.deepEqual(readFileSync(corrupt), bytes)
})
