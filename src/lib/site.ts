/**
 * Build-time site model: vault index + rendered pages + backlinks.
 *
 * Cached on `globalThis` so the Astro config, integrations and every route
 * share one instance; `invalidateSite()` drops it when the vault changes
 * during `astro dev`.
 */

import type { Element, Root as HastRoot } from 'hast'
import { unified } from 'unified'
import rehypeParse from 'rehype-parse'
import rehypeStringify from 'rehype-stringify'
import { visit, SKIP } from 'unist-util-visit'
import { toString as hastToString } from 'hast-util-to-string'
import { config } from '../config.ts'
import { indexVault, scanVaultDir, type Note, type Vault } from './vault.ts'
import { createRenderer } from './markdown.ts'

export interface OutlineItem {
  level: number
  text: string
  id: string
}

export interface OutlineNode extends OutlineItem {
  children: OutlineNode[]
}

/** Nest a flat heading list by level, like Obsidian's outline pane. */
export function nestOutline(items: OutlineItem[]): OutlineNode[] {
  const root: OutlineNode[] = []
  const stack: OutlineNode[] = []
  for (const item of items) {
    const node: OutlineNode = { ...item, children: [] }
    while (stack.length && stack.at(-1)!.level >= item.level) stack.pop()
    ;(stack.at(-1)?.children ?? root).push(node)
    stack.push(node)
  }
  return root
}

export interface Page {
  note: Note
  html: string
  outline: OutlineItem[]
  /** Plain text for the search index */
  text: string
}

export interface Site {
  vault: Vault
  page(note: Note): Page
  backlinks(note: Note): Note[]
}

const KEY = Symbol.for('dw2-vault-site')
type GlobalWithSite = typeof globalThis & { [KEY]?: Site }

export function getSite(): Site {
  const g = globalThis as GlobalWithSite
  return (g[KEY] ??= buildSite(indexVault(scanVaultDir(config.vaultDir, config.exclude), config.homeNote)))
}

export function invalidateSite() {
  delete (globalThis as GlobalWithSite)[KEY]
}

export function buildSite(vault: Vault): Site {
  const renderer = createRenderer(vault)
  const pages = new Map<string, Page>()

  const backlinkIndex = new Map<string, Note[]>()
  for (const note of vault.notes) {
    for (const target of renderer.renderNote(note).links) {
      if (target === note.path) continue
      const list = backlinkIndex.get(target) ?? []
      list.push(note)
      backlinkIndex.set(target, list)
    }
  }

  return {
    vault,
    page(note) {
      let page = pages.get(note.path)
      if (!page) {
        page = composePage(note, renderer.renderNote(note).html)
        pages.set(note.path, page)
      }
      return page
    },
    backlinks(note) {
      return (backlinkIndex.get(note.path) ?? []).slice().sort((a, b) => a.path.localeCompare(b.path))
    },
  }
}

/**
 * Final pass over a note's HTML (embeds included): make heading ids unique
 * and collect the outline — the note's own headings plus the title of each
 * directly embedded note.
 */
export function composePage(note: Note, html: string): Page {
  const tree = unified().use(rehypeParse, { fragment: true }).parse(html) as HastRoot
  const seen = new Map<string, number>()
  const outline: OutlineItem[] = []
  let lastOwnLevel = 1

  function walk(node: HastRoot | Element, embedDepth: number) {
    visit(node, 'element', (el: Element) => {
      if (el === node) return
      const classes = Array.isArray(el.properties.className) ? el.properties.className : []
      if (classes.includes('markdown-embed')) {
        walk(el, embedDepth + 1)
        return SKIP
      }
      if (!/^h[1-6]$/.test(el.tagName)) return

      const base = String(el.properties.id ?? '')
      const n = seen.get(base) ?? 0
      seen.set(base, n + 1)
      const id = n === 0 ? base : `${base}-${n}`
      el.properties.id = id

      const level = Number(el.tagName[1])
      const text = hastToString(el).trim()
      if (embedDepth === 0) {
        lastOwnLevel = level
        outline.push({ level, text, id })
      } else if (embedDepth === 1 && level === 1) {
        outline.push({ level: Math.min(lastOwnLevel + 1, 6), text, id })
      }
    })
  }

  walk(tree, 0)

  const text = hastToString(tree).replace(/\s+/g, ' ').trim()
  return { note, html: unified().use(rehypeStringify).stringify(tree), outline, text }
}
