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
