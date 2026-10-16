import { findLast } from '../../shared/compat'
import { FESTIVAL, GREET } from './data/greet'
import type { Line } from './data/talk'
import { rand } from './rand'

const WEEK = '日一二三四五六'
const pick = <T>(list: T[]): T => list[rand(0, list.length - 1)]
export const dayText = (): string => `星期${WEEK[new Date().getDay()]}`
export const greeting = (): Line => pick(findLast(GREET, ([from]) => new Date().getHours() >= from)![1])

/** Basic greetings use the local clock and never depend on an online calendar. */
export function festival(): string | null {
  const date = new Date()
  const key = `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  return FESTIVAL[key] ? pick(FESTIVAL[key]) : null
}

export function dateTalk(): string {
  const date = new Date()
  return `[host]，今天是${date.getMonth() + 1}月${date.getDate()}日，${dayText()}~`
}
