import { app, clipboard, dialog, ipcMain, net, shell, type BrowserWindow } from 'electron'
import { IPC, type AiConfig, type AiMessage, type TrayState } from '../../shared/ipc'
import type { SavePatch, Sex } from '../../shared/save'
import { aiChat, aiModels } from '../../shared/ai'
import { calendar } from '../../shared/calendar'
import { latestRelease } from '../../shared/update'
import { weather } from '../../shared/weather'
import { assertJson, gamePath, webUrl } from '../../shared/validation'
import { TRAY_STATES } from '../../shared/tray'
import { APP_NAME } from '../../shared/app-info'
import { exportSave, getSave, importSave, patchSave, resetSave } from '../save'
import { openGameWindow } from '../window'
import type { createPetTray } from '../tray'
import type { Lifetime } from '../lifecycle'

type TrayService = ReturnType<typeof createPetTray>

export function registerDesktopIpc(win: BrowserWindow, tray: TrayService, observers: { watchFront(on: boolean): void }, lifetime: Lifetime): void {
  let saveError: Error | undefined
  let panel = false
  const report = (operation: string, error: unknown): void => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`${operation}：`, error)
    if (!win.isDestroyed()) win.webContents.send(IPC.platformError, { operation, message })
  }
  // Only the pet's isolated preload may control its native window or the save.
  const handle = (channel: string, run: (...args: any[]) => unknown): void => {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      if (event.sender !== win.webContents) throw new Error('未授权的桌面请求')
      return run(...args)
    })
    lifetime.defer(() => ipcMain.removeHandler(channel))
  }
  const on = (channel: string, run: (...args: any[]) => unknown): void => {
    const listener = (event: Electron.IpcMainEvent, ...args: unknown[]): void => {
      if (event.sender !== win.webContents) return
      try { Promise.resolve(run(...args)).catch(error => report(channel, error)) }
      catch (error) { report(channel, error) }
    }
    ipcMain.on(channel, listener)
    lifetime.defer(() => ipcMain.removeListener(channel, listener))
  }
  // Imported/reset data must not be overwritten by the old renderer's pending patch.
  const relaunch = (): void => { lifetime.dispose(); app.relaunch(); app.exit(0) }

  handle(IPC.load, () => getSave())
  on(IPC.save, (patch: SavePatch) => {
    try {
      patchSave(patch)
      saveError = undefined
    } catch (error) {
      saveError = error instanceof Error ? error : new Error(String(error))
      throw error
    }
    if (patch.petInfo) tray.retip(getSave().petInfo)
    if (patch.settings?.hd !== undefined) tray.setState(getSave())
    if (patch.settings?.watchApp !== undefined) observers.watchFront(getSave().settings.watchApp)
  })
  handle(IPC.flush, () => { if (saveError) throw saveError })
  on(IPC.resetPet, (sex?: Sex) => { resetSave(sex); relaunch() })
  handle(IPC.exportSave, async () => {
    const day = new Date().toISOString().slice(0, 10)
    const result = await dialog.showSaveDialog(win, { defaultPath: `${APP_NAME}-${day}.json`, filters: [{ name: '宠物存档', extensions: ['json'] }] })
    if (result.canceled || !result.filePath) return false
    exportSave(result.filePath)
    return true
  })
  handle(IPC.importSave, async () => {
    const result = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: '宠物存档', extensions: ['json'] }] })
    if (result.canceled || !result.filePaths[0]) return
    importSave(result.filePaths[0])
    relaunch()
  })
  handle(IPC.calendar, () => calendar(net.fetch))
  handle(IPC.aiModels, (config: Omit<AiConfig, 'model'>) => {
    assertJson(config)
    webUrl(config.url)
    return aiModels(net.fetch, config)
  })
  handle(IPC.aiChat, (config: AiConfig, messages: AiMessage[]) => {
    assertJson(config)
    assertJson(messages)
    webUrl(config.url)
    return aiChat(net.fetch, config, messages)
  })
  handle(IPC.weather, (city: string) => {
    if (typeof city !== 'string') throw new Error('无效城市')
    return weather(net.fetch, city)
  })
  handle(IPC.latestRelease, () => latestRelease(net.fetch))
  on(IPC.openGame, (swf: string) => {
    const start = Date.now()
    openGameWindow(gamePath(swf), panel ? win : undefined).on('closed', () => {
      if (!win.isDestroyed()) win.webContents.send(IPC.gamePlayed, (Date.now() - start) / 60000)
    })
  })
  on(IPC.quit, () => app.quit())
  on(IPC.copyText, (text: string) => {
    if (typeof text !== 'string') throw new Error('无效文本')
    return clipboard.writeText(text)
  })
  on(IPC.openUrl, (url: string) => shell.openExternal(webUrl(url)))
  on(IPC.setClickThrough, (enabled: boolean) => win.setIgnoreMouseEvents(enabled === true))
  on(IPC.setAlwaysOnTop, (enabled: boolean) => win.setAlwaysOnTop(enabled === true, 'screen-saver'))
  on(IPC.setFocusable, (enabled: boolean) => {
    panel = enabled === true
    win.setFocusable(panel)
    if (process.platform === 'darwin') win.setAlwaysOnTop(true, panel ? 'floating' : 'screen-saver')
    if (panel) {
      if (process.platform === 'darwin') app.focus({ steal: true })
      win.focus()
    }
  })
  on(IPC.setAutoStart, (enabled: boolean) => app.setLoginItemSettings({ openAtLogin: enabled === true }))
  on(IPC.setTrayState, (state: TrayState) => {
    if (!Object.hasOwn(TRAY_STATES, state)) throw new Error('无效托盘状态')
    tray.setState(getSave(), state)
  })
}
