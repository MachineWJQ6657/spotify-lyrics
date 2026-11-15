// S2: a pause notification that still carries the last raw position (shape seen in the QA logs).
// S3: two seeks to the same raw position with no other raw sample between them.
// S5: skipping to another song while paused (first sample PAUSED, PLAYING 91 ms later, as logged 2026-10-21T04:43:35).
import { createWorld, createRig, fmt } from './harness.mjs'
const { TransportClock } = await import('./clock.bundle.mjs')

async function scenario(name, run) {
  const world = createWorld()
  const rig = await createRig(world, { title: 'A', artist: 'x', album: 'a', positionMs: 100_000, durationMs: 240_000, statusName: 'PLAYING' })
  world.advance(5000)
  rig.emit({ positionMs: 105_000 })
  const clock = new TransportClock()
  let last = null
  const feed = () => { for (const item of rig.snapshots.splice(0)) { clock.update(item.snapshot); last = item.snapshot } }
  world.advance(100); feed()
  console.log(`\n== ${name}`)
  await run({ world, rig, clock, feed, last: () => last })
  world.restore()
}

await scenario('S2 pause: first PAUSED notification repeats the last raw position', async ({ world, rig, clock, feed, last }) => {
  // The last raw position (105000) was observed 100 ms ago; play on for 3800 ms with no new raw sample.
  world.advance(3700); feed()
  const before = clock.position(world.now())
  rig.emit({ statusName: 'PAUSED' })                 // raw position still 105000
  feed()
  console.log(`before pause: clock ${fmt(before)}; after 1st PAUSED notification: isPlaying=${last().isPlaying} clock ${fmt(clock.position(world.now()))}  (jump ${fmt(clock.position(world.now()) - before)} ms)`)
  world.advance(69)
  rig.emit({ positionMs: 108_790 })                  // the accurate paused position follows
  feed()
  console.log(`+69 ms accurate PAUSED position: clock ${fmt(clock.position(world.now()))}`)
})

await scenario('S3 two seeks to the same raw position', async ({ world, rig, clock, feed }) => {
  rig.emit({ positionMs: 45_120 }); feed()            // first seek: re-anchored
  console.log(`first seek to 45120: clock ${fmt(clock.position(world.now()))}`)
  world.advance(2000); feed()
  rig.workerMessages.length = 0
  rig.emit({ positionMs: 45_120 }); feed()            // second seek to the same line 2 s later
  console.log(`second seek to 45120 after 2000 ms: published at once: ${rig.workerMessages.filter(m => m.message.type === 'state').length}; clock ${fmt(clock.position(world.now()))} (audio is at 45120)`)
  world.advance(1500); feed()
  console.log(`1500 ms later: clock ${fmt(clock.position(world.now()))}, audio at ${45_120 + 1500}, error ${fmt(clock.position(world.now()) - 46_620)} ms`)
})

await scenario('S5 skip to another song while paused', async ({ world, rig, clock, feed, last }) => {
  rig.emit({ statusName: 'PAUSED', positionMs: 105_100 }); feed()
  world.advance(10_000); feed()
  const T0 = world.now()
  rig.workerMessages.length = 0
  rig.emit({ title: 'B', album: 'b', positionMs: 0, durationMs: 200_000, statusName: 'PAUSED' }); feed()
  console.log(`t=+0   new title, PAUSED: isPlaying=${last().isPlaying} track=${last().track.name}`)
  world.advance(91)
  rig.emit({ statusName: 'PLAYING' }); feed()
  console.log(`t=+91  PLAYING observed. published: ${rig.workerMessages.filter(m => m.message.type === 'state').map(m => `+${m.at - T0}ms ${m.message.state.statusName}`).join(', ')}`)
  for (const at of [1000, 3000, 5000]) {
    world.advance(at - (world.now() - T0)); feed()
    console.log(`t=+${at} renderer: isPlaying=${last().isPlaying} clock ${fmt(clock.position(world.now()))}  (audio at ${at - 91})`)
  }
  world.advance(200); feed()
  console.log(`t=+5200 renderer: isPlaying=${last().isPlaying} clock ${fmt(clock.position(world.now()))}; published: ${rig.workerMessages.filter(m => m.message.type === 'state').map(m => `+${m.at - T0}ms ${m.message.state.statusName}`).join(', ')}`)
})
