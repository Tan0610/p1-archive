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

/** SPENDS xBZZ. Only ever called from an explicit, confirmed user action. */
export async function buyBatch(bee: Bee, sizeMb: number, days: number, label = DEFAULT_LABEL): Promise<string> {
  const id = await bee.storage.buy(Size.fromMegabytes(sizeMb), Duration.fromDays(days), {
    label,
    immutableFlag: false,
    waitForUsable: true,
    waitForUsableTimeout: 600_000,
  })
  return id.toHex()
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
