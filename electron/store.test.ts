import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir() }, safeStorage: {} }))
import { WindowBoundsStore } from './store'

const directories: string[] = []
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'syllable-bounds-test-'))
  directories.push(directory)
  const file = path.join(directory, 'overlay-window.json')
  return { file, store: new WindowBoundsStore(file) }
}
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    if (path.dirname(directory) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('syllable-bounds-test-')) throw new Error('Unsafe test cleanup')
    await rm(directory, { recursive: true, force: true })
  }
})
it('restores negative secondary coordinates and the last of overlapping saves', async () => {
  const { file, store } = await fixture()
  const first = { x: -1450, y: -20, width: 650, height: 180 }
  const last = { x: -1330, y: 610, width: 704, height: 196 }
  await Promise.all([store.set(first), store.set(last)])
  expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(last)
  expect(await new WindowBoundsStore(file).get()).toEqual(last)
})
it('snapshots pending geometry instead of retaining a mutable object', async () => {
  const { store } = await fixture()
  const bounds = { x: 20, y: 30, width: 640, height: 180 }
  const saved = store.set(bounds)
  bounds.width = 999
  await saved
  expect((await store.get())?.width).toBe(640)
})
it('falls back safely for missing, malformed and invalid geometry', async () => {
  const { file, store } = await fixture()
  expect(await store.get()).toBeNull()
  for (const raw of ['broken', 'null', '{}', '{"x":0,"y":0,"width":-1,"height":100}']) {
    await writeFile(file, raw)
    expect(await store.get()).toBeNull()
  }
})
