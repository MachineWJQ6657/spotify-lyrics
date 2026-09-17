import { describe, expect, it } from 'vitest'
import { fetchLyrics, parseTimedRows, timedLyricsStats } from './lyrics-provider'

const runOnline = process.env.SYLLABLE_ONLINE_QA === '1' ? describe : describe.skip

runOnline('online lyrics provider smoke tests', () => {
  it('does not accept the mislabeled Yuujou timeline for Yorushika Walk', async () => {
    const result = await fetchLyrics({
      id: 'qa-yorushika-aruku', name: '歩く', artist: 'ヨルシカ', album: 'エルマ',
      coverUrl: '', durationMs: 206_786
    }, null, true)
    expect(result?.syncedLyrics).toMatch(/今日.{0,3}死んでいくような|君の旅した街を歩く/)
    expect(result?.syncedLyrics).not.toContain('湖の底にいるみたいだ')
  }, 30_000)

  it('does not turn tayori outro engineering credits into sung lyrics', async () => {
    const result = await fetchLyrics({ id: 'qa-haru-wo-matsu-credits', name: '春を待つ', artist: 'tayori', album: 'memento', durationMs: 244723, coverUrl: '' }, null, true)
    expect(parseTimedRows(result?.syncedLyrics).length).toBeGreaterThan(35)
    expect(result?.syncedLyrics).not.toMatch(/(?:母[带帶]|混音)工程[师師]\s*[:：]/)
    expect(result?.additionalTracks?.some(track => track.language === 'zh-Hans')).toBe(true)
  }, 30000)

  it('finds synchronized lyrics when Spotify and provider artist names use different scripts', async () => {
    const result = await fetchLyrics({
      id: 'qa-haruru', name: '晴るる', artist: 'Atarayo', album: '極夜において月は語らず',
      coverUrl: '', durationMs: 290_241
    })
    expect(result?.syncedLyrics).toContain('[00:')
    expect(result?.confidence).toBeGreaterThanOrEqual(55)
  }, 20_000)

  it('accepts an original-script title when Spotify exposes the Japanese title as romaji', async () => {
    const result = await fetchLyrics({
      id: 'qa-yakusoku', name: 'Yakusoku no Nai Ichinichi', artist: 'SWALLOW', album: 'Yakusoku no Nai Ichinichi',
      coverUrl: '', durationMs: 225_111
    })
    expect(result?.syncedLyrics).toContain('別れの時')
    expect(result?.additionalTracks?.some(track => track.language === 'zh-Hans')).toBe(true)
  }, 20_000)

  it('finds a complete synced lyric for a currently observed Japanese track', async () => {
    const result = await fetchLyrics({
      id: 'qa-rubato', name: 'ルバート', artist: 'ヨルシカ', album: 'ルバート',
      coverUrl: '', durationMs: 231_397
    })
    const stats = timedLyricsStats(result?.syncedLyrics, 231_397)
    expect(stats.lineCount).toBeGreaterThan(25)
    expect(stats.tailCoverage).toBeGreaterThan(.7)
  }, 20_000)

  it('keeps Japanese and Chinese on separate tracks for the current Atarayo album', async () => {
    const result = await fetchLyrics({
      id: 'qa-haru-tonari', name: '春となり', artist: 'Atarayo', album: '私雨に夏の灯を知る',
      coverUrl: '', durationMs: 214_000
    })
    const stats = timedLyricsStats(result?.syncedLyrics, 214_000)
    expect(stats.lineCount).toBeGreaterThan(25)
    expect(stats.tailCoverage).toBeGreaterThan(.7)
    expect(result?.confidence).toBeGreaterThanOrEqual(78)
    expect(result?.matchedDurationMs).toBeGreaterThan(240_000)
    expect(result?.additionalTracks?.some(track => track.language === 'romaji')).toBe(true)
    expect(result?.additionalTracks?.some(track => track.language === 'zh-Hans')).toBe(true)
  }, 20_000)

  it('keeps a complete synchronized timeline for Yorushika - Usotsuki', async () => {
    const durationMs = 267_670
    const result = await fetchLyrics({
      id: 'qa-usotsuki', name: '嘘月', artist: 'ヨルシカ', album: '創作',
      coverUrl: '', durationMs
    })
    const stats = timedLyricsStats(result?.syncedLyrics, durationMs)
    expect(result?.syncedLyrics).toContain('[00:')
    expect(result?.confidence).toBeGreaterThanOrEqual(75)
    expect(stats.lineCount).toBeGreaterThan(25)
    expect(stats.tailCoverage).toBeGreaterThan(.75)
  }, 20_000)

  it('does not select a different version for Yorushika - Isana', async () => {
    const durationMs = 235_120
    const track = {
      id: 'qa-isana', name: 'いさな', artist: 'ヨルシカ', album: '幻燈',
      coverUrl: '', durationMs
    }
    const result = await fetchLyrics(track)
    const stats = timedLyricsStats(result?.syncedLyrics, durationMs)
    expect(result?.syncedLyrics).toContain('[00:')
    expect(result?.confidence).toBeGreaterThanOrEqual(75)
    expect(result?.additionalTracks?.find(item => item.language === 'zh-Hans')?.source).toContain('网易云')
    expect(stats.tailCoverage).toBeGreaterThan(.75)
  }, 20_000)

  it('keeps Japanese and Chinese separate for Yorushika - Itte', async () => {
    const durationMs = 242_000
    const result = await fetchLyrics({
      id: 'qa-itte', name: '言って。', artist: 'ヨルシカ', album: '夏草が邪魔をする',
      coverUrl: '', durationMs
    })
    const originalRows = parseTimedRows(result?.syncedLyrics)
    const chinese = result?.additionalTracks?.find(track => track.language === 'zh-Hans')
    const chineseRows = parseTimedRows(chinese?.syncedLyrics)
    if (process.env.SYLLABLE_PROVIDER_DIAGNOSTICS === '1') {
      console.log(JSON.stringify({
        selected: result?.source,
        originalAtMinute: originalRows.filter(row => row.timeMs >= 55_000 && row.timeMs <= 85_000),
        chineseAtMinute: chineseRows.filter(row => row.timeMs >= 55_000 && row.timeMs <= 85_000),
        chineseSource: chinese?.source
      }, null, 2))
    }
    expect(result?.source).toContain('LRCLIB · 精确匹配')
    expect(originalRows.some(row => row.text.includes('ヨルシカ - 言って'))).toBe(false)
    expect(result?.syncedLyrics).toContain('言って')
    expect(result?.syncedLyrics).not.toContain('虽然')
    expect(chinese?.source).toContain('网易云')
    expect(chineseRows.length).toBeGreaterThan(20)
    expect(timedLyricsStats(result?.syncedLyrics, durationMs).tailCoverage).toBeGreaterThan(.75)
  }, 20_000)

  it('resolves a romanized producer credit through the vocalist release metadata', async () => {
    const durationMs = 241_500
    const result = await fetchLyrics({
      id: 'qa-kimi-coffee', name: 'Kimi To Coffee', artist: 'Islet', album: 'CYANIDE',
      coverUrl: '', durationMs
    })
    const stats = timedLyricsStats(result?.syncedLyrics, durationMs)
    expect(result?.source).toContain('网易云')
    expect(result?.confidence).toBeGreaterThanOrEqual(80)
    expect(result?.syncedLyrics).toContain('甘いミルク入りのコーヒーを')
    expect(stats.lineCount).toBeGreaterThan(35)
    expect(stats.tailCoverage).toBeGreaterThan(.8)
    expect(result?.additionalTracks?.some(track => track.language === 'zh-Hans')).toBe(true)
    expect(result?.additionalTracks?.some(track => track.language === 'romaji')).toBe(true)
  }, 20_000)

  it('does not let a long Spotify Mix endpoint select the wrong Vaundy - Tokimeki version', async () => {
    const mixDurationMs = 233_081
    const result = await fetchLyrics({
      // The Windows SMTC session exposes the single title as the album while
      // this custom Mix endpoint is active; keep the regression identical to
      // the live metadata rather than relying on the release-album hint.
      id: 'qa-tokimeki-mix', name: 'Tokimeki', artist: 'Vaundy', album: 'Tokimeki',
      coverUrl: '', durationMs: mixDurationMs
    })
    expect(result?.syncedLyrics).toContain('[00:')
    expect(result?.confidence).toBeGreaterThanOrEqual(75)
    expect(Math.abs((result?.matchedDurationMs ?? 0) - 212_000)).toBeLessThan(6_000)
    expect(timedLyricsStats(result?.syncedLyrics, 212_000).tailCoverage).toBeGreaterThan(.75)
  }, 20_000)

  it('never maps HIBANA - Untrue onto an implausibly long same-title recording', async () => {
    const durationMs = 207_744
    const result = await fetchLyrics({
      id: 'qa-hibana-untrue', name: 'Untrue', artist: 'HIBANA', album: 'Untrue',
      coverUrl: '', durationMs
    })
    if (!result?.matchedDurationMs) return
    const ratio = result.matchedDurationMs / durationMs
    expect(ratio).toBeGreaterThanOrEqual(.82)
    expect(ratio).toBeLessThanOrEqual(1.18)
  }, 20_000)

  it('finds a locally titled NetEase timeline for an English Spotify title', async () => {
    const durationMs = 223_604
    const result = await fetchLyrics({
      id: 'qa-hibana-fading-sparks', name: 'Fading Sparks and Summer Sky', artist: 'HIBANA', album: 'Fading Sparks and Summer Sky',
      coverUrl: '', durationMs
    })
    const stats = timedLyricsStats(result?.syncedLyrics, durationMs)
    expect(result?.source).toContain('网易云')
    expect(result?.matchedDurationMs).toBe(durationMs)
    // Provider has 27 sung rows after decorative ♪ and metadata are removed.
    expect(stats.lineCount).toBeGreaterThanOrEqual(25)
    expect(result?.additionalTracks?.some(track => track.language === 'zh-Hans')).toBe(true)
    expect(result?.additionalTracks?.some(track => track.language === 'romaji')).toBe(true)
  }, 30_000)

  it('does not let an unrelated Latin-title cover hide the original-artist result', async () => {
    const durationMs = 238_560
    const result = await fetchLyrics({
      id: 'qa-suzume-localized', name: 'Suzume', artist: 'RADWIMPS', album: 'Suzume',
      coverUrl: '', durationMs
    })
    const chinese = result?.additionalTracks?.find(track => track.language === 'zh-Hans')
    expect(result?.syncedLyrics).toContain('[00:')
    expect(result?.confidence).toBeGreaterThanOrEqual(88)
    expect(chinese?.source).toContain('网易云')
    expect(parseTimedRows(chinese?.syncedLyrics).length).toBeGreaterThan(15)
  }, 30_000)

  it('matches Same Blue when Spotify localizes the Japanese artist name', async () => {
    const durationMs = 237_836
    const result = await fetchLyrics({
      id: 'qa-same-blue-localized-artist', name: 'Same Blue', artist: 'Official鬍子男dism', album: 'Same Blue',
      coverUrl: '', durationMs
    }, null, true)
    const rows = parseTimedRows(result?.syncedLyrics)
    const stats = timedLyricsStats(result?.syncedLyrics, result?.matchedDurationMs ?? durationMs)
    const chinese = result?.additionalTracks?.find(track => track.language === 'zh-Hans')
    expect(rows.some(row => row.text.includes('1人の夜に中身を'))).toBe(true)
    expect(rows.length, JSON.stringify({ source: result?.source, transient: result?.transient, duration: result?.matchedDurationMs, stats, texts: rows.map(row => row.normalizedText), extras: result?.additionalTracks?.map(item => ({ source: item.source, language: item.language, stats: timedLyricsStats(item.syncedLyrics, durationMs) })) })).toBeGreaterThan(30)
    expect(stats.tailCoverage).toBeGreaterThan(.75)
    expect(chinese?.source).toContain('网易云')
    expect(parseTimedRows(chinese?.syncedLyrics).length).toBeGreaterThan(25)
  }, 30_000)

  it('compares Same Blue localized and original artist recordings by ordered text', async () => {
    const results = await Promise.all(['Official鬍子男dism', 'Official髭男dism'].map(artist => fetchLyrics({
      id: `qa-same-blue-content-${artist}`, name: 'Same Blue', artist, album: 'Same Blue', coverUrl: '', durationMs: 237836
    }, null, true)))
    const texts = results.map(result => parseTimedRows(result?.syncedLyrics).map(row => row.normalizedText).join(''))
    if (process.env.SYLLABLE_PROVIDER_DIAGNOSTICS === '1') console.log('same-blue-recording-comparison', JSON.stringify(results.map((result, index) => ({
      source: result?.source, duration: result?.matchedDurationMs, rows: parseTimedRows(result?.syncedLyrics).length,
      characters: texts[index].length, text: texts[index]
    }))))
    expect(texts[0].length).toBeGreaterThan(500)
    expect(texts[0]).toBe(texts[1])
  }, 30_000)

  it.each([
    { id: 'qa-wind-anthem', name: '風のアンセム', artist: 'Eve', album: '風のアンセム', durationMs: 222_000, minimumLines: 30 },
    { id: 'qa-natsu-kuru', name: '夏が来るたび', artist: 'Atarayo', album: '季億の箱', durationMs: 239_099, minimumLines: 28 },
    { id: 'qa-stereotype-writer', name: 'ステレオタイプライター', artist: 'harha', album: 'ステレオタイプライター', durationMs: 234_490, minimumLines: 30 },
    { id: 'qa-prologue', name: 'Prologue', artist: '美波', album: 'カワキヲアメク', durationMs: 331_000, minimumLines: 40 },
    // Captured from a natural Spotify boundary on 0.4.13. The same complete
    // text is represented as 38 merged phrases by LRCLIB/NetEase or 48 finer
    // phrases by Kugou; row fragmentation alone must not define completeness.
    { id: 'qa-timegram', name: 'タイムグラム', artist: '美波', album: 'タイムグラム', durationMs: 243_933, minimumLines: 38 },
    // The following natural boundary selected the exact 285-second LRCLIB
    // release and aligned NetEase Chinese without introducing a second fetch.
    { id: 'qa-kimi-to-iu-shinwa', name: '君という神話', artist: 'yanaginagi', album: '君という神話', durationMs: 285_400, minimumLines: 48 },
    // Spotify can expose the localized Latin title while Asian providers use
    // バブル - Bubble. This case has no synchronized LRCLIB record and must
    // therefore exercise the real NetEase/Kugou fallback.
    { id: 'qa-bubble', name: 'Bubble', artist: 'tuki.', album: 'バブル - Bubble', durationMs: 198_112, minimumLines: 45 },
    { id: 'qa-kutsu-no-hanabi', name: '靴の花火', artist: 'ヨルシカ', album: '夏草が邪魔をする', durationMs: 303_000, minimumLines: 35 },
    { id: 'qa-tousaku', name: '盗作', artist: 'ヨルシカ', album: '盗作', durationMs: 239_115, minimumLines: 35 },
    { id: 'qa-taiyou', name: '太陽', artist: 'ヨルシカ', album: '二人称', durationMs: 266_184, minimumLines: 18 },
    { id: 'qa-yukidoke', name: '雪解け', artist: 'tayori', album: 'memento', durationMs: 245_294, minimumLines: 32 },
    // Captured from the final 0.4.14 live run. LRCLIB has no useful timed
    // result for this release, so this permanently exercises the Kugou base
    // timeline plus NetEase romanization/Chinese merge used on screen.
    { id: 'qa-lanthanoid', name: 'ランタノイド', artist: 'suisoh', album: 'ランタノイド', durationMs: 174_560, minimumLines: 36 },
    // Natural 0.4.14 boundary target: the exact LRCLIB release completed in
    // under two seconds after identity publication and contains its full
    // post-chorus/outro timeline rather than stopping at the fade boundary.
    { id: 'qa-thirsty-anxiety', name: 'Thirsty, Anxiety', artist: 'TOGENASHI TOGEARI', album: 'Thirsty, Anxiety', durationMs: 159_763, minimumLines: 28 },
    // Captured consecutively from the 0.4.15 live package without controlling
    // Spotify. The outgoing track exercises a Kugou base plus NetEase language
    // tracks; the incoming track exercises a dense exact LRCLIB timeline.
    // The exact provider groups 58 reference rows into 42. Require the actual
    // missing repetitions below, not an arbitrary preference for more rows.
    { id: 'qa-bansanka', name: '晩餐歌 - Bansanka', artist: 'tuki.', album: '晩餐歌 - Bansanka', durationMs: 217_760, minimumLines: 42 },
    { id: 'qa-seventh-heaven', name: 'SEVENTH HEAVEN', artist: 'milet', album: 'SEVENTH HEAVEN', durationMs: 237_746, minimumLines: 75 },
    // LRCLIB/NetEase group this complete recording into 31 phrases while
    // Kugou splits several repeated clauses into 39. Both are valid layouts.
    { id: 'qa-gogatsu', name: '五月は花緑青の窓辺から', artist: 'ヨルシカ', album: 'だから僕は音楽を辞めた', durationMs: 185_080, minimumLines: 30 },
    { id: 'qa-nox-lux', name: 'NOX LUX', artist: 'MYTH & ROID', album: 'NOX LUX', durationMs: 273_065, minimumLines: 35 },
    // Observed at a real Spotify queue boundary where the next duration and
    // near-zero position briefly arrived under the previous title. Besides
    // guarding source completeness, this keeps that exact hand-off target in
    // the provider corpus used for release validation.
    { id: 'qa-karakara', name: 'カラカラ', artist: '結束バンド', album: '結束バンド', durationMs: 265_133, minimumLines: 40 }
  ])('keeps a useful synchronized timeline for $artist - $name', async track => {
    const result = await fetchLyrics({ ...track, coverUrl: '' })
    const stats = timedLyricsStats(result?.syncedLyrics, result?.matchedDurationMs ?? track.durationMs)
    expect(result?.syncedLyrics).toContain('[00:')
    expect(result?.confidence).toBeGreaterThanOrEqual(55)
    expect(stats.lineCount).toBeGreaterThanOrEqual(track.minimumLines)
    expect(stats.tailCoverage).toBeGreaterThan(.7)
    if (track.id === 'qa-bansanka') {
      const text = parseTimedRows(result?.syncedLyrics).map(row => row.normalizedText).join('')
      expect(text.length).toBeGreaterThanOrEqual(574)
      expect(text).toContain('味気ないないない')
      expect(text).toContain('会い会い会いたく')
      expect(text).toContain('自信がないないない')
      expect(text).toContain('変わりたくないないない')
    }
    if (track.id === 'qa-timegram' || track.id === 'qa-kimi-to-iu-shinwa') {
      const textLength = parseTimedRows(result?.syncedLyrics).reduce((total, row) => total + row.normalizedText.length, 0)
      expect(textLength).toBeGreaterThan(300)
      expect(stats.tailCoverage).toBeGreaterThan(.9)
    }
    if (track.id === 'qa-lanthanoid') {
      // NetEase groups the same text into 36 long phrases while Kugou splits
      // it into 45 rows. Protect content and tail coverage instead of making
      // physical row fragmentation an accidental completeness metric.
      const textLength = parseTimedRows(result?.syncedLyrics).reduce((total, row) => total + row.normalizedText.length, 0)
      expect(textLength).toBeGreaterThan(300)
      expect(stats.tailCoverage).toBeGreaterThan(.85)
    }
    if (track.id === 'qa-karakara' && process.env.SYLLABLE_PROVIDER_DIAGNOSTICS === '1') {
      console.log(JSON.stringify({
        selected: result?.source,
        matchedDurationMs: result?.matchedDurationMs,
        head: parseTimedRows(result?.syncedLyrics).slice(0, 8),
        tail: parseTimedRows(result?.syncedLyrics).slice(-10),
        additionalTails: result?.additionalTracks?.map(item => ({
          language: item.language,
          source: item.source,
          tail: parseTimedRows(item.syncedLyrics).slice(-10)
        }))
      }, null, 2))
    }
    if (track.id === 'qa-nox-lux') {
      expect(result?.source).toContain('LRCLIB · 精确匹配')
      expect(result?.syncedLyrics).toContain('闇に光を')
      expect(result?.additionalTracks?.find(item => item.language === 'zh-Hans')?.source).toContain('网易云')
    }
    if (track.id === 'qa-karakara') {
      const rows = parseTimedRows(result?.syncedLyrics)
      expect(rows.slice(-3).map(row => row.normalizedText)).toEqual(['やれるわ', 'やれるわ', 'やれるわ'])
      expect(stats.tailCoverage).toBeGreaterThan(.95)
      expect(result?.additionalTracks?.find(item => item.language === 'zh-Hans')?.source).toContain('网易云')
    }
    if (track.id === 'qa-bansanka' || track.id === 'qa-seventh-heaven') {
      expect(result?.additionalTracks?.find(item => item.language === 'zh-Hans')?.source).toContain('网易云')
      expect(result?.additionalTracks?.some(item => item.language === 'romaji')).toBe(true)
    }
  }, 20_000)
})
