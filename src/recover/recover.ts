/**
 * Recovery: get every folio back from nothing but the published identifiers.
 *
 * Inputs are ONLY:
 *   - the feed owner + topic (or the archive's feed manifest reference), and
 *   - a Bee endpoint — any node or public gateway.
 *
 * This module deliberately imports nothing from the publisher: no config, no
 * archive.json, no key, no local index or database. (ESLint enforces that.)
 * The only local imports come from src/shared: the published catalogue format
 * and the chunk-probing helper that finds a feed's newest update.
 * The list of folios comes from the network: the catalogue.json inside the
 * edition, cross-checked against the edition's own manifest.
 */
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Bee, BeeResponseError, EthAddress, FeedIndex, MantarayNode, Reference, Topic } from '@ethersphere/bee-js'
import { isSafeRelativePath, validateCatalogue, type Catalogue } from '../shared/catalogue-schema.js'
import { probeLatestIndex } from '../shared/feed-probe.js'

export const PUBLIC_GATEWAY = 'https://api.gateway.ethswarm.org'

export type RecoverInput = { kind: 'feed'; owner: string; topic: string } | { kind: 'manifest'; reference: string }

export interface RecoverOptions {
  beeUrl?: string
  outDir: string
  allEditions?: boolean
  onEvent?: (message: string) => void
}

export interface RecoveredFile {
  path: string
  size: number
  sha256: string
  expected: string | null
  status: 'verified' | 'mismatch' | 'unlisted' | 'missing'
  error?: string
}

export interface Edition {
  index: string
  reference: string | null
  retrievable: boolean
}

export interface RecoveryReport {
  inputs: RecoverInput & { beeUrl: string }
  resolvedVia: 'feed' | 'feed-manifest' | 'collection'
  feed: { owner: string; topic: string; index: string } | null
  collectionReference: string | null
  status: 'complete' | 'partial' | 'empty-feed' | 'failed'
  title: string | null
  files: RecoveredFile[]
  editions: Edition[]
  problems: string[]
  finishedAt: string
}

function topicFrom(input: string): Topic {
  const clean = input.trim().replace(/^0x/i, '')
  return /^[0-9a-fA-F]{64}$/.test(clean) ? new Topic(clean) : Topic.fromString(input)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface RetryOptions {
  tries?: number
  /** First back-off delay (600 ms by default), doubled after each failure. */
  baseMs?: number
  /** Retry a 404 too (a chunk that is merely slow to arrive). Default true. */
  retryNotFound?: boolean
}

/** Gateways sometimes answer 404 or 500 for a chunk that is merely slow to arrive; retry transient failures with back-off. */
async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const tries = opts.tries ?? 3
  const baseMs = opts.baseMs ?? 600
  let last: unknown
  for (let i = 0; i < tries; i++) {
    try {
      return await fn()
    } catch (e) {
      last = e
      const status = e instanceof BeeResponseError ? e.status : undefined
      if (status === 404 && opts.retryNotFound === false) break
      if (status !== undefined && status >= 400 && status < 500 && status !== 404 && status !== 429) break
      if (i < tries - 1) await sleep(baseMs * 2 ** i)
    }
  }
  throw last
}

function isNotFound(e: unknown): boolean {
  return e instanceof BeeResponseError && e.status === 404
}

/** The part of a bee-js FeedReader that recovery uses. */
export interface FeedHeadReader {
  downloadReference(options?: { index?: FeedIndex }): Promise<{ reference: Reference; feedIndex: FeedIndex }>
}

/**
 * Latest update of a feed, or null when the feed truly has no updates.
 *
 * Bee 2.8 answers the feed lookup with 404 both for an empty feed and for a
 * lookup that failed (e.g. a retrieval timeout). So a 404 is only "no updates"
 * if update #0 itself is absent, read directly as a chunk (with retries: this
 * is the answer that would send a reader away empty-handed). If #0 exists, the
 * newest update is found by reading chunks: gallop, then binary search.
 */
export async function findFeedHead(
  reader: FeedHeadReader,
  opts: { baseMs?: number; log?: (message: string) => void } = {},
): Promise<{ index: bigint; reference: Reference } | null> {
  try {
    const head = await withRetry(() => reader.downloadReference(), { baseMs: opts.baseMs })
    return { index: head.feedIndex.toBigInt(), reference: head.reference }
  } catch (e) {
    if (!isNotFound(e)) throw e
  }
  opts.log?.('The feed lookup answered 404, which can also mean it timed out. Reading update #0 directly…')
  const read = (i: bigint, retryNotFound: boolean) =>
    withRetry(() => reader.downloadReference({ index: FeedIndex.fromBigInt(i) }), { baseMs: opts.baseMs, retryNotFound })
  /** `decisive`: the answer for #0 decides "no updates", so a 404 is retried and a 500 is an error, not "absent". */
  const exists = async (i: bigint, decisive = false) => {
    try {
      await read(i, decisive)
      return true
    } catch (e) {
      if (isNotFound(e)) return false
      // Past #0, a gateway 500 after retries only means that chunk could not be found.
      if (!decisive && e instanceof BeeResponseError && e.status === 500) return false
      throw e
    }
  }
  if (!(await exists(0n, true))) return null
  const index = await probeLatestIndex((i) => exists(i))
  const head = await read(index, true)
  opts.log?.(`Update #0 exists, so the feed is not empty; probing chunks found the newest update at index ${index}.`)
  return { index, reference: head.reference }
}

export async function recover(input: RecoverInput, opts: RecoverOptions): Promise<RecoveryReport> {
  const beeUrl = (opts.beeUrl ?? PUBLIC_GATEWAY).replace(/\/+$/, '')
  const bee = new Bee(beeUrl, { timeout: 60_000 })
  const log = (m: string) => opts.onEvent?.(m)
  const report: RecoveryReport = {
    inputs: { ...input, beeUrl },
    resolvedVia: input.kind === 'feed' ? 'feed' : 'collection',
    feed: null,
    collectionReference: null,
    status: 'failed',
    title: null,
    files: [],
    editions: [],
    problems: [],
    finishedAt: '',
  }
  const finish = async () => {
    report.finishedAt = new Date().toISOString()
    await mkdir(opts.outDir, { recursive: true })
    await writeFile(path.join(opts.outDir, 'RECOVERY-REPORT.json'), JSON.stringify(report, null, 2) + '\n', 'utf8')
    return report
  }

  // --- 1. Work out the feed (owner + topic) or the collection reference
  let owner: EthAddress | null = null
  let topic: Topic | null = null
  let collectionRef: Reference | null = null

  if (input.kind === 'feed') {
    owner = new EthAddress(input.owner)
    topic = topicFrom(input.topic)
  } else {
    const ref = new Reference(input.reference)
    log(`Reading manifest ${ref.toHex().slice(0, 12)}…`)
    const node = await withRetry(() => MantarayNode.unmarshal(bee, ref))
    const meta = node.getRootMetadata().value ?? undefined
    const feedOwner = meta?.['swarm-feed-owner']
    const feedTopic = meta?.['swarm-feed-topic']
    if (feedOwner && feedTopic) {
      owner = new EthAddress(feedOwner)
      topic = new Topic(feedTopic)
      report.resolvedVia = 'feed-manifest'
      log(`That is a feed manifest → owner ${owner.toChecksum()}, topic ${topic.toHex().slice(0, 12)}…`)
    } else {
      collectionRef = ref
      log('That is an edition snapshot (not a feed) — recovering exactly that edition.')
    }
  }

  // --- 2. Resolve the feed to the latest edition
  if (owner && topic) {
    const reader = bee.feed.makeReader(topic, owner)
    const head = await findFeedHead(reader, { log })
    if (!head) {
      // First-run case seen from the outside: the feed exists as an idea but nobody has written to it yet
      // (the lookup said 404 AND update #0 is not on the network).
      report.status = 'empty-feed'
      report.problems.push('This feed has no updates yet — nothing has been published under this owner and topic.')
      log(report.problems[0]!)
      return finish()
    }
    collectionRef = head.reference
    report.feed = { owner: owner.toChecksum(), topic: topic.toHex(), index: head.index.toString() }
    log(`Feed is at index ${report.feed.index} → edition ${collectionRef.toHex().slice(0, 12)}…`)

    if (opts.allEditions) {
      for (let i = 0n; i <= head.index; i++) {
        try {
          const ed = await reader.downloadReference({ index: FeedIndex.fromBigInt(i) })
          report.editions.push({ index: i.toString(), reference: ed.reference.toHex(), retrievable: true })
        } catch {
          report.editions.push({ index: i.toString(), reference: null, retrievable: false })
        }
      }
    }
  }

  if (!collectionRef) {
    report.problems.push('Could not work out which edition to read.')
    return finish()
  }
  report.collectionReference = collectionRef.toHex()
  const ref = collectionRef

  // --- 3. Table of contents: catalogue.json (inside the edition) ∪ the manifest itself
  let catalogue: Catalogue | null = null
  try {
    const file = await withRetry(() => bee.file.download(ref, 'catalogue.json'))
    const check = validateCatalogue(JSON.parse(file.data.toUtf8()))
    if (check.ok) {
      catalogue = check.catalogue
      report.title = catalogue.title
      await mkdir(opts.outDir, { recursive: true })
      await writeFile(path.join(opts.outDir, 'catalogue.json'), JSON.stringify(catalogue, null, 2) + '\n', 'utf8')
      log(`Catalogue lists ${catalogue.folios.length} folios: “${catalogue.title}”.`)
    } else report.problems.push(`catalogue.json is invalid: ${check.problems.join('; ')}`)
  } catch (e) {
    report.problems.push(`catalogue.json could not be read (${(e as Error).message}); falling back to the manifest listing.`)
  }

  let manifestPaths: string[] = []
  try {
    const node = await withRetry(() => MantarayNode.unmarshal(bee, ref))
    await withRetry(() => node.loadRecursively(bee))
    manifestPaths = Object.keys(node.collectAndMap()).map((p) => p.replace(/^\/+/, ''))
  } catch (e) {
    report.problems.push(`Manifest listing unavailable (${(e as Error).message}).`)
  }

  const expected = new Map<string, string>()
  for (const f of catalogue?.folios ?? []) expected.set(f.path, f.sha256.toLowerCase())
  const wanted = new Set<string>([...expected.keys(), ...manifestPaths.filter((p) => p.startsWith('folios/'))])
  if (!catalogue) for (const p of manifestPaths) wanted.add(p)

  // --- 4. Download and verify every file
  for (const p of [...wanted].sort()) {
    if (!isSafeRelativePath(p)) {
      report.problems.push(`Skipped unsafe path "${p}".`)
      continue
    }
    const exp = expected.get(p) ?? null
    try {
      const file = await withRetry(() => bee.file.download(ref, p))
      const data = file.data.toUint8Array()
      const sha256 = createHash('sha256').update(data).digest('hex')
      const target = path.join(opts.outDir, ...p.split('/'))
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, data)
      const status: RecoveredFile['status'] = exp === null ? 'unlisted' : exp === sha256 ? 'verified' : 'mismatch'
      report.files.push({ path: p, size: data.length, sha256, expected: exp, status })
      log(`${status === 'verified' ? '✓' : status === 'mismatch' ? '✗' : '·'} ${p} (${data.length} bytes)`)
    } catch (e) {
      report.files.push({ path: p, size: 0, sha256: '', expected: exp, status: 'missing', error: (e as Error).message })
      log(`✗ ${p} — ${(e as Error).message}`)
    }
  }

  const bad = report.files.filter((f) => f.status === 'missing' || f.status === 'mismatch').length
  report.status = report.files.length > 0 && bad === 0 ? 'complete' : report.files.length > bad ? 'partial' : 'failed'
  return finish()
}
