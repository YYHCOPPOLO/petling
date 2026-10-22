import { app, clipboard, dialog, ipcMain, net, shell, type BrowserWindow } from 'electron'
import { IPC, type AiConfig, type AiMessage, type TrayState } from '../../shared/ipc'
import type { SavePatch, Sex } from '../../shared/save'
import { aiChat, aiModels } from '../../shared/ai'
import { latestRelease } from '../../shared/update'
import { assertJson, webUrl } from '../../shared/validation'
import { TRAY_STATES } from '../../shared/tray'
import { APP_NAME } from '../../shared/app-info'
import { exportSave, getSave, importSave, petHost, resetSave } from '../save'
import type { createPetTray } from '../tray'
import type { Lifetime } from '../lifecycle'
import { companionHost, closeCompanion } from '../companion'

type TrayService = ReturnType<typeof createPetTray>

export function registerDesktopIpc(win: BrowserWindow, tray: TrayService, lifetime: Lifetime): void {
  let panel = false
  const report = (operation: string, error: unknown): void => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`${operation}：`, error)
    if (!win.isDestroyed()) win.webContents.send(IPC.platformError, { operation, message })
  }
  // Only the pet's isolated preload may control its native window or the save.
  const handle = (channel: string, run: (...args: any[]) => unknown): void => {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('未授权的桌面请求')
      return run(...args)
    })
    lifetime.defer(() => ipcMain.removeHandler(channel))
  }
  const on = (channel: string, run: (...args: any[]) => unknown): void => {
    const listener = (event: Electron.IpcMainEvent, ...args: unknown[]): void => {
      if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) return
      try { Promise.resolve(run(...args)).catch(error => report(channel, error)) }
      catch (error) { report(channel, error) }
    }
    ipcMain.on(channel, listener)
    lifetime.defer(() => ipcMain.removeListener(channel, listener))
  }
  // Imported/reset data must not be overwritten by the old renderer's pending patch.
  const relaunch = async (): Promise<void> => { await closeCompanion(); lifetime.dispose(); app.relaunch(); app.exit(0) }

  const companion = companionHost()
  handle(IPC.companion, (name, input) => companion.invoke(name, input))
  lifetime.defer(companion.subscribe(() => { if (!win.isDestroyed()) win.webContents.send(IPC.companionChanged) }))

  handle(IPC.load, () => getSave())
  const host = petHost()
  lifetime.defer(host.subscribe(update => {
    tray.retip(update.snapshot.save.petInfo)
    tray.setState(update.snapshot.save)
    if (!win.isDestroyed()) win.webContents.send(IPC.state, update)
  }))
  lifetime.interval(() => { try { host.interval() } catch (error) { report('pet:clock', error) } }, 60_000)
  handle(IPC.snapshot, () => host.repository.snapshot())
  handle(IPC.command, request => host.execute(request))
  handle(IPC.start, () => host.start())
  handle(IPC.save, (patch: SavePatch) => host.preferences(patch))
  handle(IPC.flush, () => undefined)
  on(IPC.resetPet, (sex?: Sex) => { resetSave(sex); return relaunch() })
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
    await relaunch()
  })
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
  handle(IPC.latestRelease, () => latestRelease(net.fetch))
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
