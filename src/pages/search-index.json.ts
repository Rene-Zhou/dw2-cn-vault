import type { APIRoute } from 'astro'
import { getSite } from '@lib/site'
import type { SearchableDoc } from '@lib/search'
import { parseLinkText } from '@lib/markdown'

export const GET: APIRoute = () => {
  const site = getSite()
  const docs: SearchableDoc[] = site.vault.notes.map((note) => {
    const page = site.page(note)
    return {
      title: note.title,
      path: note.path,
      url: note.url,
      aliases: note.aliases,
      headings: page.outline.map((o) => o.text),
      // Own text only — embedded notes are indexed as their own documents
      text: note.body
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/!\[\[[^\]]*\]\]/g, ' ')
        // Link text stays searchable, except links to unpublished notes
        .replace(/\[\[([^\]]*)\]\]/g, (_, inner: string) => {
          const link = parseLinkText(inner)
          if (site.vault.resolve(link.target, note.path)?.kind === 'excluded') return ' '
          return link.alias ?? link.target
        })
        .replace(/[*_>`|]+/g, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    }
  })

  return new Response(JSON.stringify(docs), { headers: { 'Content-Type': 'application/json' } })
}
