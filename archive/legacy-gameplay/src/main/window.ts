import { BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'node:path'
import { IPC } from '../shared/ipc'
import { APP_ORIGIN } from './protocol'
import { desktopCursor, petDisplay } from './desktop'
import { getSave } from './save'
import type { Lifetime } from './lifecycle'
import { watchFullscreen } from './services/fullscreen'

const CURSOR_INTERVAL_MS = 33
const PAGES = process.env.ELECTRON_RENDERER_URL ?? APP_ORIGIN

/** Transparent, click-through overlay following the pet's active display. */
export function createPetWindow(lifetime: Lifetime): BrowserWindow {
  const initialDisplay = petDisplay(screen, getSave().settings.petDisplayId)
  const win = new BrowserWindow({
    ...initialDisplay.workArea,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    // Chromium apps (browsers, 抖音...) treat a work-area-sized window as covering them and stop painting
    // once it stops being click-through; a tool window is never counted.
    ...(process.platform === 'win32' && { type: 'toolbar' }),
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
    },
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  // macOS keeps the pet outside other applications' full-screen spaces.
  win.setVisibleOnAllWorkspaces(true)
  win.setIgnoreMouseEvents(true)
  // On macOS, dock.hide() turns the process into a UI element, which hides
  // windows that are already visible.
  win.once('ready-to-show', () => {
    win.showInactive()
    if (process.platform === 'win32') lifetime.defer(watchFullscreen(win))
  })
  // The pet never navigates; links inside SWFs must not replace the page.
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  // Native cursor polling keeps hover and dragging working across displays.
  const position = desktopCursor(win, screen, initialDisplay.id)
  let dragging = false
  ipcMain.handle(IPC.setDragging, (event, on: boolean) => {
    if (event.sender !== win.webContents) throw new Error('Unknown drag sender')
    if (typeof on !== 'boolean') throw new Error('Invalid drag state')
    // Resolve the final point on the display under the cursor before ending the drag.
    const point = position(dragging || on)
    dragging = on
    return point
  })
  let last = ''
  const timer = setInterval(() => {
    const p = position(dragging)
    const key = JSON.stringify({ ...p, desktop: { ...p.desktop, sequence: 0 } })
    if (key === last) return
    last = key
    win.webContents.send(IPC.cursor, p)
  }, CURSOR_INTERVAL_MS)
  lifetime.defer(() => {
    clearInterval(timer)
    ipcMain.removeHandler(IPC.setDragging)
  })

  win.once('closed', () => lifetime.dispose())
  void win.loadURL(`${PAGES}/index.html`)
  if (process.env.AGENT_PET_DEVTOOLS === '1') win.webContents.openDevTools({ mode: 'detach' })
  return win
}

/** A normal, resizable window playing one game; the SWF scales with it. With `parent` it stacks above that window. */
export function openGameWindow(swf: string, parent?: BrowserWindow): BrowserWindow {
  const area = screen.getPrimaryDisplay().workAreaSize
  const scale = Math.min(1, (area.width * 0.9) / 1024, (area.height * 0.9) / 768)
  const win = new BrowserWindow({
    parent,
    width: Math.round(1024 * scale),
    height: Math.round(768 * scale),
    useContentSize: true,
    backgroundColor: '#000',
    autoHideMenuBar: true,
    webPreferences: { sandbox: true },
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  void win.loadURL(`${PAGES}/game.html?swf=${encodeURIComponent(swf)}`)
  return win
}
