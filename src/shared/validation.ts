const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor'])

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Saves and IPC payloads contain JSON, with no executable or prototype keys. */
export function assertJson(value: unknown, depth = 0): void {
  if (depth > 32) throw new Error('存档嵌套层级过深')
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number' && Number.isFinite(value)) return
  if (Array.isArray(value)) {
    for (const entry of value) assertJson(entry, depth + 1)
    return
  }
  if (isRecord(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (FORBIDDEN.has(key)) throw new Error('存档包含不支持的字段')
      assertJson(entry, depth + 1)
    }
    return
  }
  throw new Error('存档包含无效数据')
}

export function relativeAssetPath(value: unknown): string {
  if (typeof value !== 'string' || !value || /[\\\x00-\x1f:?#]/.test(value) || value.startsWith('/')) throw new Error('无效资源路径')
  if (value.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('无效资源路径')
  return value
}

export function gamePath(value: unknown): string {
  const path = relativeAssetPath(value)
  if (!path.toLowerCase().endsWith('.swf')) throw new Error('请选择 SWF 游戏')
  return path
}

export function webUrl(value: unknown): string {
  if (typeof value !== 'string') throw new Error('无效网页地址')
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('只支持 HTTP / HTTPS 地址')
  return url.href
}
