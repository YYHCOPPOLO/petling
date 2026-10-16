import type { SaveData } from '../shared/save'

/** All eager UI modules receive an initialized store, without top-level await in the module graph. */
export async function bootstrap(): Promise<void> {
  const initial: SaveData = await window.qqpet.load()
  window.__qqpetInitialSave = initial
  await import('./main')
}

void bootstrap().catch((error: unknown) => {
  console.error('QQPet startup failed:', error)
  const message = document.createElement('div')
  message.setAttribute('role', 'alert')
  message.style.cssText = 'padding:16px;background:white;color:#900;font:14px sans-serif'
  message.textContent = `QQPet: ${error instanceof Error ? error.message : String(error)}`
  document.body.appendChild(message)
})
