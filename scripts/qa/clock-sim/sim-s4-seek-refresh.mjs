// S4: seeking from Syllable. The renderer moves its clock at once (src/lib/seek.ts), main asks Spotify to seek and
// 180 ms later broadcasts localSpotify.current() (electron/main.ts playback:seek -> refreshPlayback). current() is
// projected from the last worker state, which is still the pre-seek one until Spotify's media session reports the seek.
import { createWorld, createRig, fmt } from './harness.mjs'
const { TransportClock } = await import('./clock.bundle.mjs')

for (const latencyMs of [120, 400]) {
  const world = createWorld()
  const rig = await createRig(world, { title: 'A', artist: 'x', album: 'a', positionMs: 100_000, durationMs: 240_000, statusName: 'PLAYING' })
  world.advance(5000)
  rig.emit({ positionMs: 105_000 })
  const clock = new TransportClock()
  let last = null
  const feed = () => { for (const item of rig.snapshots.splice(0)) { clock.update(item.snapshot); last = item.snapshot } }
  world.advance(1000); feed()
  const T0 = world.now()
  const target = 45_120
  console.log(`\n== media session reports the seek after ${latencyMs} ms`)
  // renderer: seekPlayback()
  clock.update({ ...last, positionMs: target, observedAtMs: world.now() })
  console.log(`t=+0    line clicked: clock ${fmt(clock.position(world.now()))}`)
  // main: playback:seek
  let resolved = false
  void rig.service.seek(target).then(() => { resolved = true })
  await Promise.resolve(); await Promise.resolve()
  const report = () => rig.emit({ positionMs: target + 5 })
  const refresh = () => { const snapshot = rig.service.current(); clock.update(structuredClone(snapshot)); last = snapshot }
  const events = [[latencyMs, report], [180, refresh]].sort((a, b) => a[0] - b[0])
  for (const [at, run] of events) {
    world.advance(at - (world.now() - T0)); run(); feed()
    console.log(`t=+${at}  ${run === refresh ? 'refresh broadcast of current()' : 'worker reports the seek      '}: clock ${fmt(clock.position(world.now()))}  (audio at ${target + at})`)
  }
  console.log(`seek request resolved: ${resolved}; native calls: ${JSON.stringify(rig.nativeCalls.map(call => call.slice(0, 2)))}`)
  world.restore()
}
