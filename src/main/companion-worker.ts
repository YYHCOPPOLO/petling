import { parentPort, workerData } from 'node:worker_threads'
import { CompanionRepository } from './companion-repository'

const repository = new CompanionRepository(workerData.file, Date.now, workerData.defaults)
const allowed = new Set(['identity', 'putIdentity', 'memories', 'putMemory', 'deleteMemory', 'sessions', 'createSession', 'deleteSession', 'history', 'tasks', 'events', 'createChat', 'claim', 'finish', 'cancel', 'resume', 'interrupt', 'close'])
parentPort!.on('message', ({ id, method, args }: { id: number; method: string; args: unknown[] }) => {
  try {
    if (!allowed.has(method)) throw new Error('未知数据库操作')
    const call = (repository as unknown as Record<string, (...args: unknown[]) => unknown>)[method]
    const value = call.apply(repository, args)
    parentPort!.postMessage({ id, value })
  } catch (error) { parentPort!.postMessage({ id, error: error instanceof Error ? error.message : '数据库操作失败' }) }
})
