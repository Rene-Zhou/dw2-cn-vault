import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AstroIntegration } from 'astro'
import { config } from '../config.ts'
import { getSite, invalidateSite } from './site.ts'

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

/**
 * Serves vault attachments under `/files/` in dev, copies them into the build
 * output, and live-reloads the browser when the vault changes.
 */
export function vaultIntegration(): AstroIntegration {
  return {
    name: 'obsidian-vault',
    hooks: {
      'astro:config:setup': ({ updateConfig, logger }) => {
        logger.info(`vault: ${config.vaultDir}`)
        updateConfig({
          vite: {
            plugins: [{
              name: 'obsidian-vault-dev',
              configureServer(server) {
                server.middlewares.use((req, res, next) => {
                  if (!req.url?.startsWith('/files/')) return next()
                  const rel = decodeURIComponent(req.url.slice('/files/'.length).split('?')[0])
                  const file = getSite().vault.attachments.find((a) => a.path === rel)
                  if (!file) return next()
                  res.setHeader('Content-Type', MIME[path.extname(file.name).toLowerCase()] ?? 'application/octet-stream')
                  fs.createReadStream(file.file).pipe(res)
                })

                server.watcher.add(config.vaultDir)
                let timer: ReturnType<typeof setTimeout> | undefined
                const onChange = (file: string) => {
                  if (!file.startsWith(config.vaultDir) || file.includes(`${path.sep}.obsidian${path.sep}workspace`)) return
                  clearTimeout(timer)
                  timer = setTimeout(() => {
                    invalidateSite()
                    server.ws.send({ type: 'full-reload' })
                  }, 150)
                }
                server.watcher.on('change', onChange)
                server.watcher.on('add', onChange)
                server.watcher.on('unlink', onChange)
              },
            }],
          },
        })
      },
      'astro:build:done': ({ dir, logger }) => {
        const outDir = fileURLToPath(dir)
        const { attachments } = getSite().vault
        for (const file of attachments) {
          const dest = path.join(outDir, 'files', ...file.path.split('/'))
          fs.mkdirSync(path.dirname(dest), { recursive: true })
          fs.copyFileSync(file.file, dest)
        }
        logger.info(`copied ${attachments.length} attachments to files/`)
      },
    },
  }
}
