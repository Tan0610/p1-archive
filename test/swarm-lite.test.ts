import { afterEach, describe, expect, it, vi } from 'vitest'
import { Bee, Bytes, FeedIndex, Identifier, PrivateKey, Reference, Topic } from '@ethersphere/bee-js'
import {
  bytesToHex,
  feedIdentifier,
  feedUpdateAddress,
  findLatestIndex,
  hexToBytes,
  keccak256,
  normalizeOwner,
  normalizeTopic,
  parseFeedReference,
  parseSoc,
  readFeedUpdate,
  resolveFeed,
  socAddress,
  uint64be,
  utf8,
} from '../reader/swarm-lite.js'

const bee = new Bee('http://127.0.0.1:1633') // pure helpers only, never makes a request
const KEY = new PrivateKey(Bytes.keccak256(utf8('swarm-lite test key')).toUint8Array())
const OWNER = KEY.publicKey().address()
const TOPIC_TEXT = 'tsering/himalayan-manuscripts/v1'

describe('keccak256 (zero-dependency implementation)', () => {
  it('matches the published test vectors', () => {
    expect(bytesToHex(keccak256(new Uint8Array()))).toBe('c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470')
    expect(bytesToHex(keccak256(utf8('abc')))).toBe('4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45')
  })

  it('agrees with bee-js on every length around the 136-byte block boundary', () => {
    for (const len of [0, 1, 31, 32, 33, 64, 135, 136, 137, 271, 272, 273, 1000]) {
      const data = new Uint8Array(len).map((_, i) => (i * 31 + len) & 0xff)
      expect(bytesToHex(keccak256(data))).toBe(Bytes.keccak256(data).toHex())
    }
  })
})

describe('feed addressing matches bee-js', () => {
  it('topic from text is keccak256 of the text, like Topic.fromString', () => {
    expect(bytesToHex(normalizeTopic(TOPIC_TEXT))).toBe(Topic.fromString(TOPIC_TEXT).toHex())
  })

  it('a 64-hex topic is used verbatim', () => {
    const hex = Topic.fromString(TOPIC_TEXT).toHex()
    expect(bytesToHex(normalizeTopic(hex))).toBe(hex)
  })

  it('feed identifier = keccak256(topic ‖ uint64_be(index))', () => {
    const topic = Topic.fromString(TOPIC_TEXT)
    for (const i of [0n, 1n, 2n, 255n, 256n, 70000n]) {
      const expected = Bytes.keccak256(Bytes.concat(topic.toUint8Array(), FeedIndex.fromBigInt(i).toUint8Array())).toHex()
      expect(bytesToHex(feedIdentifier(topic.toUint8Array(), i))).toBe(expected)
    }
  })

  it('SOC address = keccak256(identifier ‖ owner), like bee.calculateSingleOwnerChunkAddress', () => {
    const topic = Topic.fromString(TOPIC_TEXT).toUint8Array()
    for (const i of [0n, 7n]) {
      const id = feedIdentifier(topic, i)
      const expected = bee.calculateSingleOwnerChunkAddress(new Identifier(id), OWNER).toHex()
      expect(bytesToHex(socAddress(id, OWNER.toUint8Array()))).toBe(expected)
      expect(bytesToHex(feedUpdateAddress(topic, OWNER.toUint8Array(), i))).toBe(expected)
    }
  })

  it('uint64be matches FeedIndex encoding', () => {
    expect(bytesToHex(uint64be(258n))).toBe(FeedIndex.fromBigInt(258n).toHex())
  })

  it('rejects an owner that is not 20 bytes', () => {
    expect(() => normalizeOwner('0x1234')).toThrow(/20-byte/)
  })
})

/** A real signed feed-update chunk, built the way bee-js' uploadReference builds it. */
function signedUpdate(index: bigint, reference: string, timestamp = 1_760_000_000) {
  const topic = Topic.fromString(TOPIC_TEXT)
  const identifier = new Identifier(feedIdentifier(topic.toUint8Array(), index))
  const payload = Bytes.concat(uint64be(BigInt(timestamp)), new Reference(reference).toUint8Array())
  const cac = bee.makeContentAddressedChunk(payload)
  const soc = bee.makeSingleOwnerChunk(cac.address, cac.span, cac.payload, identifier, KEY)
  return { soc, address: soc.address.toHex() }
}

describe('parsing single-owner chunks', () => {
  it('reads identifier, span and the timestamp + reference payload of a real SOC', () => {
    const ref = 'ab'.repeat(32)
    const { soc } = signedUpdate(3n, ref, 1_761_111_111)
    const parsed = parseSoc(soc.data)
    expect(bytesToHex(parsed.identifier)).toBe(soc.identifier.toHex())
    expect(parsed.span).toBe(40n)
    const fr = parseFeedReference(parsed.payload)
    expect(fr.reference).toBe(ref)
    expect(fr.timestamp).toBe(1_761_111_111)
  })

  it('refuses payloads that are not timestamp + reference', () => {
    expect(() => parseFeedReference(new Uint8Array(12))).toThrow(/expected a timestamp and a reference/)
  })
})

/** Fake gateway: serves /chunks/<addr> for feed updates 0..latest, 404 otherwise. */
function fakeGateway(latest: number, opts: { flaky500?: boolean } = {}) {
  const chunks = new Map<string, Uint8Array>()
  for (let i = 0; i <= latest; i++) {
    const { soc, address } = signedUpdate(BigInt(i), (i + 1).toString(16).padStart(64, '0'))
    chunks.set(address, soc.data)
  }
  const calls: string[] = []
  const fetchMock = vi.fn(async (url: string | URL) => {
    const u = String(url)
    calls.push(u)
    const addr = u.split('/chunks/')[1] ?? ''
    const body = chunks.get(addr)
    if (body) return new Response(new Uint8Array(body), { status: 200 })
    return new Response('{"code":404,"message":"Not Found"}', { status: opts.flaky500 ? 500 : 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return { calls }
}

describe('finding the newest update by probing chunks', () => {
  afterEach(() => vi.unstubAllGlobals())
  const topic = Topic.fromString(TOPIC_TEXT).toUint8Array()
  const owner = () => OWNER.toUint8Array()

  it('returns -1 for a feed with no updates', async () => {
    fakeGateway(-1)
    expect(await findLatestIndex('https://gw', topic, owner())).toBe(-1n)
  })

  it.each([0, 1, 2, 5, 16, 37])('finds index %i', async (latest) => {
    fakeGateway(latest)
    expect(await findLatestIndex('https://gw', topic, owner())).toBe(BigInt(latest))
  })

  it('treats gateway 500s for missing chunks as absent', async () => {
    fakeGateway(4, { flaky500: true })
    expect(await findLatestIndex('https://gw', topic, owner())).toBe(4n)
  })

  it('uses a hint to skip ahead', async () => {
    const { calls } = fakeGateway(40)
    expect(await findLatestIndex('https://gw', topic, owner(), { hint: 40 })).toBe(40n)
    expect(calls.length).toBeLessThan(12)
  })

  it('resolves owner + topic text to the newest reference', async () => {
    fakeGateway(6)
    const r = await resolveFeed('https://gw', OWNER.toChecksum(), TOPIC_TEXT)
    expect(r.empty).toBe(false)
    if (!r.empty) {
      expect(r.index).toBe(6n)
      expect(r.reference).toBe((7).toString(16).padStart(64, '0'))
    }
  })

  it('rejects a chunk whose identifier is not the requested update', async () => {
    const { soc } = signedUpdate(9n, 'cd'.repeat(32))
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Uint8Array(soc.data), { status: 200 })),
    )
    await expect(readFeedUpdate('https://gw', topic, owner(), 2n)).rejects.toThrow(/is not feed update #2/)
  })

  it('only ever sends plain GETs (no custom headers the public gateway would refuse)', async () => {
    fakeGateway(2)
    await resolveFeed('https://gw', OWNER.toHex(), TOPIC_TEXT)
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    for (const call of fetchMock.mock.calls) {
      const init = call[1] as RequestInit | undefined
      expect(init?.method ?? 'GET').toBe('GET')
      expect(init?.headers).toBeUndefined()
    }
  })
})

it('hexToBytes round-trips', () => {
  const hex = 'deadbeef'
  expect(bytesToHex(hexToBytes('0x' + hex))).toBe(hex)
})
