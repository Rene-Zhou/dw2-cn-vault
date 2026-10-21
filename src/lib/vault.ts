/**
 * Vault index — scans the external Obsidian vault and resolves links the
 * way Obsidian does.
 *
 * Resolution priority for `[[target]]` (most → least specific):
 *   1. Exact vault path:          "05 职业/06 圣武士/圣武士"
 *   2. Path relative to the note:  "动作/圣武士 - 信念誓言"
 *   3. Path suffix / bare name:    "圣武士 - 信念誓言"
 *      (ties prefer the note's own folder, then the shortest path)
 */

import fs from 'node:fs'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'

export interface Note {
  /** Vault-relative path without extension, e.g. "04 动作/动作" */
  path: string
  /** File name without extension */
  name: string
  /** Folder part of `path` ('' for root) */
  dir: string
  slug: string
  url: string
  title: string
  aliases: string[]
  tags: string[]
  cssclasses: string[]
  frontmatter: Record<string, unknown>
  /** Markdown body with frontmatter removed */
  body: string
}

export interface Attachment {
  /** Vault-relative path including extension */
  path: string
  name: string
  url: string
  /** Absolute path on disk (empty for in-memory vaults) */
  file: string
}

export type LinkTarget =
  | { kind: 'note'; note: Note }
  | { kind: 'file'; file: Attachment }

export interface Vault {
  notes: Note[]
  attachments: Attachment[]
  byUrl: Map<string, Note>
  resolve(target: string, fromPath?: string): LinkTarget | null
}

export interface RawFile {
  path: string
  content?: string
  file?: string
}

// ── Slugs ───────────────────────────────────────────────────────────────────

/**
 * Convert a path to a URL-safe slug, segment by segment.
 *   "05 职业/06 圣武士/圣武士 - 信念誓言" → "05-职业/06-圣武士/圣武士-信念誓言"
 */
export function toSlug(name: string): string {
  return name
    .split('/')
    .map((segment) =>
      segment
        .toLowerCase()
        // Drop all apostrophe/quote variants (U+0027, U+2018, U+2019, U+0060, U+00B4)
        .replace(/['‘’`´]/g, '')
        .replace(/[^\p{L}\p{N}_\s-]/gu, ' ') // other special chars → space
        .trim()
        .replace(/\s+/g, '-')             // spaces → dashes
        .replace(/-+/g, '-')              // collapse runs of dashes
        .replace(/^-|-$/g, ''),           // trim leading/trailing dashes
    )
    .join('/')
}

export function encodePath(p: string): string {
  return p.split('/').map(encodeURIComponent).join('/')
}

// ── Frontmatter ─────────────────────────────────────────────────────────────

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/

export function splitFrontmatter(raw: string): { data: Record<string, unknown>; body: string } {
  const m = raw.match(FRONTMATTER_RE)
  if (!m) return { data: {}, body: raw }
  let data: Record<string, unknown> = {}
  try {
    const parsed = parseYaml(m[1])
    if (parsed && typeof parsed === 'object') data = parsed as Record<string, unknown>
  } catch {
    // Obsidian also tolerates broken frontmatter — render the body anyway
  }
  return { data, body: raw.slice(m[0].length) }
}

function toList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean)
  if (typeof value === 'string') return value.split(/[,\s]+/).filter(Boolean)
  return []
}

// ── Scanning ────────────────────────────────────────────────────────────────

const SKIP_EXTENSIONS = new Set(['.base', '.canvas'])

export function isExcluded(relPath: string, exclude: string[]): boolean {
  return exclude.some((prefix) => relPath === prefix || relPath.startsWith(prefix + '/'))
}

export function scanVaultDir(vaultDir: string, exclude: string[] = []): RawFile[] {
  if (!fs.existsSync(vaultDir)) {
    throw new Error(`VAULT_DIR not found: ${vaultDir} — set it in .env (see .env.example)`)
  }

  const files: RawFile[] = []

  function walk(dir: string, rel: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      const relPath = rel ? `${rel}/${entry.name}` : entry.name
      if (isExcluded(relPath, exclude)) continue
      const full = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        walk(full, relPath)
      } else if (entry.isFile() && !SKIP_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        const isNote = entry.name.toLowerCase().endsWith('.md')
        files.push({ path: relPath, file: full, content: isNote ? fs.readFileSync(full, 'utf8') : undefined })
      }
    }
  }

  walk(vaultDir, '')
  return files.sort((a, b) => a.path.localeCompare(b.path))
}

// ── Indexing ────────────────────────────────────────────────────────────────

export function indexVault(files: RawFile[], homeNote?: string): Vault {
  const notes: Note[] = []
  const attachments: Attachment[] = []
  const usedUrls = new Set<string>()

  for (const f of files) {
    if (f.path.toLowerCase().endsWith('.md')) {
      const notePath = f.path.slice(0, -3)
      const name = notePath.split('/').at(-1)!
      const dir = notePath.includes('/') ? notePath.slice(0, notePath.lastIndexOf('/')) : ''
      const { data, body } = splitFrontmatter(f.content ?? '')

      let slug = toSlug(notePath)
      for (let i = 1; usedUrls.has(slug); i++) slug = `${toSlug(notePath)}-${i}`
      usedUrls.add(slug)

      const title = typeof data.title === 'string' && data.title.trim()
        ? data.title.trim()
        : body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? name

      notes.push({
        path: notePath,
        name,
        dir,
        slug,
        url: '/' + slug,
        title,
        aliases: toList(data.aliases),
        tags: toList(data.tags),
        cssclasses: toList(data.cssclasses ?? data.cssClasses ?? data.cssclass),
        frontmatter: data,
        body,
      })
    } else {
      attachments.push({
        path: f.path,
        name: f.path.split('/').at(-1)!,
        url: '/files/' + encodePath(f.path),
        file: f.file ?? '',
      })
    }
  }

  // Lookup tables keyed by lowercase path
  const notesByPath = new Map(notes.map((n) => [n.path.toLowerCase(), n]))
  const filesByPath = new Map(attachments.map((a) => [a.path.toLowerCase(), a]))

  function bySuffix<T extends { path: string }>(items: T[], target: string, fromDir: string): T | null {
    const suffix = '/' + target
    const candidates = items.filter((i) => {
      const p = i.path.toLowerCase()
      return p === target || p.endsWith(suffix)
    })
    if (candidates.length === 0) return null
    const fromLower = fromDir.toLowerCase()
    candidates.sort((a, b) => {
      const aLocal = a.path.toLowerCase().startsWith(fromLower) ? 0 : 1
      const bLocal = b.path.toLowerCase().startsWith(fromLower) ? 0 : 1
      return aLocal - bLocal || a.path.length - b.path.length
    })
    return candidates[0]
  }

  function resolve(rawTarget: string, fromPath = ''): LinkTarget | null {
    const target = rawTarget.trim().replace(/^\/+/, '').toLowerCase()
    if (!target) return null
    const fromDir = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/')) : ''
    const relative = fromDir ? path.posix.normalize(`${fromDir.toLowerCase()}/${target}`) : target

    const noteKey = target.endsWith('.md') ? target.slice(0, -3) : target
    const relNoteKey = relative.endsWith('.md') ? relative.slice(0, -3) : relative

    const note = notesByPath.get(noteKey) ?? notesByPath.get(relNoteKey) ?? bySuffix(notes, noteKey, fromDir)
    if (note) return { kind: 'note', note }

    const file = filesByPath.get(target) ?? filesByPath.get(relative) ?? bySuffix(attachments, target, fromDir)
    if (file) return { kind: 'file', file }

    return null
  }

  const byUrl = new Map(notes.map((n) => [n.url, n]))
  if (homeNote) {
    const home = resolve(homeNote)
    if (home?.kind === 'note') byUrl.set('/', home.note)
  }

  return { notes, attachments, byUrl, resolve }
}
