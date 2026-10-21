import { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react'
import {
  useFloating,
  offset,
  flip,
  shift,
  autoUpdate,
  FloatingPortal,
  type VirtualElement,
} from '@floating-ui/react'
import { Rnd } from 'react-rnd'
import {
  type PinnedWindowData,
  clampToViewport,
  savePinnedToStorage,
  loadPinnedFromStorage,
} from '@lib/pinned-persistence'

interface Preview {
  title: string
  url: string
  cssclasses: string[]
  html: string
}

type HoverReference = HTMLAnchorElement | VirtualElement

interface HoverCardState {
  id: string
  /** Pathname of the previewed note */
  path: string
  /** Decoded heading anchor to scroll to, if any */
  hash: string
  preview: Preview | null
  loading: boolean
  reference: HoverReference
  level: number
}

interface PinnedWindow {
  id: string
  preview: Preview | null
  href?: string
  x: number
  y: number
  w: number
  h: number
  /** Stacking z-index — bumped whenever this window is focused */
  z: number
}

const LINK_SELECTOR = 'a.internal-link:not(.is-unresolved):not([data-file])'
const SHOW_DELAY = 300
const HIDE_DELAY = 250

// ── Shared fetch cache ────────────────────────────────────────────────────────

const previewCache = new Map<string, Preview>()

async function fetchPreview(path: string): Promise<Preview | null> {
  if (previewCache.has(path)) return previewCache.get(path)!
  try {
    const res = await fetch(`/previews${path}.json`)
    if (!res.ok) return null
    const data = (await res.json()) as Preview
    previewCache.set(path, data)
    return data
  } catch {
    return null
  }
}

function linkTarget(link: HTMLAnchorElement): { path: string; hash: string } | null {
  const raw = link.getAttribute('href')
  if (!raw || raw.startsWith('#')) return null
  const url = new URL(raw, location.href)
  if (url.origin !== location.origin || url.pathname === '/') return null
  return { path: url.pathname, hash: decodeURIComponent(url.hash.slice(1)) }
}

// ── Icon primitives ───────────────────────────────────────────────────────────

function PinIcon() {
  return (
    <svg className="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="17" x2="12" y2="22" />
      <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
    </svg>
  )
}

function OpenIcon() {
  return (
    <svg className="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  )
}

function XIcon() {
  return (
    <svg className="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  )
}

// ── Main popover island ───────────────────────────────────────────────────────

const BASE_Z = 100

export function HoverPopover() {
  const [hoverCards, setHoverCards] = useState<HoverCardState[]>([])
  const [pinned, setPinned] = useState<PinnedWindow[]>([])
  const [failedWindows, setFailedWindows] = useState<Set<string>>(new Set())
  const pinnedRef = useRef<PinnedWindow[]>([])
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const showTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pendingLink = useRef<HTMLAnchorElement | null>(null)
  const currentSurfaceLevel = useRef<number | null>(null)
  // Monotonically increasing z-index counter shared across all windows
  const zTop = useRef(BASE_Z)

  const persistPinned = useCallback((windows: PinnedWindow[]) => {
    const data: PinnedWindowData[] = windows.flatMap((w) => {
      const href = w.preview?.url ?? w.href
      if (!href) return []
      return [{ id: w.id, href, x: w.x, y: w.y, w: w.w, h: w.h, z: w.z }]
    })
    savePinnedToStorage(data, zTop.current)
  }, [])

  const updatePinned = useCallback((updater: (current: PinnedWindow[]) => PinnedWindow[]) => {
    setPinned((current) => {
      const next = updater(current)
      pinnedRef.current = next
      return next
    })
  }, [])

  const cancelShow = useCallback(() => {
    clearTimeout(showTimer.current)
    pendingLink.current = null
  }, [])

  const clearHideTimer = useCallback(() => {
    clearTimeout(hideTimer.current)
  }, [])

  const hideAll = useCallback((immediate = false) => {
    const close = () => {
      setHoverCards([])
      currentSurfaceLevel.current = null
    }
    clearTimeout(hideTimer.current)
    if (immediate) {
      close()
    } else {
      hideTimer.current = setTimeout(close, HIDE_DELAY)
    }
  }, [])

  const show = useCallback((link: HTMLAnchorElement, reference: HoverReference, level: number) => {
    const target = linkTarget(link)
    if (!target) return
    const { path, hash } = target
    const cached = previewCache.get(path) ?? null

    setHoverCards((cards) => {
      const kept = cards.filter((card) => card.level < level)
      const existing = cards.find((card) => card.level === level)
      return [
        ...kept,
        {
          id: existing?.id ?? crypto.randomUUID(),
          path,
          hash,
          preview: existing?.path === path ? (existing.preview ?? cached) : cached,
          loading: !cached,
          reference,
          level,
        },
      ]
    })

    if (cached) return

    fetchPreview(path).then((data) => {
      setHoverCards((cards) =>
        cards.map((card) =>
          card.level === level && card.path === path
            ? { ...card, preview: data, loading: false }
            : card,
        ),
      )
    })
  }, [])

  useEffect(() => {
    // Touch screens have no hover — links simply navigate there
    if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return

    const onOver = (e: MouseEvent) => {
      const target = e.target as Element

      // 1. Hover on an internal link → show/update the corresponding level.
      const link = target.closest(LINK_SELECTOR) as HTMLAnchorElement | null
      if (link && linkTarget(link)) {
        clearTimeout(hideTimer.current)
        currentSurfaceLevel.current = null
        if (pendingLink.current === link) return

        const hoverSurface = link.closest('[data-hover-preview-surface]') as HTMLElement | null
        const insidePinned = Boolean(link.closest('[data-pinned-preview-window]'))
        const level = hoverSurface && !insidePinned
          ? Number(hoverSurface.dataset.level ?? 0) + 1
          : 0
        const reference = hoverSurface || insidePinned
          ? createVirtualReference(link.getBoundingClientRect())
          : link

        clearTimeout(showTimer.current)
        pendingLink.current = link
        showTimer.current = setTimeout(() => show(link, reference, level), SHOW_DELAY)
        return
      }

      cancelShow()

      // 2. Hover on a preview surface (but not on a link inside it).
      //    Close higher-level cards after a short delay so fleeting
      //    movements across padding don't cause jarring flashes.
      const surface = target.closest('[data-hover-preview-surface]') as HTMLElement | null
      if (surface) {
        const level = Number(surface.dataset.level ?? 0)
        if (currentSurfaceLevel.current !== level) {
          currentSurfaceLevel.current = level
          clearTimeout(hideTimer.current)
          hideTimer.current = setTimeout(() => {
            setHoverCards((cards) => cards.filter((c) => c.level <= level))
          }, HIDE_DELAY)
        }
        return
      }

      currentSurfaceLevel.current = null

      // 3. Hover on a pinned window — keep hover cards as-is.
      if (target.closest('[data-pinned-preview-window]')) {
        clearTimeout(hideTimer.current)
        return
      }

      // 4. Anywhere else — schedule close all.
      hideAll()
    }

    const onDown = (e: MouseEvent) => {
      cancelShow()
      if (!(e.target as Element).closest('[data-hover-preview-surface]')) hideAll(true)
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hideAll(true)
    }

    document.addEventListener('mouseover', onOver)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mouseover', onOver)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [show, hideAll, cancelShow])

  const pin = useCallback((preview: Preview, rect?: DOMRect) => {
    const x = Math.round(rect?.left ?? 120)
    const y = Math.round(rect?.top ?? 120)
    const w = Math.round(rect?.width ?? 450)
    const h = Math.round(Math.max(rect?.height ?? 400, 240))

    zTop.current += 1
    updatePinned((p) => [
      ...p,
      { id: crypto.randomUUID(), preview, href: preview.url, x, y, w, h, z: zTop.current },
    ])
    hideAll(true)
  }, [hideAll, updatePinned])

  const unpin = useCallback((id: string) => {
    updatePinned((p) => p.filter((w) => w.id !== id))
  }, [updatePinned])

  // Bring a window to the front by giving it the highest z-index.
  const bringToFront = useCallback((id: string) => {
    updatePinned((p) => {
      const win = p.find((w) => w.id === id)
      if (!win || win.z === zTop.current) return p  // already on top
      zTop.current += 1
      return p.map((w) => (w.id === id ? { ...w, z: zTop.current } : w))
    })
  }, [updatePinned])

  const handleDragStop = useCallback((id: string, data: { x: number; y: number }) => {
    updatePinned(prev => prev.map(w => w.id === id ? { ...w, x: data.x, y: data.y } : w))
  }, [updatePinned])

  const handleResizeStop = useCallback((id: string, ref: HTMLElement, position: { x: number; y: number }) => {
    updatePinned(prev => prev.map(w => w.id === id ? {
      ...w,
      x: position.x,
      y: position.y,
      w: parseInt(ref.style.width) || w.w,
      h: parseInt(ref.style.height) || w.h,
    } : w))
  }, [updatePinned])

  useEffect(() => {
    pinnedRef.current = pinned
    const timer = setTimeout(() => {
      persistPinned(pinned)
    }, 100)
    return () => clearTimeout(timer)
  }, [pinned, persistPinned])

  useEffect(() => {
    return () => persistPinned(pinnedRef.current)
  }, [persistPinned])

  useEffect(() => {
    const { windows, zTop: savedZTop } = loadPinnedFromStorage()
    if (windows.length === 0) return

    if (savedZTop !== null && savedZTop > BASE_Z) {
      zTop.current = savedZTop
    }

    const restored: PinnedWindow[] = windows.map((d: PinnedWindowData) => ({
      id: d.id,
      preview: null,
      href: d.href,
      x: d.x,
      y: d.y,
      w: d.w,
      h: d.h,
      z: d.z,
    }))
    pinnedRef.current = restored
    setPinned(restored)

    Promise.all(
      windows.map(async (d: PinnedWindowData) => {
        const preview = await fetchPreview(new URL(d.href, location.href).pathname)
        return { id: d.id, preview }
      }),
    ).then((results) => {
      const failedIds = new Set<string>()
      updatePinned((prev) =>
        prev.map((w) => {
          const result = results.find((r) => r.id === w.id)
          if (!result?.preview) {
            failedIds.add(w.id)
            return w
          }
          return { ...w, preview: result.preview }
        }),
      )
      setFailedWindows(failedIds)
    })
  }, [updatePinned])

  useEffect(() => {
    const onPageLoad = () => {
      cancelShow()
      setHoverCards([])
    }
    document.addEventListener('astro:page-load', onPageLoad)
    return () => document.removeEventListener('astro:page-load', onPageLoad)
  }, [cancelShow])

  useEffect(() => {
    const onResize = () => {
      updatePinned((prev) =>
        clampToViewport(prev, window.innerWidth, window.innerHeight).map((clamped: PinnedWindow, i: number) => ({
          ...prev[i],
          x: clamped.x,
          y: clamped.y,
        })),
      )
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [updatePinned])

  return (
    <>
      {hoverCards.map((card) => (
        <HoverPreviewCard
          key={card.id}
          card={card}
          zIndex={1000 + card.level}
          onPin={pin}
          onClose={() => hideAll(true)}
          onCancelClose={clearHideTimer}
        />
      ))}

      {pinned.map((w) => (
        <PinnedWindow
          key={w.id}
          windowData={w}
          onClose={() => unpin(w.id)}
          onFocus={() => bringToFront(w.id)}
          onDragStop={handleDragStop}
          onResizeStop={handleResizeStop}
          failed={failedWindows.has(w.id)}
        />
      ))}
    </>
  )
}

function HoverPreviewCard({
  card,
  zIndex,
  onPin,
  onClose,
  onCancelClose,
}: {
  card: HoverCardState
  zIndex: number
  onPin: (preview: Preview, rect?: DOMRect) => void
  onClose: () => void
  onCancelClose: () => void
}) {
  const { refs, floatingStyles, isPositioned } = useFloating({
    strategy: 'fixed',
    placement: 'bottom-start',
    middleware: [
      offset(6),
      flip({ padding: 8, fallbackPlacements: ['top-start', 'right-start', 'left-start'] }),
      shift({ padding: 8 }),
    ],
    whileElementsMounted: autoUpdate,
  })

  useEffect(() => {
    if (card.reference instanceof Element) {
      refs.setReference(card.reference)
    } else {
      refs.setPositionReference(card.reference)
    }
  }, [card.reference, refs])

  const visible = isPositioned && !card.loading

  return (
    <FloatingPortal>
      <div
        ref={refs.setFloating}
        data-hover-preview-surface
        data-level={card.level}
        style={{
          ...floatingStyles,
          zIndex,
          opacity: visible ? 1 : 0,
          pointerEvents: visible ? 'auto' : 'none',
          transition: visible ? 'opacity 0.12s ease' : 'none',
        }}
        className="popover hover-popover"
        onMouseEnter={onCancelClose}
        onMouseLeave={(e) => {
          // Only close immediately when the mouse leaves the browser viewport.
          // All other transitions are handled by the global mouseover listener.
          if (!e.relatedTarget) onClose()
        }}
      >
        {card.preview ? (
          <>
            <div className="popover-actions">
              <button
                type="button"
                className="clickable-icon"
                onClick={() => onPin(card.preview!, refs.floating.current?.getBoundingClientRect())}
                aria-label="固定为浮窗"
                title="固定为浮窗"
              >
                <PinIcon />
              </button>
              <a className="clickable-icon" href={card.preview.url + (card.hash ? '#' + encodeURIComponent(card.hash) : '')} aria-label="打开笔记" title="打开笔记">
                <OpenIcon />
              </a>
            </div>
            <PreviewContent preview={card.preview} hash={card.hash} />
          </>
        ) : !card.loading ? (
          <div className="popover-empty">无法加载预览</div>
        ) : null}
      </div>
    </FloatingPortal>
  )
}

// ── Pinned draggable window ───────────────────────────────────────────────────

function PinnedWindow({
  windowData,
  onClose,
  onFocus,
  onDragStop,
  onResizeStop,
  failed,
}: {
  windowData: PinnedWindow
  onClose: () => void
  onFocus: () => void
  onDragStop: (id: string, data: { x: number; y: number }) => void
  onResizeStop: (id: string, ref: HTMLElement, position: { x: number; y: number }) => void
  failed: boolean
}) {
  const { x, y, w, h, z } = windowData

  // No FloatingPortal — pinned windows render directly inside <astro-island> to survive View Transition body swaps.
  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: z }}>
      <Rnd
        default={{ x, y, width: w, height: h }}
        minWidth={240}
        minHeight={160}
        bounds="parent"
        style={{ pointerEvents: 'auto' }}
        dragHandleClassName="window-drag-handle"
        onMouseDown={onFocus}
        onResizeStart={onFocus}
        onDragStop={(_e, data) => onDragStop(windowData.id, data)}
        onResizeStop={(_e, _direction, ref, _delta, position) => onResizeStop(windowData.id, ref, position)}
      >
        <div data-pinned-preview-window className="popover pinned-popover">
          <div className="window-drag-handle pinned-titlebar">
            <span className="pinned-title">{windowData.preview?.title ?? ''}</span>
            {windowData.preview && (
              <a className="clickable-icon" href={windowData.preview.url} aria-label="打开笔记" title="打开笔记">
                <OpenIcon />
              </a>
            )}
            <button type="button" onClick={onClose} className="clickable-icon" aria-label="关闭" title="关闭">
              <XIcon />
            </button>
          </div>

          {windowData.preview ? (
            <PreviewContent preview={windowData.preview} hash="" />
          ) : failed ? (
            <div className="popover-empty">
              内容不可用
              <button type="button" onClick={onClose} className="mod-link">关闭</button>
            </div>
          ) : (
            <div className="popover-empty"><span className="spinner" /></div>
          )}
        </div>
      </Rnd>
    </div>
  )
}

function createVirtualReference(rect: DOMRect): VirtualElement {
  const snapshot = {
    x: rect.x,
    y: rect.y,
    top: rect.top,
    left: rect.left,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  }

  return {
    getBoundingClientRect() {
      return snapshot
    },
  }
}

/** Same DOM as an Obsidian hover preview, so the vault theme styles it. */
function PreviewContent({ preview, hash }: { preview: Preview; hash: string }) {
  const scroller = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = scroller.current
    if (!el || !hash) return
    const heading = el.querySelector(`[id="${CSS.escape(hash)}"]`) as HTMLElement | null
    if (heading) el.scrollTop += heading.getBoundingClientRect().top - el.getBoundingClientRect().top - 8
  }, [hash, preview])

  const classes = ['markdown-preview-view', 'markdown-rendered', 'show-indentation-guide', ...preview.cssclasses].join(' ')

  return (
    <div ref={scroller} className="markdown-embed is-loaded">
      <div className="markdown-embed-content">
        <div className={classes}>
          <div className="markdown-preview-sizer markdown-preview-section" dangerouslySetInnerHTML={{ __html: preview.html }} />
        </div>
      </div>
    </div>
  )
}
