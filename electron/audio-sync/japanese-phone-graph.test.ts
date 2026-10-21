import { describe, expect, it } from 'vitest'
import { mapJapanesePhones, type JapanesePhoneMapping } from './japanese-phonemes'
import { buildJapanesePhoneGraph, type JapanesePhoneGraph } from './japanese-phone-graph'

const mapping = () => mapJapanesePhones('今日せい', [
  { surface_form: '今日', reading: 'キョウ', pronunciation: 'キョー' },
  { surface_form: 'せい', reading: 'セイ', pronunciation: 'セー' },
])

function paths(graph: JapanesePhoneGraph) {
  if (graph.reason !== 'ready') throw Error(graph.reason)
  const pathsTo = (index: number): string[][] => {
    const node = graph.nodes[index]
    return node.previous.length ? node.previous.flatMap(previous => pathsTo(previous).map(path => [...path, node.phone])) : [[node.phone]]
  }
  return graph.finalNodes.flatMap(index => pathsTo(index))
}

describe('Japanese explicit-reading phone DAG', () => {
  it('retains all four two-word variant combinations without expanding them as four sequences', () => {
    const graph = buildJapanesePhoneGraph(mapping(), 1)
    expect(graph.reason).toBe('ready')
    expect(graph.nodes).toHaveLength(8)
    expect(paths(graph)).toEqual([
      ['kyo', 'o', 'se', 'e'], ['kyo', 'u', 'se', 'e'],
      ['kyo', 'o', 'se', 'i'], ['kyo', 'u', 'se', 'i'],
    ])
    expect(graph.nodes.map(node => node.previous)).toEqual([[], [0], [], [2], [1, 3], [4], [1, 3], [6]])
    expect(graph.finalNodes).toEqual([5, 7])
    expect(graph.nodes.every((node, index) => node.previous.every(previous => previous < index))).toBe(true)
  })

  it('retains pronunciation provenance and original-word/reading spans on every node', () => {
    const graph = buildJapanesePhoneGraph(mapping(), 0)
    expect(graph.nodes[0]).toMatchObject({ phone: 'kyo', wordIndex: 0, variantIndex: 0, variantSource: 'pronunciation',
      variantPhoneIndex: 0, sourceStart: 0, sourceEnd: 2, readingStart: 0, readingEnd: 2 })
    expect(graph.nodes[3]).toMatchObject({ phone: 'u', wordIndex: 0, variantIndex: 1, variantSource: 'reading',
      variantPhoneIndex: 1, sourceStart: 0, sourceEnd: 2, readingStart: 2, readingEnd: 3 })
    expect(graph.words[0].variants.map(variant => variant.normalizedReading)).toEqual(['きょー', 'きょう'])
    expect(graph.sourceEnd).toBe(2)
    expect(paths(graph)).toEqual([['kyo', 'o'], ['kyo', 'u']])
  })

  it('does not merge repeated phones belonging to different source words', () => {
    const source = mapJapanesePhones('ああ', [{ surface_form: 'あ' }, { surface_form: 'あ' }])
    const graph = buildJapanesePhoneGraph(source, 1)
    expect(graph.nodes).toHaveLength(2)
    expect(graph.nodes.map(node => [node.phone, node.wordIndex, node.sourceStart, node.sourceEnd])).toEqual([
      ['a', 0, 0, 1], ['a', 1, 1, 2],
    ])
    expect(graph.nodes[1].previous).toEqual([0])
    expect(paths(graph)).toEqual([['a', 'a']])
  })

  it('retains identical input paths with different explicit reading provenance', () => {
    const source = mapJapanesePhones('あ', [{ surface_form: 'あ', pronunciation: 'ア' }])
    source.words[0].variants.push({ ...structuredClone(source.words[0].variants[0]), source: 'reading' })
    const graph = buildJapanesePhoneGraph(source, 0)
    expect(graph.nodes.map(node => [node.phone, node.variantIndex, node.variantSource])).toEqual([
      ['a', 0, 'pronunciation'], ['a', 1, 'reading'],
    ])
    expect(graph.finalNodes).toEqual([0, 1])
    expect(paths(graph)).toEqual([['a'], ['a']])
  })

  it('keeps punctuation and all prefix whitespace mapping without creating sounding nodes', () => {
    const source = mapJapanesePhones('  あ、 い。 ', [{ surface_form: 'あ' }, { surface_form: '、' },
      { surface_form: 'い' }, { surface_form: '。' }])
    const graph = buildJapanesePhoneGraph(source, 3)
    expect(graph.reason).toBe('ready')
    expect(graph.words.map(word => word.surface)).toEqual(['あ', '、', 'い', '。'])
    expect(graph.gaps.map(gap => gap.text)).toEqual(['  ', ' ', ' '])
    expect(graph.sourceEnd).toBe(8)
    expect(graph.nodes.map(node => [node.phone, node.wordIndex])).toEqual([['a', 0], ['i', 2]])
    expect(graph.nodes[1].previous).toEqual([0])
    const prefix = buildJapanesePhoneGraph(source, 1)
    expect(prefix.words.map(word => word.surface)).toEqual(['あ', '、'])
    expect(prefix.gaps.map(gap => gap.text)).toEqual(['  '])
    expect(prefix.sourceEnd).toBe(4)
    expect(paths(prefix)).toEqual([['a']])
  })

  it('rejects an unsupported word anywhere inside the requested prefix, without bridging it', () => {
    const source = mapJapanesePhones('あ3いAddict', [{ surface_form: 'あ' }, { surface_form: '3', reading: 'サン' },
      { surface_form: 'い' }, { surface_form: 'Addict', reading: 'アディクト' }])
    const prefix = buildJapanesePhoneGraph(source, 0)
    expect(prefix.reason).toBe('ready')
    expect(prefix.unsupported).toEqual([])
    expect(prefix.remainingUnsupported.map(span => span.surface)).toEqual(['3', 'Addict'])
    const rejected = buildJapanesePhoneGraph(source, 2)
    expect(rejected.reason).toBe('unsupported')
    expect(rejected.nodes).toEqual([])
    expect(rejected.finalNodes).toEqual([])
    expect(rejected.unsupported.map(span => span.surface)).toEqual(['3'])
    expect(rejected.remainingUnsupported.map(span => span.surface)).toEqual(['Addict'])
    expect(rejected.words.map(word => word.surface)).toEqual(['あ', '3', 'い'])
  })

  it('keeps an unrepresentable explicit reading as an unknown competitor instead of compiling only its supported alternative', () => {
    const source = mapJapanesePhones('君今日を', [{ surface_form: '君', reading: 'キミ' },
      { surface_form: '今日', pronunciation: 'キョー', reading: 'クァ' }, { surface_form: 'を', pronunciation: 'オ', reading: 'ヲ' }])
    expect(buildJapanesePhoneGraph(source, 0)).toMatchObject({ reason: 'ready', unsupported: [],
      remainingUnsupported: [{ wordIndex: 1, surface: '今日', reason: 'unsupported-reading' }] })
    expect(buildJapanesePhoneGraph(source, 1)).toMatchObject({ reason: 'unsupported', nodes: [], finalNodes: [],
      unsupported: [{ wordIndex: 1, surface: '今日', reason: 'unsupported-reading' }], remainingUnsupported: [] })
    expect(buildJapanesePhoneGraph(source, 2).reason).toBe('unsupported')
  })

  it('never truncates a node-limited variant set into a seemingly valid graph', () => {
    const exact = mapJapanesePhones('あ'.repeat(256), [{ surface_form: 'あ'.repeat(256) }])
    expect(buildJapanesePhoneGraph(exact, 0).nodes).toHaveLength(256)
    const over = mapJapanesePhones('あ'.repeat(257), [{ surface_form: 'あ'.repeat(257) }])
    expect(buildJapanesePhoneGraph(over, 0)).toMatchObject({ reason: 'work-budget', nodes: [], finalNodes: [] })
    const alternatives = mapJapanesePhones('あ'.repeat(130), [{ surface_form: 'あ'.repeat(130),
      reading: 'ア'.repeat(130), pronunciation: 'イ'.repeat(130) }])
    expect(buildJapanesePhoneGraph(alternatives, 0).reason).toBe('work-budget')
  })

  it('enforces the edge budget even when a DAG has fewer than 256 nodes', () => {
    const source = mapJapanesePhones('あ'.repeat(8), Array.from({ length: 8 }, () => ({ surface_form: 'あ' })))
    // Structural fixture: many explicit one-phone variants. Duplicates are
    // intentionally retained, as the builder is not a provenance optimizer.
    for (const word of source.words) word.variants = Array.from({ length: 16 }, () => structuredClone(word.variants[0]))
    expect(buildJapanesePhoneGraph(source, 7)).toMatchObject({ reason: 'work-budget', nodes: [], finalNodes: [] })
    const exact = buildJapanesePhoneGraph(source, 4)
    expect(exact.reason).toBe('ready')
    expect(exact.nodes.reduce((sum, node) => sum + node.previous.length, 0)).toBe(1024)
    expect(buildJapanesePhoneGraph(source, 5).reason).toBe('work-budget')
  })

  it('rejects punctuation-only prefixes rather than manufacturing an acoustic target', () => {
    const source = mapJapanesePhones('（…）あ', ['（', '…', '）', 'あ'].map(surface_form => ({ surface_form })))
    expect(buildJapanesePhoneGraph(source, 2)).toMatchObject({ reason: 'empty-prefix', nodes: [], finalNodes: [] })
    expect(buildJapanesePhoneGraph(source, 3).nodes[0].previous).toEqual([])
  })

  it('copies source metadata so mutating a result cannot corrupt another candidate', () => {
    const source = mapping()
    const first = buildJapanesePhoneGraph(source, 1)
    first.words[0].variants[0].phones[0].sourceStart = 99
    first.words[0].variants[0].normalizedReading = 'bad'
    first.nodes[0].previous.push(99)
    expect(buildJapanesePhoneGraph(source, 1).nodes[0].sourceStart).toBe(0)
    expect(source.words[0].variants[0].normalizedReading).toBe('きょー')
    const unknown = mapJapanesePhones('あ3', [{ surface_form: 'あ' }, { surface_form: '3' }])
    buildJapanesePhoneGraph(unknown, 0).remainingUnsupported[0].surface = 'bad'
    expect(unknown.unsupported[0].surface).toBe('3')
  })

  it('rejects invalid prefix boundaries and mappings instead of returning partial source coverage', () => {
    for (const end of [-1, .5, 2, NaN, Infinity]) expect(buildJapanesePhoneGraph(mapping(), end).reason).toBe('invalid-input')
    const corruptions: Array<(value: JapanesePhoneMapping) => void> = [
      value => { value.words[0].variants[0].phones[0].wordIndex = 1 },
      value => { value.words[0].variants[0].phones[0].readingStart = 1 },
      value => { value.words[1].sourceStart++ },
      value => { value.words[0].variants = [] },
      value => { value.phones[0] = { ...value.phones[0], phone: 'a' } },
      value => { value.words[0].wordIndex = 4 },
      value => { value.gaps.push({ sourceStart: 0, sourceEnd: 1, text: ' ' }) },
    ]
    for (const corrupt of corruptions) {
      const source = mapping()
      corrupt(source)
      expect(buildJapanesePhoneGraph(source, 1)).toMatchObject({ reason: 'invalid-input', nodes: [], finalNodes: [] })
    }
    const unknown = mapJapanesePhones('あ3', [{ surface_form: 'あ' }, { surface_form: '3' }])
    unknown.unsupported = []
    expect(buildJapanesePhoneGraph(unknown, 0).reason).toBe('invalid-input')
    expect(buildJapanesePhoneGraph(null as unknown as JapanesePhoneMapping, 0).reason).toBe('invalid-input')
    expect(buildJapanesePhoneGraph(mapJapanesePhones('君', []), 0).reason).toBe('invalid-input')
  })
})
