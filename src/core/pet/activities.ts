import { cloneJson } from '../../shared/compat'
import type { SaveData, StudyInfo } from '../../shared/save'
import { allGoods, goodOf, lookupGood, type Good } from './catalog'
import EXAM from './data/exam.json'
import { applyGood } from './items'
import { fail, succeed, type PetResult } from './result'

export type ActivityKind = 'work' | 'study'
export type Subject = keyof StudyInfo
const SUBJECTS: Subject[] = ['chinese', 'mathematics', 'politics', 'music', 'art', 'manner', 'pe', 'labouring', 'wushu']
const SCHOOLS = [
  { max: 9, key: 'xx', name: '' },
  { max: 30, key: 'zx', name: '小学' },
  { max: 71, key: 'dx', name: '中学' },
  { max: 167, key: 'yjs', name: '大学' },
  { max: Infinity, key: 'xwzj', name: '研究生' },
]
const school = (value: number) => SCHOOLS.find(entry => value <= entry.max)!
export const subjectOf = (good: Good): Subject => good.id.split('-')[1] as Subject
export const lessons = (save: SaveData, good: Good): number => save.studyInfo[subjectOf(good)] - good.classNumUp!
export const examDue = (save: SaveData, good: Good): boolean => good.type === 'study' && lessons(save, good) === good.classNum
export const diploma = (subject: string, value: number): string => school(value).name && school(value).name + goodOf('study', `xx-${subject}`).object
export const workGoods = (): Good[] => allGoods('work')
export const studyGoods = (save: SaveData): Good[] => SUBJECTS.map(subject => {
  const good = goodOf('study', `${school(save.studyInfo[subject]).key}-${subject}`)
  return { ...good, name: good.tolkName! }
})

export interface GameActivity {
  kind: ActivityKind
  good: Good
  elapsed: number
  minutes: number
}

export function currentActivity(save: SaveData): GameActivity | null {
  const kind = (['work', 'study'] as const).find(key => save.activeOption[key])
  if (!kind || typeof save.activeOption[kind] !== 'string') return null
  const good = lookupGood(kind, save.activeOption[kind])
  if (!good?.useTime) return null
  const elapsed = Number(save.saveJsonData.activity ?? 0)
  return { kind, good, elapsed: Number.isFinite(elapsed) ? Math.min(Math.max(elapsed, 0), good.useTime) : 0, minutes: good.useTime }
}

export function startActivity(save: SaveData, kind: ActivityKind, id: string): PetResult<GameActivity> {
  const good = lookupGood(kind, id)
  if (!good?.useTime) return fail('INVALID_ACTIVITY', '未知的学习或工作项目')
  if (!save.petInfo.health) return fail('PET_DEAD', '宠物已经死亡，需要先复活')
  if (save.petInfo.health !== 5) return fail('PET_SICK', '宠物生病了，暂时不能学习或打工')
  if (save.settings.paused) return fail('PAUSED', '宠物暂停成长，暂时不能学习或打工')
  if (save.petInfo.mood <= 0) return fail('NO_MOOD', '宠物没有心情，先陪它玩一会吧')
  if (save.activeOption.work || save.activeOption.study) return fail('ACTIVITY_CONFLICT', '宠物正在学习或打工，请先停止当前活动')
  if (kind === 'work') {
    if ((good.needLevel ?? 0) > save.petComputedlInfo.level) return fail('LEVEL_REQUIRED', '宠物等级不足，暂时不能做这份工作')
    if (Object.entries(good.useArtt ?? {}).some(([key, value]) => value > save.petInfo[key as 'charm'])) return fail('REQUIREMENTS_NOT_MET', '宠物的能力还不能胜任这份工作')
    if (Object.entries(good.education ?? {}).some(([key, value]) => value > save.studyInfo[key as Subject])) return fail('REQUIREMENTS_NOT_MET', '宠物的学历还不能胜任这份工作')
  } else {
    if (!studyGoods(save).some(entry => entry.id === id)) return fail('INVALID_ACTIVITY', '请选择当前学校的课程')
    if (examDue(save, good)) return fail('EXAM_REQUIRED', '当前课程已学完，需要先通过升学考试')
  }
  const next = cloneJson(save)
  next.activeOption[kind] = id
  next.saveJsonData.activity = '0'
  return succeed(save, next, { kind, good, elapsed: 0, minutes: good.useTime })
}

export function stopActivity(save: SaveData): PetResult<{ kind: ActivityKind | null }> {
  const kind = currentActivity(save)?.kind ?? null
  const next = cloneJson(save)
  next.activeOption.work = next.activeOption.study = null
  next.saveJsonData.activity = '0'
  return succeed(save, next, { kind })
}

export interface ActivityProgress {
  completed: GameActivity | null
  early: boolean
  exam: boolean
}

/** No animation callbacks or wall-clock completion: only explicitly accounted game minutes. */
export function advanceActivity(save: SaveData, minutes: number, early = false): PetResult<ActivityProgress> {
  if (!Number.isFinite(minutes) || minutes < 0) return fail('INVALID_ACTIVITY', '活动时间无效')
  const activity = currentActivity(save)
  if (!activity || save.settings.paused || save.petInfo.health <= 0) return succeed(save, save, { completed: null, early: false, exam: false })
  const next = cloneJson(save)
  const elapsed = Math.min(activity.elapsed + minutes, activity.minutes)
  next.saveJsonData.activity = String(elapsed)
  const endsEarly = early && activity.kind === 'study' && elapsed > activity.minutes - 5
  if (elapsed < activity.minutes && !endsEarly) return succeed(save, next, { completed: null, early: false, exam: false })
  next.activeOption.work = next.activeOption.study = null
  next.saveJsonData.activity = '0'
  if (activity.kind === 'work') next.petInfo.yb += activity.good.yb ?? 0
  else next.studyInfo[subjectOf(activity.good)]++
  applyGood(next, activity.good)
  return succeed(save, next, { completed: { ...activity, elapsed }, early: endsEarly, exam: examDue(next, activity.good) })
}

/** Drops invalid legacy activities and accounts offline time only while growth was active. */
export function resumeActivity(save: SaveData, now = Date.now() / 1000): PetResult<ActivityProgress> {
  const activity = currentActivity(save)
  if (!activity) {
    const stopped = stopActivity(save)
    if (stopped.status === 'failed') return stopped
    return { status: 'succeeded', data: { completed: null, early: false, exam: false }, patch: stopped.patch }
  }
  const minutes = save.petInfo.mood > 0 && save.nowTimeLine > 0 ? Math.max(now - save.nowTimeLine, 0) / 60 : 0
  return advanceActivity(save, minutes)
}

export interface ExamQuestion { title: string; options: string[]; answer: string }
export function examQuestions(topic: string): ExamQuestion[] {
  return EXAM[topic as keyof typeof EXAM] ?? []
}

/** Checks authoritative answers and current progress again when the exam is submitted. */
export function submitExam(save: SaveData, topic: string, answers: { title: string; answer: string }[]): PetResult<{ passed: boolean }> {
  const good = lookupGood('study', topic)
  if (!good || !studyGoods(save).some(entry => entry.id === topic) || !examDue(save, good)) return fail('REQUIREMENTS_NOT_MET', '当前课程还未完成，或已经通过升学考试')
  if (save.petInfo.health !== 5 || save.settings.paused || save.activeOption.work || save.activeOption.study) return fail('ACTIVITY_CONFLICT', '宠物当前不能参加考试，请稍后再试')
  const bank = examQuestions(topic)
  if (answers.length !== 3 || new Set(answers.map(entry => entry.title)).size !== 3) return fail('REQUIREMENTS_NOT_MET', '请完成本次考试的三道题目')
  const passed = answers.every(entry => bank.some(question => question.title === entry.title && question.answer === entry.answer))
  if (!passed) return succeed(save, save, { passed: false })
  const next = cloneJson(save)
  next.studyInfo[subjectOf(good)]++
  return succeed(save, next, { passed: true })
}
