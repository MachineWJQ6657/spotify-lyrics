// A second seek from Syllable to the line just played: Spotify reports the identical raw position again.
import { createWorld, createRig, fmt } from './harness.mjs'
const { TransportClock } = await import('./clock.bundle.mjs')
const world = createWorld()
const rig = await createRig(world, { title: 'A', artist: 'x', album: 'a', positionMs: 100_000, durationMs: 240_000, statusName: 'PLAYING' })
world.advance(5000)
rig.emit({ positionMs: 105_000 })
const clock = new TransportClock()
let last = null
const feed = () => { for (const item of rig.snapshots.splice(0)) { clock.update(item.snapshot); last = item.snapshot } }
world.advance(1000); feed()
const target = 45_120
const seek = async label => {
  clock.update({ ...last, positionMs: target, observedAtMs: world.now() })
  void rig.service.seek(target)
  await Promise.resolve(); await Promise.resolve()
  world.advance(100); rig.emit({ positionMs: target }); feed()      // Spotify reports the seek 100 ms later, same millisecond
  console.log(`${label}: clock ${fmt(clock.position(world.now()))} (audio at ${target + 100})`)
}
await seek('first seek ')
world.advance(1900); feed()
console.log(`2 s after the first seek: clock ${fmt(clock.position(world.now()))} (audio at ${target + 2000})`)
await seek('second seek')
world.advance(1500); feed()
console.log(`1500 ms later: clock ${fmt(clock.position(world.now()))}, audio at ${target + 1600}, error ${fmt(clock.position(world.now()) - (target + 1600))} ms`)
world.advance(3000); feed()
console.log(`4500 ms later: clock ${fmt(clock.position(world.now()))}, audio at ${target + 4600}, error ${fmt(clock.position(world.now()) - (target + 4600))} ms`)
world.restore()
