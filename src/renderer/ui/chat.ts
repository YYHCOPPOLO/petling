import type { AiMessage } from '../../shared/ipc'
import { aiOn, ask, note } from '../pet/ai'
import { speak } from '../pet/pet'
import { info } from '../pet/store'
import { openBox } from './box'
import './css/chat.css'
import { button, div } from './dom'

const history: AiMessage[] = []
const TURNS = 12
let close: (() => void) | null = null

/** Basic conversation; pet actions remain explicit UI commands until the agent runtime is added. */
export function openChat(): void {
  if (close) return
  const log = div('chatLog f1')
  const show = (message: AiMessage): void => {
    log.append(div(`chatLine ${message.role}`, message.content))
    log.scrollTop = log.scrollHeight
  }
  history.forEach(show)
  const input = Object.assign(document.createElement('input'), { className: 'chatInput f1', maxLength: 200, placeholder: `和${info.name}说点什么，回车发送` })
  async function send(): Promise<void> {
    const content = input.value.trim()
    if (!content || input.disabled) return
    input.value = ''
    input.disabled = true
    const message: AiMessage = { role: 'user', content }
    show(message)
    try {
      const reply = aiOn() ? await ask([...history.slice(-TURNS), message], '只进行对话。不能执行喂养、购物、学习等操作，也不要声称已经完成这些操作；需要时请主人使用宠物动作栏。') : null
      const line = reply ?? (aiOn() ? '现在暂时联系不上聊天服务，稍后再聊吧~' : `${info.host}，我在这里陪你~ 想聊天可以在设置里开启 AI；喂养、学习请用动作栏哦。`)
      history.push(message, { role: 'assistant', content: line })
      if (history.length > 100) history.splice(0, history.length - 100)
      show({ role: 'assistant', content: line })
      speak({ s: line, now: true, ai: false }, 'speak')
      note('刚和主人聊过天')
    } finally {
      input.disabled = false
      if (input.isConnected) input.focus()
    }
  }
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.isComposing && event.keyCode !== 229) void send()
  })
  close = openBox(div('ui-chat', div('chatMain fC', div('chatTitle', `和${info.name}聊天`), log, div('chatBar fc', input, button('chatSend fcc', () => void send(), '发送')))), {
    onClose: () => { window.qqpet.setFocusable(false); close = null },
  })
  window.qqpet.setFocusable(true)
  setTimeout(() => { if (input.isConnected) input.focus() }, 50)
}
