import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BatchId, BeeResponseError, Duration, Size, type Bee, type PostageBatch } from '@ethersphere/bee-js'
import { readLastBatch, saveBoughtBatch } from '../src/core/local-state.js'
import { BatchNotUsableYetError, buyBatch, waitUntilUsable } from '../src/core/stamps.js'

// Built at runtime: an obviously fake batch id, not something copied from a node.
const ID = 'ba7c'.repeat(16)

function batch(usable: boolean): PostageBatch {
  return {
    batchID: new BatchId(ID),
    utilization: 0,
    usable,
    label: 'himalayan-archive',
    depth: 20,
    amount: '1000' as PostageBatch['amount'],
    bucketDepth: 16,
    blockNumber: 1,
    immutableFlag: false,
    duration: Duration.fromDays(7),
    usage: 0,
    usageText: '0%',
    size: Size.fromMegabytes(100),
    remainingSize: Size.fromMegabytes(100),
    theoreticalSize: Size.fromMegabytes(400),
    calculateSize: () => Size.fromMegabytes(100),
    calculateRemainingSize: () => Size.fromMegabytes(100),
  }
}

const notListedYet = () => new BeeResponseError('GET', `stamps/${ID}`, 'Not Found', undefined, 404, 'Not Found')

/** A fake clock: sleeping advances time instantly. */
function clock() {
  let t = 0
  return { now: () => t, sleep: async (ms: number) => void (t += ms) }
}

describe('buying a batch never loses the id', () => {
  it('asks bee-js NOT to block until usable, so the id comes back as soon as the purchase does', async () => {
    let seen: Record<string, unknown> | undefined
    const bee = {
      storage: {
        buy: async (_size: Size, _duration: Duration, options: Record<string, unknown>) => {
          seen = options
          return new BatchId(ID)
        },
      },
    } as unknown as Bee
    expect(await buyBatch(bee, 100, 7)).toBe(ID)
    expect(seen).toMatchObject({ waitForUsable: false })
  })

  it('polls until the node calls the batch usable, reporting progress (a 404 only means "not synced yet")', async () => {
    const answers: Array<() => PostageBatch> = [
      () => {
        throw notListedYet()
      },
      () => batch(false),
      () => batch(true),
    ]
    const bee = { stamp: { get: async () => answers.shift()!() } } as unknown as Bee
    const waits: string[] = []
    const summary = await waitUntilUsable(bee, ID, { ...clock(), everyMs: 10_000, onWait: (s, reason) => waits.push(`${s}s ${reason}`) })
    expect(summary.usable).toBe(true)
    expect(summary.batchId).toBe(ID)
    expect(waits).toHaveLength(2)
    expect(waits[0]).toMatch(/^0s the node does not list it yet/)
    expect(waits[1]).toBe('10s not usable yet')
  })

  it('gives up after the timeout with an error that carries the id and says how to check later', async () => {
    const bee = { stamp: { get: async () => batch(false) } } as unknown as Bee
    const err = await waitUntilUsable(bee, ID, { ...clock(), timeoutMs: 15 * 60_000 }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(BatchNotUsableYetError)
    expect((err as BatchNotUsableYetError).batchId).toBe(ID)
    expect((err as Error).message).toContain(ID)
    expect((err as Error).message).toMatch(/status --batch/)
    expect((err as Error).message).toMatch(/15 min/)
  })
})

describe('the local receipt (.state/, gitignored)', () => {
  let dir = ''
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('saves the bought id and reads it back; every purchase is also appended to a log', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'archive-state-'))
    expect(readLastBatch(dir)).toBeNull()
    const other = 'e0'.repeat(32)
    saveBoughtBatch(dir, { batchId: other, sizeMb: 100, days: 7, boughtAt: '2026-09-19T00:00:00Z' })
    const file = saveBoughtBatch(dir, { batchId: ID, sizeMb: 100, days: 7, boughtAt: '2026-09-19T00:01:00Z' })
    expect(file).toBe(path.join(dir, '.state', 'last-batch.txt'))
    expect(readLastBatch(dir)).toBe(ID)
    const log = readFileSync(path.join(dir, '.state', 'bought-batches.jsonl'), 'utf8')
      .trim()
      .split('\n')
    expect(log.map((l) => (JSON.parse(l) as { batchId: string }).batchId)).toEqual([other, ID])
  })
})
