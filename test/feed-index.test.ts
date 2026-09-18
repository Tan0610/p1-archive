import { describe, expect, it } from 'vitest'
import { BeeResponseError, Bytes, FeedIndex, PrivateKey, Reference, Topic, type Bee } from '@ethersphere/bee-js'
import { publishToFeed, readFeedHead, resolveNextIndex, topicFrom } from '../src/core/feed.js'

const KEY = new PrivateKey(Bytes.keccak256(new TextEncoder().encode('feed index test')).toUint8Array())
const OWNER = KEY.publicKey().address()
const TOPIC = Topic.fromString('tsering/himalayan-manuscripts/v1')
const COLLECTION = new Reference('c0'.repeat(32))

type Latest = () => Promise<{ feedIndex: FeedIndex; feedIndexNext?: FeedIndex; payload: Bytes }>

function notFound(): never {
  throw new BeeResponseError('GET', 'feeds/x/y', 'no update found', { code: 404, message: 'no update found' }, 404, 'Not Found')
}

/** Just enough of `bee.feed` to observe what the code asks the network, and in what order. */
function fakeBee(latest: Latest) {
  const calls: string[] = []
  const writes: Array<{ index: unknown; reference: string }> = []
  const bee = {
    feed: {
      fetchLatestUpdate: async () => {
        calls.push('read')
        return latest()
      },
      makeWriter: (_topic: Topic, signer: PrivateKey) => ({
        owner: signer.publicKey().address(),
        uploadReference: async (_batch: string, reference: Reference, options?: { index?: FeedIndex }) => {
          calls.push('write')
          writes.push({ index: options?.index, reference: new Reference(reference).toHex() })
          return { reference: new Reference('5a'.repeat(32)), historyAddress: undefined }
        },
        uploadPayload: async () => {
          throw new Error('archive contents must never be written as a feed payload')
        },
      }),
      makeReader: () => ({
        downloadReference: async () => {
          const l = await latest()
          return { reference: COLLECTION, feedIndex: l.feedIndex, feedIndexNext: l.feedIndexNext }
        },
      }),
    },
  }
  return { bee: bee as unknown as Bee, calls, writes }
}

describe('resolveNextIndex — the next slot always comes from the network', () => {
  it('first run: an empty feed (HTTP 404) starts at index 0', async () => {
    const { bee } = fakeBee(async () => notFound())
    const r = await resolveNextIndex(bee, TOPIC, OWNER)
    expect(r.firstRun).toBe(true)
    expect(r.latest).toBeNull()
    expect(r.next.toBigInt()).toBe(0n)
  })

  it('uses feedIndexNext reported by the node', async () => {
    const { bee } = fakeBee(async () => ({ feedIndex: FeedIndex.fromBigInt(4n), feedIndexNext: FeedIndex.fromBigInt(5n), payload: new Bytes('00') }))
    const r = await resolveNextIndex(bee, TOPIC, OWNER)
    expect(r.firstRun).toBe(false)
    expect(r.next.toBigInt()).toBe(5n)
  })

  it('does NOT guess 0 when the node fails for another reason (e.g. 500 while syncing)', async () => {
    const { bee } = fakeBee(async () => {
      throw new BeeResponseError('GET', 'feeds/x/y', 'Internal Server Error', undefined, 500, 'Internal Server Error')
    })
    await expect(resolveNextIndex(bee, TOPIC, OWNER)).rejects.toThrow(/Internal Server Error/)
  })
})

describe('publishToFeed', () => {
  it('reads the feed immediately before writing, and writes the network-derived index', async () => {
    const { bee, calls, writes } = fakeBee(async () => ({
      feedIndex: FeedIndex.fromBigInt(11n),
      feedIndexNext: FeedIndex.fromBigInt(12n),
      payload: new Bytes('00'),
    }))
    const result = await publishToFeed(bee, KEY, 'ba'.repeat(32), TOPIC, COLLECTION)
    expect(calls).toEqual(['read', 'write'])
    expect((writes[0]!.index as FeedIndex).toBigInt()).toBe(12n)
    expect(result.index).toBe(12n)
    expect(result.firstRun).toBe(false)
  })

  it('writes the collection REFERENCE (32 bytes), never the contents', async () => {
    const { bee, writes } = fakeBee(async () => notFound())
    const result = await publishToFeed(bee, KEY, 'ba'.repeat(32), TOPIC, COLLECTION)
    expect(writes[0]!.reference).toBe(COLLECTION.toHex())
    expect(result.index).toBe(0n)
    expect(result.firstRun).toBe(true)
  })

  it('re-reads the network on every publish — nothing is remembered between calls', async () => {
    let n = 0n
    const { bee, writes } = fakeBee(async () => {
      if (n === 0n) notFound()
      return { feedIndex: FeedIndex.fromBigInt(n - 1n), feedIndexNext: FeedIndex.fromBigInt(n), payload: new Bytes('00') }
    })
    for (let i = 0; i < 3; i++) {
      await publishToFeed(bee, KEY, 'ba'.repeat(32), TOPIC, COLLECTION)
      n++
    }
    expect(writes.map((w) => (w.index as FeedIndex).toBigInt())).toEqual([0n, 1n, 2n])
  })
})

describe('reading the head of a feed', () => {
  it('reports an empty feed instead of throwing', async () => {
    const { bee } = fakeBee(async () => notFound())
    expect(await readFeedHead(bee, TOPIC, OWNER)).toEqual({ empty: true, index: null, reference: null })
  })
})

describe('topicFrom', () => {
  it('hashes text and keeps 64-hex as is', () => {
    expect(topicFrom('tsering/himalayan-manuscripts/v1').toHex()).toBe(TOPIC.toHex())
    expect(topicFrom(TOPIC.toHex()).toHex()).toBe(TOPIC.toHex())
  })
})
