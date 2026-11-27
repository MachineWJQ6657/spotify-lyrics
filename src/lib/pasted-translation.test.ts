import { describe, expect, it } from 'vitest'
import { alignPastedLines, pastedTranslationTrack, readPastedText, PASTED_SOURCE } from './pasted-translation'
import { glossStems, lexicalReader, loadLexicon } from './ja-en-lexicon'
import { stemOf, stemsOf } from './english-stems.mjs'
import type { LyricTrack } from '../types'

// Sentences written for this test, not lyrics.
const ROWS = ['今日は天気がいい', '明日は雨が降るらしい', '駅まで歩いて行く', '友達と映画を見た', '夜は星がきれいだった', '朝ごはんにパンを食べた', '古い手紙を箱にしまった', '海の音が遠くで聞こえる']
const ENGLISH = ['The weather is nice today', 'They say it will rain tomorrow', 'I walk to the station', 'I watched a movie with a friend', 'The stars were beautiful at night', 'I ate bread for breakfast', 'I put the old letters away in a box', 'I can hear the sound of the sea far away']
const original = (texts = ROWS): LyricTrack => ({ id: 'o', language: 'ja', label: '日本語', kind: 'original', source: 's', lines: texts.map((text, index) => ({ startMs: index * 4000, text })) })

describe('reading a pasted translation', () => {
  it('drops section labels and page furniture and keeps the verses apart', () => {
    const read = readPastedText('12 Contributors\n[Verse 1]\nline one\nline two\n\n(Chorus)\nline three\nYou might also like\nline four\n\n\nBridge:\nline five\n3Embed', 'en')
    expect(read.timed).toBe(false)
    expect(read.stanzas).toEqual([['line one', 'line two'], ['line three', 'line four'], ['line five']])
  })

  it('leaves out lines in the script of the original when a page shows both', () => {
    expect(readPastedText('今日は天気がいい\nThe weather is nice today\n明日は雨\nRain tomorrow', 'en').stanzas).toEqual([['The weather is nice today', 'Rain tomorrow']])
    // A Chinese translation is in Han characters itself: only kana marks the Japanese.
    expect(readPastedText('今日は天気がいい\n今天天气很好', 'zh-Hans').stanzas).toEqual([['今天天气很好']])
  })

  it('recognises a timed lyric file', () => {
    const read = readPastedText('[00:01.00]one\n[00:05.50]two\n[00:09.00]three', 'en')
    expect(read.timed).toBe(true)
    expect(read.stanzas).toEqual([['one', 'two', 'three']])
  })
})

describe('putting a pasted translation on the rows', () => {
  it('goes on line for line when there is one line per row and nothing to check the meaning with', () => {
    expect(alignPastedLines(['a', 'b', 'c'], [['x', 'y'], ['z']])).toEqual({ texts: ['x', 'y', 'z'], lineForLine: true })
  })

  it('finds a line that was split in two and one that stands for two rows', async () => {
    const reader = lexicalReader(await loadLexicon())
    // "I walk / to the station" is one row; rows 4 and 5 are one line in the translation.
    const pasted = [[ENGLISH[0], ENGLISH[1], 'I walk', 'to the station'], [`${ENGLISH[3]}, ${ENGLISH[4].toLowerCase()}`, ENGLISH[5], ENGLISH[6], ENGLISH[7]]]
    const result = alignPastedLines(ROWS, pasted, reader)
    expect(result.lineForLine).toBe(false)
    expect(result.texts[0]).toBe(ENGLISH[0])
    expect(result.texts[2]).toBe('I walk to the station')
    expect(result.texts[3]).toBe(`${ENGLISH[3]}, ${ENGLISH[4].toLowerCase()}`)
    expect(result.texts[4]).toBe('')
    expect(result.texts.slice(5)).toEqual(ENGLISH.slice(5))
  })

  it('sees through a merge and a split that leave the count unchanged', async () => {
    const reader = lexicalReader(await loadLexicon())
    // Eight lines for eight rows, but rows 2 and 3 share a line and row 7 has two.
    const pasted = [[ENGLISH[0], `${ENGLISH[1]} and ${ENGLISH[2]}`, ENGLISH[3], ENGLISH[4], ENGLISH[5], ENGLISH[6], 'I can hear the sound of the sea', 'far away']]
    const result = alignPastedLines(ROWS, pasted, reader)
    expect(result.lineForLine).toBe(false)
    expect(result.texts[3]).toBe(ENGLISH[3])
    expect(result.texts[6]).toBe(ENGLISH[6])
    expect(result.texts[7]).toBe('I can hear the sound of the sea far away')
  })

  it('keeps a true line-for-line translation line for line when it checks the meaning', async () => {
    const result = alignPastedLines(ROWS, [ENGLISH], lexicalReader(await loadLexicon()))
    expect(result).toEqual({ texts: ENGLISH, lineForLine: true })
  })

  it('loses no line: one that no row takes joins its neighbour', () => {
    const result = alignPastedLines(['短い', 'とても長い長い長い長い行です', '短い'], [['a', 'a very very very long long line', 'b', 'c d']], undefined)
    expect(result.texts.join(' ').split(' ').sort()).toEqual('a a very very very long long line b c d'.split(' ').sort())
  })
})

describe('the track a paste becomes', () => {
  it('is a translation on the times of the original, credits left alone', async () => {
    const song = original(['作词 : someone', ...ROWS])
    const result = pastedTranslationTrack(song, ENGLISH.join('\n'), 'en', lexicalReader(await loadLexicon()))!
    expect(result).toMatchObject({ lines: 8, rows: 8, placed: 'line-for-line' })
    expect(result.track).toMatchObject({ id: 'pasted-en', language: 'en', label: 'English', kind: 'translation', source: PASTED_SOURCE })
    expect(result.track.lines.map(line => line.startMs)).toEqual(song.lines.map(line => line.startMs))
    expect(result.track.lines[0].text).toBe('')
    expect(result.track.lines[1].text).toBe(ENGLISH[0])
  })

  it('takes a timed lyric file by its own times', () => {
    const result = pastedTranslationTrack(original(), '[00:00.00]one\n[00:04.00]two\n[00:08.00]three\n[00:12.00]four', 'en')!
    expect(result.placed).toBe('timed')
    expect(result.track.lines.map(line => [line.startMs, line.text])).toEqual([[0, 'one'], [4000, 'two'], [8000, 'three'], [12_000, 'four']])
  })

  it('refuses what is too little to be the song', () => {
    expect(pastedTranslationTrack(original(), 'just a title', 'en')).toBeNull()
    expect(pastedTranslationTrack(original(), 'one\ntwo', 'en')).toBeNull()
    expect(pastedTranslationTrack(original(), '今日は天気がいい\n明日は雨が降るらしい\n駅まで歩いて行く', 'en')).toBeNull()
  })
})

describe('the dictionary side', () => {
  it('gives the English stems a Japanese line is glossed with, inflected words included', async () => {
    const lexicon = await loadLexicon()
    const stems = glossStems('駅まで歩いて行く', lexicon)
    expect(stems.has(stemOf('station'))).toBe(true)
    expect(stems.has(stemOf('walk'))).toBe(true)
    expect(glossStems('ねえ、ねえ', lexicon).size).toBe(0)
  })

  it('cuts both sides the same way', () => {
    expect(stemOf('running')).toBe(stemOf('run'))
    expect(stemOf('stars')).toBe(stemOf('star'))
    expect(stemOf('hoped')).toBe(stemOf('hope'))
    expect([...stemsOf("I'm walking to the stations")]).toEqual([stemOf('walk'), stemOf('station')])
  })
})
