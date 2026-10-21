import { app, net, protocol } from 'electron'
import { join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { hidpiSvg } from './hidpi'
import { AssetCatalog } from './assets'

// The renderer and every SWF are served from app://bundle/. Ruffle loads SWFs,
// XML configs and wasm through fetch(), which file:// does not support.
export const APP_ORIGIN = 'app://bundle'

const rendererRoot = join(import.meta.dirname, '../renderer')
// The audited asset pack lives next to the app in production (extraResources).
export const resourcesRoot = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
let assets: AssetCatalog | undefined
export const resourceCatalog = (): AssetCatalog => assets ??= new AssetCatalog(resourcesRoot)

export function registerScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  ])
}

export function handleScheme(): void {
  resourceCatalog().checkOverrides()
  protocol.handle('app', async (req) => {
    try {
      const url = new URL(req.url)
      if (url.host !== 'bundle') return new Response(null, { status: 403 })
      const path = decodeURIComponent(url.pathname)
      const asset = path.startsWith('/pet/')
      const file = asset ? resourceCatalog().resolve(path) : resolve(rendererRoot, '.' + path)
      const inside = relative(asset ? resourcesRoot : rendererRoot, file)
      if (inside === '..' || inside.startsWith('..' + sep) || inside.includes(':')) return new Response(null, { status: 403 })
      const svg = asset && req.headers.has('x-hd') && req.headers.get('accept')?.includes('image/svg+xml') && hidpiSvg(file)
      if (svg) return new Response(svg, { headers: { 'content-type': 'image/svg+xml' } })
      return await net.fetch(pathToFileURL(file).toString())
    } catch {
      return new Response('Resource unavailable', { status: 404 })
    }
  })
}
