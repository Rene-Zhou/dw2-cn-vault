export interface SearchableDoc {
  title: string
  path: string
  url: string
  aliases: string[]
  headings: string[]
  text: string
}

export interface SearchHit<T extends SearchableDoc = SearchableDoc> {
  doc: T
  score: number
  snippet: string
}

const MAX_RESULTS = 50
const SNIPPET_RADIUS = 36

/**
 * Substring search — every whitespace-separated term must match somewhere.
 * Plain substring matching suits Chinese text, which has no word breaks.
 * With an empty query, returns the first notes in vault order.
 */
export function searchDocs<T extends SearchableDoc>(docs: T[], query: string): { hits: SearchHit<T>[]; terms: string[] } {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) {
    return { hits: docs.slice(0, MAX_RESULTS).map((doc) => ({ doc, score: 0, snippet: '' })), terms }
  }

  const hits: SearchHit<T>[] = []

  for (const doc of docs) {
    const title = doc.title.toLowerCase()
    const aliases = doc.aliases.map((a) => a.toLowerCase())
    const path = doc.path.toLowerCase()
    const headings = doc.headings.map((h) => h.toLowerCase())
    const text = doc.text.toLowerCase()

    let score = 0
    let matchedAll = true
    for (const term of terms) {
      let s = 0
      if (title === term) s += 20
      else if (title.startsWith(term)) s += 14
      else if (title.includes(term)) s += 10
      if (aliases.some((a) => a.includes(term))) s += 8
      if (path.includes(term)) s += 3
      if (headings.some((h) => h.includes(term))) s += 3
      if (text.includes(term)) s += 1
      if (s === 0) {
        matchedAll = false
        break
      }
      score += s
    }
    if (!matchedAll) continue

    hits.push({ doc, score, snippet: makeSnippet(doc.text, text, terms) })
  }

  hits.sort((a, b) => b.score - a.score || a.doc.path.length - b.doc.path.length)
  return { hits: hits.slice(0, MAX_RESULTS), terms }
}

function makeSnippet(original: string, lower: string, terms: string[]): string {
  for (const term of terms) {
    const at = lower.indexOf(term)
    if (at < 0) continue
    const start = Math.max(0, at - SNIPPET_RADIUS)
    const end = Math.min(original.length, at + term.length + SNIPPET_RADIUS)
    return (start > 0 ? '…' : '') + original.slice(start, end) + (end < original.length ? '…' : '')
  }
  return ''
}
