import type { LyricsDocument } from '../types'
import { listenTimingKey } from './listened-offset'
import { shiftAmount, shiftDirection } from './timing-status'

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
  const measured = document?.listenedOffset && original && document.listenedOffset.timingKey === listenTimingKey(original)
    ? document.listenedOffset : null
  const again = Boolean(measured || document?.offsetMs || input.reason === 'attempts-exhausted' || input.reason === 'source-inconsistent')
  const action = again ? '立即重新校准' : '立即校准'
  if (!input.enabled) return { text: '听音自动校准已关闭，打开上面的开关后可以使用。', action, canRun: false }
  if (input.listening) return { text: '正在听这首歌，通常需要 25–60 秒。', action, canRun: false }
  const blocked: Record<string, string> = {
    demo: '演示模式下不可用。',
    'no-lyrics': '这首歌还没有同步歌词。',
    'unsupported-language': '这首歌的歌词语言暂不支持，目前支持日语、中文和英文。',
    'too-few-lines': '歌词行数太少，无法校准。',
    'invalid-lines': '这份歌词的时间轴无法用于校准。',
    'manual-audio-sync': '「声音同步」实验功能正在运行，停止后可以使用。',
    'source-switching': '正在换用另一个歌词来源，换好后自动校准。'
  }
  if (input.reason && blocked[input.reason]) return { text: blocked[input.reason], action, canRun: false }
  const paused = !input.playing
  if (document?.offsetMs) return { text: `这首歌正在使用手动校准（歌词${shiftDirection(document.offsetMs)} ${shiftAmount(document.offsetMs)}）。重新校准会改用听音结果。`, action, canRun: true }
  if (measured?.state === 'decided' && measured.offsetMs) return { text: `已校准：歌词${shiftDirection(measured.offsetMs)} ${shiftAmount(measured.offsetMs)}。`, action, canRun: true }
  if (measured?.state === 'decided') return { text: '已听过：这份歌词的时间准确，没有调整。', action, canRun: true }
  if (measured?.state === 'inconsistent') return { text: '上次各句测得的偏差不一致，没有调整。', action, canRun: true }
  if (measured?.state === 'dismissed') return { text: '你已把这首歌归零，听音结果没有使用。', action, canRun: true }
  if (input.reason === 'attempts-exhausted') return { text: '这首歌已经试过两次，没有得出结果。', action, canRun: true }
  if (input.reason === 'source-inconsistent') return { text: '各个歌词来源测得的偏差都不一致，没有调整。', action, canRun: true }
  return { text: paused ? '这首歌还没有校准，播放后会自动开始。' : '这首歌还没有校准，马上开始。', action, canRun: false }
}
