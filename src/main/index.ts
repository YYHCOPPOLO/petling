import { app, dialog, session, type BrowserWindow } from 'electron'
import { APP_NAME } from '../shared/app-info'
import { handleScheme, registerScheme } from './protocol'
import { getSave, loadSave } from './save'
import { createPetTray } from './tray'
import { createPetWindow } from './window'
import { Lifetime } from './lifecycle'
import { registerDesktopIpc } from './services/ipc'
import { observeDesktop } from './services/observers'
import { IPC } from '../shared/ipc'
import { closeCompanion } from './companion'

app.setName(APP_NAME)
if (process.env.AGENT_PET_TEST_DATA) app.setPath('userData', process.env.AGENT_PET_TEST_DATA)

if (!app.requestSingleInstanceLock()) app.exit(0)
else {
  registerScheme()
  const lifetime = new Lifetime()
  let petWindow: BrowserWindow | undefined
  let quitting = false
  let readyToQuit = false
  app.on('before-quit', event => {
    if (readyToQuit) { lifetime.dispose(); return }
    event.preventDefault()
    if (quitting) return
    quitting = true
    let timer: ReturnType<typeof setTimeout>
    void Promise.race([
      petWindow && !petWindow.isDestroyed() ? petWindow.webContents.executeJavaScript('window.__qqpetClosing = true; window.__qqpetFlush?.()') : Promise.resolve(),
      new Promise<void>(resolve => { timer = setTimeout(resolve, 1500) }),
    ]).catch(error => console.error('退出时存档写入失败：', error)).finally(async () => {
      clearTimeout(timer)
      try { await closeCompanion() } catch (error) { console.error('退出时任务保存失败：', error) }
      lifetime.dispose()
      readyToQuit = true
      app.quit()
    })
  })
  app.on('window-all-closed', () => app.quit())

  void app.whenReady().then(() => {
    if (!['win32', 'darwin'].includes(process.platform)) throw new Error('AgentPet 目前只支持 Windows 和 macOS')
    handleScheme()
    lifetime.defer(() => session.defaultSession.protocol.unhandle('app'))
    app.dock?.hide()
    loadSave()
    if (getSave().settings.hd) {
      session.defaultSession.webRequest.onBeforeSendHeaders((details, done) => done({ requestHeaders: { ...details.requestHeaders, 'X-HD': '1' } }))
      lifetime.defer(() => session.defaultSession.webRequest.onBeforeSendHeaders(null))
    }
    const win = petWindow = createPetWindow(lifetime)
    const tray = createPetTray(click => {
      if (win.isDestroyed()) return
      const bounds = win.getBounds()
      win.webContents.send(IPC.trayClick, click.x === undefined ? click : { ...click, x: click.x - bounds.x, y: click.y! - bounds.y })
    })
    lifetime.defer(() => tray.destroy())
    observeDesktop(win, lifetime)
    registerDesktopIpc(win, tray, lifetime)
    app.on('second-instance', () => {
      if (!win.isDestroyed()) {
        win.showInactive()
        win.webContents.send(IPC.trayClick, { kind: 'menu' })
      }
    })
  }).catch((error: unknown) => {
    console.error('AgentPet 启动失败：', error)
    dialog.showErrorBox('AgentPet 启动失败', error instanceof Error ? error.message : String(error))
    app.quit()
  })
}
