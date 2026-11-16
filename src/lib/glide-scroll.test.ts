import { describe, expect, it } from 'vitest'
import { glideScroll } from './glide-scroll'

/** A display refreshing every `vsyncMs`: runs requested callbacks on each tick. */
function display(vsyncMs: number) {
  let time = 0
  let queue: Array<{ handle: number; callback: () => void }> = []
  let next = 1
  return {
    now: () => time,
    request: (callback: () => void) => { const handle = next++; queue.push({ handle, callback }); return handle },
    cancel: (handle: number) => { queue = queue.filter(item => item.handle !== handle) },
    run(untilMs: number, element: { scrollTop: number }, writes: number[]) {
      while (time < untilMs && queue.length) {
        time += vsyncMs
        const due = queue; queue = []
        const before = element.scrollTop
        for (const item of due) item.callback()
        if (element.scrollTop !== before) writes.push(time)
      }
    }
  }
}

describe('gliding the lyric list to the sung line', () => {
  it('moves about 60 times a second on a 240 Hz display and ends exactly on the target', () => {
    const screen = display(1000 / 240)
    const element = { scrollTop: 1000 }
    const writes: number[] = []
    glideScroll(element, 1240, screen)
    screen.run(1000, element, writes)
    expect(element.scrollTop).toBe(1240)
    // 320 ms at <= 60 a second: about 20 positions, not about 77.
    expect(writes.length).toBeGreaterThanOrEqual(16)
    expect(writes.length).toBeLessThanOrEqual(23)
  })

  it('still moves on every frame of a 60 Hz display', () => {
    const screen = display(1000 / 60)
    const element = { scrollTop: 0 }
    const writes: number[] = []
    glideScroll(element, 300, screen)
    screen.run(1000, element, writes)
    expect(element.scrollTop).toBe(300)
    expect(writes.length).toBeGreaterThanOrEqual(18)
  })

  it('eases out: most of the way is covered early', () => {
    const screen = display(1000 / 240)
    const element = { scrollTop: 0 }
    glideScroll(element, 400, screen)
    screen.run(100, element, [])
    expect(element.scrollTop).toBeGreaterThan(200)
    expect(element.scrollTop).toBeLessThan(400)
  })

  it('stops where it is when cancelled (the user scrolled)', () => {
    const screen = display(1000 / 240)
    const element = { scrollTop: 0 }
    const stop = glideScroll(element, 400, screen)
    screen.run(60, element, [])
    const reached = element.scrollTop
    stop()
    screen.run(1000, element, [])
    expect(element.scrollTop).toBe(reached)
  })

  it('jumps when there is nothing to glide', () => {
    const element = { scrollTop: 100.4 }
    glideScroll(element, 100, display(4))
    expect(element.scrollTop).toBe(100)
  })
})
