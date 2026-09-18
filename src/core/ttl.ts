/**
 * "Permanent" on Swarm is a payment schedule with an end date.
 *
 * A postage batch is prepaid rent. The node estimates how long the remaining
 * balance lasts at today's storage price (the batch TTL). When it runs out,
 * nodes are free to drop every chunk stamped with it — the folios AND the feed
 * updates that point at them. This module turns the node's own TTL figure into
 * honest words. It never invents a number: if the node didn't tell us, the
 * term is "unknown".
 */
export type TermLevel = 'ok' | 'soon' | 'urgent' | 'expired' | 'unknown'

export interface StorageTerm {
  /** Seconds of paid storage left, as estimated by the node. null = unknown. */
  ttlSeconds: number | null
  /** ISO date the prepaid storage is estimated to run out. */
  paidUntil: string | null
  /** Whole days left (floored). */
  daysLeft: number | null
  /** When the node gave us this estimate. */
  asOf: string
  level: TermLevel
  /** Where the number came from — always the node, never a constant. */
  source: 'bee-node' | 'none'
  /** Why the term is unknown, when it is. */
  unknownReason?: string
}

export const SOON_DAYS = 30
export const URGENT_DAYS = 7

export function termFromTtlSeconds(
  ttlSeconds: number | null | undefined,
  now: Date = new Date(),
  unknownReason = 'the node did not answer, so we will not guess',
): StorageTerm {
  const asOf = now.toISOString()
  if (ttlSeconds === null || ttlSeconds === undefined || !Number.isFinite(ttlSeconds)) {
    return { ttlSeconds: null, paidUntil: null, daysLeft: null, asOf, level: 'unknown', source: 'none', unknownReason }
  }
  const secs = Math.max(0, Math.floor(ttlSeconds))
  const days = Math.floor(secs / 86_400)
  const level: TermLevel = secs <= 0 ? 'expired' : days <= URGENT_DAYS ? 'urgent' : days <= SOON_DAYS ? 'soon' : 'ok'
  return {
    ttlSeconds: secs,
    paidUntil: new Date(now.getTime() + secs * 1000).toISOString(),
    daysLeft: days,
    asOf,
    level,
    source: 'bee-node',
  }
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function humanDuration(seconds: number): string {
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} minutes`
  if (seconds < 86_400 * 2) return `${Math.round(seconds / 3600)} hours`
  return `${Math.floor(seconds / 86_400)} days`
}

/** One honest sentence for CLI / UI / generated files. */
export function honestSentence(term: StorageTerm): string {
  if (term.level === 'unknown' || term.ttlSeconds === null || term.paidUntil === null) {
    return `Paid-until date unknown: ${term.unknownReason ?? 'the node did not answer, so we will not guess'}.`
  }
  if (term.level === 'expired') {
    return 'This batch has run out. Nodes may already be dropping these folios. Buy or top up a batch and republish.'
  }
  return (
    `Paid until about ${formatDate(term.paidUntil)} (≈ ${humanDuration(term.ttlSeconds)}), ` +
    `the node's estimate at today's storage price as of ${formatDate(term.asOf)}. ` +
    'After that, Swarm nodes may delete these folios — and the feed updates that point at them — unless someone tops up the batch.'
  )
}
