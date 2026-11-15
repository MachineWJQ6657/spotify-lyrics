import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { fetchWithTimeout } from './lyrics-provider'

let close: (() => void) | undefined
afterEach(() => { close?.(); close = undefined })

/** A local server; `stall` sends the headers and half a body, then nothing. */
const serve = (stall: boolean) => new Promise<string>(resolve => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    if (stall) response.write('{"result":')
    else response.end('{"result":{"songs":[]}}')
  })
  server.listen(0, '127.0.0.1', () => {
    close = () => { server.closeAllConnections(); server.close() }
    resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`)
  })
})

describe('provider requests', () => {
  it('give up on a body that stalls after the headers', async () => {
    const url = await serve(true)
    const started = Date.now()
    // Before: this resolved on the headers and the later json() never settled.
    await expect(fetchWithTimeout(url, undefined, 400, 0)).rejects.toBeTruthy()
    expect(Date.now() - started).toBeLessThan(3000)
  }, 10_000)

  it('return a complete body that can still be read', async () => {
    const url = await serve(false)
    const response = await fetchWithTimeout(url, undefined, 2000, 0)
    expect(response.ok).toBe(true)
    expect(await response.json()).toEqual({ result: { songs: [] } })
  }, 10_000)
})
