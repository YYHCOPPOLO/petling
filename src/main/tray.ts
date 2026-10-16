import { nativeImage, screen, Tray, type NativeImage } from 'electron'
import { readFileSync } from 'node:fs'
import type { TrayClick, TrayState } from '../shared/ipc'
import type { PetInfo, SaveData } from '../shared/save'
import { TRAY_STATES, trayTip } from '../shared/tray'
import { resourceCatalog } from './protocol'
import { APP_NAME } from '../shared/app-info'

const FRAME_MS = 300

/** createFromPath also loads a `@2x` sibling for HiDPI screens; a buffer is the file alone. */
function icon(sex: string, file: string, hd: boolean): NativeImage {
  const path = resourceCatalog().resolve(`img_res/Tray/${sex}/${file}`)
  return hd ? nativeImage.createFromPath(path) : nativeImage.createFromBuffer(readFileSync(path))
}

export function createPetTray(onClick: (e: TrayClick) => void) {
  const tray = new Tray(icon('GG', 'leave.png', false))
  tray.setToolTip(APP_NAME)
    // Open at the cursor, not the icon: an icon in the Windows overflow flyout or hidden by the macOS menu bar
    // (Bartender) reports a position the cursor is not on, and the menu closes once the cursor is off it.
    const at = (kind: TrayClick['kind']): TrayClick => ({ kind, ...screen.getCursorScreenPoint() })
    tray.on('click', () => onClick(at('state')))
    tray.on('right-click', () => onClick(at('menu')))

  let timer: NodeJS.Timeout | undefined
  let current: TrayState = 'leave'
  const retip = (pet: PetInfo): void => {
    const tip = trayTip(current, pet)
    if (tip) tray.setToolTip(tip)
  }
  return {
    /** Re-renders the tooltip, e.g. after a rename. */
    retip,
    /** Without a state: redraws the current one, e.g. after the hd setting changed. */
    setState(s: SaveData, state = current): void {
      const pet = s.petInfo
      clearTimeout(timer)
      current = state
      retip(pet)
      const { frames } = TRAY_STATES[state]
      if (frames === 0) return tray.setImage(icon(pet.sex, `${state}.png`, s.settings.hd))
      const images = Array.from({ length: frames }, (_, i) => icon(pet.sex, `${state}/${i + 1}.png`, s.settings.hd))
      const show = (i: number): void => {
        tray.setImage(images[i])
        timer = setTimeout(() => show((i + 1) % frames), FRAME_MS)
      }
      show(0)
    },
    destroy(): void {
      clearTimeout(timer)
      tray.destroy()
    },
  }
}
