import type { LyricsDocument } from '../types'
import { isConclusiveListen, listenTimingKey } from './listened-offset'
import { shiftAmount } from './timing-status'
import { LYRICS_SOURCES } from './lyrics-source'
import { currentLanguage, t, tk } from './i18n'
import { localizeLabel } from './source-label'

const VERDICT_TEXT = { consistent: tk('一致'), inconsistent: tk('不一致'), unmeasurable: tk('量不出') } as const

/**
 * "已试过的来源：LRCLIB 不一致 · 网易云音乐 一致。" for a song where listening
 * compared providers. Empty when there is nothing to explain (no verdicts, or
 * only the ordinary one consistent provider).
 */
export function sourceTrialsSummary(document: LyricsDocument | null): string {
  const trials = document?.sourceTrials
  if (!trials) return ''
  const rows = LYRICS_SOURCES.flatMap(item => trials[item.id] ? [`${localizeLabel(item.label)} ${t(VERDICT_TEXT[trials[item.id]!])}`] : [])
  if (!rows.length || (rows.length === 1 && Object.values(trials).every(verdict => verdict === 'consistent'))) return ''
  return t('已试过的来源：{sources}。', { sources: rows.join(' · ') })
}

export interface ListenStatus {
  /** One line for the 同步 tab: what listening calibration did or is doing for this song. */
  text: string
  /** Label of the action button. */
  action: string
  /** Whether pressing the button can do anything for this song right now. */
  canRun: boolean
}

/**
 * Status of listening calibration for the current song and whether it can be
 * run (again) now. `reason` is listenTarget's reason evaluated as if the song
 * were playing (so a paused song still reports an unsupported language);
 * `undefined` means a session can start.
 */
export function listenStatus(input: { document: LyricsDocument | null; listening: boolean; enabled: boolean; playing: boolean; reason?: string }): ListenStatus {
  const { document } = input
  const original = document?.untimedOriginal ? undefined : document?.tracks.find(track => track.kind === 'original')
  // A result from too few lines (stored as "inconsistent" before 0.4.70) is not a measurement.
  const measured = document?.listenedOffset && original && document.listenedOffset.timingKey === listenTimingKey(original)
    && isConclusiveListen(document.listenedOffset) ? document.listenedOffset : null
  const again = Boolean(measured || document?.offsetMs || input.reason === 'attempts-exhausted' || input.reason === 'source-inconsistent')
  const action = again ? t('立即重新校准') : t('立即校准')
  if (!input.enabled) return { text: t('听音自动校准已关闭，打开上面的开关后可以使用。'), action, canRun: false }
  if (input.listening) return { text: t('正在听这首歌，通常需要 25–60 秒。'), action, canRun: false }
  const blocked: Record<string, string> = {
    demo: t('演示模式下不可用。'),
    'no-lyrics': t('这首歌还没有同步歌词。'),
    'unsupported-language': t('这首歌的歌词语言暂不支持，目前支持日语、中文和英文。'),
    'too-few-lines': t('歌词行数太少，无法校准。'),
    'invalid-lines': t('这份歌词的时间轴无法用于校准。'),
    'manual-audio-sync': t('「声音同步」实验功能正在运行，停止后可以使用。'),
    'source-switching': t('正在换用另一个歌词来源，换好后自动校准。')
  }
  if (input.reason && blocked[input.reason]) return { text: blocked[input.reason], action, canRun: false }
  const paused = !input.playing
  const tried = sourceTrialsSummary(document)
  if (tried) {
    // Same status as without the trials, followed by what was compared.
    const plain = listenStatus({ ...input, document: { ...document!, sourceTrials: undefined } })
    return { ...plain, text: `${plain.text}${currentLanguage() === 'en' ? ' ' : ''}${tried}` }
  }
  if (document?.offsetMs) return { text: document.offsetMs > 0
    ? t('这首歌正在使用手动校准（歌词延后 {amount}）。重新校准会改用听音结果。', { amount: shiftAmount(document.offsetMs) })
    : t('这首歌正在使用手动校准（歌词提前 {amount}）。重新校准会改用听音结果。', { amount: shiftAmount(document.offsetMs) }), action, canRun: true }
  if (measured?.state === 'decided' && measured.offsetMs) return { text: measured.offsetMs > 0
    ? t('已校准：歌词延后 {amount}。', { amount: shiftAmount(measured.offsetMs) })
    : t('已校准：歌词提前 {amount}。', { amount: shiftAmount(measured.offsetMs) }), action, canRun: true }
  if (measured?.state === 'decided') return { text: t('已听过：这份歌词的时间准确，没有调整。'), action, canRun: true }
  if (measured?.state === 'inconsistent') return { text: t('上次各句测得的偏差不一致，没有调整。'), action, canRun: true }
  if (measured?.state === 'dismissed') return { text: t('你已把这首歌归零，听音结果没有使用。'), action, canRun: true }
  if (input.reason === 'attempts-exhausted') return { text: t('这首歌已经试过两次，没有得出结果。'), action, canRun: true }
  if (input.reason === 'source-inconsistent') return { text: t('各个歌词来源测得的偏差都不一致，没有调整。'), action, canRun: true }
  return { text: paused ? t('这首歌还没有校准，播放后会自动开始。') : t('这首歌还没有校准，马上开始。'), action, canRun: false }
}
