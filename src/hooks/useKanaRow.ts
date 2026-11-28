import { useEffect, useMemo, useState } from 'react'
import type { LyricsDocument } from '../types'
import { kanaRequest, kanaSource, kanaTrack, withKanaTrack } from '../lib/kana-row'

/** Readings this window already has, by the lyric text they belong to: a song shown again has its row at once. */
const made = new Map<string, readonly string[]>()
const MADE_LIMIT = 24
const RETRY_MS = 5000

export function rememberKana(key: string, readings: readonly string[]) {
  made.delete(key)
  made.set(key, readings)
  if (made.size > MADE_LIMIT) made.delete(made.keys().next().value!)
}

/** Test hook: forget the readings. */
export function forgetKana() { made.clear() }

/**
 * The document with its kana row, when the "kana" lyric language is on and the
 * song is Japanese; otherwise the document itself. The row arrives a moment
 * after the lyrics the first time (the analysis runs in the main process) and
 * the lyrics are shown without it until then.
 */
export function useKanaRow(document: LyricsDocument | null, enabled: readonly string[]): LyricsDocument | null {
  const original = useMemo(() => kanaSource(document, enabled), [document, enabled])
  const key = useMemo(() => original ? kanaRequest(original).join('\n') : '', [original])
  // One more try per song when the analyser was busy.
  const [retried, setRetried] = useState({ key: '', count: 0 })
  const attempt = retried.key === key ? retried.count : 0
  const [, setArrived] = useState(0)
  useEffect(() => {
    if (!original || !key || made.has(key)) return
    const ask = window.syllable?.lyrics?.kana
    if (!ask) return
    let current = true
    let retry: number | undefined
    ask(kanaRequest(original)).then(readings => {
      if (!Array.isArray(readings) || readings.length !== original.lines.length) return
      rememberKana(key, readings)
      if (current) setArrived(count => count + 1)
    }).catch(() => {
      // The analyser was busy or slow: once more a little later, then leave the song without the row.
      if (current && attempt < 1) retry = window.setTimeout(() => setRetried({ key, count: attempt + 1 }), RETRY_MS)
    })
    return () => { current = false; if (retry !== undefined) window.clearTimeout(retry) }
  }, [original, key, attempt])
  const readings = key ? made.get(key) : undefined
  return useMemo(() => {
    if (!document || !original || !readings) return document
    const track = kanaTrack(original, readings)
    return track ? withKanaTrack(document, track) : document
  }, [document, original, readings])
}
