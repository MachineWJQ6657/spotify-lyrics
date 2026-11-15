// Reads the result of scripts/qa/live-check.mjs: the displayed position against
// the Web API's, backward and forward moves of the displayed clock, each event
// (position and active row every 250 ms), main's snapshots, scroll smoothness.
import fs from 'node:fs'
const data = JSON.parse(fs.readFileSync(process.argv[2] ?? '.qa-scratch/live-check.json', 'utf8'))
const { marks, live } = data
const clock = live.clock.map(([t, pct, dur, track]) => ({ t, pos: pct / 100 * dur, track }))
const shown = t => { let last = null; for (const c of clock) { if (c.t > t) break; last = c } return last }
const lineAt = t => { let last = null; for (const l of live.lines) { if (l[0] > t) break; last = l } return last }
const t0 = marks.find(m => m.at)?.at ?? clock[0].t
const rel = t => ((t - t0) / 1000).toFixed(2).padStart(7)
console.log('notes', data.notes)
// API samples against the displayed position
console.log('\nWeb API progress vs displayed position (ms, + = display ahead):')
for (const m of marks.filter(m => m.sample)) {
  const s = m.sample
  const c = shown(s.at)
  const next = clock.find(x => x.t > s.at)
  let disp = c ? c.pos : NaN
  if (c && next && next.track === c.track && next.pos > c.pos && next.t - c.t < 400) disp = c.pos + (next.pos - c.pos) * (s.at - c.t) / (next.t - c.t)
  console.log(rel(s.at), m.name.padEnd(11), 'api', String(s.progress).padStart(7), 'playing', s.playing, 'rtt', s.rtt, 'shown', Math.round(disp), 'diff', Math.round(disp - s.progress), (s.name ?? '').slice(0, 20))
}
// Backward jumps in the displayed position within one track
console.log('\nbackward moves of the displayed position (same track, > 150 ms):')
for (let i = 1; i < clock.length; i++) {
  const a = clock[i - 1], b = clock[i]
  if (a.track === b.track && b.pos < a.pos - 150) console.log(rel(b.t), Math.round(a.pos), '->', Math.round(b.pos), 'by', Math.round(b.pos - a.pos))
}
// Forward jumps (more than the elapsed time + 400 ms)
console.log('\nforward jumps of the displayed position (same track):')
for (let i = 1; i < clock.length; i++) {
  const a = clock[i - 1], b = clock[i]
  const jump = (b.pos - a.pos) - (b.t - a.t)
  if (a.track === b.track && jump > 400) console.log(rel(b.t), Math.round(a.pos), '->', Math.round(b.pos), 'extra', Math.round(jump))
}
// Event windows
console.log('\nevents (displayed position every 250 ms from -0.5 s to +4 s; line = active row):')
for (const m of marks.filter(m => m.at)) {
  const row = []
  for (let dt = -500; dt <= 4000; dt += 250) { const c = shown(m.at + dt); const l = lineAt(m.at + dt); row.push(`${(dt / 1000).toFixed(2)}:${c ? Math.round(c.pos) : '-'}${l ? '/L' + l[1] : ''}`) }
  console.log(`${rel(m.at)} ${m.name}${m.row != null ? ` row ${m.row} start ${m.start}` : ''}${m.status ? ' status ' + m.status : ''}${m.done ? ' done +' + (m.done - m.at) : ''}`)
  console.log('   ', row.join(' '))
}
// Native snapshots near events
console.log('\nsnapshots sent by main (t, track, positionMs, observedAt offset, playing) around events:')
for (const m of marks.filter(m => m.at)) {
  const near = live.snaps.filter(s => s[0] >= m.at - 300 && s[0] <= m.at + 3000)
  console.log(rel(m.at), m.name, near.map(s => `${((s[0] - m.at) / 1000).toFixed(2)}:${s[2]}${s[4] ? 'P' : 'p'}`).join(' '))
}
// Scroll smoothness at line changes
let smooth = 0, jumpy = 0, quiet = 0
const detail = []
for (const [t, line] of live.lines) {
  if (line < 0) continue
  const moves = live.scroll.filter(s => s[0] > t && s[0] <= t + 900)
  if (moves.length === 0) quiet++
  else if (moves.length >= 4) smooth++
  else { jumpy++; detail.push(`${rel(t)} L${line} ${moves.length} steps`) }
}
console.log('\nscroll after line changes: smooth', smooth, 'one-to-three steps', jumpy, 'no move', quiet, detail.join('; '))
