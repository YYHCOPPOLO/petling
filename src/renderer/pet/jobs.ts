import { diploma, lessons, studyGoods as currentCourses, workGoods } from '../../core/pet/activities'
import { attrs, type Good } from '../../core/pet/catalog'
import { openExam } from '../ui/exam'
import { onActivityEnd } from './activity'
import { command } from './commands'
import { speak } from './pet'
import { refreshTray, save } from './store'

export { diploma, workGoods }
export const studyGoods = (): Good[] => currentCourses(save)

export function describeWork(good: Good): string[] {
  const education = Object.entries(good.education ?? {}).map(([key, value]) => diploma(key, value)).filter(Boolean).join('、')
  const requirements = (['charm', 'intel', 'strong'] as const).filter(key => good.useArtt?.[key]).map(key => `${{ charm: '魅力', intel: '智力', strong: '武力' }[key]}：${good.useArtt![key]}`).join(' ')
  return [good.desc, `元宝：${good.yb ?? 0}`, good.needLevel ? `需要${good.needLevel}级` : '无等级要求', education && `学历要求：${education}`, requirements && `属性要求：${requirements}`, `工作时长：${good.useTime}分钟`, attrs(good)].filter((line): line is string => Boolean(line))
}

export function describeStudy(good: Good): string[] {
  return [good.desc, `课时：${good.classNum}`, `已学课时：${lessons(save, good)}`, attrs(good), `学习时长：${good.useTime}分钟`].filter((line): line is string => Boolean(line))
}

function examPrompt(good: Good): void {
  speak({ s: '[host]，课程学完啦，我要参加升学考试！', b: '我要考试', now: true, ai: false }, 'speak', {
    ok: () => openExam(good.id, () => speak({ s: '[host]，我通过考试，升学啦！', now: true, ai: false }, 'speak')),
  })
}

async function begin(kind: 'work' | 'study', good: Good): Promise<boolean> {
  const result = await command('pet.startActivity', { kind, id: good.id })
  if (result.status === 'failed') {
    if (result.error.code === 'EXAM_REQUIRED') examPrompt(good)
    else speak({ s: result.error.message, now: true, ai: false }, 'speak')
    return false
  }
  refreshTray()
  speak({ s: kind === 'work' ? '[host]，我开始工作了哦~' : `[host]，我开始学习${result.data.good.object}，下课就回来~`, now: true, ai: false }, 'speak')
  return true
}

export const work = (good: Good): Promise<boolean> => begin('work', good)
export const study = (good: Good): Promise<boolean> => begin('study', good)

onActivityEnd(progress => {
  if (!progress.completed) return
  if (progress.exam) examPrompt(progress.completed.good)
  else speak({ c: 'state', s: progress.completed.kind === 'work' ? 'overWork' : progress.early ? 'cententStudy' : 'overStudy', now: true, ai: false }, 'speak')
})
