import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'

// `setIgnoreMouseEvents(…, { forward: true })` installs a system-wide low-level
// mouse hook on the main process's thread. With it, the cursor stuttered in
// every application whenever that thread was busy (0.4.82).
it('never asks Electron to forward mouse movement', () => {
  for (const file of ['main.ts', 'overlay-input.ts', 'local-spotify.ts']) {
    const source = readFileSync(path.join(__dirname, file), 'utf8')
    const code = source.split(/\r?\n/).filter(line => !line.trim().startsWith('//')).join('\n')
    expect(code, file).not.toMatch(/forward\s*:\s*true/)
  }
})
