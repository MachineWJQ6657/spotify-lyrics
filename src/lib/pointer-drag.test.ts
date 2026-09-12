import { describe, expect, it, vi } from 'vitest'
import { finishPointerDrag } from './pointer-drag'

describe('pointer drag completion', () => {
  it('ends active capture once across pointerup, lostcapture and blur', () => {
    const ref = { current: { pointerId: 7, active: true } as { pointerId: number; active: boolean } | null }
    const end = vi.fn(() => expect(ref.current).toBeNull())
    expect(finishPointerDrag(ref, end, 7)).toBe(true)
    expect(finishPointerDrag(ref, end, 7)).toBe(false)
    expect(finishPointerDrag(ref, end)).toBe(false)
    expect(end).toHaveBeenCalledTimes(1)
  })
  it('does not let another pointer cancel a drag or turn a click into a drag-end', () => {
    const ref = { current: { pointerId: 7, active: false } as { pointerId: number; active: boolean } | null }
    const end = vi.fn()
    expect(finishPointerDrag(ref, end, 8)).toBe(false)
    expect(ref.current).not.toBeNull()
    expect(finishPointerDrag(ref, end, 7)).toBe(true)
    expect(end).not.toHaveBeenCalled()
  })
})
