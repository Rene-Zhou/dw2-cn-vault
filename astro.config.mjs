// @ts-check
import { defineConfig } from 'astro/config'
import react from '@astrojs/react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { config } from './src/config.ts'
import { vaultIntegration } from './src/lib/vault-integration.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  site: config.url,
  trailingSlash: 'never',
  build: {
    // "/04-动作/动作" → 04-动作/动作.html — no folder/file name clashes
    format: 'file',
  },
  integrations: [react(), vaultIntegration()],
  vite: {
    resolve: {
      alias: {
        '@lib': path.join(__dirname, 'src/lib'),
        '@components': path.join(__dirname, 'src/components'),
        '@layouts': path.join(__dirname, 'src/layouts'),
      },
    },
    server: {
      fs: { allow: [__dirname, config.vaultDir] },
    },
  },
})
