import { expect, it } from 'vitest'
import { formatErrorEntry, recentErrorEntries } from './error-log'

it('lists the newest logged errors first, one line each', () => {
  const stack = new Error('first')
  stack.stack = 'Error: first\n    at one\n    at two'
  const log = [
    formatErrorEntry('uncaughtException', stack, new Date('2026-11-15T01:00:00.000Z')),
    formatErrorEntry('child-process-gone', 'GPU crashed exitCode=1', new Date('2026-11-15T02:00:00.000Z')),
    formatErrorEntry('unhandledRejection', 'x'.repeat(400), new Date('2026-11-15T03:00:00.000Z'))
  ].join('')
  const recent = recentErrorEntries(log)
  expect(recent).toHaveLength(3)
  expect(recent[0].startsWith('2026-11-15T03:00:00.000Z unhandledRejection')).toBe(true)
  expect(recent[0].endsWith('…')).toBe(true)
  expect(recent[1]).toBe('2026-11-15T02:00:00.000Z child-process-gone: GPU crashed exitCode=1')
  // Indented stack lines belong to their entry and are not listed separately.
  expect(recent[2]).toBe('2026-11-15T01:00:00.000Z uncaughtException: Error: first')
  expect(recentErrorEntries(log, 1)).toHaveLength(1)
  expect(recentErrorEntries('')).toEqual([])
})
