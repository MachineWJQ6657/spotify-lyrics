import { describe, expect, it } from 'vitest'
import { EN } from './en'
import fs from 'node:fs'
import path from 'node:path'
import { interfaceFiles, placeholders, scanFile, type Found } from './scan'

// The English interface is complete when every interface text goes through
// t() / tk() and each of those texts has an entry in src/i18n/en.
//
// Working on some files only:   I18N_ONLY=SettingsPanel.tsx,SourceMenu.tsx npx vitest run src/i18n/coverage.test.ts
// A count per file:             I18N_REPORT=1 npx vitest run src/i18n/coverage.test.ts
const only = (process.env.I18N_ONLY ?? '').split(',').map(name => name.trim()).filter(Boolean)
const files = interfaceFiles().filter(file => !only.length || only.some(name => file.endsWith(name)))
const scans = files.map(file => ({ file, ...scanFile(file) }))
const show = (found: Found[]) => found.map(item => `${item.file}:${item.line}  ${item.text}`)

if (process.env.I18N_REPORT) {
  for (const scan of scans) if (scan.unwrapped.length || scan.keys.length) console.log(`${String(scan.unwrapped.length).padStart(4)} unwrapped ${String(scan.keys.length).padStart(4)} wrapped  ${scan.file}`)
}

describe('the English interface', () => {
  it('has every interface text wrapped in t() or tk()', () => {
    expect(show(scans.flatMap(scan => scan.unwrapped))).toEqual([])
  })

  it('never builds a text inside t(): placeholders, not template strings', () => {
    expect(show(scans.flatMap(scan => scan.dynamic))).toEqual([])
  })

  it('has an English entry for every wrapped text', () => {
    const missing = scans.flatMap(scan => scan.keys).filter(key => !EN[key.text]?.trim())
    expect([...new Set(missing.map(key => key.text))].map(text => `${missing.find(key => key.text === text)!.file}  ${text}`)).toEqual([])
  })

  it('keeps the placeholders of each text in its English entry', () => {
    const keys = new Set(scans.flatMap(scan => scan.keys).map(key => key.text))
    expect([...keys].filter(key => EN[key] && placeholders(key.split('@@')[0]) !== placeholders(EN[key])).map(key => `${key}  ->  ${EN[key]}`)).toEqual([])
  })

  it('has nothing in a dictionary file that the bundler reads as an import statement', () => {
    // electron-vite puts its CommonJS shims after the last `import … "…"` it finds in the main bundle, by
    // pattern. A comment ending in the word import, followed by an entry, matched: the shims landed inside
    // the dictionary object and the build failed.
    const directory = path.resolve(__dirname, 'en')
    const hits = fs.readdirSync(directory).filter(name => name.endsWith('.ts')).flatMap(name =>
      fs.readFileSync(path.join(directory, name), 'utf8').split(/\r?\n/).flatMap((line, index, lines) =>
        /(?:^|\s|;)import\s*$/.test(line) && /^\s*["'`]/.test(lines[index + 1] ?? '') || /(?:^|\s|;)import\s*["'`]/.test(line) ? [`${name}:${index + 1}  ${line.trim()}`] : []))
    expect(hits).toEqual([])
  })

  it('has no Chinese left in an English entry', () => {
    expect(Object.entries(EN).filter(([, value]) => /[㐀-鿿]/.test(value)).map(([key, value]) => `${key}  ->  ${value}`)).toEqual([])
  })
})
