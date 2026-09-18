import { BeeResponseError, EthAddress, FeedIndex, Reference, Topic, type Bee, type PrivateKey } from '@ethersphere/bee-js'

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

/** Bee answers 404 "no update found" when a feed has never been written. */
export function isEmptyFeedError(error: unknown): boolean {
  return error instanceof BeeResponseError && error.status === 404
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
 * First run: an empty feed makes Bee answer 404; that — and only that — is
 * treated as "start at index 0". Any other failure (timeouts, 500s while the
 * node syncs) aborts, because silently guessing 0 would overwrite nothing and
 * fork the history. (bee-js' own findNextIndex swallows every HTTP error and
 * returns 0, which is why we never let it choose.)
 */
export async function resolveNextIndex(bee: Bee, topic: Topic, owner: EthAddress): Promise<NextIndex> {
  try {
    const latest = await bee.feed.fetchLatestUpdate(topic, owner)
    const next = latest.feedIndexNext ?? latest.feedIndex.next()
    return { next, latest: latest.feedIndex, firstRun: false }
  } catch (error) {
    if (isEmptyFeedError(error)) {
      return { next: FeedIndex.fromBigInt(0n), latest: null, firstRun: true }
    }
    throw error
  }
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
): Promise<FeedPublishResult> {
  const writer = bee.feed.makeWriter(topic, signer)
  // Read the feed from the network immediately before writing to it.
  const { next, firstRun } = await resolveNextIndex(bee, topic, writer.owner)
  const result = await writer.uploadReference(batchId, collectionReference, { index: next })
  return { index: next.toBigInt(), firstRun, updateChunk: result.reference.toHex() }
}

/** Reads back the exact slot we wrote (not "latest", which can lag on a light node). */
export async function verifyUpdate(bee: Bee, topic: Topic, owner: EthAddress, index: bigint, expected: Reference | string): Promise<boolean> {
  const reader = bee.feed.makeReader(topic, owner)
  const update = await reader.downloadReference({ index: FeedIndex.fromBigInt(index) })
  return update.reference.equals(new Reference(expected))
}

export interface FeedHead {
  empty: boolean
  index: bigint | null
  reference: string | null
}

/** Latest edition of a feed, with the empty-feed case handled. */
export async function readFeedHead(bee: Bee, topic: Topic, owner: EthAddress): Promise<FeedHead> {
  try {
    const head = await bee.feed.makeReader(topic, owner).downloadReference()
    return { empty: false, index: head.feedIndex.toBigInt(), reference: head.reference.toHex() }
  } catch (error) {
    if (isEmptyFeedError(error)) return { empty: true, index: null, reference: null }
    throw error
  }
}
