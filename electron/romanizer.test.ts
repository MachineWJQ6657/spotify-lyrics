import { describe, expect, it } from 'vitest'
import { romanizeLines } from './romanizer'

describe('Japanese romanization', () => {
  it('uses morphological readings for kanji rather than leaving them untouched', async () => {
    const [value] = await romanizeLines(['夜明け前の街を歩く'])
    expect(value).toContain('yoake mae no machi')
    expect(value).not.toContain('夜明け')
  })

  it('fully converts mixed kanji and kana with readable word spacing', async () => {
    const [value] = await romanizeLines(['喜んで会いに行くから'])
    expect(value).toBe('yorokonde ai ni iku kara')
    expect(value).not.toMatch(/[\u3040-\u30ff\u3400-\u9fff]/)
  })
})
