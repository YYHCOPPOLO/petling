import { advanceActivity, currentActivity, resumeActivity, stopActivity, type ActivityKind, type ActivityProgress } from '../../core/pet/activities'
import { command } from './commands'
import { rand } from './rand'
import { info, refreshTray, save } from './store'

const listeners: ((progress: ActivityProgress) => void)[] = []
export const onActivityEnd = (listener: (progress: ActivityProgress) => void): void => { listeners.push(listener) }
export const elapsed = (): number => currentActivity(save)?.elapsed ?? 0

export function stopTask(): ActivityKind | null {
  const result = command(stopActivity)
  refreshTray()
  return result.status === 'succeeded' ? result.data.kind : null
}

function notify(progress: ActivityProgress): void {
  refreshTray()
  if (progress.completed) for (const listener of listeners) listener(progress)
}

export function advanceTask(minutes: number): void {
  const activity = currentActivity(save)
  const early = activity?.kind === 'study' && activity.elapsed + minutes > activity.minutes - 5 && rand(0, Math.max(200, 3000 - info.intel / 10)) <= 10
  const result = command(state => advanceActivity(state, minutes, Boolean(early)))
  if (result.status === 'succeeded') notify(result.data)
}

export function resumeTask(): void {
  const result = command(resumeActivity)
  if (result.status === 'succeeded') notify(result.data)
}
