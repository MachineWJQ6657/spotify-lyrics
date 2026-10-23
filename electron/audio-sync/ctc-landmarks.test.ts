import { describe, expect, it } from 'vitest'
import { extractCtcLandmarks } from './ctc-landmarks'
import type { CtcOutput } from './ctc-tokens'
import type { JapaneseWord } from '../romanizer'
import { analyzeJapaneseLines } from '../romanizer'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const phones = ['a', 'ka', 'sa', 'ta', 'na', 'ha', 'ma', 'ya', 'ra', 'wa', 'i', 'o', 'wo', 'ki', 'N', 'cl']
const kana = 'あかさたなはまや'
const word = (surface_form: string, reading?: string, pronunciation?: string): JapaneseWord => ({ surface_form, reading, pronunciation })
function audio(): CtcOutput {
  const vocabulary = ['<blank>', ...phones]
  const logits = new Float32Array(299 * vocabulary.length).fill(-8)
  for (let frame = 0; frame < 299; frame++) logits[frame * vocabulary.length] = 8
  return { vocabulary, blankId: 0, logits,
    geometry: { sampleRate: 16000, sampleCount: 96000, strideSamples: 320, receptiveFieldSamples: 400 } }
}
function emit(value: CtcOutput, sequence = phones.slice(0, 8), start = 30, weak = -1) {
  sequence.forEach((phone, index) => {
    const frame = start + 5 * index, offset = frame * value.vocabulary.length
    if (index === weak) {
      value.logits.fill(0, offset, offset + value.vocabulary.length)
      value.logits[offset + value.vocabulary.indexOf(phone)] = 1
    } else {
      value.logits[offset] = -8
      value.logits[offset + value.vocabulary.indexOf(phone)] = 8
    }
  })
  return value
}
function extract(value: CtcOutput, texts = [kana], words = texts.map(text => [word(text)]), limits = {}) {
  return extractCtcLandmarks(value, texts.map((text, index) => ({ startMs: 10000 + index * 50000, text })), words, 6000, limits)
}

describe('shadow-only whole-source CTC pronunciation hypotheses', () => {
  it('retains actual model frame coordinates without publishing a clock or claiming calibrated coverage', () => {
    const result = extract(emit(audio()))
    expect(result.reason).toBe('hypotheses')
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0]).toMatchObject({ heardMs: 600, choices: [{ lineIndex: 0, sourceMs: 10000, role: 'eligible' }] })
    expect(result.candidates[0]).toMatchObject({ firstFrameRange: { earliest: 30, latest: 30 }, witnessHeardMs: 600,
      labelCount: 8, lastFrameExclusive: 66, firstWordIndex: 0, lastWordIndex: 0 })
    expect(result.coverage.complete).toBe(false)
    expect(result.coverage.reasons).toContain('uncalibrated-acoustic-onsets')
    expect(result).not.toHaveProperty('anchor'); expect(result).not.toHaveProperty('rate')
    expect(result).not.toHaveProperty('accepted'); expect(result.candidates[0]).not.toHaveProperty('heardMs')
  })

  it('keeps every repeated source occurrence even when their scores are identical', () => {
    const result = extract(emit(audio()), [kana, kana, kana])
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0].choices.map(choice => choice.lineIndex)).toEqual([0, 1, 2])
    expect(result.groups[0].choices.map(choice => choice.sourceMs)).toEqual([10000, 60000, 110000])
    expect(result.groups[0].choices.every(choice => choice.role === 'eligible')).toBe(true)
  })

  it('preserves separate repetitions WITHIN a recording rather than only a global best ending', () => {
    const value = emit(audio()); emit(value, phones.slice(0, 8), 130)
    const result = extract(value)
    expect(result.groups.map(group => group.heardMs)).toEqual([600, 2600])
    expect(result.candidates.map(candidate => candidate.witnessHeardMs)).toEqual([600, 2600])
  })

  it('marks an internal known-word match as unresolved and never invents its source timestamp', () => {
    const result = extract(emit(audio()), [kana, `らわ${kana}`], [[word(kana)], [word('らわ'), word(kana)]])
    expect(result.groups[0]).toMatchObject({ heardMs: 600, unresolvedInternalCompetitor: true,
      choices: [{ lineIndex: 0, role: 'eligible' }] })
    const internal = result.candidates.find(candidate => candidate.kind === 'internal-word')!
    expect(internal).toMatchObject({ lineIndex: 1, firstWordIndex: 1, witnessHeardMs: 600 })
    expect(internal).not.toHaveProperty('sourceMs')
  })

  it('keeps unsupported words anywhere in the source explicit instead of declaring a matched row globally safe', () => {
    const result = extract(emit(audio()), [kana, '4000円', `謎${kana}`], [
      [word(kana)], [word('4000'), word('円', 'エン')], [word('謎'), word(kana)]
    ])
    expect(result.reason).toBe('hypotheses')
    expect(result.coverage.complete).toBe(false)
    expect(result.coverage.reasons).toContain('unsupported-source')
    expect(result.coverage.unsupportedSpans).toEqual(expect.arrayContaining([
      expect.objectContaining({ lineIndex: 1, wordIndex: 0, reason: 'number' }),
      expect.objectContaining({ lineIndex: 2, wordIndex: 0, reason: 'unknown-reading' }),
    ]))
    expect(result.groups[0].unresolvedInternalCompetitor).toBe(true)
  })

  it('keeps a weak zero-cost occurrence as veto rather than dropping it to produce false uniqueness', () => {
    const text = `${kana}ら`, value = emit(audio(), phones.slice(0, 9), 30, 0)
    const result = extract(value, [text])
    expect(result.reason).toBe('hypotheses')
    expect(result.groups[0].choices[0].role).toBe('veto')
    expect(result.groups[0].choices[0].score).toBeLessThan(.95)
    expect(result.candidates[0].firstPeakPosterior).toBeLessThan(.5)
  })

  it('tries all independent pronunciation alternatives without enumerating or truncating combinations', () => {
    const text = 'あをかをさをたを'
    const words = [word('あを', 'アヲ', 'アオ'), word('かを', 'カヲ', 'カオ'), word('さを', 'サヲ', 'サオ'), word('たを', 'タヲ', 'タオ')]
    const result = extract(emit(audio(), ['a', 'wo', 'ka', 'wo', 'sa', 'o', 'ta', 'wo']), [text], [words])
    expect(result.groups[0].choices[0].role).toBe('eligible')
    expect(result.coverage.graphsPrepared).toBe(1)
    expect(result.candidates[0].labelCount).toBe(8)
  })

  it('searches every complete-word endpoint, not just a selected first/last prefix', () => {
    const text = `${kana}らわ`, words = [...kana].map(surface => word(surface)).concat([word('ら'), word('わ')])
    const result = extract(emit(audio(), phones.slice(0, 10)), [text], [words])
    expect(result.coverage.graphsPrepared).toBe(6) // 8/9/10 at row start, 8/9 and8 internal
    expect(result.candidates.filter(candidate => candidate.kind === 'line-start').map(candidate => candidate.lastWordIndex)).toEqual([7, 8, 9])
    expect(result.groups[0].choices).toHaveLength(1)
  })

  it('does not mistake all-blank or flat logits for supported lyrics even though forced CTC can fit them', () => {
    expect(extract(audio())).toMatchObject({ reason: 'insufficient-words', groups: [], candidates: [] })
    const value = audio(); value.logits.fill(0)
    const result = extract(value)
    expect(result).toMatchObject({ reason: 'insufficient-words', groups: [], candidates: [] })
    expect(result.coverage.work).toBe(0)
  })

  it('does not accept a wrong source because it is the least bad forced fit', () => {
    const result = extract(emit(audio()), ['やまはなたさかあ'])
    expect(result.groups).toEqual([])
    expect(result.candidates).toEqual([])
    expect(result.reason).toBe('insufficient-words')
  })

  it('retains uncertainty when a sustained first phone has multiple exactly optimal acoustic start frames', () => {
    const value = emit(audio())
    value.logits[31 * value.vocabulary.length] = -8
    value.logits[31 * value.vocabulary.length + value.vocabulary.indexOf('a')] = 8
    const result = extract(value)
    expect(result.coverage.reasons).toContain('ambiguous-acoustic-start')
    expect(result.candidates[0]).toMatchObject({ firstFrameRange: { earliest: 30, latest: 31 }, role: 'veto' })
    expect(result.groups).toEqual([])
  })

  it('does not clip a dictionary word to manufacture an eight-phone word boundary', () => {
    const text = 'あ'.repeat(40)
    const result = extract(emit(audio()), [text])
    expect(result.groups).toEqual([])
    expect(result.coverage.reasons).toContain('short-source-row')
    expect(result.coverage.graphsPrepared).toBe(0)
  })

  it('completes a sustained terminal run before testing its peak posterior', () => {
    const value = emit(audio())
    const last = 65 * value.vocabulary.length
    value.logits.fill(0, last, last + value.vocabulary.length)
    value.logits[last + value.vocabulary.indexOf('ya')] = 2
    value.logits[66 * value.vocabulary.length] = -8
    value.logits[66 * value.vocabulary.length + value.vocabulary.indexOf('ya')] = 8
    const result = extract(value)
    expect(result.candidates[0].lastPeakPosterior).toBeGreaterThan(.99)
    expect(result.groups[0].choices[0].role).toBe('eligible')
  })

  it('abstains as a whole when a graph, trace or cumulative work budget would omit competitors', () => {
    const value = emit(audio())
    for (const [texts, limits] of [
      [[kana, kana], { graphs: 1 }], [[kana], { work: 1 }], [[kana, kana], { candidates: 1 }]
    ] as const) {
      const result = extract(value, [...texts], undefined, limits)
      expect(result).toMatchObject({ reason: 'work-budget', groups: [], candidates: [] })
      expect(result.coverage.reasons).toContain('work-budget')
    }
    const repeated = emit(audio()); emit(repeated, phones.slice(0, 8), 130); emit(repeated, phones.slice(0, 8), 230)
    expect(extract(repeated, [kana], undefined, { endTraces: 1 })).toMatchObject({ reason: 'work-budget', groups: [], candidates: [] })
  })

  it('searches a normal 54-row song within the default work limit without media-position pruning', () => {
    // All complete-word endpoints and internal starts must be searched even
    // though none of these intentionally wrong rows matches this recording.
    const texts = Array.from({ length: 54 }, () => 'らわら'.repeat(8))
    const result = extractCtcLandmarks(emit(audio()), texts.map((text, index) => ({ startMs: index * 5000, text })),
      texts.map(() => Array.from({ length: 8 }, () => word('らわら'))), 6000)
    expect(result.reason).toBe('insufficient-words')
    expect(result.coverage.graphsPrepared).toBe(1134)
    expect(result.coverage.graphsScored).toBe(1134)
    expect(result.coverage.work).toBeLessThan(120_000_000)
    expect(result.coverage.reasons).not.toContain('work-budget')
  })

  it('retains missing-vocabulary coverage rather than treating omitted source alternatives as absent', () => {
    const result = extract(emit(audio()), [kana, 'ぜ'.repeat(8)])
    expect(result.reason).toBe('hypotheses')
    expect(result.groups[0].choices).toHaveLength(1)
    expect(result.coverage.reasons).toContain('model-vocabulary')
    expect(result.coverage.complete).toBe(false)
  })

  it('rejects malformed references, missing rows, geometry/duration disagreement and unsafe limits', () => {
    const value = emit(audio())
    for (const result of [
      extractCtcLandmarks(value, [{ startMs: 0, text: kana }], [], 6000),
      extractCtcLandmarks(value, [{ startMs: NaN, text: kana }], [[word(kana)]], 6000),
      extractCtcLandmarks(value, [{ startMs: 0, text: kana }], [[word('あ')]], 6000),
      extractCtcLandmarks(value, [{ startMs: 0, text: kana }], [[word(kana)]], 12000),
      extract(value, [kana], undefined, { work: Infinity }),
      extract(value, [kana], undefined, { graphs: 3000 }),
      extract(value, [kana], undefined, Object.assign(Object.create({ work: 1 }), {})),
      extract(value, [kana], undefined, { [Symbol('work')]: 1 }),
    ]) expect(result).toMatchObject({ reason: 'invalid-input', groups: [], candidates: [] })
    expect(extractCtcLandmarks(value, new Array(1), new Array(1), 6000).reason).toBe('invalid-input')
  })
})

// Opt-in LOCAL replay: no recording, download, upload, clock, or private fixture
// in the repository. The console summary deliberately excludes lyric text and
// audio; it makes typical-song budget/coverage failures reproducible.
it.skipIf(!process.env.CTC_LANDMARK_EVIDENCE_ROOT)('reports local saved whole-song diagnostics without accepting a clock', async () => {
  const root = process.env.CTC_LANDMARK_EVIDENCE_ROOT!
  const snapshot = JSON.parse(await readFile(process.env.CTC_LANDMARK_SOURCE!, 'utf8'))
  const lines: Array<{ startMs: number; text: string }> = snapshot.documents[0].tracks.find((track: { kind: string; language: string }) =>
    track.kind === 'original' && track.language === 'ja').lines
  const words = await analyzeJapaneseLines(lines.map(line => line.text))
  const vocabularyRecord = JSON.parse(await readFile(process.env.CTC_LANDMARK_VOCABULARY!, 'utf8')) as Record<string, number>
  const vocabulary: string[] = []
  for (const [phone, id] of Object.entries(vocabularyRecord)) vocabulary[id] = phone
  const entries = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')) as Array<{ identifier: string; samples: number }>
  const summaries = []
  for (const entry of entries) {
    const logitsBuffer = await readFile(join(root, `${entry.identifier}.f32`))
    const idsBuffer = await readFile(join(root, `${entry.identifier}.i32`))
    const output: CtcOutput = { vocabulary, blankId: 0,
      logits: new Float32Array(logitsBuffer.buffer.slice(logitsBuffer.byteOffset, logitsBuffer.byteOffset + logitsBuffer.length)),
      predictedIds: new Int32Array(idsBuffer.buffer.slice(idsBuffer.byteOffset, idsBuffer.byteOffset + idsBuffer.length)),
      geometry: { sampleRate: 16000, sampleCount: entry.samples, strideSamples: 320, receptiveFieldSamples: 400 } }
    const started = performance.now()
    const result = extractCtcLandmarks(output, lines, words, entry.samples / 16)
    summaries.push({ clip: entry.identifier, elapsedMs: Math.round(performance.now() - started), reason: result.reason,
      groups: result.groups.length, eligibleChoices: result.groups.reduce((sum, group) => sum + group.choices.filter(choice => choice.role === 'eligible').length, 0),
      candidates: result.candidates.length, coverage: result.coverage })
    expect(result.coverage.complete).toBe(false)
    expect(result).not.toHaveProperty('anchor')
  }
  console.info('LOCAL_CTC_LANDMARK_DIAGNOSTICS', JSON.stringify(summaries))
}, 60000)
