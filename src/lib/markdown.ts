/**
 * Markdown → HTML renderer that reproduces Obsidian's reading-view DOM.
 *
 * Output mirrors the class names Obsidian uses (`internal-link`,
 * `internal-embed markdown-embed`, `callout`, `tag` …) so vault themes and
 * CSS snippets apply unchanged.
 *
 * Handles:
 *   [[Link]] / [[Link|Alias]] / [[Link#Heading]]  → a.internal-link
 *   ![[Note]] / ![[Note#Heading]]                  → div.internal-embed.markdown-embed (recursive)
 *   ![[image.png|300]]                             → span.internal-embed.image-embed
 *   #tag                                           → a.tag
 *   > [!type]± Title                               → div.callout
 */

import type { Root, RootContent, PhrasingContent, Paragraph, Text, Html, Blockquote } from 'mdast'
import type { Root as HastRoot, Element } from 'hast'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkCjkFriendly from 'remark-cjk-friendly'
import remarkRehype from 'remark-rehype'
import rehypeRaw from 'rehype-raw'
import rehypeStringify from 'rehype-stringify'
import { visit, SKIP } from 'unist-util-visit'
import { toString as hastToString } from 'hast-util-to-string'
import type { Note, Vault } from './vault.ts'
import { calloutIcon, EMBED_LINK_ICON } from './icons.ts'

// ── Helpers ─────────────────────────────────────────────────────────────────

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Obsidian ignores these characters when matching `[[note#heading]]`. */
export function normalizeHeading(text: string): string {
  return text.replace(/[#|^\\:%[\]]/g, ' ').replace(/\s+/g, ' ').trim()
}

export function headingId(text: string): string {
  return normalizeHeading(text).replace(/ /g, '-')
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i
const PDF_EXT = /\.pdf$/i

export interface ParsedLink {
  target: string
  heading?: string
  alias?: string
}

/** Split the inside of `[[…]]` into target, heading and alias. */
export function parseLinkText(inner: string): ParsedLink {
  const unescaped = inner.replace(/\\\|/g, '|')
  const pipe = unescaped.indexOf('|')
  const ref = pipe >= 0 ? unescaped.slice(0, pipe) : unescaped
  const alias = pipe >= 0 ? unescaped.slice(pipe + 1).trim() : undefined
  const hash = ref.indexOf('#')
  const target = (hash >= 0 ? ref.slice(0, hash) : ref).trim()
  const heading = hash >= 0 ? ref.slice(hash + 1).replace(/^\^/, '').trim() || undefined : undefined
  return { target, heading, alias: alias || undefined }
}

/** Return the markdown of one heading's section (heading included). */
export function extractSection(body: string, heading: string): string | null {
  const want = normalizeHeading(heading).toLowerCase()
  const lines = body.split(/\r?\n/)
  let start = -1
  let level = 0
  let fence = false

  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) fence = !fence
    if (fence) continue
    const m = lines[i].match(/^(#{1,6})\s+(.*?)\s*#*\s*$/)
    if (!m) continue
    if (start < 0) {
      if (normalizeHeading(m[2]).toLowerCase() === want) {
        start = i
        level = m[1].length
      }
    } else if (m[1].length <= level) {
      return lines.slice(start, i).join('\n')
    }
  }

  return start < 0 ? null : lines.slice(start).join('\n')
}

function hashString(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

// ── Renderer ────────────────────────────────────────────────────────────────

export interface RenderedNote {
  html: string
  /** Paths of notes this note links to or embeds */
  links: Set<string>
  /** True when a circular embed was cut short (result depends on the host) */
  cyclic?: boolean
}

const TOKEN_RE = /(!?)\[\[([^\]\n]+?)\]\]|(^|\s)#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/gu
const EMBED_PLACEHOLDER_RE = /<!--obsidian-embed-(\d+)-->/g
const MAX_EMBED_DEPTH = 8

export function createRenderer(vault: Vault) {
  const cache = new Map<string, RenderedNote>()

  let cyclicFlag = false
  const markCyclic = () => { cyclicFlag = true }

  function renderNote(note: Note): RenderedNote {
    const cached = cache.get(note.path)
    if (cached) return cached
    const result = renderMarkdown(note.body, note, [note.path])
    cache.set(note.path, result)
    return result
  }

  function renderMarkdown(markdown: string, note: Note, stack: string[]): RenderedNote {
    const links = new Set<string>()
    const embeds: string[] = []
    const outerCyclic = cyclicFlag
    cyclicFlag = false

    const embed = (link: ParsedLink, raw: string): string => {
      embeds.push(renderEmbed(link, raw, note, stack, links))
      return `<!--obsidian-embed-${embeds.length - 1}-->`
    }

    const processor = unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkCjkFriendly)
      .use(remarkObsidian, { vault, note, links, embed })
      .use(remarkRehype, { allowDangerousHtml: true, clobberPrefix: `fn-${hashString(note.path)}-`, footnoteLabel: '脚注', footnoteBackLabel: '返回正文' })
      .use(rehypeRaw)
      .use(rehypeObsidian)
      .use(rehypeStringify, { allowDangerousHtml: true })

    const html = String(processor.processSync(markdown))
      .replace(EMBED_PLACEHOLDER_RE, (_, i) => embeds[Number(i)] ?? '')

    const cyclic = cyclicFlag
    cyclicFlag = outerCyclic || cyclic
    return { html, links, cyclic }
  }

  function renderEmbed(link: ParsedLink, raw: string, from: Note, stack: string[], links: Set<string>): string {
    const resolved = vault.resolve(link.target, from.path)
    const src = escapeHtml(raw)
    const alt = link.alias ? ` alt="${escapeHtml(link.alias)}"` : ''

    if (!resolved) {
      return `<div class="internal-embed file-embed mod-empty is-unresolved" src="${src}"${alt}><div class="file-embed-title">“${escapeHtml(link.target)}” 尚未创建</div></div>`
    }

    if (resolved.kind === 'file') {
      const { file } = resolved
      if (IMAGE_EXT.test(file.name)) {
        const size = link.alias?.match(/^(\d+)(?:x(\d+))?$/)
        const dims = size ? ` width="${size[1]}"${size[2] ? ` height="${size[2]}"` : ''}` : ''
        const imgAlt = size ? file.name : (link.alias ?? file.name)
        return `<span class="internal-embed media-embed image-embed is-loaded" src="${src}"${alt}><img src="${file.url}" alt="${escapeHtml(imgAlt)}"${dims} loading="lazy"></span>`
      }
      if (PDF_EXT.test(file.name)) {
        return `<div class="internal-embed pdf-embed is-loaded" src="${src}"${alt}><iframe src="${file.url}" title="${escapeHtml(file.name)}" loading="lazy"></iframe></div>`
      }
      return `<div class="internal-embed file-embed is-loaded" src="${src}"${alt}><a class="file-embed-title" href="${file.url}" target="_blank" rel="noopener">${escapeHtml(file.name)}</a></div>`
    }

    const target = resolved.note
    links.add(target.path)
    const href = target.url + (link.heading ? '#' + encodeURIComponent(headingId(link.heading)) : '')
    const wrap = (content: string) =>
      `<div class="internal-embed markdown-embed inline-embed is-loaded" tabindex="-1" src="${src}"${alt} data-href="${escapeHtml(href)}">` +
      `<div class="embed-title markdown-embed-title"></div>` +
      `<div class="markdown-embed-content"><div class="markdown-preview-view markdown-rendered show-indentation-guide">` +
      `<div class="markdown-preview-sizer markdown-preview-section">${content}</div></div></div>` +
      `<a class="markdown-embed-link" href="${escapeHtml(href)}" aria-label="打开链接">${EMBED_LINK_ICON}</a></div>`

    if (stack.includes(target.path) || stack.length > MAX_EMBED_DEPTH) {
      markCyclic()
      return wrap(`<p class="embed-error">无法嵌入：检测到循环嵌入 “${escapeHtml(link.target)}”</p>`)
    }

    if (link.heading) {
      const section = extractSection(target.body, link.heading)
      if (section === null) return wrap(`<p class="embed-error">找不到标题 “${escapeHtml(link.heading)}”</p>`)
      return wrap(renderMarkdown(section, target, [...stack, target.path]).html)
    }

    // Whole-note embeds render the same regardless of host — reuse the cache
    const rendered = cache.get(target.path) ?? renderMarkdown(target.body, target, [...stack, target.path])
    if (!rendered.cyclic) cache.set(target.path, rendered)
    else markCyclic()
    return wrap(rendered.html)
  }

  return { renderNote }
}

// ── Remark plugin ───────────────────────────────────────────────────────────

interface ObsidianOptions {
  vault: Vault
  note: Note
  links: Set<string>
  embed: (link: ParsedLink, raw: string) => string
}

function remarkObsidian(options: ObsidianOptions) {
  const { vault, note, links, embed } = options

  function wikilink(link: ParsedLink): Html {
    const display = link.alias ?? (link.heading ? `${link.target || note.title} > ${link.heading}` : link.target)
    const dataHref = escapeHtml(link.target + (link.heading ? '#' + link.heading : ''))
    const anchor = link.heading ? '#' + encodeURIComponent(headingId(link.heading)) : ''

    // [[#Heading]] — link within the same note
    if (!link.target && link.heading) {
      return { type: 'html', value: `<a data-href="${dataHref}" href="${anchor}" class="internal-link">${escapeHtml(display)}</a>` }
    }

    const resolved = vault.resolve(link.target, note.path)
    if (!resolved) {
      return { type: 'html', value: `<a data-href="${dataHref}" class="internal-link is-unresolved" title="尚未创建">${escapeHtml(display)}</a>` }
    }
    if (resolved.kind === 'file') {
      return { type: 'html', value: `<a data-href="${dataHref}" href="${resolved.file.url}" class="internal-link" data-file target="_blank" rel="noopener">${escapeHtml(display)}</a>` }
    }
    links.add(resolved.note.path)
    return { type: 'html', value: `<a data-href="${dataHref}" href="${escapeHtml(resolved.note.url + anchor)}" class="internal-link">${escapeHtml(display)}</a>` }
  }

  function splitText(value: string): PhrasingContent[] | null {
    // matchAll clones the regex — embeds render recursively and reuse TOKEN_RE
    const matches = [...value.matchAll(TOKEN_RE)]
    if (matches.length === 0) return null

    const out: PhrasingContent[] = []
    let last = 0

    for (const m of matches) {
      const [full, bang, inner, lead, tag] = m
      const start = m.index + (lead?.length ?? 0)
      if (start > last) out.push({ type: 'text', value: value.slice(last, start) })

      if (inner !== undefined) {
        const link = parseLinkText(inner)
        if (bang) {
          out.push({ type: 'html', value: embed(link, inner.replace(/\\\|/g, '|')), data: { embed: true } } as Html)
        } else {
          out.push(wikilink(link))
        }
      } else {
        out.push({ type: 'html', value: `<a href="#${escapeHtml(tag)}" class="tag" data-tag="${escapeHtml(tag)}">#${escapeHtml(tag)}</a>` })
      }
      last = m.index + full.length
    }

    if (last < value.length) out.push({ type: 'text', value: value.slice(last) })
    return out
  }

  return (tree: Root) => {
    // 1. Callouts
    visit(tree, 'blockquote', (node: Blockquote) => {
      transformCallout(node)
    })

    // 2. Wikilinks, embeds, tags inside text
    visit(tree, 'text', (node: Text, index, parent) => {
      if (!parent || index === undefined) return
      if (parent.type === 'link' || parent.type === 'linkReference') return
      const replaced = splitText(node.value)
      if (!replaced) return
      ;(parent.children as RootContent[]).splice(index, 1, ...replaced)
      return [SKIP, index + replaced.length]
    })

    // 3. A paragraph holding only embeds becomes block-level embeds
    visit(tree, 'paragraph', (node: Paragraph, index, parent) => {
      if (!parent || index === undefined) return
      const meaningful = node.children.filter((c) => !(c.type === 'text' && !c.value.trim()) && c.type !== 'break')
      if (meaningful.length === 0 || !meaningful.every((c) => c.type === 'html' && (c.data as { embed?: boolean } | undefined)?.embed)) return
      ;(parent.children as RootContent[]).splice(index, 1, ...meaningful)
      return [SKIP, index + meaningful.length]
    })
  }
}

const CALLOUT_RE = /^\[!([^\]\s]+)\]([+-]?)[ \t]*/

function transformCallout(node: Blockquote) {
  const first = node.children[0]
  if (first?.type !== 'paragraph') return
  const head = first.children[0]
  if (head?.type !== 'text') return
  const m = head.value.match(CALLOUT_RE)
  if (!m) return

  const type = m[1].toLowerCase()
  const fold = m[2]
  head.value = head.value.slice(m[0].length)

  // Title is everything on the first line; the rest of the paragraph is content
  const titleNodes: PhrasingContent[] = []
  const restNodes: PhrasingContent[] = []
  let inTitle = true
  for (const child of first.children) {
    if (!inTitle) {
      restNodes.push(child)
      continue
    }
    if (child.type === 'text' && child.value.includes('\n')) {
      const nl = child.value.indexOf('\n')
      if (nl > 0) titleNodes.push({ type: 'text', value: child.value.slice(0, nl) })
      const after = child.value.slice(nl + 1)
      if (after) restNodes.push({ type: 'text', value: after })
      inTitle = false
    } else if (child.type === 'break') {
      inTitle = false
    } else {
      titleNodes.push(child)
    }
  }

  const hasTitle = titleNodes.some((n) => n.type !== 'text' || n.value.trim())
  const title: PhrasingContent[] = hasTitle
    ? titleNodes
    : [{ type: 'text', value: type.charAt(0).toUpperCase() + type.slice(1) }]

  const contentChildren = [
    ...(restNodes.length ? [{ type: 'paragraph', children: restNodes } as Paragraph] : []),
    ...node.children.slice(1),
  ]

  const classes = ['callout']
  if (fold) classes.push('is-collapsible')
  if (fold === '-') classes.push('is-collapsed')

  node.data = {
    hName: 'div',
    hProperties: { className: classes, dataCallout: type, dataCalloutFold: fold || undefined, dataCalloutMetadata: '' },
  }
  node.children = [
    {
      type: 'calloutTitle',
      data: { hName: 'div', hProperties: { className: ['callout-title'], dir: 'auto' } },
      children: [
        { type: 'html', value: `<div class="callout-icon">${calloutIcon(type)}</div>` },
        { type: 'calloutTitleInner', data: { hName: 'div', hProperties: { className: ['callout-title-inner'] } }, children: title },
        ...(fold ? [{ type: 'html', value: '<div class="callout-fold"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-chevron-down"><path d="m6 9 6 6 6-6"/></svg></div>' }] : []),
      ],
    },
    ...(contentChildren.length
      ? [{ type: 'calloutContent', data: { hName: 'div', hProperties: { className: ['callout-content'] } }, children: contentChildren }]
      : []),
  ] as unknown as Blockquote['children']
}

// ── Rehype plugin ───────────────────────────────────────────────────────────

function rehypeObsidian() {
  return (tree: HastRoot) => {
    visit(tree, 'element', (node: Element, index, parent) => {
      if (node.tagName === 'table' && parent && index !== undefined) {
        parent.children[index] = { type: 'element', tagName: 'div', properties: { className: ['table-wrapper'] }, children: [node] }
        return
      }
      if (/^h[1-6]$/.test(node.tagName)) {
        const text = hastToString(node)
        node.properties.id = headingId(text)
        node.properties.dataHeading = text
        return
      }
      if (node.tagName === 'a') {
        const href = String(node.properties.href ?? '')
        if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !String(node.properties.className ?? '').includes('internal-link')) {
          node.properties.className = ['external-link']
          node.properties.target = '_blank'
          node.properties.rel = ['noopener', 'nofollow']
        }
        return
      }
      if (node.tagName === 'input' && node.properties.type === 'checkbox') {
        node.properties.className = ['task-list-item-checkbox']
      }
    })
  }
}
