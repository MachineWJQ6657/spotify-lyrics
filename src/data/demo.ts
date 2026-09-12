import type { LyricsDocument, PlaybackSnapshot } from '../types'
import { makeTrack } from '../lib/lyrics'

const ja = `[00:00.00]夜明け前の街を歩く
[00:06.40]まだ名前のない今日へ
[00:12.80]ポケットの中の小さな光
[00:19.20]君の言葉を思い出す
[00:25.80]遠回りでも構わない
[00:32.40]この声が届くのなら
[00:39.10]静かな空に手を伸ばして
[00:45.80]新しい季節を歌おう
[00:52.60]風がページをめくるたび
[00:59.10]昨日の影はほどけてゆく
[01:05.80]何度でもここから始めよう
[01:12.60]朝焼けが僕らを照らす`

const romaji = `[00:00.00]Yoake mae no machi o aruku
[00:06.40]Mada namae no nai kyō e
[00:12.80]Poketto no naka no chiisana hikari
[00:19.20]Kimi no kotoba o omoidasu
[00:25.80]Tōmawari demo kamawanai
[00:32.40]Kono koe ga todoku no nara
[00:39.10]Shizukana sora ni te o nobashite
[00:45.80]Atarashii kisetsu o utaō
[00:52.60]Kaze ga pēji o mekuru tabi
[00:59.10]Kinō no kage wa hodokete yuku
[01:05.80]Nando demo koko kara hajimeyō
[01:12.60]Asayake ga bokura o terasu`

const zh = `[00:00.00]走在黎明前的街道
[00:06.40]向着尚未命名的今天
[00:12.80]口袋里微小的光
[00:19.20]让我想起你的话语
[00:25.80]绕些远路也没关系
[00:32.40]只要这声音能够抵达
[00:39.10]向安静的天空伸出手
[00:45.80]歌唱崭新的季节
[00:52.60]每当风翻过一页
[00:59.10]昨日的影子便渐渐散开
[01:05.80]无论几次，都从这里重新开始
[01:12.60]朝霞照亮我们`

const en = `[00:00.00]Walking through the city before dawn
[00:06.40]Toward a day that has no name yet
[00:12.80]A little light inside my pocket
[00:19.20]Brings your words back to me
[00:25.80]I don't mind taking the long way
[00:32.40]If only this voice can reach you
[00:39.10]Reaching for the quiet sky
[00:45.80]Let's sing a brand new season
[00:52.60]Each time the wind turns a page
[00:59.10]Yesterday's shadows come undone
[01:05.80]We'll begin again as often as it takes
[01:12.60]The morning glow shines on us`

export const demoDocument: LyricsDocument = {
  trackId: 'demo-yoake', tracks: [
    makeTrack('demo-ja', 'ja', '日本語', 'original', ja, 'Syllable Demo'),
    makeTrack('demo-romaji', 'romaji', 'Romaji', 'romanization', romaji, 'Syllable Demo'),
    makeTrack('demo-zh', 'zh-Hans', '中文', 'translation', zh, 'Syllable Demo'),
    makeTrack('demo-en', 'en', 'English', 'translation', en, 'Syllable Demo')
  ]
}

export function createDemoPlayback(): PlaybackSnapshot {
  return {
    track: { id: 'demo-yoake', name: '夜明けのページ', artist: 'Kiri', album: 'Afterglow', coverUrl: '', durationMs: 91_000 },
    positionMs: 0, observedAtMs: Date.now(), isPlaying: true, deviceName: 'Demo player', playbackSource: 'demo'
  }
}
