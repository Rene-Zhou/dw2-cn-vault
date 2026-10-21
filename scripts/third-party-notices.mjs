/**
 * Writes public/THIRD-PARTY-NOTICES.txt — license notices for everything the
 * published site ships to browsers: the client JS bundle's npm packages, the
 * Lucide icons inlined in the HTML, and the vault's active Obsidian theme.
 * Runs before every build (`prebuild`).
 */

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const root = path.resolve(import.meta.dirname, '..')
const require = createRequire(path.join(root, 'package.json'))

// Packages bundled into dist/_astro (React islands + view-transition router)
const CLIENT_ROOTS = ['react', 'react-dom', '@floating-ui/react', 'react-rnd']
const CLIENT_EXTRA = ['astro']

function pkgDir(name, from = root) {
  let dir = from
  while (true) {
    const candidate = path.join(dir, 'node_modules', name)
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

function collect(names) {
  const seen = new Map()
  const visit = (name, from) => {
    const dir = pkgDir(name, from)
    if (!dir) return
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
    const key = `${pkg.name}@${pkg.version}`
    if (seen.has(key)) return
    seen.set(key, { pkg, dir })
    for (const dep of Object.keys(pkg.dependencies ?? {})) visit(dep, dir)
  }
  for (const name of names) visit(name, root)
  return seen
}

function licenseText(dir) {
  const file = fs.readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f))
  return file ? fs.readFileSync(path.join(dir, file), 'utf8').trim() : null
}

const packages = collect(CLIENT_ROOTS)
for (const name of CLIENT_EXTRA) {
  const dir = pkgDir(name)
  if (dir) {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
    packages.set(`${pkg.name}@${pkg.version}`, { pkg, dir })
  }
}

const sections = []

for (const [key, { pkg, dir }] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
  const text = licenseText(dir)
  sections.push(`${key} — ${pkg.license ?? 'see license'}\n${typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url ?? ''}\n\n${text ?? `Licensed under ${pkg.license}.`}`)
}

sections.push(`Lucide icons — ISC (icons derived from Feather: MIT)
https://lucide.dev — inlined as SVG in src/lib/icons.ts, the layout and components.

ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

The MIT License (MIT) (for icons derived from Feather)

Copyright (c) 2013-present Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`)

// The vault's community theme is served verbatim in /obsidian.css
const KNOWN_THEMES = {
  'Obsidian Nord': `MIT License — https://github.com/insanum/obsidian_nord

Copyright (c) 2020 Eric Davis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`,
}

try {
  const { config } = await import(path.join(root, 'src/config.ts'))
  const appearance = JSON.parse(fs.readFileSync(path.join(config.vaultDir, '.obsidian/appearance.json'), 'utf8'))
  const theme = appearance.cssTheme
  if (theme) {
    let author = ''
    try {
      author = JSON.parse(fs.readFileSync(path.join(config.vaultDir, '.obsidian/themes', theme, 'manifest.json'), 'utf8')).author ?? ''
    } catch { /* no manifest */ }
    sections.push(`Obsidian theme "${theme}"${author ? ` by ${author}` : ''} — served in /obsidian.css\n\n${KNOWN_THEMES[theme] ?? 'Distributed under the theme author\'s license; see the theme\'s repository.'}`)
  }
} catch {
  // No vault configured — skip the theme section
}

const header = `THIRD-PARTY NOTICES

This site is generated by dw2-cn-vault (MIT, see LICENSE). It includes the
following third-party software and assets. Obsidian is a trademark of Dynalist
Inc.; this site is not affiliated with or endorsed by Obsidian.
`

const out = path.join(root, 'public', 'THIRD-PARTY-NOTICES.txt')
fs.writeFileSync(out, [header, ...sections].join('\n\n' + '='.repeat(78) + '\n\n') + '\n')
console.log(`wrote ${path.relative(root, out)} (${sections.length} entries)`)
