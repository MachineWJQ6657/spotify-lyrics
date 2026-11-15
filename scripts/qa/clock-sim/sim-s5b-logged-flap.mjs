// S5b: the exact shape in qa-0439-1019-current.log at 2026-10-21T04:43:35 (skip while paused):
// new title PAUSED, old title PAUSED 11 ms later, new title PLAYING 91 ms after the first. With the title flapping
// back, the PLAYING sample is a third identity change and is announced; without the flap (S5) it is withheld 5 s.
import { createWorld, createRig, fmt } from './harness.mjs'
const { TransportClock } = await import('./clock.bundle.mjs')
const world = createWorld()
const rig = await createRig(world, { title: 'A', artist: 'x', album: 'a', positionMs: 21_397, durationMs: 177_613, statusName: 'PAUSED' })
world.advance(2000)
const clock = new TransportClock()
let last = null
const feed = () => { for (const item of rig.snapshots.splice(0)) { clock.update(item.snapshot); last = item.snapshot } }
feed()
const T0 = world.now()
rig.workerMessages.length = 0
rig.emit({ title: 'B', album: 'b', positionMs: 0, durationMs: 238_398 }); feed()
world.advance(11); rig.emit({ title: 'A', album: 'a' }); feed()
world.advance(80); rig.emit({ title: 'B', album: 'b', statusName: 'PLAYING' }); feed()
console.log('published:', rig.workerMessages.filter(m => m.message.type === 'state').map(m => `+${m.at - T0}ms ${m.message.state.title} ${m.message.state.statusName}`).join(', '))
world.advance(1000); feed()
console.log(`t=+1091 renderer: track=${last.track.name} isPlaying=${last.isPlaying} clock ${fmt(clock.position(world.now()))}`)
world.restore()
