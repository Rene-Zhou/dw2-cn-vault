import { defineConfig } from 'vitest/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@lib': path.join(__dirname, 'src/lib'),
      '@components': path.join(__dirname, 'src/components'),
      '@layouts': path.join(__dirname, 'src/layouts'),
    },
  },
  test: {
    environment: 'node',
    globals: false,
  },
})
