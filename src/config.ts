/**
 * Site configuration — everything is read from the environment so the
 * Obsidian vault stays outside this repository and can be swapped or
 * updated without touching code. See `.env.example`.
 */

import fs from 'node:fs'
import path from 'node:path'

function loadDotEnv(file: string) {
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!m || process.env[m[1]] !== undefined) continue
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
  }
}

loadDotEnv(path.join(process.cwd(), '.env'))

export interface SiteConfig {
  /** Absolute path of the Obsidian vault */
  vaultDir: string
  /** Vault-relative note path (no extension) rendered at `/` */
  homeNote: string
  title: string
  url: string
  /** Vault-relative path prefixes that are never published */
  exclude: string[]
}

export const config: SiteConfig = {
  vaultDir: path.resolve(process.env.VAULT_DIR ?? 'vault'),
  homeNote: process.env.HOME_NOTE ?? '开始阅读',
  title: process.env.SITE_TITLE ?? '地城世界2 中文规则库',
  url: process.env.SITE_URL ?? 'http://localhost:4321',
  exclude: (process.env.EXCLUDE ?? '')
    .split(',')
    .map((s) => s.trim().replace(/^\/+|\/+$/g, ''))
    .filter(Boolean),
}
