import type { ChatMessage, Memory, MemoryKind, TaskState } from '../../shared/companion'
import { info, flushSave } from '../pet/store'
import { openBox } from './box'
import { div } from './dom'
import './css/chat.css'

let close: (() => void) | null = null
const api = window.qqpet.companion
const labels: Record<TaskState, string> = { queued: '排队中', running: '正在回复', waiting_input: '等待输入', waiting_approval: '等待授权', interrupted: '已中断', succeeded: '已完成', failed: '失败', cancelled: '已取消' }
const kinds: Record<MemoryKind, string> = { preference: '个人偏好', experience: '共同经历', project: '项目资料' }
const field = (label: string, control: HTMLElement): HTMLElement => { const wrapper = document.createElement('label'); wrapper.className = 'companionField'; wrapper.append(document.createTextNode(label), control); return wrapper }
const textInput = (value = '', maxLength = 500): HTMLInputElement => Object.assign(document.createElement('input'), { value, maxLength })
const textArea = (value = '', maxLength = 4000): HTMLTextAreaElement => Object.assign(document.createElement('textarea'), { value, maxLength, rows: 4 })
const button = (className: string, click: () => void, ...children: (Node | string)[]): HTMLButtonElement => {
  const element = Object.assign(document.createElement('button'), { className, type: 'button' })
  element.append(...children); element.addEventListener('click', click)
  return element
}

/** A persisted application session; closing this view never cancels a running request. */
export function openChat(): void {
  if (close) return
  let alive = true, generation = 0
  let tab: 'chat' | 'tasks' | 'memory' | 'identity' = 'chat'
  let sessionId = localStorage.getItem('companion.session') ?? ''
  let sending = false
  let messages: ChatMessage[] = []
  let shown = new Set<number>()
  const status = div('companionStatus')
  status.setAttribute('role', 'status')
  const content = div('companionContent f1')
  const sessions = document.createElement('select')
  sessions.className = 'companionSessions'
  sessions.setAttribute('aria-label', '选择对话')
  const log = div('chatLog f1')
  const input = Object.assign(document.createElement('textarea'), { className: 'chatInput f1', maxLength: 8000, rows: 2, placeholder: `和${info.name}说点什么，Enter 发送，Shift+Enter 换行` })
  const notice = (error: unknown): void => { if (alive) status.textContent = String(error instanceof Error ? error.message : error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }
  const run = (action: () => Promise<unknown>): void => { void action().catch(notice) }
  const selectSession = (id: string): void => { sessionId = id; localStorage.setItem('companion.session', id); messages = []; shown = new Set(); generation++ }

  async function loadSessions(): Promise<void> {
    const list = await api('session.list', {})
    if (!alive) return
    if (!list.some(item => item.id === sessionId)) {
      const session = await api('session.create', { id: crypto.randomUUID() })
      if (!alive) return
      list.unshift(session); selectSession(session.id)
    }
    sessions.replaceChildren(...list.map(item => Object.assign(document.createElement('option'), { value: item.id, textContent: item.title })))
    sessions.value = sessionId
  }
  const showMessages = (): void => {
    log.replaceChildren(...messages.map(message => div(`chatLine ${message.role}`, message.content)))
    log.scrollTop = log.scrollHeight
  }
  async function refresh(): Promise<void> {
    if (!alive || !sessionId || !['chat', 'tasks'].includes(tab)) return
    const version = ++generation, requested = sessionId
    const [history, tasks] = await Promise.all([api('chat.history', { sessionId: requested }), api('task.list', { sessionId: requested })])
    if (!alive || version !== generation || requested !== sessionId) return
    if (tab === 'chat') {
      const previous = messages.filter(message => !history.some(fresh => fresh.sequence === message.sequence))
      messages = [...previous, ...history].sort((a, b) => a.sequence - b.sequence).slice(-500)
      for (const message of history) shown.add(message.sequence)
      showMessages()
      const active = tasks.find(task => task.state === 'queued' || task.state === 'running')
      input.disabled = sending || Boolean(active)
      status.textContent = active ? `${labels[active.state]}；关闭面板后继续。可在「任务」中取消。` : (tasks[0]?.error ?? '对话自动保存在本机；消息和已保存偏好会发送给设置中选择的模型。')
    } else {
      content.replaceChildren(div('companionHelp', '以下是文本回复任务。继续会重新请求同一后端，不代表恢复外部 Agent 原生会话。'))
      for (const task of tasks) {
        const detail = div('companionDetail')
        const controls = div('companionActions')
        controls.append(button('companionButton', () => run(async () => {
          const events = await api('task.events', { id: task.id })
          if (detail.isConnected) detail.textContent = events.map(event => `${new Date(event.at).toLocaleString()} · ${labels[event.state]} · ${event.detail}`).join('\n')
        }), '记录'))
        if (['queued', 'running', 'interrupted', 'failed'].includes(task.state)) controls.append(button('companionButton', () => run(async () => { await api('task.cancel', { id: task.id }); await refresh() }), '取消'))
        if (['interrupted', 'failed'].includes(task.state)) controls.append(button('companionButton', () => run(async () => { await flushSave(); await api('task.resume', { id: task.id }); await refresh() }), '继续'))
        content.append(div('companionCard', div('companionTask', `${labels[task.state]} · ${task.backend.id === 'local' ? '本地陪伴' : task.backend.model}`), div('', task.input), div('companionHelp', task.error ?? `第 ${task.attempt} 次请求 · ${new Date(task.updatedAt).toLocaleString()}`), controls, detail))
      }
      if (!tasks.length) content.append(div('companionHelp', '这段对话还没有任务。'))
      status.textContent = '显示最近 100 项任务。隐藏宠物和暂停成长不会停止回复。'
    }
  }
  async function send(): Promise<void> {
    const message = input.value.trim()
    if (!message || input.disabled || !sessionId) return
    sending = true; input.disabled = true
    try {
      await flushSave()
      const request = { sessionId, requestId: crypto.randomUUID(), message }
      try { await api('chat.send', request) } catch { await api('chat.send', request) }
      input.value = ''
    } finally {
      sending = false
      await refresh()
      if (input.isConnected && !input.disabled) input.focus()
    }
  }
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); run(send) }
  })
  const earlier = button('companionLink', () => run(async () => {
    const selected = sessionId
    const old = await api('chat.history', { sessionId, before: messages[0]?.sequence ?? Number.MAX_SAFE_INTEGER })
    if (alive && selected === sessionId && tab === 'chat') {
      messages = [...old.filter(message => !shown.has(message.sequence)), ...messages].slice(0, 500)
      for (const message of old) shown.add(message.sequence)
      showMessages(); log.scrollTop = 0
      status.textContent = old.length ? '已加载较早消息（面板最多显示 500 条）。' : '已到这段对话的开头。'
    }
  }), '较早消息')

  async function identity(): Promise<void> {
    const saved = await api('identity.get', {})
    if (!alive || tab !== 'identity') return
    const personality = textArea(saved.personality, 2000), address = textInput(saved.address, 80)
    content.replaceChildren(div('companionHelp', '性格和称呼由本机保存，更换模型仍沿用。宠物名字可在「宠物资料」中修改。'), field('性格与表达偏好', personality), field('希望我如何称呼你', address), button('companionButton', () => run(async () => {
      await api('identity.put', { revision: saved.revision, personality: personality.value.trim(), address: address.value.trim() })
      await identity(); status.textContent = '已保存性格。进行中的回复已中断，可在任务中重新请求。'
    }), '保存性格'), div('companionHelp', `伙伴标识：${saved.id}`))
  }
  async function memories(): Promise<void> {
    const query = textInput('', 200), list = div('companionMemoryList'), editor = div('companionEditor')
    query.placeholder = '搜索已保存的记忆'
    const edit = (memory?: Memory): void => {
      const text = textArea(memory?.text), source = textInput(memory?.source ?? '用户手动记录'), project = textInput(memory?.project)
      const kind = document.createElement('select')
      for (const [value, label] of Object.entries(kinds)) kind.append(Object.assign(document.createElement('option'), { value, textContent: label }))
      kind.value = memory?.kind ?? 'preference'
      editor.replaceChildren(field('类型', kind), field('内容', text), field('来源', source), field('项目（项目资料必填）', project), button('companionButton', () => run(async () => {
        await api('memory.put', { id: memory?.id ?? crypto.randomUUID(), revision: memory?.revision ?? 0, kind: kind.value as MemoryKind, text: text.value.trim(), source: source.value.trim(), project: project.value.trim() })
        editor.replaceChildren(); await search(); status.textContent = '记忆已保存。聊天不会自动写入个人记忆。'
      }), '保存记忆'))
    }
    const search = async (): Promise<void> => {
      const records = await api('memory.list', { query: query.value.trim() })
      if (!alive || tab !== 'memory') return
      list.replaceChildren(...records.map(memory => div('companionCard', div('', `${kinds[memory.kind]}${memory.project ? ` · ${memory.project}` : ''}`), div('companionMemoryText', memory.text), div('companionHelp', `来源：${memory.source}`), div('companionActions', button('companionButton', () => edit(memory), '修改'), button('companionButton', () => run(async () => {
        await api('memory.delete', { id: memory.id, revision: memory.revision }); editor.replaceChildren(); await search(); status.textContent = '已遗忘。旧对话仍可查看，可选择对应对话单独删除。'
      }), '遗忘')))))
    }
    content.replaceChildren(div('companionHelp', '仅主动保存的偏好和共同经历用于聊天（最近 20 条）；项目资料独立保留，不自动发送。修改或遗忘后，旧对话只供查看，不再自动带入模型上下文。'), div('companionActions', query, button('companionButton', () => run(search), '搜索'), button('companionButton', () => edit(), '添加')), editor, list)
    await search()
  }
  async function render(): Promise<void> {
    generation++
    for (const element of navigation.querySelectorAll('button')) element.setAttribute('aria-pressed', String(element.classList.contains(`companionTab-${tab}`)))
    status.textContent = ''
    content.classList.toggle('fC', tab === 'chat')
    content.replaceChildren()
    if (tab === 'chat') { content.append(earlier, log, div('chatBar fc', input, button('chatSend fcc', () => run(send), '发送'))); await refresh() }
    else if (tab === 'tasks') await refresh()
    else if (tab === 'identity') await identity()
    else await memories()
  }
  sessions.addEventListener('change', () => { selectSession(sessions.value); run(render) })
  const navigation = div('companionActions')
  for (const [name, label] of [['chat', '对话'], ['tasks', '任务'], ['memory', '记忆'], ['identity', '性格']] as const) {
    navigation.append(button(`companionButton companionTab-${name}`, () => { tab = name; run(render) }, label))
  }
  const sessionBar = div('companionActions', sessions,
    button('companionButton', () => run(async () => { const session = await api('session.create', { id: crypto.randomUUID() }); selectSession(session.id); await loadSessions(); await render() }), '新对话'),
    button('companionButton', () => {
      status.replaceChildren(document.createTextNode('删除该对话及任务文本；已单独保存的记忆保留。'), button('companionLink', () => run(async () => {
        await api('session.delete', { id: sessionId }); selectSession(''); await loadSessions(); await render()
      }), '确认删除'))
    }, '删除对话'))
  const unsubscribe = window.qqpet.onCompanionChanged(() => { if (['chat', 'tasks'].includes(tab)) run(refresh) })
  close = openBox(div('ui-chat', div('chatMain fC', div('chatTitle', `和${info.name}一起`), navigation, sessionBar, content, status)), {
    onClose: () => { alive = false; generation++; unsubscribe(); window.qqpet.setFocusable(false); close = null },
  })
  window.qqpet.setFocusable(true)
  run(async () => { await loadSessions(); if (alive) { await render(); if (input.isConnected) input.focus() } })
}
