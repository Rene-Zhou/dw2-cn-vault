import { describe, expect, it } from 'vitest'
import { indexVault } from '../vault.ts'
import { createRenderer, extractSection, headingId, parseLinkText } from '../markdown.ts'

function render(files: Record<string, string>, notePath: string) {
  const vault = indexVault(Object.entries(files).map(([path, content]) => ({ path, content })))
  const note = vault.notes.find((n) => n.path === notePath)!
  return createRenderer(vault).renderNote(note)
}

describe('parseLinkText', () => {
  it('splits target, heading and alias', () => {
    expect(parseLinkText('a/b#标题|显示')).toEqual({ target: 'a/b', heading: '标题', alias: '显示' })
    expect(parseLinkText('note')).toEqual({ target: 'note', heading: undefined, alias: undefined })
  })

  it('accepts table-escaped pipes', () => {
    expect(parseLinkText('x.pdf\\|X')).toMatchObject({ target: 'x.pdf', alias: 'X' })
  })
})

describe('headingId', () => {
  it('matches Obsidian heading links that drop # characters', () => {
    expect(headingId('装备与 #标签')).toBe(headingId('装备与 标签'))
  })
})

describe('extractSection', () => {
  it('returns the heading and its body up to the next same-level heading', () => {
    const body = '# A\n\n## B\n\nb text\n\n### C\n\nc\n\n## D\n\nd'
    expect(extractSection(body, 'B')).toBe('## B\n\nb text\n\n### C\n\nc\n')
    expect(extractSection(body, 'missing')).toBeNull()
  })
})

describe('renderer', () => {
  it('resolves wikilinks by path and by bare name', () => {
    const { html, links } = render(
      {
        '04 动作/核心/动作/安慰或支持.md': '# 安慰或支持',
        'index.md': '[[04 动作/核心/动作/安慰或支持|安慰]] [[安慰或支持]] [[不存在]]',
      },
      'index',
    )
    expect(html).toContain('href="/04-动作/核心/动作/安慰或支持" class="internal-link">安慰</a>')
    expect(html).toContain('class="internal-link">安慰或支持</a>')
    expect(html).toContain('class="internal-link is-unresolved"')
    expect([...links]).toEqual(['04 动作/核心/动作/安慰或支持'])
  })

  it('renders each embed exactly once, in order', () => {
    const { html } = render(
      {
        'moves/动作/甲.md': '# 甲\n\n见 [[乙]]',
        'moves/动作/乙.md': '# 乙\n\n![[丙]]',
        'moves/动作/丙.md': '# 丙',
        'page.md': '![[甲]]\n\n![[乙]]',
      },
      'page',
    )
    expect(html.match(/<h1[^>]*>甲<\/h1>/g)).toHaveLength(1)
    expect(html.match(/<h1[^>]*>乙<\/h1>/g)).toHaveLength(1)
    expect(html.match(/<h1[^>]*>丙<\/h1>/g)).toHaveLength(1)
    expect(html.indexOf('>甲</h1>')).toBeLessThan(html.indexOf('>乙</h1>'))
  })

  it('emits Obsidian embed markup with the src the snippet matches on', () => {
    const { html } = render({ '职业/动作/誓言.md': '# 誓言', 'p.md': '![[职业/动作/誓言]]' }, 'p')
    expect(html).toMatch(/^<div class="internal-embed markdown-embed inline-embed is-loaded" tabindex="-1" src="职业\/动作\/誓言"/)
    expect(html).toContain('<div class="markdown-embed-content"><div class="markdown-preview-view markdown-rendered')
  })

  it('stops circular embeds', () => {
    const { html } = render({ 'a.md': '# A\n\n![[b]]', 'b.md': '# B\n\n![[a]]' }, 'a')
    expect(html).toContain('循环嵌入')
  })

  it('renders callouts, tags and CJK emphasis', () => {
    const { html } = render(
      { 'n.md': '> [!example] 关系示例\n> - 一项\n\n标枪 #中距 #投掷 \n\n**筹备：**□ □' },
      'n',
    )
    expect(html).toContain('<div class="callout" data-callout="example"')
    expect(html).toContain('<div class="callout-title-inner">关系示例</div>')
    expect(html).toContain('<a href="#中距" class="tag" data-tag="中距">#中距</a>')
    expect(html).toContain('<strong>筹备：</strong>□')
  })

  it('links attachments inside tables', () => {
    const { html } = render(
      { 'files/a.pdf': '', 'n.md': '| f |\n|---|\n| [[files/a.pdf\\|A]] |' },
      'n',
    )
    expect(html).toContain('href="/files/files/a.pdf" class="internal-link" data-file')
    expect(html).toContain('<div class="table-wrapper"><table>')
  })

  it('prunes links and embeds pointing at excluded notes', () => {
    const vault = indexVault([
      { path: '08 冒险/冒险.md', excluded: true },
      { path: '07 战役/战役.md', content: '# 战役' },
      {
        path: '目录.md',
        content: [
          '1. [[07 战役/战役|战役]]',
          '2. [[08 冒险/冒险|冒险]]',
          '',
          '- [[08 冒险/冒险|冒险]]',
          '  - [[08 冒险/冒险#背景|背景]]',
          '- [[07 战役/战役|战役]]',
          '',
          '[[08 冒险/冒险]]',
          '',
          '另见[[冒险]]一章。',
          '',
          '![[08 冒险/冒险]]',
        ].join('\n'),
      },
    ])
    const html = createRenderer(vault).renderNote(vault.notes.find((n) => n.name === '目录')!).html
    expect(html.match(/<li>/g)).toHaveLength(2)
    expect(html).not.toContain('背景')
    expect(html).not.toContain('internal-embed')
    expect(html).toContain('<p>另见冒险一章。</p>')
    expect(html).not.toContain('is-unresolved')
  })
})
