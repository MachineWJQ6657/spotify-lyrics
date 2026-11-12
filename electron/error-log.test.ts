import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createErrorLog, formatErrorEntry } from './error-log'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe('main-process error log', () => {
  it('formats errors, strings and objects on one entry with indented stack lines', () => {
    const error = new TypeError('Object has been destroyed')
    error.stack = 'TypeError: Object has been destroyed\n    at Timeout.tick'
    const at = new Date('2026-11-12T23:20:00.000Z')
    expect(formatErrorEntry('uncaughtException', error, at)).toBe('2026-11-12T23:20:00.000Z uncaughtException: TypeError: Object has been destroyed\n        at Timeout.tick\n')
    expect(formatErrorEntry('child-process-gone', 'GPU crashed exitCode=143', at)).toContain('child-process-gone: GPU crashed exitCode=143')
    expect(formatErrorEntry('unhandledRejection', { code: 7 }, at)).toContain('{"code":7}')
  })

  it('appends in order and rotates past the size cap', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'syllable-error-log-'))
    dirs.push(dir)
    const file = path.join(dir, 'error.log')
    const log = createErrorLog(() => file, 200)
    await log('first', 'a'.repeat(120))
    await log('second', 'b'.repeat(120))
    expect(existsSync(`${file}.1`)).toBe(true)
    expect(readFileSync(`${file}.1`, 'utf8')).toContain('first')
    expect(readFileSync(file, 'utf8')).toContain('second')
    expect(readFileSync(file, 'utf8')).not.toContain('first')
  })

  it('never throws when no path is available or the write fails', async () => {
    await expect(createErrorLog(() => null)('kind', 'x')).resolves.toBeUndefined()
    await expect(createErrorLog(() => path.join(tmpdir(), 'missing-dir-xyz', 'nested', 'error.log'))('kind', 'x')).resolves.toBeUndefined()
  })
})
