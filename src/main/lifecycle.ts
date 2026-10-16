/** Every native listener, timer and IPC registration belongs to one application lifetime. */
export class Lifetime {
  private cleanup: (() => void)[] = []
  private stopped = false

  defer(cleanup: () => void): void {
    if (this.stopped) cleanup()
    else this.cleanup.push(cleanup)
  }

  interval(tick: () => void, milliseconds: number): void {
    const timer = setInterval(tick, milliseconds)
    this.defer(() => clearInterval(timer))
  }

  dispose(): void {
    if (this.stopped) return
    this.stopped = true
    for (const cleanup of this.cleanup.splice(0).reverse()) {
      try { cleanup() } catch (error) { console.error('桌面服务清理失败：', error) }
    }
  }
}
