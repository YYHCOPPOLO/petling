import { DatabaseSync } from 'node:sqlite'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Backend, ChatContext, ChatMessage, CompanionOperations, Conversation, Identity, Memory, TaskErrorCode, TaskEvent, WorkTask } from '../shared/companion'

const ACTIVE = ['queued', 'running', 'waiting_input', 'waiting_approval']
type Row = Record<string, unknown>
const decode = <T>(row: Row | undefined): T => {
  if (!row) throw new Error('记录不存在或已删除')
  return JSON.parse(String(row.body)) as T
}

/** Runs exclusively in the database worker. No pet save or credential is stored here. */
export class CompanionRepository {
  private db: DatabaseSync
  constructor(file: string, private readonly now = Date.now, defaults = { address: '主人' }) {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
    this.db = new DatabaseSync(file)
    try {
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA secure_delete=ON;')
      const version = Number(this.db.prepare('PRAGMA user_version').get()!.user_version)
      if (version > 1) throw new Error('伙伴数据库来自更新版本，请先升级应用')
      if (!version) this.transaction(() => {
        this.db.exec(`
          CREATE TABLE meta (key TEXT PRIMARY KEY, body TEXT NOT NULL);
          CREATE TABLE sessions (id TEXT PRIMARY KEY, body TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
          CREATE TABLE memories (id TEXT PRIMARY KEY, body TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
          CREATE TABLE tasks (id TEXT PRIMARY KEY, session TEXT NOT NULL REFERENCES sessions(id), request TEXT NOT NULL UNIQUE,
            fingerprint TEXT NOT NULL, state TEXT NOT NULL, body TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
          CREATE INDEX tasks_session ON tasks(session, deleted);
          CREATE INDEX tasks_state ON tasks(state, deleted);
          CREATE TABLE messages (sequence INTEGER PRIMARY KEY AUTOINCREMENT, session TEXT NOT NULL REFERENCES sessions(id),
            task TEXT NOT NULL REFERENCES tasks(id), context INTEGER NOT NULL, body TEXT NOT NULL);
          CREATE INDEX messages_session ON messages(session, sequence);
          CREATE TABLE events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, task TEXT NOT NULL REFERENCES tasks(id), body TEXT NOT NULL);
          CREATE INDEX events_task ON events(task, sequence);
          PRAGMA user_version=1;
        `)
        this.db.prepare('INSERT INTO meta VALUES (?, ?)').run('context', '0')
        this.db.prepare('INSERT INTO meta VALUES (?, ?)').run('identity', JSON.stringify({ id: randomUUID(), revision: 1, personality: '温暖、好奇、坦诚的桌面伙伴。', address: defaults.address }))
      })
      this.interrupt('应用已重启；请核对后继续，本轮请求不会自动重发')
    } catch (error) { this.db.close(); throw error }
  }

  private transaction<T>(run: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try { const result = run(); this.db.exec('COMMIT'); return result }
    catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  private contextRevision(): number { return decode<number>(this.db.prepare('SELECT body FROM meta WHERE key=?').get('context')) }
  private event(task: WorkTask, detail: string): void {
    this.db.prepare('INSERT INTO events(task, body) VALUES (?, ?)').run(task.id, JSON.stringify({ taskId: task.id, state: task.state, attempt: task.attempt, errorCode: task.errorCode, detail, at: this.now() }))
  }
  private writeTask(task: WorkTask, detail: string): WorkTask {
    task.updatedAt = this.now()
    this.db.prepare('UPDATE tasks SET state=?, body=? WHERE id=?').run(task.state, JSON.stringify(task), task.id)
    this.event(task, detail)
    return task
  }
  private task(id: string): WorkTask { return decode<WorkTask>(this.db.prepare('SELECT body FROM tasks WHERE id=? AND deleted=0').get(id)) }
  private session(id: string): Conversation { return decode<Conversation>(this.db.prepare('SELECT body FROM sessions WHERE id=? AND deleted=0').get(id)) }
  identity(): Identity { return decode<Identity>(this.db.prepare('SELECT body FROM meta WHERE key=?').get('identity')) }
  putIdentity(input: CompanionOperations['identity.put']['input']): Identity {
    return this.transaction(() => {
      const current = this.identity()
      if (input.revision !== current.revision) throw new Error('性格配置已变更，请刷新后再保存')
      const next = { ...current, ...input, revision: current.revision + 1 }
      this.db.prepare('UPDATE meta SET body=? WHERE key=?').run(JSON.stringify(next), 'identity')
      this.invalidateContext()
      return next
    })
  }
  memories(query = ''): Memory[] {
    return this.db.prepare("SELECT body FROM memories WHERE deleted=0 AND instr(body, ?) > 0 ORDER BY json_extract(body, '$.updatedAt') DESC, rowid DESC LIMIT 100").all(query).map(row => decode<Memory>(row))
  }
  putMemory(input: CompanionOperations['memory.put']['input']): Memory {
    return this.transaction(() => {
      const stored = this.db.prepare('SELECT body, deleted FROM memories WHERE id=?').get(input.id)
      if (stored && (stored.deleted || decode<Memory>(stored).revision !== input.revision)) throw new Error('记忆已变更或已遗忘，请刷新后重试')
      if (!stored && input.revision !== 0) throw new Error('记忆不存在')
      const next: Memory = { ...input, revision: input.revision + 1, updatedAt: this.now() }
      this.db.prepare('INSERT INTO memories(id,body) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(next.id, JSON.stringify(next))
      this.invalidateContext()
      return next
    })
  }
  deleteMemory(id: string, revision: number): void {
    this.transaction(() => {
      const current = decode<Memory>(this.db.prepare('SELECT body FROM memories WHERE id=? AND deleted=0').get(id))
      if (current.revision !== revision) throw new Error('记忆已变更，请刷新后重试')
      // Retain only the ID tombstone: stale writes must never resurrect forgotten text.
      this.db.prepare('UPDATE memories SET deleted=1, body=? WHERE id=?').run('{}', id)
      this.invalidateContext()
    })
  }
  private invalidateContext(): void {
    this.db.prepare('UPDATE meta SET body=? WHERE key=?').run(String(this.contextRevision() + 1), 'context')
    this.interruptActive('性格或记忆已变更，请核对后继续', 'CONTEXT_CHANGED')
  }
  sessions(): Conversation[] {
    return this.db.prepare('SELECT body FROM sessions WHERE deleted=0 ORDER BY rowid DESC LIMIT 100').all().map(row => decode<Conversation>(row))
  }
  createSession(id: string): Conversation {
    const existing = this.db.prepare('SELECT body, deleted FROM sessions WHERE id=?').get(id)
    if (existing) { if (existing.deleted) throw new Error('对话已删除'); return decode<Conversation>(existing) }
    const session = { id, title: '新对话', updatedAt: this.now() }
    this.db.prepare('INSERT INTO sessions(id,body) VALUES (?,?)').run(id, JSON.stringify(session))
    return session
  }
  deleteSession(id: string): void {
    this.transaction(() => {
      this.session(id)
      this.db.prepare('DELETE FROM messages WHERE session=?').run(id)
      this.db.prepare('DELETE FROM events WHERE task IN (SELECT id FROM tasks WHERE session=?)').run(id)
      // Request fingerprints remain solely to reject delayed create retries.
      this.db.prepare("UPDATE tasks SET deleted=1, state='cancelled', body='{}' WHERE session=?").run(id)
      this.db.prepare("UPDATE sessions SET deleted=1, body='{}' WHERE id=?").run(id)
    })
  }
  history(sessionId: string, before = Number.MAX_SAFE_INTEGER): ChatMessage[] {
    this.session(sessionId)
    return this.db.prepare('SELECT sequence, body FROM messages WHERE session=? AND sequence < ? ORDER BY sequence DESC LIMIT 100').all(sessionId, before)
      .reverse().map(row => ({ ...decode<ChatMessage>(row), sequence: Number(row.sequence) }))
  }
  tasks(sessionId: string): WorkTask[] {
    this.session(sessionId)
    return this.db.prepare('SELECT body FROM tasks WHERE session=? AND deleted=0 ORDER BY rowid DESC LIMIT 100').all(sessionId).map(row => decode<WorkTask>(row))
  }
  events(id: string, before = Number.MAX_SAFE_INTEGER): TaskEvent[] {
    this.task(id)
    return this.db.prepare('SELECT sequence, body FROM events WHERE task=? AND sequence < ? ORDER BY sequence DESC LIMIT 100').all(id, before)
      .reverse().map(row => ({ ...decode<TaskEvent>(row), sequence: Number(row.sequence) }))
  }
  createChat(input: CompanionOperations['chat.send']['input'], backend: Backend): WorkTask {
    return this.transaction(() => {
      this.session(input.sessionId)
      const fingerprint = createHash('sha256').update(JSON.stringify([input.sessionId, input.message])).digest('hex')
      const existing = this.db.prepare('SELECT body, fingerprint, deleted FROM tasks WHERE request=?').get(input.requestId)
      if (existing) {
        if (existing.deleted) throw new Error('该请求所属对话已删除')
        if (existing.fingerprint !== fingerprint) throw new Error('同一请求标识不能用于不同消息')
        return decode<WorkTask>(existing)
      }
      if (Number(this.db.prepare("SELECT count(*) AS count FROM tasks WHERE deleted=0 AND state IN ('queued','running')").get()!.count) >= 8) throw new Error('最多同时排队 8 条消息，请等待或取消已有任务')
      const id = randomUUID(), now = this.now()
      const task: WorkTask = { id, requestId: input.requestId, sessionId: input.sessionId, rootTaskId: id, parentTaskId: null, origin: 'chat', backend,
        state: 'queued', attempt: 0, contextRevision: this.contextRevision(), input: input.message, output: null, error: null, errorCode: null, createdAt: now, updatedAt: now }
      this.db.prepare('INSERT INTO tasks(id,session,request,fingerprint,state,body) VALUES (?,?,?,?,?,?)').run(id, input.sessionId, input.requestId, fingerprint, task.state, JSON.stringify(task))
      this.db.prepare('INSERT INTO messages(session,task,context,body) VALUES (?,?,?,?)').run(input.sessionId, id, task.contextRevision, JSON.stringify({ taskId: id, role: 'user', content: input.message, createdAt: now }))
      this.db.prepare('UPDATE sessions SET body=? WHERE id=?').run(JSON.stringify({ id: input.sessionId, title: input.message.slice(0, 32), updatedAt: now }), input.sessionId)
      this.event(task, '消息已保存，等待回复')
      return task
    })
  }
  claim(): ChatContext | null {
    return this.transaction(() => {
      const row = this.db.prepare("SELECT body FROM tasks WHERE state='queued' AND deleted=0 ORDER BY rowid LIMIT 1").get()
      if (!row) return null
      const task = decode<WorkTask>(row)
      task.state = 'running'; task.attempt++; task.contextRevision = this.contextRevision(); task.error = null; task.errorCode = null
      this.writeTask(task, '开始本轮回复')
      // Forgotten memories cannot leak back through earlier model replies. Old messages remain viewable.
      const messages = this.db.prepare('SELECT m.sequence,m.body FROM messages m JOIN tasks t ON t.id=m.task WHERE m.session=? AND m.context=? AND t.state=? AND t.deleted=0 ORDER BY m.sequence DESC LIMIT 12')
        .all(task.sessionId, task.contextRevision, 'succeeded').reverse().map(row => ({ ...decode<ChatMessage>(row), sequence: Number(row.sequence) }))
      const memories = this.memories().filter(memory => memory.kind !== 'project').slice(0, 20)
      return { task, identity: this.identity(), memories, messages }
    })
  }
  finish(id: string, attempt: number, output: string | null, error: string | null): boolean {
    return this.transaction(() => {
      const row = this.db.prepare('SELECT body FROM tasks WHERE id=? AND deleted=0').get(id)
      if (!row) return false
      const task = decode<WorkTask>(row)
      if (task.state !== 'running' || task.attempt !== attempt || task.contextRevision !== this.contextRevision()) return false
      task.output = output; task.error = error; task.state = error === null ? 'succeeded' : 'failed'
      task.errorCode = error === null ? null : 'MODEL_REQUEST_FAILED'
      if (output !== null) this.db.prepare('INSERT INTO messages(session,task,context,body) VALUES (?,?,?,?)').run(task.sessionId, id, task.contextRevision, JSON.stringify({ taskId: id, role: 'assistant', content: output, createdAt: this.now() }))
      this.writeTask(task, error ?? '回复已保存')
      return true
    })
  }
  cancel(id: string): WorkTask {
    return this.transaction(() => {
      const task = this.task(id)
      if (!['succeeded', 'cancelled'].includes(task.state)) {
        task.state = 'cancelled'; task.attempt++; task.error = '用户已取消'; task.errorCode = 'USER_CANCELLED'
        this.writeTask(task, '取消已保存，迟到的回复不会写回')
      }
      return task
    })
  }
  resume(id: string, backend: Backend): WorkTask {
    return this.transaction(() => {
      const task = this.task(id)
      if (!['interrupted', 'failed'].includes(task.state)) throw new Error('只有中断或失败的回复可以重试')
      if (JSON.stringify(task.backend) !== JSON.stringify(backend)) throw new Error('模型配置已改变，请发送新消息；原任务保留原后端信息')
      if (Number(this.db.prepare("SELECT count(*) AS count FROM tasks WHERE deleted=0 AND state IN ('queued','running')").get()!.count) >= 8) throw new Error('队列已满，请稍后重试')
      task.state = 'queued'; task.error = null; task.errorCode = null; task.contextRevision = this.contextRevision()
      this.db.prepare('UPDATE messages SET context=? WHERE task=? AND body LIKE ?').run(task.contextRevision, id, '%"role":"user"%')
      return this.writeTask(task, '用户要求继续：重新请求文本回复，不执行任何外部副作用')
    })
  }
  private interruptActive(reason: string, code: TaskErrorCode = 'APPLICATION_INTERRUPTED'): void {
    for (const row of this.db.prepare("SELECT body FROM tasks WHERE deleted=0 AND state IN ('queued','running','waiting_input','waiting_approval')").all()) {
      const task = decode<WorkTask>(row)
      if (!ACTIVE.includes(task.state)) continue
      task.state = 'interrupted'; task.attempt++; task.error = reason; task.errorCode = code
      this.writeTask(task, reason)
    }
  }
  interrupt(reason: string): void { this.transaction(() => this.interruptActive(reason)) }
  close(): void { this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); this.db.close() }
}
