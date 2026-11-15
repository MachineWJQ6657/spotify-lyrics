// S2b: pausing from Syllable's own button. control('pause') first publishes an accurate projected pause position;
// the first native PAUSED notification (still carrying the last raw position, as in qa-0442-current.log
// 2026-10-21T04:55:04.357 -> 04.426) then "confirms" the command and replaces it.
import { createWorld, createRig, fmt } from './harness.mjs'
const { TransportClock } = await import('./clock.bundle.mjs')
const world = createWorld()
const rig = await createRig(world, { title: 'A', artist: 'x', album: 'a', positionMs: 100_000, durationMs: 240_000, statusName: 'PLAYING' })
world.advance(5000)
rig.emit({ positionMs: 169_134 })
const clock = new TransportClock()
let last = null
const feed = () => { for (const item of rig.snapshots.splice(0)) { clock.update(item.snapshot); last = item.snapshot } }
world.advance(3787); feed()
console.log(`before pause: clock ${fmt(clock.position(world.now()))}`)
const done = rig.service.control('pause')
await done; feed()
console.log(`pause command acknowledged: isPlaying=${last.isPlaying} clock ${fmt(clock.position(world.now()))}`)
world.advance(50)
rig.emit({ statusName: 'PAUSED' }); feed()          // raw position still 169134
console.log(`+50 ms native PAUSED with the last raw position: clock ${fmt(clock.position(world.now()))}`)
world.advance(69)
rig.emit({ positionMs: 172_921 }); feed()
console.log(`+119 ms accurate paused position: clock ${fmt(clock.position(world.now()))}`)
world.restore()
