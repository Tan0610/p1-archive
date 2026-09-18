import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { BeeResponseError, Bytes, FeedIndex, PrivateKey, Reference, Topic, type Bee } from '@ethersphere/bee-js'
import { publishToFeed, readFeedHead, resolveNextIndex, topicFrom } from '../src/core/feed.js'
import { probeLatestIndex } from '../src/shared/feed-probe.js'

// A fresh throwaway key every run: no key material is ever written into this repository.
const KEY = new PrivateKey(randomBytes(32))
const OWNER = KEY.publicKey().address()
const TOPIC = Topic.fromString('tsering/himalayan-manuscripts/v1')
const COLLECTION = new Reference('c0'.repeat(32))
/** No real waiting between retries in tests. */
const FAST = { attempts: 3, baseMs: 0 }

type Latest = () => Promise<{ feedIndex: FeedIndex; feedIndexNext?: FeedIndex; payload: Bytes }>

function notFound(): never {
  throw new BeeResponseError('GET', 'feeds/x/y', 'no update found', { code: 404, message: 'no update found' }, 404, 'Not Found')
}

function serverError(): never {
  throw new BeeResponseError('GET', 'feeds/x/y', 'Internal Server Error', undefined, 500, 'Internal Server Error')
}

/**
 * Just enough of `bee.feed` to observe what the code asks the network, and in what order.
 *
 *  - `latest` models the feed LOOKUP (GET /feeds/…), which can be wrong (a false 404).
 *  - `chunk(i)` models reading update #i directly (GET /chunks/…). By default it
 *    agrees with the lookup: #i exists iff i <= the latest index.
 */
function fakeBee(latest: Latest, chunk?: (i: bigint) => Promise<boolean>) {
  const calls: string[] = []
  const probes: bigint[] = []
  const writes: Array<{ index: unknown; reference: string }> = []
  const exists =
    chunk ??
    (async (i: bigint) => {
      try {
        return i <= (await latest()).feedIndex.toBigInt()
      } catch (e) {
        if (e instanceof BeeResponseError && e.status === 404) return false
        throw e
      }
    })
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
        downloadReference: async (options?: { index?: FeedIndex }) => {
          if (options?.index !== undefined) {
            const i = options.index.toBigInt()
            probes.push(i)
            if (!(await exists(i))) notFound()
            return { reference: COLLECTION, feedIndex: options.index }
          }
          const l = await latest()
          return { reference: COLLECTION, feedIndex: l.feedIndex, feedIndexNext: l.feedIndexNext }
        },
      }),
    },
  }
  return { bee: bee as unknown as Bee, calls, probes, writes }
}

const at = (i: bigint) => ({ feedIndex: FeedIndex.fromBigInt(i), feedIndexNext: FeedIndex.fromBigInt(i + 1n), payload: new Bytes('00') })

describe('resolveNextIndex — the next slot always comes from the network', () => {
  it('first run: an empty feed (HTTP 404) starts at index 0', async () => {
    const { bee } = fakeBee(async () => notFound())
    const r = await resolveNextIndex(bee, TOPIC, OWNER)
    expect(r.firstRun).toBe(true)
    expect(r.latest).toBeNull()
    expect(r.next.toBigInt()).toBe(0n)
  })

  it('a truly empty feed: the lookup 404s AND update #0 is absent → index 0, and #0 was checked directly', async () => {
    const { bee, probes } = fakeBee(
      async () => notFound(),
      async () => false,
    )
    const r = await resolveNextIndex(bee, TOPIC, OWNER, FAST)
    expect(r).toMatchObject({ firstRun: true, latest: null })
    expect(r.next.toBigInt()).toBe(0n)
    expect(probes).toEqual([0n])
  })

  it('a false 404 (the lookup failed) while updates 0..13 exist → next is 14, never 0', async () => {
    const { bee, probes } = fakeBee(
      async () => notFound(),
      async (i) => i <= 13n,
    )
    const r = await resolveNextIndex(bee, TOPIC, OWNER, FAST)
    expect(r.firstRun).toBe(false)
    expect(r.latest!.toBigInt()).toBe(13n)
    expect(r.next.toBigInt()).toBe(14n)
    // O(log n) chunk reads, not a walk from 0
    expect(probes.length).toBeLessThan(14)
  })

  it.each([0n, 1n, 2n, 7n, 8n, 100n])('a false 404 with updates 0..%i finds the right next slot', async (n) => {
    const { bee } = fakeBee(
      async () => notFound(),
      async (i) => i <= n,
    )
    expect((await resolveNextIndex(bee, TOPIC, OWNER, FAST)).next.toBigInt()).toBe(n + 1n)
  })

  it('uses feedIndexNext reported by the node', async () => {
    const { bee } = fakeBee(async () => ({ feedIndex: FeedIndex.fromBigInt(4n), feedIndexNext: FeedIndex.fromBigInt(5n), payload: new Bytes('00') }))
    const r = await resolveNextIndex(bee, TOPIC, OWNER)
    expect(r.firstRun).toBe(false)
    expect(r.next.toBigInt()).toBe(5n)
  })

  it('steps past a slot that is already taken (the lookup lags behind the network)', async () => {
    const { bee } = fakeBee(
      async () => at(4n),
      async (i) => i <= 6n,
    )
    const r = await resolveNextIndex(bee, TOPIC, OWNER, FAST)
    expect(r.next.toBigInt()).toBe(7n)
    expect(r.latest!.toBigInt()).toBe(6n)
  })

  it('does NOT guess 0 when the node fails for another reason (e.g. 500 while syncing)', async () => {
    const { bee } = fakeBee(async () => serverError())
    await expect(resolveNextIndex(bee, TOPIC, OWNER, FAST)).rejects.toThrow(/Internal Server Error/)
  })

  it('retries a 500 with back-off and carries on once the node answers', async () => {
    let failures = 2
    const { bee, calls } = fakeBee(async () => (failures-- > 0 ? serverError() : at(2n)))
    const r = await resolveNextIndex(bee, TOPIC, OWNER, FAST)
    expect(r.next.toBigInt()).toBe(3n)
    expect(calls.filter((c) => c === 'read')).toHaveLength(3)
  })

  it('gives up after the last retry of a persistent 500 (3 tries, then throws)', async () => {
    const { bee, calls } = fakeBee(async () => serverError())
    await expect(resolveNextIndex(bee, TOPIC, OWNER, FAST)).rejects.toThrow(/Internal Server Error/)
    expect(calls).toEqual(['read', 'read', 'read'])
  })

  it('a 500 while checking update #0 is NOT taken as "absent", so no first run is guessed', async () => {
    const { bee } = fakeBee(
      async () => notFound(),
      async () => serverError(),
    )
    await expect(resolveNextIndex(bee, TOPIC, OWNER, FAST)).rejects.toThrow(/Internal Server Error/)
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

  it('a false 404 never re-signs index 0: it writes after the last existing update', async () => {
    const { bee, writes } = fakeBee(
      async () => notFound(),
      async (i) => i <= 5n,
    )
    const result = await publishToFeed(bee, KEY, 'ba'.repeat(32), TOPIC, COLLECTION, FAST)
    expect(writes).toHaveLength(1)
    expect((writes[0]!.index as FeedIndex).toBigInt()).toBe(6n)
    expect(result).toMatchObject({ index: 6n, firstRun: false })
  })

  it('never writes into an occupied slot', async () => {
    const { bee, writes } = fakeBee(
      async () => at(1n),
      async (i) => i <= 3n,
    )
    await publishToFeed(bee, KEY, 'ba'.repeat(32), TOPIC, COLLECTION, FAST)
    expect((writes[0]!.index as FeedIndex).toBigInt()).toBe(4n)
  })
})

describe('reading the head of a feed', () => {
  it('reports an empty feed instead of throwing', async () => {
    const { bee } = fakeBee(async () => notFound())
    expect(await readFeedHead(bee, TOPIC, OWNER)).toEqual({ empty: true, index: null, reference: null })
  })

  it('does not report "empty" on a false 404 when update #0 exists', async () => {
    const { bee } = fakeBee(
      async () => notFound(),
      async (i) => i <= 9n,
    )
    expect(await readFeedHead(bee, TOPIC, OWNER, FAST)).toEqual({ empty: false, index: 9n, reference: COLLECTION.toHex() })
  })
})

describe('probeLatestIndex (shared with recovery)', () => {
  it.each([0n, 1n, 2n, 3n, 31n, 32n, 33n, 1000n])('finds %i with O(log n) reads', async (n) => {
    let reads = 0
    const found = await probeLatestIndex(async (i) => {
      reads++
      return i <= n
    })
    expect(found).toBe(n)
    expect(reads).toBeLessThanOrEqual(2 * (n.toString(2).length + 1))
  })
})

describe('topicFrom', () => {
  it('hashes text and keeps 64-hex as is', () => {
    expect(topicFrom('tsering/himalayan-manuscripts/v1').toHex()).toBe(TOPIC.toHex())
    expect(topicFrom(TOPIC.toHex()).toHex()).toBe(TOPIC.toHex())
  })
})
