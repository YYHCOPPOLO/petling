import { powerMonitor, type BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipc'
import type { Lifetime } from '../lifecycle'

/** Basic return greetings only; no clipboard or foreground-application observation. */
export function observeDesktop(win: BrowserWindow, lifetime: Lifetime): void {
  let active = true
  let away = false
  const presence = (next: boolean): void => {
    if (!active || next === away || win.isDestroyed() || win.webContents.isDestroyed()) return
    away = next
    win.webContents.send(IPC.presence, next)
  }
  lifetime.interval(() => presence(powerMonitor.getSystemIdleTime() >= 300), 5000)
  const leave = (): void => presence(true)
  const returnToDesktop = (): void => presence(false)
  powerMonitor.on('lock-screen', leave)
  powerMonitor.on('suspend', leave)
  powerMonitor.on('unlock-screen', returnToDesktop)
  powerMonitor.on('resume', returnToDesktop)
  lifetime.defer(() => {
    active = false
    powerMonitor.removeListener('lock-screen', leave)
    powerMonitor.removeListener('suspend', leave)
    powerMonitor.removeListener('unlock-screen', returnToDesktop)
    powerMonitor.removeListener('resume', returnToDesktop)
  })
}
