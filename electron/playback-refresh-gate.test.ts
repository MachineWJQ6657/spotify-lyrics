import { describe, expect, it, vi } from 'vitest'
import { PlaybackRefreshGate } from './playback-refresh-gate'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

describe('playback refresh ordering', () => {
  it('cannot restore the outgoing song after a newer refresh finishes first', async () => {
    const gate = new PlaybackRefreshGate()
    const old = deferred<string>()
    const publish = vi.fn()
    const pending = gate.refresh(() => old.promise, publish)
    expect(await gate.refresh(async () => 'new song', publish)).toBe(true)
    old.resolve('outgoing song')
    expect(await pending).toBe(false)
    expect(publish.mock.calls).toEqual([['new song']])
  })

  it('rejects a web result invalidated by native state or logout, including empty results', async () => {
    for (const value of ['old song', null]) {
      const gate = new PlaybackRefreshGate()
      const old = deferred<string | null>()
      const publish = vi.fn()
      const pending = gate.refresh(() => old.promise, publish)
      gate.invalidate()
      old.resolve(value)
      expect(await pending).toBe(false)
      expect(publish).not.toHaveBeenCalled()
      expect(await gate.refresh(async () => 'fresh observation', publish)).toBe(true)
    }
  })

  it('does not publish an old response even while the newer request is still pending', async () => {
    const gate = new PlaybackRefreshGate()
    const old = deferred<number>()
    const fresh = deferred<number>()
    const publish = vi.fn()
    const first = gate.refresh(() => old.promise, publish)
    const second = gate.refresh(() => fresh.promise, publish)
    old.resolve(1)
    expect(await first).toBe(false)
    expect(publish).not.toHaveBeenCalled()
    fresh.resolve(2)
    expect(await second).toBe(true)
    expect(publish.mock.calls).toEqual([[2]])
  })

  it('suppresses obsolete errors but propagates current failures for poll backoff', async () => {
    const gate = new PlaybackRefreshGate()
    const old = deferred<never>()
    const pending = gate.refresh(() => old.promise, vi.fn())
    gate.invalidate()
    old.reject(new Error('obsolete failure'))
    expect(await pending).toBe(false)
    await expect(gate.refresh(async () => { throw new Error('current failure') }, vi.fn())).rejects.toThrow('current failure')
  })
})
