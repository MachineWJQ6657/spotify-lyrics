const { SpotifyClient } = require('libspotifyctl')

const targetTitle = process.argv[2]
const targetPositionMs = Number(process.argv[3] || 0)
const shouldPause = process.argv[4] !== 'playing'
const client = new SpotifyClient()
const deadline = Date.now() + 12_000
let commandSent = false
let initialTitle = ''
let firstCommandAt = 0
let secondCommandSent = false
let settled = false

function finish(code, message) {
  if (settled) return
  settled = true
  try { client.close() } catch {}
  console.log(message)
  process.exit(code)
}

function inspect() {
  try {
    const state = client.latestState()
    if (!commandSent && state?.title) {
      commandSent = true
      initialTitle = state.title
      firstCommandAt = Date.now()
      if (!client.previous()) return finish(2, 'previous command rejected')
    }
    // Spotify's previous action restarts a track once it has played for more
    // than three seconds. If that happened, a second deliberate action while
    // it is back near the beginning selects the actual previous queue item.
    if (commandSent && !secondCommandSent && state?.title === initialTitle && Date.now() - firstCommandAt >= 700) {
      secondCommandSent = true
      if (!client.previous()) return finish(2, 'second previous command rejected')
    }
    if (commandSent && state?.title === targetTitle) {
      if (targetPositionMs > 0 && !client.seekMs(Math.round(targetPositionMs))) return finish(3, 'seek rejected')
      if (shouldPause && !client.pause()) return finish(4, 'pause rejected')
      return setTimeout(() => finish(0, `restored ${state.artist} - ${state.title} at ${Math.round(targetPositionMs)}ms (${shouldPause ? 'paused' : 'playing'})`), 350)
    }
    if (Date.now() >= deadline) finish(5, `restore timeout; current=${state?.artist || '?'} - ${state?.title || '?'}`)
  } catch (error) {
    if (Date.now() >= deadline) finish(6, error instanceof Error ? error.message : String(error))
  }
}

client.on('stateChanged', inspect)
client.start()
const timer = setInterval(inspect, 120)
setTimeout(() => {
  clearInterval(timer)
  if (!settled) finish(7, 'restore watchdog timeout')
}, 13_000)
