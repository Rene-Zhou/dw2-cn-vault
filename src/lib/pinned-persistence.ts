export const PINNED_STORAGE_KEY = 'skywrite-pinned-windows'
export const ZTOP_STORAGE_KEY = 'skywrite-pinned-ztop'
export const BASE_Z = 100

export interface PinnedWindowData {
  id: string
  href: string
  x: number
  y: number
  w: number
  h: number
  z: number
}

export function serializePinned(windows: PinnedWindowData[]): string {
  return JSON.stringify(windows)
}

export function deserializePinned(raw: string | null): PinnedWindowData[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

export function clampToViewport<
  T extends { x: number; y: number }
>(
  windows: T[],
  viewportWidth: number,
  viewportHeight: number,
  minWidth = 220,
  minHeight = 50,
): T[] {
  return windows.map(w => ({
    ...w,
    x: Math.min(Math.max(w.x, 0), viewportWidth - minWidth - 10),
    y: Math.min(Math.max(w.y, 0), viewportHeight - minHeight),
  }))
}

export function savePinnedToStorage(windows: PinnedWindowData[], zTop: number): void {
  try {
    localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(windows))
    localStorage.setItem(ZTOP_STORAGE_KEY, String(zTop))
  } catch { /* QuotaExceededError or private browsing — silently ignore */ }
}

export function loadPinnedFromStorage(): { windows: PinnedWindowData[], zTop: number | null } {
  try {
    const raw = localStorage.getItem(PINNED_STORAGE_KEY)
    const zTopRaw = localStorage.getItem(ZTOP_STORAGE_KEY)
    return {
      windows: deserializePinned(raw),
      zTop: zTopRaw ? Number(zTopRaw) : null,
    }
  } catch {
    return { windows: [], zTop: null }
  }
}
