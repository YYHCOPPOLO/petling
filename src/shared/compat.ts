/** Restricted to the JSON values in saves and bridge payloads; this is not a structuredClone polyfill. */
export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function findLast<T>(list: readonly T[], predicate: (value: T, index: number) => boolean): T | undefined {
  for (let i = list.length - 1; i >= 0; i--) if (predicate(list[i], i)) return list[i]
  return undefined
}

/** Safari 14 can abort a request but does not expose AbortSignal.reason. */
export function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
}

/** Keep the deadline alive through body decoding, and always dispose it after completion. */
export async function withTimeoutSignal<T>(milliseconds: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), milliseconds)
  try {
    return await run(controller.signal)
  } finally {
    clearTimeout(timer)
  }
}
