import type { QQPetApi } from '../shared/ipc'
import type { SaveData } from '../shared/save'

declare global {
  interface Window {
    qqpet: QQPetApi
    __qqpetInitialSave?: SaveData
    __qqpetFlush?: () => Promise<void>
    __qqpetClosing?: boolean
    RufflePlayer: { newest(): { createPlayer(): RufflePlayerElement } }
    /** Pet action SWFs use these cursor/window values to follow the mouse. */
    API: { GetCursorPosition(): string; GetWindowRect(): string; GetPrivateProfileString(section: string, key: string, fallback: string, file: string): string }
    /** Called by talk.swf when a bubble button is clicked. */
    BubbleAPI: { OnButtonClick(i: number): void }
    /** Called by reset/Adopt.swf: 0 GG, 1 MM. */
    ChooseAPI: { ChooseSex(n: number): void }
  }

  interface RuffleMetadata {
    width: number
    height: number
    frameRate: number
    numFrames: number
    isActionScript3: boolean
  }

  /** Subset of Ruffle's PlayerV1 API (ruffle.js 0.6) that we rely on. */
  interface RuffleApi {
    load(options: Record<string, unknown>): Promise<void>
    resume(): void
    suspend(): void
    addFSCommandHandler(handler: (command: string, args: string) => void): void
    callExternalInterface(name: string, ...args: unknown[]): unknown
    readonly isPlaying: boolean
    readonly metadata: RuffleMetadata | null
  }

  interface RufflePlayerElement extends HTMLElement {
    ruffle(): RuffleApi
    /**
     * Ruffle's master volume, 0..1. Each load() rebuilds the player instance from Ruffle's own
     * element-wide volume (which is a private field), so a write only covers the current movie.
     */
    volume: number
  }
}
