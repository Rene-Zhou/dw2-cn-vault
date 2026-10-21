/**
 * Read the vault's own appearance settings from `.obsidian/` — the active
 * community theme, enabled CSS snippets, base color scheme and fonts — so the
 * site looks the way the vault looks in Obsidian.
 */

import fs from 'node:fs'
import path from 'node:path'

export interface Appearance {
  /** 'dark' | 'light' | 'system' */
  baseTheme: 'dark' | 'light' | 'system'
  themeName: string | null
  /** Concatenated theme.css + enabled snippets, in Obsidian's load order */
  css: string
  /** Extra CSS variables derived from appearance.json (fonts, accent, size) */
  variables: string
  readableLineLength: boolean
}

function readJson(file: string): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return {}
  }
}

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

export function loadAppearance(vaultDir: string): Appearance {
  const dir = path.join(vaultDir, '.obsidian')
  const appearance = readJson(path.join(dir, 'appearance.json'))
  const app = readJson(path.join(dir, 'app.json'))

  const parts: string[] = []
  const themeName = typeof appearance.cssTheme === 'string' && appearance.cssTheme ? appearance.cssTheme : null
  if (themeName) {
    const css = readText(path.join(dir, 'themes', themeName, 'theme.css'))
    if (css) parts.push(`/* ── theme: ${themeName} ── */\n${css}`)
  }

  const snippets = Array.isArray(appearance.enabledCssSnippets) ? appearance.enabledCssSnippets.map(String) : []
  for (const name of snippets) {
    const css = readText(path.join(dir, 'snippets', `${name}.css`))
    if (css) parts.push(`/* ── snippet: ${name} ── */\n${css}`)
  }

  const vars: string[] = []
  const font = (key: string, cssVar: string) => {
    const value = appearance[key]
    if (typeof value === 'string' && value.trim()) vars.push(`${cssVar}: ${value};`)
  }
  font('textFontFamily', '--font-text-override')
  font('interfaceFontFamily', '--font-interface-override')
  font('monospaceFontFamily', '--font-monospace-override')
  if (typeof appearance.baseFontSize === 'number') vars.push(`--font-text-size: ${appearance.baseFontSize}px;`)
  if (typeof appearance.accentColor === 'string' && /^#[0-9a-f]{6}$/i.test(appearance.accentColor)) {
    const [h, s, l] = hexToHsl(appearance.accentColor)
    vars.push(`--accent-h: ${h}; --accent-s: ${s}%; --accent-l: ${l}%;`)
  }

  const theme = appearance.theme
  const baseTheme = theme === 'moonstone' ? 'light' : theme === 'obsidian' ? 'dark' : 'system'

  return {
    baseTheme,
    themeName,
    css: parts.join('\n\n'),
    variables: vars.length ? `body { ${vars.join(' ')} }` : '',
    readableLineLength: app.readableLineLength !== false,
  }
}

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, Math.round(l * 100)]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [Math.round(h * 60), Math.round(s * 100), Math.round(l * 100)]
}
