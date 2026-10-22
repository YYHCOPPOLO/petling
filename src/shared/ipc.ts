import type { SaveData, SavePatch, Sex } from './save'
import type { PetReply, PetRequest, PetSnapshot, PetUpdate } from './pet-command'
import type { CompanionApi } from './companion'

export const IPC = {
  load: 'pet:load',
  companion: 'companion:invoke',
  companionChanged: 'companion:changed',
  save: 'pet:save',
  snapshot: 'pet:snapshot',
  command: 'pet:command',
  state: 'pet:state',
  start: 'pet:start',
  flush: 'pet:flush',
  platformError: 'app:platform-error',
  resetPet: 'pet:reset',
  exportSave: 'pet:export',
  importSave: 'pet:import',
  aiModels: 'ai:models',
  aiChat: 'ai:chat',
  latestRelease: 'app:latest-release',
  quit: 'app:quit',
  copyText: 'app:copy-text',
  openUrl: 'app:open-url',
  presence: 'app:presence',
  setClickThrough: 'win:set-click-through',
  setAlwaysOnTop: 'win:set-always-on-top',
  setFocusable: 'win:set-focusable',
  setAutoStart: 'app:set-auto-start',
  setTrayState: 'tray:set-state',
  cursor: 'win:cursor',
  setDragging: 'win:set-dragging',
  trayClick: 'tray:click',
} as const

export interface Point {
  x: number
  y: number
}

export interface DesktopCursor extends Point {
  /** Desktop only. Offset is relative to the window origin at launch, in Electron DIP coordinates. */
  desktop?: { id: number; width: number; height: number; offset: Point; sequence: number }
}

export type TrayState =
  | 'normal'
  | 'leave'
  | 'dirty'
  | 'event'
  | 'feast'
  | 'game'
  | 'hungry'
  | 'ill'
  | 'pause'
  | 'study'
  | 'travel'
  | 'work'
  | 'dead'
  | 'bury'

/** `state` opens the pet status panel, `menu` the pet's context menu. Coordinates are relative to the window. */
export interface TrayClick {
  kind: 'state' | 'menu'
  x?: number
  y?: number
}

/** The newest GitHub release; `version` without the leading v, `url` its download page. */
export interface Release {
  version: string
  url: string
}

/** An OpenAI-compatible endpoint: `url` ends in /v1; `key` may be empty for local servers. */
export interface AiConfig {
  url: string
  key: string
  model: string
}

/** Network services run through Electron's net.fetch in the main process. */
export type Fetch = (url: string, init?: RequestInit) => Promise<Response>

export interface AiMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** Exposed to the renderer as `window.qqpet` by the preload script. */
export interface QQPetApi {
  companion: CompanionApi
  onCompanionChanged(listener: () => void): () => void
  load(): Promise<SaveData>
  snapshot(): Promise<PetSnapshot>
  command(request: PetRequest): Promise<PetReply>
  start(): Promise<void>
  onState(listener: (update: PetUpdate) => void): void
  /** Only desktop preferences/name/position; gameplay is owned by the host. */
  save(patch: SavePatch): Promise<PetSnapshot>
  /** Resolves after previously submitted saves reach persistent storage. */
  flush(): Promise<void>
  /** Buries the pet and relaunches into egg selection, or straight into a newborn of `sex`. */
  resetPet(sex?: Sex): void
  /** Asks where to write the save; false when cancelled. */
  exportSave(): Promise<boolean>
  /** Asks for a save file (ours or the original's config.json), then relaunches with it. Rejects when the file is not a save. */
  importSave(): Promise<void>
  /** Rejects with the server's error. */
  aiModels(c: Omit<AiConfig, 'model'>): Promise<string[]>
  /** The reply's text; rejects with the server's error. */
  aiChat(c: AiConfig, messages: AiMessage[]): Promise<string>
  /** Rejects while offline. */
  latestRelease(): Promise<Release>
  quit(): void
  copyText(text: string): void
  /** Opens a web page in the system browser. */
  openUrl(url: string): void
  setClickThrough(enabled: boolean): void
  setAlwaysOnTop(enabled: boolean): void
  setFocusable(enabled: boolean): void
  setAutoStart(enabled: boolean): void
  setTrayState(state: TrayState): void
  /** Desktop drag follows the native cursor across displays. */
  setDragging?(enabled: boolean): Promise<DesktopCursor>
  /** Cursor position in window coordinates, pushed ~30 times per second. */
  onCursor(listener: (p: DesktopCursor) => void): void
  onTrayClick(listener: (e: TrayClick) => void): void
  /** The user left the machine (screen off / idle) or came back. */
  onPresence(listener: (away: boolean) => void): void
  onPlatformError(listener: (error: { operation: string; message: string }) => void): void
}
