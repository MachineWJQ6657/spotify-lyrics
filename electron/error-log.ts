import { appendFile, rename, stat } from 'node:fs/promises'

/** Keep the log small: past this size it is rotated to `<file>.1` (one generation). */
export const ERROR_LOG_MAX_BYTES = 256 * 1024

/** One log line: timestamp, kind, and the stack (or message) collapsed onto indented lines. */
export function formatErrorEntry(kind: string, error: unknown, now = new Date()) {
  const detail = error instanceof Error ? (error.stack || `${error.name}: ${error.message}`)
    : typeof error === 'string' ? error : JSON.stringify(error) ?? String(error)
  return `${now.toISOString()} ${kind}: ${String(detail).replace(/\r?\n/g, '\n    ')}\n`
}

/**
 * Append to a persistent error log so crashes the user notices can be
 * diagnosed afterwards. Never throws: logging must not become the next error.
 */
export function createErrorLog(resolvePath: () => string | null, maxBytes = ERROR_LOG_MAX_BYTES) {
  let queue = Promise.resolve()
  return (kind: string, error: unknown) => {
    const entry = formatErrorEntry(kind, error)
    queue = queue.then(async () => {
      const file = resolvePath()
      if (!file) return
      const size = await stat(file).then(info => info.size, () => 0)
      if (size + entry.length > maxBytes) await rename(file, `${file}.1`).catch(() => undefined)
      await appendFile(file, entry, 'utf8')
    }).catch(() => undefined)
    return queue
  }
}
