import type { APIRoute } from 'astro'
import { getSite } from '@lib/site'
import type { SearchableDoc } from '@lib/search'

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
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/!\[\[[^\]]*\]\]/g, ' ')
        .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
        .replace(/[*_>`|]+/g, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    }
  })

  return new Response(JSON.stringify(docs), { headers: { 'Content-Type': 'application/json' } })
}
