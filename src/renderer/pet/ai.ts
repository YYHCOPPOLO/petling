import type { AiMessage } from '../../shared/ipc'
import { dayText } from './calendar'
import { info, save } from './store'

/** A model is saved only once it passed the settings test. */
export const aiOn = (): boolean => save.settings.aiModel !== ''

const MAX = 80
const TODAY = 5
const today: string[] = []

/** Remembers something that just happened; idle talk may mention it. Dropped after five, never saved. */
export function note(s: string): void {
  const t = s.trim()
  if (!t) return
  today.push(t)
  if (today.length > TODAY) today.shift()
}

const STYLE = '用可爱、亲昵的口吻说中文，像小孩子撒娇；每次只说一两句话，不超过40个字；不要用Markdown、不要换行。'

function persona(): string {
  const c = save.petComputedlInfo
  const pct = (n: number, max: number): string => `${Math.round((n / max) * 100)}%`
  const now = new Date()
  return [
    `你是QQ宠物里的一只${info.sex === 'GG' ? '男生' : '女生'}小企鹅，名叫「${info.name}」，${c.level}级，主人叫「${info.host}」。`,
    `你现在的状态：饱食${pct(info.hunger, c.hungerMax)}，清洁${pct(info.clean, c.cleanMax)}，心情${pct(info.mood, c.moodMax)}，健康${info.health}/5。`,
    `现在是${now.getMonth() + 1}月${now.getDate()}日${now.getHours()}点${now.getMinutes()}分，${dayText()}。`,
    today.length ? `今天刚发生：${today.join('；')}。` : '',
    STYLE,
  ]
    .filter(Boolean)
    .join('\n')
}

async function chat(sys: string, messages: AiMessage[]): Promise<string | null> {
  if (!aiOn()) return null
  const s = save.settings
  try {
    return (await window.qqpet.aiChat({ url: s.aiUrl, key: s.aiKey, model: s.aiModel }, [{ role: 'system', content: sys }, ...messages])).trim()
  } catch (e) {
    console.warn('AI request failed:', e)
    return null
  }
}

// Small models sometimes add notes about their answer on the following lines.
const firstLine = (text: string | null): string | null => text?.split('\n')[0].replace(/\s+/g, ' ').slice(0, MAX) || null

/** In-character text only. A failed request falls back to local conversation; no reply text executes actions. */
export async function ask(messages: AiMessage[], extra = ''): Promise<string | null> {
  if (!extra) return firstLine(await chat(persona(), messages))
  return (await chat(`${persona()}\n${extra}`, messages))?.slice(0, 200) || null
}

/** By default the line is only reworded; `how` can ask for more, e.g. small talk around it. */
const REWORD =
  '下面这句话是你对主人说的，句中的「我」就是你自己。用你的口吻把它重新说一遍。原句里的时间、天气、数字、物品和要做的事都必须保留，不能改也不能编新内容；只输出改写后的那句话，不要解释。原句：'

/** Small talk while idle, starting from one of the original lines. */
export const IDLE =
  '主人在旁边忙，没有说话。结合你现在的状态、时间和日期，以及今天刚发生的事，主动对主人说一句话；只输出这句话，不要解释。可以参考这句：'

const nums = (s: string): string => (s.match(/\d+/g) ?? []).sort().join()

/** The line in the pet's own words; null when AI is off or fails. */
export async function rephrase(line: string, how = REWORD): Promise<string | null> {
  const s = await ask([{ role: 'user', content: `${how}\n${line}` }])
  // Small models garble numbers ("21点" became "720点") or pull the date in from the persona; a reworded line keeps exactly the original's.
  return s && (how !== REWORD || nums(s) === nums(line)) ? s : null
}
