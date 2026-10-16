import { clipboard, powerMonitor, type BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipc'
import { frontName } from '../front'
import { Lifetime } from '../lifecycle'
import { getSave } from '../save'

export function observeDesktop(win: BrowserWindow, lifetime: Lifetime): { watchFront(on: boolean): void } {
  let active = true
  lifetime.defer(() => { active = false })
  const send = (channel: string, value: unknown): void => {
    if (active && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, value)
  }
  let copied: string | undefined
  let reading = false
  lifetime.interval(() => {
    if (!getSave().settings.clip) { copied = undefined; return }
    if (reading) return
    reading = true
    void clipboard.readText().then(text => {
      if (!active) return
      const changed = copied !== undefined && text !== copied
      copied = text
      if (changed && text.trim() && getSave().settings.clip) send(IPC.clipboard, text)
    }).catch(error => console.error('剪贴板读取失败：', error)).finally(() => { reading = false })
  }, 500)

  let away = false
  const presence = (next: boolean): void => {
    if (next === away) return
    away = next
    send(IPC.presence, next)
  }
  lifetime.interval(() => presence(powerMonitor.getSystemIdleTime() >= 300), 5000)
  const leave = (): void => presence(true)
  const returnToDesktop = (): void => presence(false)
  powerMonitor.on('lock-screen', leave)
  powerMonitor.on('suspend', leave)
  powerMonitor.on('unlock-screen', returnToDesktop)
  powerMonitor.on('resume', returnToDesktop)
  lifetime.defer(() => {
    powerMonitor.removeListener('lock-screen', leave)
    powerMonitor.removeListener('suspend', leave)
    powerMonitor.removeListener('unlock-screen', returnToDesktop)
    powerMonitor.removeListener('resume', returnToDesktop)
  })

  let timer: ReturnType<typeof setInterval> | undefined
  let generation = 0
  let lastFront = ''
  let busy = false
  const watchFront = (on: boolean): void => {
    clearInterval(timer)
    timer = undefined
    const revision = ++generation
    lastFront = ''
    if (!on) return
    const tick = (): void => {
      if (busy) return
      busy = true
      void frontName().then(name => {
        if (!active || revision !== generation || !name || name === lastFront) return
        lastFront = name
        send(IPC.front, name)
      }).finally(() => { busy = false })
    }
    tick()
    timer = setInterval(tick, 15_000)
  }
  lifetime.defer(() => { generation++; clearInterval(timer) })
  watchFront(getSave().settings.watchApp)
  return { watchFront }
}
