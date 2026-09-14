import { describe, expect, it } from 'vitest'
import { PlaybackRequestGate } from './playback-request-gate'
import { TransportGate } from './transport-gate'

describe('playback request serialization', () => {
  it('rejects repeated controls even after the seek-to-zero transaction expires', async () => {
    let now = 1_000
    const transport = new TransportGate(() => now)
    const requests = new PlaybackRequestGate()
    let finish!: () => void
    let sends = 0
    const first = requests.run(async () => {
      transport.begin({ command: 'previous', backend: 'web', fromTrackId: 'a', livePositionMs: 10_000 })
      sends++
      await new Promise<void>(resolve => { finish = resolve })
    })
    now += 301
    expect(transport.isPending()).toBe(false)
    for (let index = 0; index < 10; index++) {
      expect(await requests.run(async () => { sends++ })).toEqual({ accepted: false })
    }
    finish()
    expect(await first).toMatchObject({ accepted: true })
    expect(sends).toBe(1) // Rejected clicks are never replayed after completion.
    expect(await requests.run(async () => ++sends)).toEqual({ accepted: true, value: 2 })
  })

  it('releases after asynchronous failure and synchronous exceptions', async () => {
    const requests = new PlaybackRequestGate()
    await expect(requests.run(async () => { throw new Error('network failure') })).rejects.toThrow('network failure')
    await expect(requests.run(() => { throw new Error('immediate failure') })).rejects.toThrow('immediate failure')
    expect(await requests.run(async () => 'recovered')).toEqual({ accepted: true, value: 'recovered' })
  })

  it('blocks reentrant operations before the first await', async () => {
    const requests = new PlaybackRequestGate()
    const result = await requests.run(() => requests.run(async () => 'must not run'))
    expect(result).toEqual({ accepted: true, value: { accepted: false } })
  })
})
