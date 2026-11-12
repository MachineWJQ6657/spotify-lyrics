import { parentPort } from 'node:worker_threads'
import { pinyin } from 'pinyin-pro'
import { dictionary } from 'cmu-pronouncing-dictionary'
import { englishReader, readLinePronunciation, type PronunciationReaders } from './lyric-pronunciation'

// No Electron, playback, file or network access. The dictionaries (~30 MB in
// memory) live only as long as this worker: one song's lines, then exit.
parentPort?.once('message', ({ lines }: { lines: unknown }) => {
  try {
    if (!Array.isArray(lines) || lines.length > 400 || lines.some(line => typeof line !== 'string' || line.length > 500)) throw new Error('Invalid lyric lines')
    const readers: PronunciationReaders = {
      pinyin: text => pinyin(text, { type: 'all', toneType: 'none' }).map(item => ({ origin: item.origin, pinyin: item.pinyin, isZh: item.isZh })),
      english: englishReader(dictionary),
    }
    parentPort!.postMessage({ result: (lines as string[]).map(line => readLinePronunciation(line, readers)) })
  } catch (error) {
    parentPort!.postMessage({ error: error instanceof Error ? error.message.slice(0, 300) : 'Pronunciation lookup failed' })
  }
})
