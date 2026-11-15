import { describe, expect, it } from 'vitest'
import { version } from '../../package.json'
import { CHANGELOG, compareVersions, hasUnseenNews, releasedEntries } from './changelog'

describe('changelog', () => {
  it('compares dotted versions numerically', () => {
    expect(compareVersions('0.4.9', '0.4.10')).toBeLessThan(0)
    expect(compareVersions('0.4.66', '0.4.66')).toBe(0)
    expect(compareVersions('0.5.0', '0.4.99')).toBeGreaterThan(0)
    expect(compareVersions('1', '0.9.9')).toBeGreaterThan(0)
  })
  it('is newest first, without duplicates or empty entries', () => {
    for (let index = 1; index < CHANGELOG.length; index++) expect(compareVersions(CHANGELOG[index - 1].version, CHANGELOG[index].version)).toBeGreaterThan(0)
    expect(CHANGELOG.every(entry => entry.items.length > 0 && entry.items.every(item => item.trim().length > 0))).toBe(true)
  })
  it('describes the release being built', () => {
    // A release with something visible gets an entry; this keeps the list from going stale.
    expect(compareVersions(CHANGELOG[0].version, version)).toBeGreaterThanOrEqual(0)
    expect(releasedEntries(version)[0]?.version).toBe(version)
  })
  it('shows only what has been released', () => {
    const entries = [{ version: '0.5.1', date: '', items: ['a'] }, { version: '0.5.0', date: '', items: ['b'] }]
    expect(releasedEntries('0.5.0', entries).map(entry => entry.version)).toEqual(['0.5.0'])
    expect(releasedEntries('0.4.0', entries)).toEqual([])
  })
  it('has news until the newest released entry was read', () => {
    const entries = [{ version: '0.5.1', date: '', items: ['a'] }, { version: '0.5.0', date: '', items: ['b'] }]
    expect(hasUnseenNews(null, '0.5.1', entries)).toBe(true)
    expect(hasUnseenNews('0.5.0', '0.5.1', entries)).toBe(true)
    expect(hasUnseenNews('0.5.1', '0.5.1', entries)).toBe(false)
    // An update without an entry is not news.
    expect(hasUnseenNews('0.5.1', '0.5.2', entries)).toBe(false)
    expect(hasUnseenNews(null, '0.4.0', entries)).toBe(false)
  })
})
