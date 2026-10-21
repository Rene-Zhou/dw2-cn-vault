import type { APIRoute } from 'astro'
import base from '../styles/obsidian-base.css?raw'
import { config } from '../config.ts'
import { loadAppearance } from '@lib/obsidian-css'

/**
 * One stylesheet in Obsidian's cascade order:
 * base layer → appearance.json variables → community theme → CSS snippets.
 */
export const GET: APIRoute = () => {
  const appearance = loadAppearance(config.vaultDir)
  const css = [base, appearance.variables, appearance.css].filter(Boolean).join('\n\n')
  return new Response(css, { headers: { 'Content-Type': 'text/css; charset=utf-8' } })
}
