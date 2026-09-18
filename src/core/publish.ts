import { Reference, type Bee } from '@ethersphere/bee-js'
import { assertCanPublish, doctor } from './bee.js'
import { CATALOGUE_SCHEMA, type Catalogue } from './catalogue-schema.js'
import { scanFolios, totalBytes } from './catalogue.js'
import { toCollectionEntries, uploadCollection } from './collection.js'
import type { AppConfig } from './config.js'
import { ensureFeedManifest, publishToFeed, resolveNextIndex, topicFrom, verifyUpdate } from './feed.js'
import { ARCHIVE_SCHEMA, writeArchiveJson, writePublishedMd, type ArchiveRecord } from './record.js'
import { ephemeralSigner, loadFeedSigner, loadOrCreateFeedSigner, type FeedSigner } from './signer.js'
import { buildEdition } from './staging.js'
import { describeBatch, listBatches, pickUsableBatch } from './stamps.js'
import { honestSentence, termFromTtlSeconds, type StorageTerm } from './ttl.js'

export type StepId = 'node' | 'signer' | 'stamp' | 'address' | 'stage' | 'upload' | 'feed' | 'verify' | 'record'

export interface PublishEvent {
  step: StepId
  status: 'start' | 'done' | 'info' | 'warn'
  message: string
  data?: Record<string, unknown>
}

export interface PublishOptions {
  config: AppConfig
  bee: Bee
  batchId?: string
  dryRun?: boolean
  onEvent?: (e: PublishEvent) => void
}

export interface PublishResult {
  dryRun: boolean
  /** THE archive address: the feed manifest reference. */
  archiveAddress: string | null
  owner: string
  topic: string
  topicString: string
  /** This edition's snapshot (NOT the address to hand out). */
  collectionReference: string | null
  feedIndex: string | null
  firstRun: boolean | null
  fileCount: number
  bytes: number
  term: StorageTerm
  stagingDir: string
  files: string[]
}

const DESCRIPTION =
  'Photographs of birch-bark (Bhojpatra) scrolls and palm-leaf folios from a stone vault above the Spiti valley, ' +
  'taken page by page by Tsering over two winters. Published to Swarm so they stay reachable after the grant, the ' +
  'committee and the publisher have moved on.'

export async function publish(opts: PublishOptions): Promise<PublishResult> {
  const { config, bee } = opts
  const dryRun = opts.dryRun ?? false
  const emit = (e: PublishEvent): void => opts.onEvent?.(e)

  // 1. Node
  emit({ step: 'node', status: 'start', message: `Knocking on ${config.beeUrl}…` })
  const health = await doctor(bee)
  if (!dryRun) assertCanPublish(health)
  emit({
    step: 'node',
    status: health.reachable ? 'done' : 'warn',
    message: health.reachable ? `Bee ${health.version} is up, mode: ${health.mode ?? 'unknown'}.` : 'No node answered (fine for a dry run).',
    data: { ...health },
  })

  // 2. Signer (the only secret; stays in Node, never printed)
  emit({ step: 'signer', status: 'start', message: 'Loading the feed signer…' })
  let signer: FeedSigner
  if (dryRun) signer = loadFeedSigner(config.root) ?? ephemeralSigner()
  else signer = loadOrCreateFeedSigner(config.root)
  const topic = topicFrom(config.topicString)
  const owner = signer.owner
  emit({
    step: 'signer',
    status: signer.source === 'created' ? 'warn' : 'done',
    message:
      signer.source === 'created'
        ? `New feed key created in ${signer.keyFile}. Back it up somewhere safe: lose it and you can't publish new editions (readers are unaffected).`
        : signer.source === 'ephemeral'
          ? 'Dry run: using a throwaway in-memory key.'
          : `Feed owner ${owner.toChecksum()} (key from ${signer.source}).`,
    data: { owner: owner.toChecksum(), topic: topic.toHex(), topicString: config.topicString, source: signer.source },
  })

  // 3. Folios + stamp
  const folios = await scanFolios(config.foliosDir)
  if (folios.length === 0) throw new Error(`No folios found in ${config.foliosDir}`)
  const bytes = totalBytes(folios)
  emit({ step: 'stamp', status: 'start', message: `Looking for a postage batch with room for ${folios.length} folios…` })
  let batchId = opts.batchId ?? null
  let term: StorageTerm = termFromTtlSeconds(
    null,
    new Date(),
    health.reachable ? 'no postage batch chosen yet' : 'the node did not answer, so we will not guess',
  )
  if (health.reachable) {
    try {
      if (!batchId) batchId = pickUsableBatch(await listBatches(bee), bytes)?.batchId ?? null
      if (batchId) term = (await describeBatch(bee, batchId)).term
    } catch (e) {
      if (!dryRun) throw e
    }
  }
  if (!batchId && !dryRun) {
    throw new Error('No usable postage batch with enough room. Buy one first: npm run archive -- buy --size 100mb --days 14')
  }
  emit({
    step: 'stamp',
    status: batchId ? 'done' : 'warn',
    message: batchId ? `Batch ${batchId.slice(0, 10)}… — ${honestSentence(term)}` : 'No batch yet (dry run continues without one).',
    data: { batchId, term },
  })

  // 4. The permanent address (feed manifest)
  emit({ step: 'address', status: 'start', message: 'Minting the archive address (feed manifest)…' })
  let feedManifest: Reference | null = null
  if (!dryRun && batchId) feedManifest = await ensureFeedManifest(bee, batchId, topic, owner)
  emit({
    step: 'address',
    status: feedManifest ? 'done' : 'info',
    message: feedManifest ? `Archive address: ${feedManifest.toHex()}` : 'Dry run: the feed manifest is created on a real publish.',
    data: { feedManifest: feedManifest?.toHex() ?? null },
  })

  // 5. Stage the self-describing edition
  const catalogue: Catalogue = {
    schema: CATALOGUE_SCHEMA,
    title: config.title,
    description: DESCRIPTION,
    publishedAt: new Date().toISOString(),
    feed: {
      owner: owner.toChecksum(),
      topic: topic.toHex(),
      topicString: config.topicString,
      feedManifest: feedManifest?.toHex() ?? '(created on first real publish)',
    },
    storage: {
      batchId: batchId ?? '(none yet)',
      ttlSeconds: term.ttlSeconds,
      paidUntil: term.paidUntil,
      asOf: term.asOf,
      note: 'Snapshot at publish time. Ask any Bee node for the live figure: GET /stamps/<batchId> → batchTTL.',
    },
    folios,
  }
  emit({ step: 'stage', status: 'start', message: 'Laying out the edition: gallery, catalogue, reader, folios…' })
  const dir = buildEdition({ root: config.root, foliosDir: config.foliosDir, catalogue, term })
  const entries = await toCollectionEntries(dir)
  emit({
    step: 'stage',
    status: 'done',
    message: `${entries.length} files staged (${folios.length} folios + index.html, catalogue.json, recover.html, ABOUT.txt).`,
    data: { files: entries.map((e) => e.path) },
  })

  const base: PublishResult = {
    dryRun,
    archiveAddress: feedManifest?.toHex() ?? null,
    owner: owner.toChecksum(),
    topic: topic.toHex(),
    topicString: config.topicString,
    collectionReference: null,
    feedIndex: null,
    firstRun: null,
    fileCount: entries.length,
    bytes,
    term,
    stagingDir: dir,
    files: entries.map((e) => e.path),
  }

  if (dryRun) {
    // Read-only peek at the network so the plan says what WOULD happen.
    if (health.reachable) {
      try {
        const peek = await resolveNextIndex(bee, topic, owner)
        base.feedIndex = peek.next.toBigInt().toString()
        base.firstRun = peek.firstRun
        emit({
          step: 'feed',
          status: 'info',
          message: `Network says the next feed index would be ${base.feedIndex}${peek.firstRun ? ' (empty feed — first edition)' : ''}.`,
        })
      } catch (e) {
        emit({ step: 'feed', status: 'warn', message: `Could not read the feed: ${(e as Error).message}` })
      }
    }
    emit({ step: 'record', status: 'info', message: 'Dry run finished. Nothing was uploaded, nothing was spent, no tracked file was touched.' })
    return base
  }

  // 6. Upload the edition as a collection (one manifest reference for the whole folder)
  emit({ step: 'upload', status: 'start', message: `Uploading ${entries.length} files to Swarm…` })
  const uploaded = await uploadCollection(bee, batchId!, dir)
  const collectionReference = uploaded.reference.toHex()
  emit({ step: 'upload', status: 'done', message: `Edition snapshot: ${collectionReference}`, data: { collectionReference } })

  // 7. Read the feed from the network, then write the reference to the next slot
  emit({ step: 'feed', status: 'start', message: 'Asking the network for the next feed index, then writing…' })
  const fed = await publishToFeed(bee, signer.key, batchId!, topic, uploaded.reference)
  emit({
    step: 'feed',
    status: 'done',
    message: `Feed index ${fed.index}${fed.firstRun ? ' (first edition — the feed was empty)' : ''} now points at this edition.`,
    data: { index: fed.index.toString(), firstRun: fed.firstRun, updateChunk: fed.updateChunk },
  })

  // 8. Verify
  emit({ step: 'verify', status: 'start', message: 'Reading the slot back…' })
  const ok = await verifyUpdate(bee, topic, owner, fed.index, uploaded.reference)
  if (!ok) throw new Error(`Feed index ${fed.index} does not point at ${collectionReference}.`)
  emit({ step: 'verify', status: 'done', message: 'The feed points at this edition.' })

  // 9. Record the public identifiers (tracked files) with the LIVE batch TTL
  const liveTerm = (await describeBatch(bee, batchId!)).term
  const rec = buildRecord(config, {
    owner: owner.toChecksum(),
    topic: topic.toHex(),
    feedManifest: feedManifest!.toHex(),
    collectionReference,
    index: fed.index,
    files: entries.length,
    bytes,
    batchId: batchId!,
    term: liveTerm,
  })
  writeArchiveJson(config.root, rec)
  writePublishedMd(config.root, rec, liveTerm)
  emit({ step: 'record', status: 'done', message: 'Wrote archive.json and PUBLISHED.md. Commit them — they are the hand-over.', data: { term: liveTerm } })

  return {
    ...base,
    collectionReference,
    feedIndex: fed.index.toString(),
    firstRun: fed.firstRun,
    term: liveTerm,
  }
}

export function buildRecord(
  config: AppConfig,
  p: {
    owner: string
    topic: string
    feedManifest: string
    collectionReference: string
    index: bigint
    files: number
    bytes: number
    batchId: string
    term: StorageTerm
  },
): ArchiveRecord {
  const gw = config.gatewayUrl
  return {
    schema: ARCHIVE_SCHEMA,
    title: config.title,
    feed: { owner: p.owner, topic: p.topic, topicString: config.topicString, type: 'sequence' },
    address: {
      feedManifest: p.feedManifest,
      bzzUrl: `${gw}/bzz/${p.feedManifest}/`,
      cid: new Reference(p.feedManifest).toCid('feed'),
    },
    latestEdition: {
      collectionReference: p.collectionReference,
      publishedAtIndex: p.index.toString(),
      publishedAt: new Date().toISOString(),
      fileCount: p.files,
      bytes: p.bytes,
    },
    storage: {
      batchId: p.batchId,
      ttlSecondsAtPublish: p.term.ttlSeconds,
      paidUntil: p.term.paidUntil,
      asOf: p.term.asOf,
      source: p.term.source,
      note: honestSentence(p.term) + ' Run `npm run archive -- status` for the live figure.',
    },
    recover: {
      cli: `npm run recover -- ${p.owner} ${p.topic} --bee ${gw} --out recovered`,
      curl: `curl -s ${gw}/bzz/${p.feedManifest}/catalogue.json`,
      reader: 'reader/recover.html',
    },
  }
}
