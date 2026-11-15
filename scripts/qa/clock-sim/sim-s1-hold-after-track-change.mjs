// S1: after a track change the worker announces the first sample, then withholds later raw observations for 5 s
// unless they differ by >= 1500 ms. Numbers follow qa-0442-current.log 2026-10-21T05:20:22 (-884 ms after a skip).
import { createWorld, createRig, fmt } from './harness.mjs'
const { TransportClock } = await import('./clock.bundle.mjs')
const world = createWorld()
const rig = await createRig(world, { title: 'A', artist: 'x', album: 'a', positionMs: 100_000, durationMs: 240_000, statusName: 'PLAYING' })
world.advance(5000)                       // startup hold of the first song
rig.emit({ positionMs: 105_000 })
world.advance(3000)
const clock = new TransportClock()
const feed = () => { for (const item of rig.snapshots.splice(0)) clock.update(item.snapshot) }
feed()
const T0 = world.now()
rig.workerMessages.length = 0
rig.emit({ title: 'B', album: 'b', positionMs: 0, durationMs: 200_000 })   // new song announced at 0
feed()
const published = () => rig.workerMessages.filter(m => m.message.type === 'state').map(m => `+${m.at - T0}ms pos=${fmt(m.message.state.positionMs)}`)
console.log('t=+0     published:', published(), 'renderer clock', fmt(clock.position(world.now())))
world.advance(2111)
rig.emit({ positionMs: 1227 })            // the next raw position: the song is really 884 ms behind the first sample
feed()
console.log('t=+2111  raw 1227 observed (clock says 2111). published so far:', published())
for (const at of [2500, 3500, 4900]) {
  world.advance(at - (world.now() - T0)); feed()
  const truth = 1227 + (world.now() - T0 - 2111)
  console.log(`t=+${at}  renderer clock ${fmt(clock.position(world.now()))}  position per the latest raw sample ${truth}  error ${fmt(clock.position(world.now()) - truth)} ms`)
}
world.advance(5100 - (world.now() - T0)); feed()
console.log('t=+5100  published:', published(), 'renderer clock', fmt(clock.position(world.now())), 'expected', 1227 + 5100 - 2111)
// Control: the same correction once the hold is over is published at once.
world.advance(3000); feed(); rig.workerMessages.length = 0
const T1 = world.now()
rig.emit({ positionMs: Math.round(clock.position(world.now())) - 884 }); feed()
console.log('control (mid-song, same -884 ms correction): published after', rig.workerMessages.filter(m => m.message.type === 'state').map(m => `${m.at - T1}ms`))
world.restore()
