import { withTimeoutSignal } from './compat'
import { UPDATE_API } from './app-info'
import { webUrl } from './validation'
import type { Fetch, Release } from './ipc'



interface Reply {
  tag_name: string
  html_url: string
}

/** Rejects while offline or when the proxy fails. */
export async function latestRelease(fetch: Fetch): Promise<Release> {
  if (!UPDATE_API) throw new Error('尚未配置 AgentPet 的发布地址')
  return withTimeoutSignal(20_000, async (signal) => {
    const r = await fetch(webUrl(UPDATE_API), { signal })
    if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 100)}`)
    const d = (await r.json()) as Reply
    return { version: d.tag_name.replace(/^v/, ''), url: webUrl(d.html_url) }
  })
}
