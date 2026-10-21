import type { APIRoute } from 'astro'
import { getSite } from '@lib/site'

/** Hover-preview payload for every note: `/previews/<slug>.json`. */
export function getStaticPaths() {
  return getSite().vault.notes.map((note) => ({ params: { slug: note.slug }, props: { path: note.path } }))
}

export const GET: APIRoute = ({ props }) => {
  const site = getSite()
  const note = site.vault.notes.find((n) => n.path === props.path)!
  const page = site.page(note)

  return new Response(
    JSON.stringify({ title: note.title, url: note.url, cssclasses: note.cssclasses, html: page.html }),
    { headers: { 'Content-Type': 'application/json' } },
  )
}
