import { Worker } from 'node:worker_threads'
import type { CompanionRepository } from './companion-repository'

export type CompanionStore = { [K in keyof CompanionRepository]: CompanionRepository[K] extends (...args: infer A) => infer R ? (...args: A) => Promise<R> : never }

/** Lazy, bounded transport; SQLite never blocks the Electron event loop. */
export function companionStore(file: string, defaults = { address: '主人' }): CompanionStore {
  let worker: Worker | undefined
  let stopped = false, next = 0
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  const failed = (error: Error): void => {
    stopped = true
    for (const call of pending.values()) call.reject(error)
    pending.clear()
    void worker?.terminate()
  }
  const call = (method: string, args: unknown[]): Promise<unknown> => {
    if (stopped) return Promise.reject(new Error('伙伴存储已关闭，请重新启动应用'))
    if (!worker) {
      worker = new Worker(new URL('./companion-worker.js', import.meta.url), { workerData: { file, defaults } })
      worker.on('message', ({ id, value, error }) => {
        const request = pending.get(id)
        if (!request) return
        pending.delete(id)
        if (error) request.reject(new Error(error)); else request.resolve(value)
      })
      worker.on('error', failed)
      worker.on('exit', () => { if (!stopped) failed(new Error('伙伴存储进程已退出')) })
    }
    if (pending.size >= 64) return Promise.reject(new Error('存储请求过多，请稍后重试'))
    return new Promise((resolve, reject) => {
      const id = ++next
      pending.set(id, { resolve, reject })
      worker!.postMessage({ id, method, args })
    })
  }
  return new Proxy({} as CompanionStore, { get: (_target, method: string) => method === 'close'
    ? async () => {
      if (!worker || stopped) return
      try { await call('close', []) } finally { stopped = true; await worker.terminate() }
    }
    : (...args: unknown[]) => call(method, args) })
}
