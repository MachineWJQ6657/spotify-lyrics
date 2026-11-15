import { describe, expect, it } from 'vitest'
import { alignSecondaryTrack } from './lyrics'

describe('secondary rows whose timestamps were rounded', () => {
  // The original keeps milliseconds; a translation re-timed onto it is written to 10 ms.
  const base = [{ startMs: 21_457, text: '一行目' }, { startMs: 22_311, text: 'それでもいい' }, { startMs: 23_189, text: '歩いていこう' }, { startMs: 27_004, text: '四行目' }]
  const rounded = [{ startMs: 21_460, text: '第一句' }, { startMs: 22_310, text: '这样也好' }, { startMs: 23_190, text: '继续走吧' }, { startMs: 27_000, text: '第四句' }]

  it('stay on their own line when lines are under 1.2 s apart', () => {
    expect(alignSecondaryTrack(base, rounded).map(line => line?.text)).toEqual(['第一句', '这样也好', '继续走吧', '第四句'])
  })

  it('still follow the lead rule when they are genuinely earlier than the line', () => {
    // 400 ms before its line and far from the previous one: it belongs to the line it leads.
    const early = [{ startMs: 26_600, text: '第四句' }]
    expect(alignSecondaryTrack(base, early).map(line => line?.text)).toEqual([undefined, undefined, undefined, '第四句'])
  })
})
