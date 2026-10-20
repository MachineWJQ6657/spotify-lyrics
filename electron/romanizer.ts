import { createRequire } from 'node:module'
import { Worker } from 'node:worker_threads'
import { romanizeJapaneseWords } from './japanese-romaji'

const nodeRequire = createRequire(import.meta.url)
export interface JapaneseWord {
  surface_form: string
  reading?: string
  pronunciation?: string
  pos?: string
  pos_detail_1?: string
}

type JobOutput = { romanize: string[]; analyze: JapaneseWord[][] }
type JobMode = keyof JobOutput
const jobs = new Map<string, Promise<unknown>>()
let queue: Promise<unknown> = Promise.resolve()
let sequence = 0

function abortError() {
  const error = new Error('日文分析已取消')
  error.name = 'AbortError'
  return error
}

/** Both consumers share the queue so only one expanded dictionary can be alive. */
function analyze<M extends JobMode>(mode: M, lines: string[], options?: { signal?: AbortSignal }): Promise<JobOutput[M]> {
  const signal = options?.signal
  if (signal?.aborted) return Promise.reject(abortError())
  if (!Array.isArray(lines) || lines.some(line => typeof line !== 'string')) {
    return Promise.reject(new Error('日文分析输入格式无效'))
  }
  if (lines.length > 400 || lines.some(line => line.length > 500)
    || lines.reduce((length, line) => length + line.length, 0) > 16_000) {
    return Promise.reject(new Error('日文分析输入过大（最多 400 行、16000 字，每行 500 字）'))
  }
  if (!lines.length) return Promise.resolve([] as unknown as JobOutput[M])
  // Cancellable requests have independent ownership, even with identical input.
  const key = `${mode}:${JSON.stringify(lines)}${signal ? `:${++sequence}` : ''}`
  const existing = jobs.get(key)
  if (existing) return existing as Promise<JobOutput[M]>
  if (jobs.size >= 8) return Promise.reject(new Error('罗马音分析任务较多，请稍后重试'))

  const input = [...lines]
  let resolveTask!: (output: JobOutput[M]) => void
  let rejectTask!: (error: unknown) => void
  const task = new Promise<JobOutput[M]>((resolve, reject) => { resolveTask = resolve; rejectTask = reject })
  let cancelled = false
  let finishActive: ((output?: JobOutput[M], error?: Error) => void) | undefined
  const cancel = () => {
    cancelled = true
    if (finishActive) finishActive(undefined, abortError())
    else rejectTask(abortError())
  }
  signal?.addEventListener('abort', cancel, { once: true })
  const previous = queue
  let releaseQueue!: () => void
  queue = new Promise<void>(resolve => { releaseQueue = resolve })
  const fail = (error: unknown) => { releaseQueue(); rejectTask(error) }
  void previous.then(() => {
    if (cancelled) { releaseQueue(); return }
    const workerSource = `
      const { parentPort, workerData } = require('node:worker_threads')
      const AnalyzerModule = require(workerData.analyzerPath)
      const KuromojiAnalyzer = AnalyzerModule.default || AnalyzerModule
      const romanizeWords = (${romanizeJapaneseWords.toString()})

      ;(async () => {
        const analyzer = new KuromojiAnalyzer()
        await analyzer.init()
        const toRomaji = workerData.mode === 'romanize' ? require(workerData.wanakanaPath).toRomaji : undefined
        const output = []
        for (const line of workerData.lines) {
          const tokens = await analyzer.parse(line)
          if (workerData.mode === 'analyze') {
            output.push(tokens.map(token => ({
              surface_form: token.surface_form,
              reading: token.reading,
              pronunciation: token.pronunciation,
              pos: token.pos,
              pos_detail_1: token.pos_detail_1
            })))
            continue
          }
          output.push(romanizeWords(tokens, toRomaji))
        }
        parentPort.postMessage({ output })
      })().catch(error => parentPort.postMessage({ error: error && error.message ? error.message : String(error) }))
    `
    const worker = new Worker(workerSource, {
      eval: true,
      workerData: {
        mode,
        lines: input,
        analyzerPath: nodeRequire.resolve('kuroshiro-analyzer-kuromoji'),
        wanakanaPath: nodeRequire.resolve('wanakana')
      }
    })
    let finished = false
    const finish = (output?: JobOutput[M], error?: Error) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      // Do not release the queue while the expanded dictionary still lives.
      void worker.terminate().then(() => {
        releaseQueue()
        if (cancelled) rejectTask(abortError())
        else if (error) rejectTask(error)
        else resolveTask(output ?? [] as unknown as JobOutput[M])
      }, fail)
    }
    finishActive = finish
    const timer = setTimeout(() => finish(undefined, new Error('日文分析超时')), 20_000)
    worker.once('message', (message: { output?: JobOutput[M]; error?: string }) => {
      if (message.output) finish(message.output)
      else finish(undefined, new Error(message.error || '日文分析失败'))
    })
    worker.once('error', error => finish(undefined, error))
    worker.once('exit', () => finish(undefined, new Error('日文分析进程提前退出')))
  }).catch(fail)
  jobs.set(key, task)
  void task.finally(() => {
    signal?.removeEventListener('abort', cancel)
    jobs.delete(key)
  }).catch(() => undefined)
  return task
}

/** Kuromoji's expanded dictionary is released as soon as the task finishes. */
export function romanizeLines(lines: string[]): Promise<string[]> {
  return analyze('romanize', lines)
}

/** Word order is authoritative; Kuromoji's word_position is deliberately omitted. */
export function analyzeJapaneseLines(lines: string[], options?: { signal?: AbortSignal }): Promise<JapaneseWord[][]> {
  return analyze('analyze', lines, options)
}
