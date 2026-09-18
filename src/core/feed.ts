import { BeeResponseError, EthAddress, FeedIndex, Reference, Topic, type Bee, type PrivateKey } from '@ethersphere/bee-js'
import { probeLatestIndex } from '../shared/feed-probe.js'

/**
 * Feeds give the archive ONE address that never changes.
 *
 *   feed manifest ref  ──(owner + topic)──▶  latest feed update  ──▶  this edition's collection
 *   (published once)                         (index 0, 1, 2 …)         (changes every edition)
 *
 * A content hash is not an address you can publish: change one folio and the
 * hash changes. So every edition is uploaded as a collection, and its reference
 * is written into the next slot of a feed owned by the archive's signer.
 */

/** 64 hex chars → used verbatim as the 32-byte topic; anything else → keccak256 of the text. */
export function topicFrom(input: string): Topic {
  const clean = input.trim().replace(/^0x/i, '')
  return /^[0-9a-fA-F]{64}$/.test(clean) ? new Topic(clean) : Topic.fromString(input)
}

/**
 * Bee answers 404 "no update found" when a feed has never been written, but
 * Bee 2.8 ALSO answers 404 when the lookup itself failed (e.g. a retrieval
 * timeout). So on its own this is only a hint; see resolveNextIndex.
 */
export function isEmptyFeedError(error: unknown): boolean {
  return error instanceof BeeResponseError && error.status === 404
}

export interface RetryOptions {
  /** Total tries, including the first. Default 4. */
  attempts?: number
  /** First back-off delay; it doubles after each failure. Default 1 000 ms (1 s, 2 s, 4 s). */
  baseMs?: number
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 5xx, 429 and network-level failures (no HTTP status) are worth another try; a 404 or other 4xx is an answer. */
function isTransient(error: unknown): boolean {
  if (error instanceof BeeResponseError) return error.status === undefined || error.status >= 500 || error.status === 429
  return true
}

/** Retries transient failures with exponential back-off. Never retries a 404. */
export async function withRetry<T>(fn: () => Promise<T>, retry: RetryOptions = {}): Promise<T> {
  const attempts = retry.attempts ?? 4
  const baseMs = retry.baseMs ?? 1_000
  for (let i = 1; ; i++) {
    try {
      return await fn()
    } catch (error) {
      if (i >= attempts || !isTransient(error)) throw error
      await sleep(baseMs * 2 ** (i - 1))
    }
  }
}

/**
 * Is feed update `index` on the network? Reads that one signed chunk directly:
 * downloadReference with an explicit index is a plain /chunks read, with no
 * feed lookup involved. 404 → false. A 5xx is retried and then thrown, never
 * taken to mean "absent": guessing wrong here would mean signing a slot twice.
 */
export async function hasFeedUpdate(bee: Bee, topic: Topic, owner: EthAddress, index: FeedIndex, retry?: RetryOptions): Promise<boolean> {
  try {
    await withRetry(() => bee.feed.makeReader(topic, owner).downloadReference({ index }), retry)
    return true
  } catch (error) {
    if (isEmptyFeedError(error)) return false
    throw error
  }
}

/** Newest existing update, found by reading chunks. Only call once update #0 is known to exist. */
async function probeLatest(bee: Bee, topic: Topic, owner: EthAddress, retry?: RetryOptions): Promise<FeedIndex> {
  const latest = await probeLatestIndex((i) => hasFeedUpdate(bee, topic, owner, FeedIndex.fromBigInt(i), retry))
  return FeedIndex.fromBigInt(latest)
}

export interface NextIndex {
  /** The slot the next update must be written to, as reported by the network. */
  next: FeedIndex
  /** The latest existing update, or null on first run. */
  latest: FeedIndex | null
  firstRun: boolean
}

/**
 * Asks the network where the feed currently is. Never a literal, never a local
 * counter, never a value remembered from archive.json.
 *
 *  1. Feed lookup (`fetchLatestUpdate`) → `feedIndexNext`. A 5xx is retried
 *     with back-off, then aborts: silently guessing would fork the history.
 *     (bee-js' own findNextIndex swallows every HTTP error and returns 0, which
 *     is why we never let it choose.)
 *  2. First run: the lookup answers 404 both for an empty feed and for a lookup
 *     that failed. So a 404 is a first run ONLY if update #0 itself is absent,
 *     read directly as a chunk. If #0 exists the lookup was wrong, and the real
 *     head is found by probing chunks (gallop, then binary search).
 *  3. The slot about to be handed out is read once more. If it is already taken
 *     (a lagging lookup), we step past it rather than sign a second version.
 */
export async function resolveNextIndex(bee: Bee, topic: Topic, owner: EthAddress, retry?: RetryOptions): Promise<NextIndex> {
  let next: FeedIndex
  try {
    const latest = await withRetry(() => bee.feed.fetchLatestUpdate(topic, owner), retry)
    next = latest.feedIndexNext ?? latest.feedIndex.next()
  } catch (error) {
    if (!isEmptyFeedError(error)) throw error
    // First-run guard: 404 → start at index 0, but only if update #0 is truly absent.
    const first = FeedIndex.fromBigInt(0n)
    if (!(await hasFeedUpdate(bee, topic, owner, first, retry))) {
      return { next: first, latest: null, firstRun: true }
    }
    next = (await probeLatest(bee, topic, owner, retry)).next()
  }
  while (await hasFeedUpdate(bee, topic, owner, next, retry)) next = next.next()
  return { next, latest: FeedIndex.fromBigInt(next.toBigInt() - 1n), firstRun: false }
}

/**
 * The feed manifest is THE archive address. It is deterministic for a given
 * owner + topic, so creating it again later returns the same reference.
 * Opening /bzz/<feedManifest>/ on any gateway serves the latest edition.
 */
export async function ensureFeedManifest(bee: Bee, batchId: string, topic: Topic, owner: EthAddress): Promise<Reference> {
  return bee.feed.createManifest(batchId, topic, owner)
}

export interface FeedPublishResult {
  index: bigint
  firstRun: boolean
  /** Address of the single-owner chunk holding this feed update. */
  updateChunk: string
}

/**
 * Writes an edition's collection reference into the next feed slot.
 *
 * The archive contents never go into the feed itself: a feed update is one
 * chunk (4 KB). We upload the collection separately and write only its
 * 32-byte reference with `uploadReference`.
 */
export async function publishToFeed(
  bee: Bee,
  signer: PrivateKey,
  batchId: string,
  topic: Topic,
  collectionReference: Reference | string,
  retry?: RetryOptions,
): Promise<FeedPublishResult> {
  const writer = bee.feed.makeWriter(topic, signer)
  // Read the feed from the network immediately before writing to it.
  const { next, firstRun } = await resolveNextIndex(bee, topic, writer.owner, retry)
  const result = await writer.uploadReference(batchId, collectionReference, { index: next })
  return { index: next.toBigInt(), firstRun, updateChunk: result.reference.toHex() }
}

/** Reads back the exact slot we wrote (not "latest", which can lag on a light node). */
export async function verifyUpdate(
  bee: Bee,
  topic: Topic,
  owner: EthAddress,
  index: bigint,
  expected: Reference | string,
  retry?: RetryOptions,
): Promise<boolean> {
  const reader = bee.feed.makeReader(topic, owner)
  const update = await withRetry(() => reader.downloadReference({ index: FeedIndex.fromBigInt(index) }), retry)
  return update.reference.equals(new Reference(expected))
}

export interface FeedHead {
  empty: boolean
  index: bigint | null
  reference: string | null
}

/** Latest edition of a feed. A 404 from the lookup is only "empty" if update #0 is absent too. */
export async function readFeedHead(bee: Bee, topic: Topic, owner: EthAddress, retry?: RetryOptions): Promise<FeedHead> {
  const reader = bee.feed.makeReader(topic, owner)
  try {
    const head = await withRetry(() => reader.downloadReference(), retry)
    return { empty: false, index: head.feedIndex.toBigInt(), reference: head.reference.toHex() }
  } catch (error) {
    if (!isEmptyFeedError(error)) throw error
    if (!(await hasFeedUpdate(bee, topic, owner, FeedIndex.fromBigInt(0n), retry))) return { empty: true, index: null, reference: null }
    const index = await probeLatest(bee, topic, owner, retry)
    const head = await withRetry(() => reader.downloadReference({ index }), retry)
    return { empty: false, index: index.toBigInt(), reference: head.reference.toHex() }
  }
}
