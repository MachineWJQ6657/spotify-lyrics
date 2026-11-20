import ts from 'typescript'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Finds the interface text in the source: every string, template or JSX text
 * with Chinese in it. A text is fine when it is the first argument of `t()`,
 * `tk()` or `tc()` (then it is a key that needs an English entry), when it is only
 * logged, or when its line (or the line above) says `i18n-ignore` because it
 * is data, not interface text (a provider's label, a pattern, a test value).
 */
export interface Found { file: string; line: number; text: string }
export interface Scan { keys: Found[]; unwrapped: Found[]; dynamic: Found[] }

const HAN = /[㐀-鿿]/
const ROOT = path.resolve(__dirname, '../..')

/** Not interface text as a whole: lyric data, patterns, release notes (translated as a table), provider internals. */
export const DATA_FILES = new Set([
  'src/data/demo.ts', 'src/lib/lyric-metadata.ts', 'src/lib/changelog.ts',
  'electron/japanese-romaji.ts', 'electron/lyrics-provider.ts'
])

export function interfaceFiles(): string[] {
  const files: string[] = []
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name)
      if (entry.isDirectory()) { if (entry.name !== 'i18n') walk(full); continue }
      if (!/\.(ts|tsx)$/.test(entry.name) || /\.(test|d)\.tsx?$/.test(entry.name)) continue
      const relative = path.relative(ROOT, full).replace(/\\/g, '/')
      if (!DATA_FILES.has(relative)) files.push(relative)
    }
  }
  walk(path.join(ROOT, 'src'))
  walk(path.join(ROOT, 'electron'))
  return files.sort()
}

const calleeName = (call: ts.CallExpression) =>
  ts.isIdentifier(call.expression) ? call.expression.text : ts.isPropertyAccessExpression(call.expression) ? call.expression.name.text : ''

export function scanFile(relative: string): Scan {
  const text = fs.readFileSync(path.join(ROOT, relative), 'utf8')
  const source = ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true, relative.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const lines = text.split(/\r?\n/)
  const result: Scan = { keys: [], unwrapped: [], dynamic: [] }
  const lineOf = (node: ts.Node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line
  const ignored = (line: number) => /i18n-ignore/.test(lines[line] ?? '') || /i18n-ignore/.test(lines[line - 1] ?? '')
  const onlyLogged = (node: ts.Node) => {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (!ts.isCallExpression(parent)) continue
      const name = calleeName(parent)
      if (name === 'qaLog' || (ts.isPropertyAccessExpression(parent.expression) && ts.isIdentifier(parent.expression.expression) && parent.expression.expression.text === 'console')) return true
    }
    return false
  }
  const visit = (node: ts.Node) => {
    const literal = ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
    const content = literal ? node.text : ts.isJsxText(node) ? node.text : ts.isTemplateExpression(node) ? node.head.text + node.templateSpans.map(span => span.literal.text).join('{}') : null
    if (content !== null && HAN.test(content)) {
      const found: Found = { file: relative, line: lineOf(node) + 1, text: content.trim().replace(/\s+/g, ' ').slice(0, 120) }
      const call = node.parent && ts.isCallExpression(node.parent) && node.parent.arguments[0] === node ? node.parent : null
      const marker = call ? calleeName(call) : ''
      const context = call && marker === 'tc' && call.arguments[1] && (ts.isStringLiteral(call.arguments[1]) || ts.isNoSubstitutionTemplateLiteral(call.arguments[1])) ? call.arguments[1].text : null
      if (literal && context !== null) result.keys.push({ ...found, text: `${(node as ts.StringLiteral).text}@@${context}` })
      else if (literal && (marker === 't' || marker === 'tk')) result.keys.push({ ...found, text: (node as ts.StringLiteral).text })
      else if (ts.isTemplateExpression(node) && (marker === 't' || marker === 'tk')) result.dynamic.push(found)
      else if (node.parent && ts.isLiteralTypeNode(node.parent)) { /* a type, not a text */ }
      else if (!onlyLogged(node) && !ignored(lineOf(node))) result.unwrapped.push(found)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return result
}

/** `{name}` placeholders of a text, sorted. */
export const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort().join(',')
