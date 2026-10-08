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
