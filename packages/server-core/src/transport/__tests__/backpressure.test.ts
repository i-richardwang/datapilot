/**
 * Backpressure + shared event serialization tests.
 *
 * Backpressure: a client whose ws send buffer stays above the threshold past
 * the grace period is terminated; the retained event buffer makes reconnect
 * replay the recovery path.
 *
 * Shared serialization: push() serializes the envelope body once and splices
 * per-client id/seq in as a string prefix — the output must stay equivalent
 * to a full serializeEnvelope.
 */

import { describe, it, expect, afterEach } from 'bun:test'
import WebSocket from 'ws'
import { connect, type Socket } from 'node:net'
import { WsRpcServer } from '../server'
import { serializeEnvelope, deserializeEnvelope } from '../codec'
import { PROTOCOL_VERSION } from '@craft-agent/shared/protocol'

const TEST_TOKEN = 'test-token-with-enough-entropy-to-pass'

function createServer(opts?: { backpressureThresholdBytes?: number; backpressureGraceMs?: number }) {
  return new WsRpcServer({
    host: '127.0.0.1',
    port: 0,
    requireAuth: true,
    validateToken: async (t) => t === TEST_TOKEN,
    serverId: 'test',
    ...opts,
  })
}

function handshake(url: string): Promise<{ ws: WebSocket; clientId: string }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    const timeout = setTimeout(() => {
      ws.close()
      reject(new Error('Handshake timeout'))
    }, 5_000)

    ws.on('open', () => {
      ws.send(JSON.stringify({
        id: crypto.randomUUID(),
        type: 'handshake',
        protocolVersion: PROTOCOL_VERSION,
        token: TEST_TOKEN,
      }))
    })
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString())
      if (msg.type === 'handshake_ack') {
        clearTimeout(timeout)
        resolve({ ws, clientId: msg.clientId })
      }
    })
    ws.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })
  })
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timeout')
    await new Promise(r => setTimeout(r, 25))
  }
}

/** Build a masked client→server WS text frame (RFC 6455 §5.3). */
function maskedTextFrame(payload: string): Buffer {
  const data = Buffer.from(payload)
  const mask = Buffer.from([0x12, 0x34, 0x56, 0x78])
  let header: Buffer
  if (data.length < 126) {
    header = Buffer.from([0x81, 0x80 | data.length])
  } else {
    header = Buffer.alloc(4)
    header[0] = 0x81
    header[1] = 0x80 | 126
    header.writeUInt16BE(data.length, 2)
  }
  const masked = Buffer.alloc(data.length)
  for (let i = 0; i < data.length; i++) masked[i] = data[i]! ^ mask[i % 4]!
  return Buffer.concat([header, mask, masked])
}

/**
 * Handshake over a raw TCP socket so the test can socket.pause() afterwards —
 * a genuine "client stopped reading" simulation that backs the server's send
 * buffer up through the TCP window. (Bun's ws client shim does not implement
 * WebSocket.pause(), so the high-level client can't simulate this.)
 */
async function rawWsHandshake(port: number): Promise<{ socket: Socket; clientId: string }> {
  const socket = connect(port, '127.0.0.1')
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve())
    socket.once('error', reject)
  })
  socket.write(
    'GET / HTTP/1.1\r\n' +
    'Host: 127.0.0.1\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
    'Sec-WebSocket-Version: 13\r\n\r\n',
  )

  let received = ''
  let sentHandshake = false
  const clientId = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('raw ws handshake timeout')), 5_000)
    socket.on('data', (chunk) => {
      received += chunk.toString('latin1')
      if (!sentHandshake && received.includes('\r\n\r\n')) {
        sentHandshake = true
        socket.write(maskedTextFrame(JSON.stringify({
          id: crypto.randomUUID(),
          type: 'handshake',
          protocolVersion: PROTOCOL_VERSION,
          token: TEST_TOKEN,
        })))
      }
      // The handshake_ack payload is plain JSON inside the (unmasked) server frame.
      const match = received.match(/"clientId":"([0-9a-fA-F-]+)"/)
      if (match) {
        clearTimeout(timeout)
        resolve(match[1]!)
      }
    })
    socket.once('error', (err) => { clearTimeout(timeout); reject(err) })
  })
  return { socket, clientId }
}

type FakeWs = { bufferedAmount: unknown; terminate: () => void }
type CheckableServer = {
  checkBackpressure(client: { id: string; ws: FakeWs; backpressureSince: number | null }): boolean
}

describe('checkBackpressure (unit)', () => {
  function fakeClient(bufferedAmount: unknown, backpressureSince: number | null = null) {
    let terminated = false
    return {
      client: {
        id: 'c_test',
        ws: { bufferedAmount, terminate: () => { terminated = true } },
        backpressureSince,
      },
      wasTerminated: () => terminated,
    }
  }

  const server = createServer({ backpressureThresholdBytes: 1000, backpressureGraceMs: 50 }) as unknown as CheckableServer

  it('healthy buffer clears the congestion timestamp', () => {
    const { client, wasTerminated } = fakeClient(500, Date.now() - 10_000)
    expect(server.checkBackpressure(client)).toBe(true)
    expect(client.backpressureSince).toBeNull()
    expect(wasTerminated()).toBe(false)
  })

  it('first over-threshold reading starts the grace period and still sends', () => {
    const { client, wasTerminated } = fakeClient(2000)
    expect(server.checkBackpressure(client)).toBe(true)
    expect(client.backpressureSince).not.toBeNull()
    expect(wasTerminated()).toBe(false)
  })

  it('terminates after the grace period expires', () => {
    const { client, wasTerminated } = fakeClient(2000, Date.now() - 100)
    expect(server.checkBackpressure(client)).toBe(false)
    expect(wasTerminated()).toBe(true)
  })

  it('degrades to no-op when bufferedAmount is unavailable', () => {
    const { client, wasTerminated } = fakeClient(undefined, Date.now() - 10_000)
    expect(server.checkBackpressure(client)).toBe(true)
    expect(wasTerminated()).toBe(false)
  })
})

describe('backpressure (integration)', () => {
  let server: WsRpcServer | null = null
  const openSockets: WebSocket[] = []

  afterEach(() => {
    for (const ws of openSockets) {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.terminate()
      }
    }
    openSockets.length = 0
    server?.close()
    server = null
  })

  it('terminates a client that stops reading, then resumes via reconnect replay', async () => {
    server = createServer({ backpressureThresholdBytes: 16 * 1024, backpressureGraceMs: 100 })
    await server.listen()
    const url = `ws://127.0.0.1:${server.port}`

    const { socket, clientId } = await rawWsHandshake(server.port)

    // Stop reading — the server's send buffer backs up once TCP windows fill.
    socket.pause()

    // Flood past the threshold. Measured on macOS loopback under Bun: TCP +
    // uWS internal buffers absorb ~19MB before bufferedAmount starts rising,
    // so the flood must be well past that.
    const payload = 'x'.repeat(64 * 1024)
    for (let i = 0; i < 600; i++) {
      server.push('test:flood', { to: 'all' }, { i, payload })
    }
    // Let the grace period lapse, then trigger the send-path check again.
    await new Promise(r => setTimeout(r, 200))
    server.push('test:flood', { to: 'all' }, { i: 600, payload })

    await waitFor(() => server!.getConnectedClientCount() === 0)
    socket.destroy()

    // Recovery path: reconnect with the old identity. The slow client missed
    // more events (601) than the ring buffer retains (500), so the server must
    // answer stale=true — the client's signal to do a full refresh. That is
    // the designed degradation for a backpressure cut: bounded memory on the
    // server, explicit resync for the client, no silent gaps.
    const reconnectAck = await reconnect(url, clientId, 0)
    expect(reconnectAck.ack.reconnected).toBe(true)
    expect(reconnectAck.ack.clientId).toBe(clientId)
    expect(reconnectAck.ack.stale).toBe(true)
  }, 15_000)

  it('replays buffered events with contiguous seq after a reconnect', async () => {
    server = createServer({ backpressureThresholdBytes: 16 * 1024, backpressureGraceMs: 100 })
    await server.listen()
    const url = `ws://127.0.0.1:${server.port}`

    const { ws, clientId } = await handshake(url)
    openSockets.push(ws)
    let lastSeq = 0
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString())
      if (msg.type === 'event') lastSeq = msg.seq
    })

    server.push('test:a', { to: 'all' }, 1)
    server.push('test:a', { to: 'all' }, 2)
    await waitFor(() => lastSeq === 2)

    // Drop the connection abruptly (same socket-level outcome as a
    // backpressure terminate), push more events while disconnected, reconnect.
    ws.terminate()
    await waitFor(() => server!.getConnectedClientCount() === 0)
    server.push('test:a', { to: 'all' }, 3)
    server.push('test:a', { to: 'all' }, 4)

    const { ack, replayed } = await reconnect(url, clientId, lastSeq)
    expect(ack.reconnected).toBe(true)
    expect(ack.stale).toBeUndefined()
    await waitFor(() => replayed.length >= 2)
    // Replay resumes exactly after the last seq the client processed.
    expect(replayed[0]).toBe(lastSeq + 1)
    expect(replayed[1]).toBe(lastSeq + 2)
  })

  function reconnect(url: string, reconnectClientId: string, lastSeq: number): Promise<{ ack: Record<string, unknown>; replayed: number[] }> {
    return new Promise((resolve, reject) => {
      const replayed: number[] = []
      const ws = new WebSocket(url)
      openSockets.push(ws)
      const timeout = setTimeout(() => reject(new Error('reconnect timeout')), 5_000)
      ws.on('open', () => {
        ws.send(JSON.stringify({
          id: crypto.randomUUID(),
          type: 'handshake',
          protocolVersion: PROTOCOL_VERSION,
          token: TEST_TOKEN,
          reconnectClientId,
          lastSeq,
        }))
      })
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString())
        if (msg.type === 'handshake_ack') {
          clearTimeout(timeout)
          resolve({ ack: msg, replayed })
        } else if (msg.type === 'event') {
          replayed.push(msg.seq)
        }
      })
      ws.on('error', (err) => { clearTimeout(timeout); reject(err) })
    })
  }
})

describe('shared event serialization', () => {
  let server: WsRpcServer | null = null
  const openSockets: WebSocket[] = []

  afterEach(() => {
    for (const ws of openSockets) ws.terminate()
    openSockets.length = 0
    server?.close()
    server = null
  })

  function nextEvent(ws: WebSocket): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('event timeout')), 5_000)
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString())
        if (msg.type === 'event') {
          clearTimeout(timeout)
          resolve(msg)
        }
      })
    })
  }

  it('clients share the event id but keep per-client seq, and Uint8Array round-trips', async () => {
    server = createServer()
    await server.listen()
    const url = `ws://127.0.0.1:${server.port}`

    const a = await handshake(url)
    openSockets.push(a.ws)
    // Advance client A's seq before B connects so their seqs diverge.
    const aFirst = nextEvent(a.ws)
    server.push('test:warmup', { to: 'all' }, 'warmup')
    await aFirst

    const b = await handshake(url)
    openSockets.push(b.ws)

    const [aRaw, bRaw] = await Promise.all([
      new Promise<string>((resolve) => a.ws.once('message', d => resolve(d.toString()))),
      new Promise<string>((resolve) => b.ws.once('message', d => resolve(d.toString()))),
      Promise.resolve().then(() =>
        server!.push('test:shared', { to: 'all' }, { bytes: new Uint8Array([1, 2, 3]), n: 42 })),
    ])

    const aMsg = JSON.parse(aRaw)
    const bMsg = JSON.parse(bRaw)
    expect(aMsg.channel).toBe('test:shared')
    expect(bMsg.channel).toBe('test:shared')
    // Shared id, per-client seq.
    expect(aMsg.id).toBe(bMsg.id)
    expect(aMsg.seq).toBe(2)
    expect(bMsg.seq).toBe(1)

    // The spliced JSON must be a valid envelope AND decode Uint8Array — i.e.
    // the body went through encodeWireValue, not a bare JSON.stringify.
    const decoded = deserializeEnvelope(aRaw)
    const arg = (decoded.args as Array<Record<string, unknown>>)[0]!
    expect(arg.n).toBe(42)
    expect(arg.bytes).toBeInstanceOf(Uint8Array)
    expect([...(arg.bytes as Uint8Array)]).toEqual([1, 2, 3])

    // Byte-level equivalence class: re-serializing the decoded envelope with
    // the ordinary path yields the same parsed structure.
    expect(JSON.parse(serializeEnvelope(decoded))).toEqual(JSON.parse(aRaw))
  })
})
