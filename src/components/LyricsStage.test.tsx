import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { LyricsStage } from './LyricsStage'

it('renders untimed original as readable text without an active-line or follow claim', () => {
  const html = renderToStaticMarkup(<LyricsStage document={{ trackId: 'fixture', tracks: [],
    untimedOriginal: { text: 'テストの一行です\n次のテストの行です', language: 'ja', source: 'Spotify' },
    textReference: { referenceSource: 'Spotify', status: 'conflict', matchedLines: 0, referenceLines: 12 }
  }} positionMs={50000} enabled={['ja']} romanization={true} />)
  expect(html).toContain('暂无可信时间轴')
  expect(html).toContain('テストの一行です')
  expect(html).toContain('untimed-lyrics')
  expect(html).toContain('japanese-grid')
  expect(html).not.toContain('lyric-group active')
  expect(html).not.toContain('回到当前歌词')
})

it('shows a confirmed instrumental as such, without a retry prompt', () => {
  const html = renderToStaticMarkup(<LyricsStage document={{ trackId: 'fixture-instrumental', tracks: [], instrumental: true }}
    positionMs={1000} enabled={['ja']} romanization={false} onRetry={() => {}} />)
  expect(html).toContain('纯音乐')
  expect(html).not.toContain('重新匹配歌词')
  const missing = renderToStaticMarkup(<LyricsStage document={{ trackId: 'fixture-missing', tracks: [] }}
    positionMs={1000} enabled={['ja']} romanization={false} onRetry={() => {}} />)
  expect(missing).toContain('重新匹配歌词')
})

it('offers a manual search when no synced lyrics were found or the song may not be instrumental', () => {
  const missing = renderToStaticMarkup(<LyricsStage document={{ trackId: 'fixture-missing', tracks: [] }}
    positionMs={1000} enabled={['ja']} romanization={false} onRetry={() => {}} onSearch={() => {}} />)
  expect(missing).toContain('手动搜索')
  const instrumental = renderToStaticMarkup(<LyricsStage document={{ trackId: 'fixture-instrumental', tracks: [], instrumental: true }}
    positionMs={1000} enabled={['ja']} romanization={false} onSearch={() => {}} />)
  expect(instrumental).toContain('不是纯音乐？手动搜索')
})

it('marks lines as seekable with the song time they jump to, only when seeking is offered', () => {
  const document = { trackId: 'fixture-seek', tracks: [{ id: 'o', language: 'en', label: 'English', kind: 'original' as const, source: 'test',
    lines: [{ startMs: 1000, text: 'first line' }, { startMs: 65_000, text: 'second line' }] }] }
  const seekable = renderToStaticMarkup(<LyricsStage document={document} positionMs={2000} enabled={['en']} romanization={false}
    onSeekLine={() => {}} seekLabel={line => `${Math.floor(line.startMs / 60_000)}:${String(Math.floor(line.startMs / 1000) % 60).padStart(2, '0')}`} />)
  expect(seekable).toContain('seekable')
  expect(seekable).toContain('从 1:05 播放这一句')
  expect(seekable).toMatch(/second line<\/div><span class="lyric-seek-hint"/)
  const plain = renderToStaticMarkup(<LyricsStage document={document} positionMs={2000} enabled={['en']} romanization={false} />)
  expect(plain).not.toContain('seekable')
  expect(plain).not.toContain('lyric-seek-hint')
})

it('reads a song that is not playing: every row alike, no sung line, no timing note', () => {
  const lines = Array.from({ length: 6 }, (_, index) => ({ startMs: index * 4000, text: `row number ${index}` }))
  const html = renderToStaticMarkup(<LyricsStage reading document={{ trackId: 'browse:x', tracks: [{ id: 'o', language: 'en', label: 'English', kind: 'original', source: 'LRCLIB', lines }] }}
    positionMs={-1} enabled={['en']} romanization={false} />)
  expect(html).toContain('lyrics-stage-shell  reading')
  expect(html).toContain('row number 5')
  expect(html).not.toContain('lyric-group active')
  expect(html).not.toContain('past')
  expect(html).not.toContain('回到当前歌词')
  const untimed = renderToStaticMarkup(<LyricsStage reading document={{ trackId: 'browse:y', tracks: [], untimedOriginal: { text: 'plain words\nmore words', language: 'en', source: 'LRCLIB' } }}
    positionMs={-1} enabled={['en']} romanization={false} />)
  expect(untimed).toContain('plain words')
  expect(untimed).not.toContain('info-note')
})

it('reading a saved song without a displayable row does not suggest dropping a file (that imports into the playing song)', () => {
  const html = renderToStaticMarkup(<LyricsStage reading document={{ trackId: 'saved', tracks: [{ id: 'o', language: 'zh-Hans', label: '中文原文', kind: 'original', source: 'LRCLIB', lines: [] }] }}
    positionMs={-1} enabled={['zh-Hans']} romanization={false} />)
  expect(html).toContain('没有可显示的歌词')
  expect(html).not.toContain('拖进窗口')
  expect(html).not.toContain('重新匹配')
})
