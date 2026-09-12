import { describe, expect, it } from 'vitest'
import { activeLineIndex, alignSecondaryTrack, detectLyricsLanguage, languageFromFilename, makeTrack, nearestLine, parseLrc, serializeLrc, visibleTracks } from './lyrics'

describe('LRC parsing', () => {
  it('parses centiseconds, milliseconds, repeated timestamps, and offset', () => {
    const lines = parseLrc('[offset:100]\n[00:01.50][00:02.500] hello\n[00:05.00]world')
    expect(lines.map(line => line.startMs)).toEqual([1600, 2600, 5100])
    expect(lines[0].text).toBe('hello')
    expect(lines[1].endMs).toBe(5100)
  })

  it('finds active and nearest translated lines without exact timestamps', () => {
    const lines = parseLrc('[00:01.00]one\n[00:04.00]two\n[00:08.00]three')
    expect(activeLineIndex(lines, 6500)).toBe(1)
    expect(nearestLine(lines, 4300)?.text).toBe('two')
    expect(nearestLine(lines, 15_000)).toBeUndefined()
  })

  it('keeps every translated phrase when the source groups two phrases into one line', () => {
    const original = parseLrc('[00:00.00]first half second half\n[00:17.00]next line')
    const translated = parseLrc('[00:03.78]第一句\n[00:10.17]第二句\n[00:16.60]下一行')
    const aligned = alignSecondaryTrack(original, translated)
    expect(aligned[0]?.text).toBe('第一句　第二句')
    expect(aligned[1]?.text).toBe('下一行')
  })

  it('keeps one translated sentence visible across short split source phrases', () => {
    const original = parseLrc('[01:00.88]きっと人生最後の日を\n[01:04.38]前に思うのだろう\n[01:06.29]全部全部言い足りなくて')
    const translated = parseLrc('[01:00.88]想必在人生最后那天会想起吧\n[01:06.29]虽然没能说完所有话很遗憾')
    const aligned = alignSecondaryTrack(original, translated)
    expect(aligned.map(line => line?.text)).toEqual([
      '想必在人生最后那天会想起吧',
      '想必在人生最后那天会想起吧',
      '虽然没能说完所有话很遗憾'
    ])
  })

  it('does not carry a sparse translation through a long instrumental gap', () => {
    const original = parseLrc('[00:01.00]始まりの歌\n[00:14.00]間奏の後\n[00:18.00]次の歌')
    const translated = parseLrc('[00:01.00]开场的歌\n[00:18.00]下一段歌')
    const aligned = alignSecondaryTrack(original, translated)
    expect(aligned[1]).toBeUndefined()
  })

  it('infers language suffixes used for multi-file import', () => {
    expect(languageFromFilename('song.zh.lrc').code).toBe('zh-Hans')
    expect(languageFromFilename('song.romaji.lrc').kind).toBe('romanization')
    expect(languageFromFilename('song.ja.lrc').kind).toBe('original')
  })

  it('round-trips edited tracks back to LRC', () => {
    const track = makeTrack('x', 'en', 'English', 'translation', '[00:01.23]hello\n[01:02.34]world')
    expect(serializeLrc(track)).toBe('[00:01.23]hello\n[01:02.34]world\n')
  })

  it('removes timed production credits from the opening lyric sequence', () => {
    const lines = parseLrc('[00:00.00]作词 : tuki.\n[00:01.00]作曲：tuki.\n[00:03.00]一生に一度だから')
    expect(lines.map(line => line.text)).toEqual(['一生に一度だから'])
  })

  it('drops empty timing markers that would make the transparent overlay vanish', () => {
    const lines = parseLrc('[00:01.00]first line\n[00:03.00]   \n[00:05.00]last line\n[03:55.00]')
    expect(lines.map(line => line.text)).toEqual(['first line', 'last line'])
    expect(lines[0].endMs).toBe(5000)
  })

  it('distinguishes Japanese kana, Chinese text, and Latin lyrics', () => {
    expect(detectLyricsLanguage('[00:01.00]喜んで会いに行く')).toBe('ja')
    expect(detectLyricsLanguage('[00:01.00]她想去南方')).toBe('zh-Hans')
    expect(detectLyricsLanguage('[00:01.00]Tonight we dance')).toBe('en')
  })

  it('always keeps the source track as the timing anchor', () => {
    const original = makeTrack('original', 'en', 'English', 'original', '[00:01.00]Tonight we dance')
    const translation = makeTrack('translation', 'zh-Hans', '中文', 'translation', '[00:01.00]今夜起舞')
    const visible = visibleTracks({ trackId: 'song', tracks: [original, translation] }, ['zh-Hans'], false)
    expect(visible.map(track => track.id)).toEqual(['original', 'translation'])
  })
})
