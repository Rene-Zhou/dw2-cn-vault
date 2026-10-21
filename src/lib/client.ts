/**
 * Browser-side behaviour for the site shell. Runs once; everything is
 * delegated on `document` so it survives Astro view-transition swaps.
 */

const THEME_KEY = 'dw2-theme'
const TREE_KEY = 'dw2-file-tree'

export const OPEN_SEARCH_EVENT = 'dw2:open-search'

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function storageSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // private mode — preferences just won't persist
  }
}

function prefersDark(): boolean {
  const pref = storageGet(THEME_KEY)
  if (pref) return pref === 'dark'
  const base = document.body.dataset.baseTheme
  if (base === 'system') return matchMedia('(prefers-color-scheme: dark)').matches
  return base !== 'light'
}

function applyTheme(dark = prefersDark()) {
  document.body.classList.toggle('theme-dark', dark)
  document.body.classList.toggle('theme-light', !dark)
}

function openSearch(query = '') {
  document.dispatchEvent(new CustomEvent(OPEN_SEARCH_EVENT, { detail: { query } }))
}

// ── File tree ───────────────────────────────────────────────────────────────

function loadTreeState(): Record<string, boolean> {
  try {
    return JSON.parse(storageGet(TREE_KEY) || '{}')
  } catch {
    return {}
  }
}

function setCollapsed(folder: Element, collapsed: boolean) {
  folder.classList.toggle('ft-collapsed', collapsed)
  folder.querySelector(':scope > .ft-row > .ft-toggle')?.setAttribute('aria-expanded', String(!collapsed))
}

function syncFileTree() {
  const nav = document.querySelector('.file-tree')
  if (!nav) return
  const current = decodeURI(location.pathname)
  const saved = loadTreeState()

  nav.querySelectorAll<HTMLElement>('.ft-folder').forEach((folder) => {
    const key = folder.dataset.key
    if (key && saved[key] !== undefined) setCollapsed(folder, saved[key])
  })

  let active: HTMLElement | null = null
  nav.querySelectorAll<HTMLAnchorElement>('a.ft-link').forEach((link) => {
    const isActive = link.getAttribute('href') === current
    link.classList.toggle('ft-active', isActive)
    if (isActive) active = link
  })

  // Reveal the current note
  if (active) {
    let folder = (active as HTMLElement).closest('.ft-folder')
    // A folder note's link sits in the folder's own row — start above it
    if (folder && (active as HTMLElement).parentElement?.parentElement === folder) folder = folder.parentElement?.closest('.ft-folder') ?? null
    while (folder) {
      setCollapsed(folder, false)
      folder = folder.parentElement?.closest('.ft-folder') ?? null
    }
    const row = (active as HTMLElement).closest('.ft-row') as HTMLElement
    const scroller = nav.closest('.sidebar-scroll') as HTMLElement | null
    if (scroller && row) {
      const r = row.getBoundingClientRect()
      const s = scroller.getBoundingClientRect()
      if (r.top < s.top || r.bottom > s.bottom) row.scrollIntoView({ block: 'center' })
    }
  }

  nav.classList.add('file-tree--ready')
}

function onTreeClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  const toggle = target.closest('.ft-toggle, .ft-label')
  if (!toggle) return
  const folder = toggle.closest('.ft-folder') as HTMLElement | null
  if (!folder) return
  e.preventDefault()
  const collapsed = !folder.classList.contains('ft-collapsed')
  setCollapsed(folder, collapsed)
  const key = folder.dataset.key
  if (key) {
    const state = loadTreeState()
    state[key] = collapsed
    storageSet(TREE_KEY, JSON.stringify(state))
  }
}

// ── Init ────────────────────────────────────────────────────────────────────

export function initApp() {
  applyTheme()

  document.addEventListener('astro:after-swap', () => applyTheme())
  document.addEventListener('astro:page-load', () => {
    document.body.classList.remove('is-left-sidebar-open')
    syncFileTree()
  })

  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (!storageGet(THEME_KEY)) applyTheme()
  })

  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement

    if (target.closest('.file-tree')) onTreeClick(e)

    if (target.closest('[data-toggle-theme]')) {
      const dark = !document.body.classList.contains('theme-dark')
      storageSet(THEME_KEY, dark ? 'dark' : 'light')
      applyTheme(dark)
      return
    }

    if (target.closest('[data-toggle-sidebar]')) {
      document.body.classList.toggle('is-left-sidebar-open')
      return
    }

    if (target.closest('[data-close-sidebar]')) {
      document.body.classList.remove('is-left-sidebar-open')
      return
    }

    if (target.closest('[data-open-search]')) {
      openSearch()
      return
    }

    const tag = target.closest('a.tag') as HTMLAnchorElement | null
    if (tag) {
      e.preventDefault()
      openSearch('#' + (tag.dataset.tag ?? tag.textContent?.replace(/^#/, '') ?? ''))
      return
    }

    const calloutTitle = target.closest('.callout.is-collapsible > .callout-title')
    if (calloutTitle) {
      calloutTitle.parentElement?.classList.toggle('is-collapsed')
      return
    }

    if (target.closest('a.internal-link.is-unresolved')) e.preventDefault()
  })
}
