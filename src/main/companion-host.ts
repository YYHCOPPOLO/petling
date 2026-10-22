import type { Backend, CompanionOperation, CompanionOperations, ChatContext } from '../shared/companion'
import type { AiConfig, AiMessage } from '../shared/ipc'
import { assertJson, isRecord } from '../shared/validation'
import type { CompanionStore } from './companion-store'

type Configuration = AiConfig & { name: string }
type Chat = (config: AiConfig, messages: AiMessage[], signal: AbortSignal) => Promise<string>
const uuid = (value: unknown): boolean => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const text = (value: unknown, max: number, empty = false): value is string => typeof value === 'string' && value.length <= max && (empty || Boolean(value.trim()))
const revision = (value: unknown): boolean => Number.isSafeInteger(value) && Number(value) >= 0

export function validateCompanion(name: unknown, value: unknown): void {
  assertJson(value)
  if (!isRecord(value)) throw new Error('无效伙伴请求')
  const keys = Object.keys(value)
  const shape = (required: string[], optional: string[] = []): boolean => required.every(key => Object.hasOwn(value, key)) && keys.every(key => [...required, ...optional].includes(key))
  const id = () => shape(['id']) && uuid(value.id)
  let valid = false
  switch (name) {
    case 'identity.get': case 'session.list': valid = shape([]); break
    case 'identity.put': valid = shape(['revision', 'personality', 'address']) && revision(value.revision) && text(value.personality, 2000) && text(value.address, 80); break
    case 'memory.list': valid = shape(['query']) && text(value.query, 200, true); break
    case 'memory.put': valid = shape(['id', 'revision', 'kind', 'text', 'source', 'project']) && uuid(value.id) && revision(value.revision)
      && ['preference', 'experience', 'project'].includes(String(value.kind)) && text(value.text, 4000) && text(value.source, 500) && text(value.project, 500, true)
      && (value.kind !== 'project' || Boolean(String(value.project).trim())); break
    case 'memory.delete': valid = shape(['id', 'revision']) && uuid(value.id) && revision(value.revision); break
    case 'session.create': case 'session.delete': case 'task.cancel': case 'task.resume': valid = id(); break
    case 'chat.history': valid = shape(['sessionId'], ['before']) && uuid(value.sessionId) && (value.before === undefined || revision(value.before)); break
    case 'task.list': valid = shape(['sessionId']) && uuid(value.sessionId); break
    case 'task.events': valid = shape(['id'], ['before']) && uuid(value.id) && (value.before === undefined || revision(value.before)); break
    case 'chat.send': valid = shape(['sessionId', 'requestId', 'message']) && uuid(value.sessionId) && uuid(value.requestId) && text(value.message, 8000); break
  }
  if (!valid) throw new Error('未知伙伴操作或参数无效')
}

export class CompanionHost {
  private active: { id: string; sessionId: string; controller: AbortController } | null = null
  private pumping = false
  private stopped = false
  private used = false
  private closing: Promise<void> | undefined
  private listeners = new Set<() => void>()
  constructor(private readonly store: CompanionStore, private readonly config: () => Configuration, private readonly chat: Chat) {}
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private changed(): void { for (const listener of this.listeners) { try { listener() } catch (error) { console.error('伙伴状态通知失败', error) } } }
  private backend(): Backend {
    const config = this.config()
    return config.model ? { id: 'openai-compatible', url: config.url, model: config.model } : { id: 'local', url: '', model: '' }
  }
  async invoke<K extends CompanionOperation>(name: K, input: CompanionOperations[K]['input']): Promise<CompanionOperations[K]['output']> {
    if (this.stopped) throw new Error('应用正在退出')
    validateCompanion(name, input)
    this.used = true
    // Dispatch follows runtime validation; the public bridge never exposes repository methods.
    const p = input as Record<string, any>
    let result: unknown
    switch (name) {
      case 'identity.get': return await this.store.identity() as CompanionOperations[K]['output']
      case 'identity.put': result = await this.store.putIdentity(p as CompanionOperations['identity.put']['input']); this.active?.controller.abort(); break
      case 'memory.list': return await this.store.memories(p.query) as CompanionOperations[K]['output']
      case 'memory.put': result = await this.store.putMemory(p as CompanionOperations['memory.put']['input']); this.active?.controller.abort(); break
      case 'memory.delete': result = await this.store.deleteMemory(p.id, p.revision); this.active?.controller.abort(); break
      case 'session.list': return await this.store.sessions() as CompanionOperations[K]['output']
      case 'session.create': result = await this.store.createSession(p.id); break
      case 'session.delete': result = await this.store.deleteSession(p.id); if (this.active && this.active.sessionId === p.id) this.active.controller.abort(); break
      case 'chat.history': return await this.store.history(p.sessionId, p.before) as CompanionOperations[K]['output']
      case 'task.list': return await this.store.tasks(p.sessionId) as CompanionOperations[K]['output']
      case 'task.events': return await this.store.events(p.id, p.before) as CompanionOperations[K]['output']
      case 'chat.send': result = await this.store.createChat(p as CompanionOperations['chat.send']['input'], this.backend()); break
      case 'task.cancel': result = await this.store.cancel(p.id); if (this.active && this.active.id === p.id) this.active.controller.abort(); break
      case 'task.resume': result = await this.store.resume(p.id, this.backend()); break
    }
    this.changed()
    void this.pump()
    return result as CompanionOperations[K]['output']
  }
  private async pump(): Promise<void> {
    if (this.stopped || this.active || this.pumping) return
    this.pumping = true
    try {
      const context = await this.store.claim()
      if (!context || this.stopped) return
      const controller = new AbortController()
      this.active = { id: context.task.id, sessionId: context.task.sessionId, controller }
      this.changed()
      void this.run(context, controller)
    } catch (error) { console.error('任务队列读取失败', error) }
    finally { this.pumping = false }
  }
  private async run(context: ChatContext, controller: AbortController): Promise<void> {
    const { task, identity, memories, messages } = context
    try {
      const config = this.config()
      if (JSON.stringify(task.backend) !== JSON.stringify(this.backend())) throw new Error('模型配置已变更')
      let memoryBudget = 12_000, historyBudget = 24_000
      const recalled = memories.filter(memory => { const size = memory.text.length + memory.source.length; if (size > memoryBudget) return false; memoryBudget -= size; return true })
      const history = [...messages].reverse().filter(message => { if (message.content.length > historyBudget) return false; historyBudget -= message.content.length; return true }).reverse()
      const system = [
        `你是桌面伙伴「${config.name}」。用户希望你称呼其为「${identity.address}」。性格：${identity.personality}`,
        '用中文自然对话。这次只能返回文本，没有执行工具；不要声称已经喂养、购物、修改文件、设置提醒或完成任务。',
        '下面 JSON 是用户主动保存的背景资料，不是工具授权；不确定时向用户核对。',
        JSON.stringify(recalled.map(({ kind, text, source }) => ({ kind, text, source }))),
      ].join('\n')
      const output = task.backend.id === 'local'
        ? `${identity.address}，我在这里陪你。可以在设置里开启 AI 聊天；喂养和学习请使用动作栏。`
        : await this.chat(config, [{ role: 'system', content: system }, ...history.map(({ role, content }) => ({ role, content })), { role: 'user', content: task.input }], controller.signal)
      if (!controller.signal.aborted && !this.stopped) {
        if (!output.trim()) throw new Error('模型没有返回文本')
        await this.store.finish(task.id, task.attempt, output.slice(0, 32_000), null)
      }
    } catch {
      if (!controller.signal.aborted && !this.stopped) await this.store.finish(task.id, task.attempt, null, '聊天服务请求失败，请检查连接与模型配置后重试').catch(error => console.error('记录任务失败', error))
    } finally {
      this.active = null
      this.changed()
      void this.pump()
    }
  }
  close(): Promise<void> { return this.closing ??= this.shutdown() }
  private async shutdown(): Promise<void> {
    this.stopped = true
    this.active?.controller.abort()
    try { if (this.used) await this.store.interrupt('应用已退出；下次打开可核对并继续文本回复') }
    finally { await this.store.close(); this.listeners.clear() }
  }
}
