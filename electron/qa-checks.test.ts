import { describe, expect, it } from 'vitest'
import { createQaChecks } from './qa-checks'

describe('packaged QA acceptance', () => {
  it('fails when a required window observation was skipped', () => {
    const checks = createQaChecks(['hover', 'open'])
    checks.record('hover', true)
    expect(checks.result()).toEqual({ passed: false, failed: [], missing: ['open'] })
  })
  it('keeps failures even if a later retry succeeds', () => {
    const checks = createQaChecks(['open'])
    checks.record('open', false)
    checks.record('open', true)
    expect(checks.result()).toEqual({ passed: false, failed: ['open'], missing: [] })
  })
  it('passes only after every expected state was observed', () => {
    const checks = createQaChecks(['hover', 'open'])
    checks.record('hover', true)
    checks.record('open', true)
    expect(checks.result()).toEqual({ passed: true, failed: [], missing: [] })
  })
})
