// Explicit, bounded, LOCAL-ONLY ASR evaluation; never imported by the app.
// node scripts/evaluate-local-asr.mjs --cli=path --model=path input.wav ...
// Optional --language=ja --timeout=90000 --seconds=20. No lyric prompt is used.
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const option = (name, fallback) => args.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback
const cli = option('cli'), model = option('model'), language = option('language', 'ja')
const timeoutMs = Number(option('timeout', '90000')), seconds = Number(option('seconds', '20'))
const files = args.filter(value => !value.startsWith('--'))
if (!cli || !model || !files.length) throw new Error('Provide --cli, --model, and local audio input(s)')
if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 180000 || !Number.isFinite(seconds) || seconds < 5 || seconds > 30) throw new Error('Invalid resource limits')
const root = path.resolve('.qa-asr')
mkdirSync(root, { recursive: true })
const runDirectory = mkdtempSync(path.join(root, 'run-'))
function run(executable, arguments_, timeout) {
  return new Promise(resolve => {
    const started = performance.now()
    const child = spawn(executable, arguments_, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], shell: false })
    let stdout = '', stderr = '', timedOut = false, failure
    const timer = setTimeout(() => { timedOut = true; child.kill() }, timeout)
    child.stdout.on('data', data => { stdout = (stdout + data.toString()).slice(-1024 * 1024) })
    child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-1024 * 1024) })
    child.on('error', error => { failure = error.message })
    child.on('close', code => {
      clearTimeout(timer)
      resolve({ code, timedOut, failure, elapsedMs: Math.round(performance.now() - started), stdout, stderr })
    })
  })
}
const results = []
for (let index = 0; index < files.length; index++) {
  const converted = path.join(runDirectory, `clip-${index}.wav`), output = path.join(runDirectory, `transcript-${index}`)
  const conversion = await run('ffmpeg', ['-v', 'error', '-nostdin', '-i', path.resolve(files[index]), '-t', String(seconds), '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', converted], 30000)
  if (conversion.code !== 0) throw new Error(`Audio conversion failed: ${conversion.failure || conversion.stderr}`)
  const result = await run(path.resolve(cli), ['-m', path.resolve(model), '-f', converted, '-l', language,
    '-t', '4', '-p', '1', '-bs', '1', '-bo', '1', '-nf', '-ojf', '-of', output], timeoutMs)
  writeFileSync(`${output}.stderr.log`, result.stderr)
  let transcript, parseError
  if (result.code === 0) {
    try { transcript = JSON.parse(readFileSync(`${output}.json`, 'utf8')) } catch (error) { parseError = error.message }
  }
  const segments = transcript?.transcription ?? []
  const text = segments.map(segment => segment.text ?? '').join(' ')
  const cleaned = text.replace(/\([^)]*\)|\[[^\]]*\]|（[^）]*）|♪|♫/gu, '').replace(/\s+/gu, '')
  const row = { index, model: path.basename(model), language, code: result.code, timedOut: result.timedOut,
    failure: result.failure || parseError, elapsedMs: result.elapsedMs, segmentCount: segments.length,
    lexicalCharacters: [...cleaned].length, onlyNonSpeechLabels: Boolean(text.trim()) && !cleaned,
    transcriptFile: `${output}.json`, logFile: `${output}.stderr.log` }
  results.push(row)
  console.log(JSON.stringify(row))
}
writeFileSync(path.join(runDirectory, 'report.json'), JSON.stringify({ createdAt: new Date().toISOString(),
  note: 'ASR execution evidence only; non-empty text is NOT evidence of correct sung words or timing. No known-lyric prompt, audio upload or playback control.', results }, null, 2))
console.log(JSON.stringify({ report: path.join(runDirectory, 'report.json') }))
if (results.some(result => result.code !== 0 || result.failure)) process.exitCode = 1
