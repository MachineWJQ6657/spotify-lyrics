import { createRequire } from 'node:module'
import { Worker } from 'node:worker_threads'

const nodeRequire = createRequire(import.meta.url)
const jobs = new Map<string, Promise<string[]>>()
let queue: Promise<unknown> = Promise.resolve()

/** Kuromoji's expanded dictionary lives only for the duration of one track. */
export function romanizeLines(lines: string[]) {
  const key = lines.join('\0')
  const existing = jobs.get(key)
  if (existing) return existing
  if (jobs.size >= 8) return Promise.reject(new Error('罗马音分析任务较多，请稍后重试'))

  const input = [...lines]
  const task = queue.then(() => new Promise<string[]>((resolve, reject) => {
    const workerSource = `
      const { parentPort, workerData } = require('node:worker_threads')
      const KuroshiroModule = require(workerData.kuroshiroPath)
      const AnalyzerModule = require(workerData.analyzerPath)
      const { toRomaji } = require(workerData.wanakanaPath)
      const Kuroshiro = KuroshiroModule.default || KuroshiroModule
      const KuromojiAnalyzer = AnalyzerModule.default || AnalyzerModule

      ;(async () => {
        const kuroshiro = new Kuroshiro()
        const analyzer = new KuromojiAnalyzer()
        await kuroshiro.init(analyzer)
        const output = []
        for (const line of workerData.lines) {
          const tokens = await analyzer.parse(line)
          const words = []
          for (const token of tokens) {
            const value = toRomaji(token.pronunciation || token.reading || token.surface_form).trim()
            if (!value) continue
            const joinsConjugation = token.pos === '助動詞' || (token.pos === '助詞' && token.pos_detail_1 === '接続助詞' && /^(て|で)$/.test(token.surface_form))
            const punctuation = token.pos === '記号'
            if ((joinsConjugation || punctuation) && words.length) words[words.length - 1] += value
            else words.push(value)
          }
          output.push(words.join(' ').replace(/\\s+/g, ' ').trim())
        }
        parentPort.postMessage({ output })
      })().catch(error => parentPort.postMessage({ error: error && error.message ? error.message : String(error) }))
    `
    const worker = new Worker(workerSource, {
      eval: true,
      workerData: {
        lines: input,
        kuroshiroPath: nodeRequire.resolve('kuroshiro'),
        analyzerPath: nodeRequire.resolve('kuroshiro-analyzer-kuromoji'),
        wanakanaPath: nodeRequire.resolve('wanakana')
      }
    })
    let finished = false
    const finish = (output?: string[], error?: Error) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      // Do not release the queue while the expanded dictionary still lives.
      void worker.terminate().then(() => {
        if (error) reject(error)
        else resolve(output ?? [])
      }, reject)
    }
    const timer = setTimeout(() => finish(undefined, new Error('日文罗马音分析超时')), 20_000)
    worker.once('message', (message: { output?: string[]; error?: string }) => {
      if (message.output) finish(message.output)
      else finish(undefined, new Error(message.error || '日文罗马音分析失败'))
    })
    worker.once('error', error => finish(undefined, error))
    worker.once('exit', () => finish(undefined, new Error('日文罗马音分析进程提前退出')))
  }))
  queue = task.catch(() => undefined)
  jobs.set(key, task)
  void task.finally(() => jobs.delete(key)).catch(() => undefined)
  return task
}
