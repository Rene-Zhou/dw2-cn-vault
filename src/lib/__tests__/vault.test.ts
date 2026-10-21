import { describe, expect, it } from 'vitest'
import { indexVault, isExcluded, splitFrontmatter, toSlug } from '../vault.ts'
import { buildFileTree } from '../file-tree.ts'
import { searchDocs } from '../search.ts'

const files = [
  { path: '05 职业/职业.md', content: '---\ntitle: 职业\ncssclasses:\n- dw2-book\n---\n# 职业' },
  { path: '05 职业/06 圣武士/圣武士.md', content: '---\naliases:\n- The Paladin\n---\n# 圣武士' },
  { path: '05 职业/06 圣武士/动作/圣武士 - 信念誓言.md', content: '# 信念誓言' },
  { path: '开始阅读.md', content: '# 开始' },
  { path: '90 原文附件/Bonds.pdf' },
]

describe('toSlug', () => {
  it('keeps CJK and folds spaces', () => {
    expect(toSlug('05 职业/06 圣武士/圣武士 - 信念誓言')).toBe('05-职业/06-圣武士/圣武士-信念誓言')
  })
})

describe('splitFrontmatter', () => {
  it('parses YAML lists', () => {
    expect(splitFrontmatter('---\ntags:\n- a\n- b\n---\nbody').data.tags).toEqual(['a', 'b'])
  })
})

describe('indexVault', () => {
  const vault = indexVault(files, '开始阅读')

  it('reads metadata', () => {
    const paladin = vault.notes.find((n) => n.name === '圣武士')!
    expect(paladin.aliases).toEqual(['The Paladin'])
    expect(vault.notes.find((n) => n.name === '职业')!.cssclasses).toEqual(['dw2-book'])
  })

  it('maps the home note to /', () => {
    expect(vault.byUrl.get('/')?.name).toBe('开始阅读')
  })

  it('resolves exact, relative and bare links', () => {
    expect(vault.resolve('05 职业/06 圣武士/圣武士')).toMatchObject({ kind: 'note' })
    expect(vault.resolve('动作/圣武士 - 信念誓言', '05 职业/06 圣武士/圣武士')).toMatchObject({ kind: 'note' })
    expect(vault.resolve('圣武士 - 信念誓言.md')).toMatchObject({ kind: 'note' })
    expect(vault.resolve('Bonds.pdf')).toMatchObject({ kind: 'file' })
    expect(vault.resolve('nope')).toBeNull()
  })
})

describe('isExcluded', () => {
  it('matches whole path segments', () => {
    expect(isExcluded('90 原文附件/Bonds.pdf', ['90 原文附件'])).toBe(true)
    expect(isExcluded('90 原文附件说明.md', ['90 原文附件'])).toBe(false)
  })
})

describe('buildFileTree', () => {
  it('turns folder notes into folder links', () => {
    const tree = buildFileTree(indexVault(files).notes)
    const classes = tree.children.find((c) => c.name === '05 职业')!
    expect(classes.url).toBe('/05-职业/职业')
    const paladin = classes.children.find((c) => c.name === '06 圣武士')!
    expect(paladin.url).toBe('/05-职业/06-圣武士/圣武士')
    expect(paladin.children.map((c) => c.name)).toEqual(['动作'])
  })
})

describe('searchDocs', () => {
  const docs = [
    { title: '圣武士', path: 'a/圣武士', url: '/a', aliases: ['The Paladin'], headings: [], text: '誓言' },
    { title: '圣武士 - 信念誓言', path: 'a/动作/x', url: '/b', aliases: [], headings: [], text: '#神圣' },
  ]

  it('ranks title matches first and requires every term', () => {
    expect(searchDocs(docs, '圣武士').hits.map((h) => h.doc.url)).toEqual(['/a', '/b'])
    expect(searchDocs(docs, '圣武士 #神圣').hits.map((h) => h.doc.url)).toEqual(['/b'])
    expect(searchDocs(docs, 'paladin').hits).toHaveLength(1)
  })
})
