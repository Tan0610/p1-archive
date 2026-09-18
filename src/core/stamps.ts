import { BatchId, Duration, Size, type Bee, type PostageBatch } from '@ethersphere/bee-js'
import { termFromTtlSeconds, type StorageTerm } from './ttl.js'

export const DEFAULT_LABEL = 'himalayan-archive'

export interface BatchSummary {
  batchId: string
  label: string
  usable: boolean
  depth: number
  immutable: boolean
  /** 0..1 */
  usage: number
  sizeBytes: number
  remainingBytes: number
  /** Remaining lifetime, straight from the node's batchTTL. */
  term: StorageTerm
}

/** Converts what the node told us into our summary. `duration` IS the node's batchTTL. */
export function summarise(batch: PostageBatch, now: Date = new Date()): BatchSummary {
  return {
    batchId: batch.batchID.toHex(),
    label: batch.label,
    usable: batch.usable,
    depth: batch.depth,
    immutable: batch.immutableFlag,
    usage: batch.usage,
    sizeBytes: batch.size.toBytes(),
    remainingBytes: batch.remainingSize.toBytes(),
    term: termFromTtlSeconds(batch.duration.toSeconds(), now),
  }
}

export async function listBatches(bee: Bee): Promise<BatchSummary[]> {
  const batches = await bee.stamp.getAll()
  return batches.map((b) => summarise(b))
}

/** Reads the batch's remaining lifetime (TTL) from the node right now. */
export async function describeBatch(bee: Bee, batchId: string): Promise<BatchSummary> {
  const batch = await bee.stamp.get(new BatchId(batchId))
  return summarise(batch)
}

/** Longest-lived usable batch with room for `neededBytes` (plus 20% headroom). */
export function pickUsableBatch(batches: BatchSummary[], neededBytes: number): BatchSummary | null {
  const fits = batches
    .filter((b) => b.usable && b.term.level !== 'expired' && b.remainingBytes >= neededBytes * 1.2)
    .sort((a, b) => (b.term.ttlSeconds ?? 0) - (a.term.ttlSeconds ?? 0))
  const preferred = fits.find((b) => b.label === DEFAULT_LABEL)
  return preferred ?? fits[0] ?? null
}

export interface Quote {
  size: string
  duration: string
  costXbzz: string
}

export async function quoteBuy(bee: Bee, sizeMb: number, days: number): Promise<Quote> {
  const size = Size.fromMegabytes(sizeMb)
  const duration = Duration.fromDays(days)
  const cost = await bee.storage.getCost(size, duration)
  return { size: size.toFormattedString(), duration: duration.represent(), costXbzz: cost.toSignificantDigits(4) }
}

/**
 * SPENDS xBZZ. Only ever called from an explicit, confirmed user action.
 *
 * Returns the new batch id as soon as the node reports the purchase, WITHOUT
 * waiting for the batch to become usable. bee-js would otherwise block until
 * usable and throw on its timeout: xBZZ spent, id never returned. The caller
 * prints and saves the id first (local-state.ts), then calls waitUntilUsable.
 */
export async function buyBatch(bee: Bee, sizeMb: number, days: number, label = DEFAULT_LABEL): Promise<string> {
  const id = await bee.storage.buy(Size.fromMegabytes(sizeMb), Duration.fromDays(days), {
    label,
    immutableFlag: false,
    waitForUsable: false,
  })
  return id.toHex()
}

export class BatchNotUsableYetError extends Error {
  constructor(
    readonly batchId: string,
    readonly waitedSeconds: number,
  ) {
    super(
      `Batch ${batchId} is bought but the node does not call it usable yet (waited ${Math.round(waitedSeconds / 60)} min). ` +
        `Nothing is lost: the id is saved in .state/last-batch.txt. Check again later with: npm run archive -- status --batch ${batchId}`,
    )
    this.name = 'BatchNotUsableYetError'
  }
}

export interface WaitOptions {
  /** Give up after this long. Default 15 minutes. */
  timeoutMs?: number
  /** Poll interval. Default 10 s. */
  everyMs?: number
  /** Called after each poll that found the batch not usable yet. */
  onWait?: (waitedSeconds: number, reason: string) => void
  /** For tests. */
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

/**
 * A new batch becomes usable once the node has seen enough block confirmations
 * (usually 1 to 5 minutes on Gnosis). Polls GET /stamps/{id}; a 404 or a 5xx
 * there only means the node has not caught up yet, so it keeps polling.
 * Throws BatchNotUsableYetError (which carries the id) on timeout.
 */
export async function waitUntilUsable(bee: Bee, batchId: string, opts: WaitOptions = {}): Promise<BatchSummary> {
  const timeoutMs = opts.timeoutMs ?? 15 * 60_000
  const everyMs = opts.everyMs ?? 10_000
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const now = opts.now ?? Date.now
  const started = now()
  for (;;) {
    let reason = 'not usable yet'
    try {
      const summary = summarise(await bee.stamp.get(new BatchId(batchId)))
      if (summary.usable) return summary
    } catch (e) {
      reason = `the node does not list it yet (${(e as Error).message})`
    }
    const waited = now() - started
    if (waited >= timeoutMs) throw new BatchNotUsableYetError(batchId, waited / 1000)
    opts.onWait?.(Math.round(waited / 1000), reason)
    await sleep(everyMs)
  }
}

export async function quoteExtend(bee: Bee, batchId: string, days: number): Promise<string> {
  const cost = await bee.storage.getDurationExtensionCost(new BatchId(batchId), Duration.fromDays(days))
  return cost.toSignificantDigits(4)
}

/** SPENDS xBZZ. Adds `days` of paid storage to an existing batch (a top-up). */
export async function extendBatch(bee: Bee, batchId: string, days: number): Promise<string> {
  const id = await bee.storage.extendDuration(new BatchId(batchId), Duration.fromDays(days))
  return id.toHex()
}
