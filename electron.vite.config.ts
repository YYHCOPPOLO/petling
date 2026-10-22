import { join, resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import { normalizePath } from 'vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import { AssetCatalog } from './src/main/assets'
import { hidpiSvg } from './src/main/hidpi'
import pkg from './package.json'

const resourceDirectory = resolve('resources')
const definitions = {
  __APP_VERSION__: JSON.stringify(pkg.version),
  __UPDATE_API__: JSON.stringify(process.env.AGENT_PET_UPDATE_API ?? ''),
}

export default defineConfig({
  main: {
    define: definitions,
    build: { rollupOptions: { input: { index: resolve('src/main/index.ts'), 'companion-worker': resolve('src/main/companion-worker.ts') } } },
  },
  preload: {
    build: { rollupOptions: { input: resolve('src/preload/index.ts'), output: { format: 'cjs', entryFileNames: '[name].cjs' } } },
  },
  renderer: {
    define: definitions,
    root: 'src/renderer',
    publicDir: resourceDirectory,
    build: {
      target: 'chrome144',
      cssTarget: 'chrome144',
      copyPublicDir: false,
      rollupOptions: { input: { index: resolve('src/renderer/index.html') } },
    },
    plugins: [
      {
        name: 'desktop-assets',
        configureServer(server) {
          const catalog = new AssetCatalog(resourceDirectory)
          catalog.checkOverrides()
          server.middlewares.use((req, res, next) => {
            try {
              const [raw, query] = (req.url ?? '').split('?')
              const asked = decodeURIComponent(raw)
              if (!asked.startsWith('/pet/')) return next()
              const logical = asked
              const file = catalog.resolve(logical)
              const svg = req.headers['x-hd'] && req.headers.accept?.includes('image/svg+xml') && hidpiSvg(file)
              if (svg) {
                res.setHeader('Content-Type', 'image/svg+xml')
                res.end(svg)
                return
              }
              req.url = encodeURI(catalog.publicPath(logical)) + (query === undefined ? '' : '?' + query)
              next()
            } catch {
              res.statusCode = 400
              res.end('Invalid resource path')
            }
          })
        },
        generateBundle() {
          this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: pkg.version }) })
        },
      },
      viteStaticCopy({ targets: [{ src: normalizePath(join(resolve('node_modules/@ruffle-rs/ruffle'), '*')), dest: 'ruffle', rename: { stripBase: true } }] }),
    ],
  },
})
