import { currentActivity, type ActivityKind, type ActivityProgress } from '../../core/pet/activities'
import { command } from './commands'
import { onPetEvent, refreshTray, save } from './store'
import { windowView } from '../ui/window-view'

const listeners: ((progress: ActivityProgress) => void)[] = []
export const onActivityEnd = (listener: (progress: ActivityProgress) => void): void => { listeners.push(listener) }
export const elapsed = (): number => currentActivity(save)?.elapsed ?? 0

export async function stopTask(): Promise<ActivityKind | null> {
  const result = await command('pet.stopActivity', {})
  if (result.status === 'failed') windowView({ msg: result.error.message })
  refreshTray()
  return result.status === 'succeeded' ? result.data.kind : null
}

onPetEvent(event => {
  if (event.type !== 'activity') return
  refreshTray()
  if (event.progress.completed) for (const listener of listeners) listener(event.progress)
})
