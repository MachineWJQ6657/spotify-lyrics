/** Confirm cooperative close, including successful native shutdown AND exit.
 * A timeout is failure. The caller persists that failure before any forced
 * termination: terminating a live native Koffi worker can exit the host itself. */
exports.closeMonitorNative = (worker, timeoutMs = 3000) => new Promise((resolve, reject) => {
  let acknowledged = false, done = false
  const finish = error => {
    if (done) return
    done = true; clearTimeout(timer)
    worker.removeListener('message', onMessage); worker.removeListener('error', onError); worker.removeListener('exit', onExit)
    if (error) reject(error); else resolve()
  }
  const onMessage = message => {
    if (message?.type === 'stopped') acknowledged = true
    else if (message?.type === 'error') finish(new Error(message.error || 'Native close failed'))
  }
  const onError = error => finish(error)
  const onExit = code => finish(code === 0 && acknowledged ? undefined : new Error('Native close/exit was not confirmed'))
  const timer = setTimeout(() => finish(new Error('Native close timed out')), timeoutMs)
  worker.on('message', onMessage); worker.once('error', onError); worker.once('exit', onExit)
  try { worker.postMessage({ type: 'stop' }) } catch (error) { finish(error) }
})
