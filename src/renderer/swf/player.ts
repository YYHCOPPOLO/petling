const FONT = 'HappyZcool-2016'
// SWFs resolve relative URLs (configs, sub-movies) against the page, exactly
// like the original <embed> inside dist/index.html did.
const BASE = new URL('./', location.href).href

const CONFIG = {
  base: BASE,
  wmode: 'transparent',
  backgroundColor: null,
  autoplay: 'on',
  splashScreen: false,
  unmuteOverlay: 'hidden',
  contextMenu: 'off',
  letterbox: 'off',
  allowScriptAccess: true,
  // Ruffle ships no CJK glyphs; without this every Chinese text field is blank.
  fontSources: [BASE + 'pet/qqfont.ttf'],
  defaultFonts: { sans: [FONT], serif: [FONT], typewriter: [FONT] },
  logLevel: 'error',
}

const players = new Set<SwfPlayer>()
const LOAD_MS = 30_000
const CALLBACK_MS = 10_000
// Panels usually remove their DOM directly. Dispose players, including those inside removed iframes.
const removed = new MutationObserver(() => {
  for (const player of players) {
    const frame = player.el.ownerDocument.defaultView?.frameElement
    if (!player.el.isConnected || (frame && !frame.isConnected)) player.destroy()
  }
})
removed.observe(document.documentElement, { childList: true, subtree: true })

/** A detached generation can finish building after its original DOM disconnect. */
function disposeDetached(el: RufflePlayerElement): void {
  try {
    el.volume = 0
    el.ruffle().suspend()
    // Pinned Ruffle 0.6 releases its Rust instance in this custom-element lifecycle method.
    const disconnected = (el as RufflePlayerElement & { disconnectedCallback?: () => void }).disconnectedCallback
    disconnected?.call(el)
  } catch { /* A removed or partially built instance may already have been released. */ }
}

/**
 * One Ruffle instance. Ruffle has no Flash scripting API (CurrentFrame,
 * TotalFrames, StopPlay...), so the playhead is derived from the SWF header
 * frame rate and the time since load. The pet state machine only uses it to
 * detect "animation reached its last frame", so the estimate clamps there
 * instead of looping.
 */
export class SwfPlayer {
  readonly el: RufflePlayerElement
  private meta: RuffleMetadata | null = null
  private startedAt = 0
  private stoppedAt: number | null = null
  private callbacks = new Set<string>()
  private muted = false
  private destroyed = false
  private revision = 0
  private loading = false
  private pending = new Set<(error: Error) => void>()
  private keyboardCleanup = (): void => {}

  /** The SWF's ExternalInterface calls go to the globals of the window that owns `parent`. */
  constructor(parent: HTMLElement) {
    this.el = parent.ownerDocument.defaultView!.RufflePlayer.newest().createPlayer()
    this.el.style.width = '100%'
    this.el.style.height = '100%'
    parent.appendChild(this.el)
    players.add(this)
    // Ruffle types into text fields from a hidden <input> it empties on every input event, which breaks IME
    // composition (Chinese). Keep the composing keystrokes from it and hand it the committed text at once.
    const keyboard = this.el.shadowRoot?.getElementById('virtual-keyboard')
    const composing = (e: Event): void => {
      if ((e as InputEvent).isComposing) e.stopImmediatePropagation()
    }
    if (keyboard) {
      const committed = (): void => { keyboard.dispatchEvent(new Event('input')) }
      for (const type of ['input', 'keydown', 'keyup']) keyboard.addEventListener(type, composing, true)
      keyboard.addEventListener('compositionend', committed)
      this.keyboardCleanup = () => {
        for (const type of ['input', 'keydown', 'keyup']) keyboard.removeEventListener(type, composing, true)
        keyboard.removeEventListener('compositionend', committed)
      }
    }
  }

  private cancelPending(message: string): void {
    for (const cancel of [...this.pending]) cancel(new Error(message))
  }

  private bounded<T>(operation: Promise<T>, label: string, milliseconds: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const finish = (): void => { clearTimeout(timer); this.pending.delete(cancel) }
      const cancel = (error: Error): void => { finish(); reject(error) }
      const timer = setTimeout(() => cancel(new Error(`${label} timed out`)), milliseconds)
      this.pending.add(cancel)
      operation.then((value) => { finish(); resolve(value) }, cancel)
    })
  }

  private waitFor<T>(read: () => T | null | undefined, label: string, milliseconds: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const deadline = performance.now() + milliseconds
      let timer: ReturnType<typeof setTimeout> | undefined
      const finish = (): void => { clearTimeout(timer); this.pending.delete(cancel) }
      const cancel = (error: Error): void => { finish(); reject(error) }
      const poll = (): void => {
        try {
          const value = read()
          if (value != null) { finish(); resolve(value); return }
          if (performance.now() >= deadline) return cancel(new Error(`${label} timed out`))
          timer = setTimeout(poll, 50)
        } catch (error) { cancel(error instanceof Error ? error : new Error(String(error))) }
      }
      this.pending.add(cancel)
      poll()
    })
  }

  /**
   * Mutes or unmutes the movie's audio. Ruffle seeds every new player instance from its own
   * element-wide volume, which is not reachable from here, so load() re-applies this after
   * each load — setting it once would be undone by the next one.
   */
  setMuted(muted: boolean): void {
    this.muted = muted
    this.el.volume = muted ? 0 : 1
  }

  /** `base` (relative to the page) resolves the SWF's own relative URLs; `options` override Ruffle's config. */
  async load(url: string, base = BASE, options: Record<string, unknown> = {}): Promise<RuffleMetadata> {
    if (this.destroyed) throw new Error('SWF player was destroyed')
    // Ruffle does not cancel its async WASM/font builder. Never reuse an in-flight element.
    if (this.loading) {
      this.destroy()
      throw new Error('SWF player had an unfinished load; a new player is required')
    }
    // Some hosts request a callback before the first load (the pond); retain those initial waits.
    if (this.revision) this.cancelPending('SWF movie was replaced')
    const revision = ++this.revision
    this.meta = null
    // Keep the logical source visible for diagnostics.
    this.el.dataset.swf = url
    // Ruffle leaves the previous movie's callbacks on the element; calling one before the new movie registers it does nothing.
    for (const name of this.callbacks) delete (this.el as unknown as Record<string, unknown>)[name]
    this.callbacks.clear()
    this.loading = true
    try {
      const operation = this.el.ruffle().load({ ...CONFIG, ...options, base: new URL(base, BASE).href, url: new URL(url, BASE).href }).finally(() => {
        if (this.destroyed || revision !== this.revision) disposeDetached(this.el)
      })
      await this.bounded(operation, 'SWF load', LOAD_MS)
      if (this.destroyed || revision !== this.revision) throw new Error('SWF load was cancelled')
      // The rebuilt instance is live and already at Ruffle's own volume; restore ours before the
      // movie's one-shot audio (the edge-peek 嘿嘿嘿) can be heard.
      this.el.volume = this.muted ? 0 : 1
      const metadata = await this.waitFor(() => this.el.ruffle().metadata, 'SWF metadata', LOAD_MS)
      if (this.destroyed || revision !== this.revision) throw new Error('SWF load was cancelled')
      this.meta = metadata
      this.startedAt = performance.now()
      this.stoppedAt = null
      return this.meta
    } catch (error) {
      // Removing the failed generation isolates every late fetch/build from future players.
      const cancelled = this.destroyed
      this.destroy()
      if (!cancelled) {
        const message = error instanceof Error ? error.message : String(error)
        window.dispatchEvent(new CustomEvent('qqpet-swf-error', { detail: { url, message } }))
      }
      throw error
    } finally {
      this.loading = false
    }
  }

  /** 0-based, same convention as Flash's CurrentFrame(). -1 (== totalFrames - 1) before the first load. */
  get currentFrame(): number {
    if (!this.meta) return -1
    const elapsed = (this.stoppedAt ?? performance.now()) - this.startedAt
    return Math.min(Math.floor((elapsed / 1000) * this.meta.frameRate), this.meta.numFrames - 1)
  }

  get totalFrames(): number {
    return this.meta?.numFrames ?? 0
  }

  get isPlaying(): boolean {
    return this.stoppedAt === null && this.el.ruffle().isPlaying
  }

  stop(): void {
    this.el.ruffle().suspend()
    this.stoppedAt ??= performance.now()
  }

  async nextPaint(): Promise<void> {
    const view = this.el.ownerDocument.defaultView!
    let first = 0
    let second = 0
    try {
      await this.bounded(new Promise<void>((resolve) => {
        first = view.requestAnimationFrame(() => { second = view.requestAnimationFrame(() => resolve()) })
      }), 'SWF paint', LOAD_MS)
    } finally {
      view.cancelAnimationFrame(first)
      view.cancelAnimationFrame(second)
    }
  }

  /**
   * Resolves with a function the SWF registered via ExternalInterface.addCallback.
   * SWFs register from their first frame script, some time after load() resolves.
   */
  async callback(name: string): Promise<(...args: unknown[]) => unknown> {
    if (this.destroyed) throw new Error('SWF player was destroyed')
    const host = this.el as unknown as Record<string, unknown>
    const fn = await this.waitFor(() => typeof host[name] === 'function' ? host[name] as (...args: unknown[]) => unknown : null, `SWF callback ${name}`, CALLBACK_MS)
    this.callbacks.add(name)
    return fn.bind(this.el)
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    ++this.revision
    this.cancelPending('SWF player was destroyed')
    this.keyboardCleanup()
    players.delete(this)
    this.el.remove()
  }
}
