import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

interface CaptureBlock {
  pcm: Float32Array
  sampleRate: number
  startContextTime: number
  endContextTime: number
  continuityId: number
}

function captureHarness() {
  const blocks: CaptureBlock[] = []
  const gaps: Array<{ type: 'gap'; continuityId: number }> = []
  let Capture!: new () => { process(inputs: Float32Array[][]): boolean; port: { onmessage(event: unknown): void } }
  const context = {
    sampleRate: 8000, currentFrame: 0, currentTime: 0,
    AudioWorkletProcessor: class { port = { postMessage: (block: CaptureBlock | { type: 'gap'; continuityId: number }) => 'type' in block ? gaps.push(block) : blocks.push(block) } },
    registerProcessor: (_name: string, processor: typeof Capture) => { Capture = processor },
  }
  runInNewContext(readFileSync(new URL('../../public/audio-sync-worklet.js', import.meta.url), 'utf8'), context)
  const capture = new Capture()
  const step = (value: number | null, frameCount = 128) => {
    context.currentTime = context.currentFrame / context.sampleRate
    capture.process(value === null ? [] : [[new Float32Array(frameCount).fill(value)]])
    context.currentFrame += frameCount
  }
  const seconds = (duration: number, value: number | null) => {
    for (let remaining = Math.round(duration * context.sampleRate); remaining > 0; remaining -= 128) step(value, Math.min(128, remaining))
  }
  return { blocks, gaps, context, step, seconds, reset: () => capture.port.onmessage({ data: { type: 'reset' } }) }
}

describe('continuous audio capture blocks', () => {
  it('notifies once per missing-input episode and does not echo a controller reset', () => {
    const capture = captureHarness()
    capture.seconds(8, .25)
    capture.seconds(5, null)
    expect(capture.gaps).toEqual([{ type: 'gap', continuityId: 1 }])
    capture.reset()
    capture.seconds(3, null)
    expect(capture.gaps).toHaveLength(1)
    capture.seconds(12, .5)
    expect(capture.blocks[0].continuityId).toBe(2)
    expect(capture.blocks[0].startContextTime).toBe(16)
  })
  it('preserves uninterrupted twelve-second block timestamps and samples', () => {
    const capture = captureHarness()
    capture.seconds(24, .25)
    expect(capture.blocks).toHaveLength(2)
    for (const [index, block] of capture.blocks.entries()) {
      expect(block.pcm).toHaveLength(96000)
      expect(block.pcm.every(value => value === .25)).toBe(true)
      expect(block.startContextTime).toBeCloseTo(index * 12)
      expect(block.endContextTime).toBeCloseTo((index + 1) * 12)
      expect(block.continuityId).toBe(0)
    }
  })

  it('discards audio preceding absent input instead of compressing the missing time', () => {
    const capture = captureHarness()
    capture.seconds(8, .25)
    capture.seconds(5, null)
    capture.seconds(4, .5)
    expect(capture.blocks).toHaveLength(0)
    capture.seconds(8, .5)
    expect(capture.blocks).toHaveLength(1)
    const block = capture.blocks[0]
    expect(block.pcm.every(value => value === .5)).toBe(true)
    expect(block.startContextTime).toBeCloseTo(13)
    expect(block.endContextTime).toBeCloseTo(25)
    expect(block.continuityId).toBe(1)
  })

  it('also discards a partial block after an unreported render-frame jump', () => {
    const capture = captureHarness()
    capture.seconds(8, .25)
    capture.context.currentFrame += 5 * capture.context.sampleRate
    capture.seconds(4, .5)
    expect(capture.blocks).toHaveLength(0)
    capture.seconds(8, .5)
    expect(capture.blocks[0].startContextTime).toBeCloseTo(13)
    expect(capture.blocks[0].endContextTime).toBeCloseTo(25)
    expect(capture.blocks[0].continuityId).toBe(1)
    expect(capture.blocks[0].pcm.every(value => value === .5)).toBe(true)
  })

  it('marks a gap between full blocks so downstream clocks can discard old evidence', () => {
    const capture = captureHarness()
    capture.seconds(12, .25)
    capture.seconds(2, null)
    capture.seconds(12, .5)
    expect(capture.blocks.map(block => block.continuityId)).toEqual([0, 1])
    expect(capture.blocks[1].startContextTime).toBeCloseTo(14)
    expect(capture.blocks[1].endContextTime).toBeCloseTo(26)
  })
})
