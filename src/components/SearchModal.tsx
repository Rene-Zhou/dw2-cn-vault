import { useState, useEffect, useRef, useMemo, useCallback, type ReactNode } from 'react'
import { navigate } from 'astro:transitions/client'
import { OPEN_SEARCH_EVENT } from '@lib/client'
import { searchDocs, type SearchHit, type SearchableDoc as SearchDoc } from '@lib/search'

let indexPromise: Promise<SearchDoc[]> | null = null

function loadIndex(): Promise<SearchDoc[]> {
  indexPromise ??= fetch('/search-index.json')
    .then((r) => (r.ok ? r.json() : []))
    .catch(() => {
      indexPromise = null
      return []
    })
  return indexPromise
}

function highlight(text: string, terms: string[]): ReactNode[] {
  if (terms.length === 0) return [text]
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const re = new RegExp(`(${escaped.join('|')})`, 'gi')
  return text.split(re).map((part, i) =>
    i % 2 === 1 ? <span key={i} className="suggestion-highlight">{part}</span> : part,
  )
}

/** Quick-switcher style search — opens with ⌘K / Ctrl+K or a tag click. */
export function SearchModal() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [docs, setDocs] = useState<SearchDoc[] | null>(null)
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const show = useCallback((initial = '') => {
    setQuery(initial)
    setSelected(0)
    setOpen(true)
    loadIndex().then(setDocs)
  }, [])

  useEffect(() => {
    const onOpen = (e: Event) => show((e as CustomEvent<{ query?: string }>).detail?.query ?? '')
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        show()
      }
    }
    document.addEventListener(OPEN_SEARCH_EVENT, onOpen)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener(OPEN_SEARCH_EVENT, onOpen)
      document.removeEventListener('keydown', onKey)
    }
  }, [show])

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  const { hits, terms } = useMemo<{ hits: SearchHit[]; terms: string[] }>(
    () => (docs ? searchDocs(docs, query) : { hits: [], terms: [] }),
    [docs, query],
  )

  useEffect(() => {
    listRef.current?.querySelector('.is-selected')?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const go = (hit: SearchHit | undefined) => {
    if (!hit) return
    setOpen(false)
    navigate(hit.doc.url)
  }

  if (!open) return null

  return (
    <div className="modal-container mod-dim" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="prompt" role="dialog" aria-label="搜索">
        <div className="prompt-input-container">
          <input
            ref={inputRef}
            className="prompt-input"
            type="search"
            enterKeyHint="go"
            placeholder="搜索笔记、动作、标签…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSelected(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setSelected((s) => Math.min(s + 1, hits.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSelected((s) => Math.max(s - 1, 0))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                go(hits[selected])
              } else if (e.key === 'Escape') {
                setOpen(false)
              }
            }}
          />
        </div>
        <div className="prompt-results" ref={listRef}>
          {docs === null ? (
            <div className="suggestion-empty">加载中…</div>
          ) : query.trim() && hits.length === 0 ? (
            <div className="suggestion-empty">没有找到结果</div>
          ) : (
            hits.map((hit, i) => (
              <div
                key={hit.doc.path}
                className={`suggestion-item mod-complex${i === selected ? ' is-selected' : ''}`}
                onMouseMove={() => setSelected(i)}
                onClick={() => go(hit)}
              >
                <div className="suggestion-content">
                  <div className="suggestion-title">{highlight(hit.doc.title, terms)}</div>
                  {hit.snippet && <div className="suggestion-note">{highlight(hit.snippet, terms)}</div>}
                </div>
                <div className="suggestion-aux">{hit.doc.path.split('/').slice(0, -1).join(' / ')}</div>
              </div>
            ))
          )}
        </div>
        <div className="prompt-instructions">
          <span><kbd>↑↓</kbd> 选择</span>
          <span><kbd>↵</kbd> 打开</span>
          <span><kbd>esc</kbd> 关闭</span>
        </div>
      </div>
    </div>
  )
}
