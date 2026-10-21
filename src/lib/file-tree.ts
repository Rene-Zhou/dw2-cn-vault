import type { Note } from './vault.ts'

export interface FileTreeNode {
  name: string
  key: string
  url: string
  isDir: boolean
  children: FileTreeNode[]
}

/** "05 职业" → "职业": folder-note names may drop the numeric prefix. */
function stripOrder(name: string): string {
  return name.replace(/^\d+[\s._-]*/, '')
}

/**
 * Build the sidebar tree from the vault's folders, sorted like Obsidian's
 * file explorer (folders first, natural name order).
 *
 * Folder notes — a note named after its folder, e.g. `05 职业/职业.md` or
 * `05 职业/06 圣武士/圣武士.md` — become the folder's own link.
 */
export function buildFileTree(notes: Note[]): FileTreeNode {
  const root: FileTreeNode = { name: '', key: '', url: '', isDir: true, children: [] }

  for (const note of notes) {
    const parts = note.path.split('/')
    let current = root

    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts.slice(0, i + 1).join('/')
      let child = current.children.find((c) => c.isDir && c.key === key)
      if (!child) {
        child = { name: parts[i], key, url: '', isDir: true, children: [] }
        current.children.push(child)
      }
      current = child
    }

    const folderName = parts.at(-2)
    if (folderName && !current.url && (note.name === folderName || note.name === stripOrder(folderName))) {
      current.url = note.url
      continue
    }

    current.children.push({ name: note.name, key: note.path, url: note.url, isDir: false, children: [] })
  }

  sortTree(root)
  return root
}

const collator = new Intl.Collator('zh-Hans-CN', { numeric: true })

function sortTree(node: FileTreeNode) {
  node.children.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return collator.compare(a.name, b.name)
  })
  for (const child of node.children) {
    if (child.isDir) sortTree(child)
  }
  // A folder holding nothing but its folder note is shown as a plain note
  // (after sorting, so it keeps its place among the folders)
  for (const child of node.children) {
    if (child.isDir && child.url && child.children.length === 0) child.isDir = false
  }
}
