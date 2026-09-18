import { describe, expect, it } from 'vitest'
import { BeeResponseError, FeedIndex, Reference } from '@ethersphere/bee-js'
import { findFeedHead, type FeedHeadReader } from '../src/recover/recover.js'

const REF = new Reference('e1'.repeat(32))

function fail(status: number): never {
  throw new BeeResponseError('GET', 'x', `HTTP ${status}`, undefined, status, `HTTP ${status}`)
}

/** A reader whose feed LOOKUP answers `lookup`, and whose direct chunk reads answer `chunk(i)`. */
function reader(lookup: () => number | null, chunk: (i: bigint) => number) {
  const probes: bigint[] = []
  const r: FeedHeadReader = {
    downloadReference: async (options) => {
      if (options?.index === undefined) {
        const latest = lookup()
        if (latest === null) fail(404)
        if (latest < 0) fail(-latest)
        return { reference: REF, feedIndex: FeedIndex.fromBigInt(BigInt(latest)) }
      }
      const i = options.index.toBigInt()
      probes.push(i)
      const status = chunk(i)
      if (status !== 200) fail(status)
      return { reference: REF, feedIndex: options.index }
    },
  }
  return { r, probes }
}

const FAST = { baseMs: 0 }

describe('recovery: finding the head of a feed', () => {
  it('uses the lookup when it answers', async () => {
    const { r, probes } = reader(
      () => 4,
      () => 200,
    )
    expect(await findFeedHead(r, FAST)).toEqual({ index: 4n, reference: REF })
    expect(probes).toEqual([])
  })

  it('a truly empty feed (lookup 404, update #0 absent) → null, i.e. "no updates"', async () => {
    const { r } = reader(
      () => null,
      () => 404,
    )
    expect(await findFeedHead(r, FAST)).toBeNull()
  })

  it('a false 404 while update #0 exists does NOT report "no updates": it probes to the newest', async () => {
    const { r } = reader(
      () => null,
      (i) => (i <= 11n ? 200 : 404),
    )
    expect(await findFeedHead(r, FAST)).toEqual({ index: 11n, reference: REF })
  })

  it('treats gateway 500s past #0 as "not there" while probing', async () => {
    const { r } = reader(
      () => null,
      (i) => (i <= 2n ? 200 : 500),
    )
    expect(await findFeedHead(r, FAST)).toEqual({ index: 2n, reference: REF })
  })

  it('a 500 on update #0 is an error, not "no updates"', async () => {
    const { r } = reader(
      () => null,
      () => 500,
    )
    await expect(findFeedHead(r, FAST)).rejects.toThrow(/HTTP 500/)
  })

  it('a persistent 500 on the lookup is retried, then thrown', async () => {
    let calls = 0
    const { r } = reader(
      () => {
        calls++
        return -500
      },
      () => 200,
    )
    await expect(findFeedHead(r, FAST)).rejects.toThrow(/HTTP 500/)
    expect(calls).toBe(3)
  })
})
