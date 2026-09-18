/**
 * Finding the newest update of a sequence feed by reading its update chunks
 * directly, one explicit index at a time, instead of trusting Bee's feed lookup.
 *
 * Why: Bee 2.8 answers the feed lookup (GET /feeds/{owner}/{topic}) with 404
 * both when the feed has no updates AND when the lookup itself failed (a
 * retrieval timeout, a slow peer). Reading update #i is a plain chunk read, so
 * its 404 really means "update #i is not there".
 *
 * Shared by the publisher (src/core/feed.ts) and by recovery (src/recover), so
 * it takes a predicate and imports nothing.
 */

/**
 * Newest index `>= from` for which `exists` is true, given that `exists(from)`
 * is already known to be true. Sequence feeds have no gaps, so: gallop
 * from+1, from+2, from+4, … to the first miss, then binary-search between the
 * last hit and that miss. O(log n) reads.
 */
export async function probeLatestIndex(exists: (index: bigint) => Promise<boolean>, from = 0n): Promise<bigint> {
  let lo = from
  let step = 1n
  while (await exists(lo + step)) {
    lo += step
    step *= 2n
  }
  let hi = lo + step // first known miss
  while (hi - lo > 1n) {
    const mid = (lo + hi) / 2n
    if (await exists(mid)) lo = mid
    else hi = mid
  }
  return lo
}
