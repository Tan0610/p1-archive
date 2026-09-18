#!/usr/bin/env node
import path from 'node:path'
import { parseArgs } from 'node:util'
import { Bee, EthAddress } from '@ethersphere/bee-js'
import { doctor, makeBee } from '../core/bee.js'
import { loadConfig, trimSlash } from '../core/config.js'
import { readFeedHead, topicFrom } from '../core/feed.js'
import { publish, type PublishEvent } from '../core/publish.js'
import { readPublishedIdentifiers } from '../core/record.js'
import { buyBatch, describeBatch, extendBatch, listBatches, quoteBuy, quoteExtend } from '../core/stamps.js'
import { honestSentence, type StorageTerm } from '../core/ttl.js'
import { PUBLIC_GATEWAY } from '../recover/recover.js'
import { bar, c, fail, heading, kv, plate } from './ui.js'

const HELP = `
${c.bold('archive')} — keep Tsering's folios reachable after the app is gone

  ${c.saffron('doctor')}                         is the node up, light, funded?
  ${c.saffron('stamps')}                         list postage batches and how long each is paid for
  ${c.saffron('quote')}   --size 100mb --days 14 what a new batch would cost (no spending)
  ${c.saffron('buy')}     --size 100mb --days 14 --yes     buy a batch (spends xBZZ)
  ${c.saffron('extend')}  --batch <id> --days 7 --yes     top up an existing batch (spends xBZZ)
  ${c.saffron('publish')} [--dir samples/folios] [--batch <id>] [--dry-run]
  ${c.saffron('status')}  [--owner <addr> --topic <t>]    live paid-until + latest feed index
  ${c.saffron('verify')}  [--gateway]                    can the address be read back (locally / via the public gateway)?
  ${c.saffron('recover')} <owner> <topic> [--bee URL] [--out DIR] [--all-editions]
  ${c.saffron('recover')} --manifest <ref> [--bee URL] [--out DIR]
  ${c.saffron('serve')}   [--port 4173]                  the local web UI's API

  Recovery defaults to the public gateway ${PUBLIC_GATEWAY} and reads NOTHING from this repo.
`

function parseSizeMb(s: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*(mb|gb|kb)?$/i.exec(s.trim())
  if (!m) fail(`Could not read size "${s}" — try 100mb or 1gb.`)
  const n = Number(m[1])
  const unit = (m[2] ?? 'mb').toLowerCase()
  return unit === 'gb' ? n * 1000 : unit === 'kb' ? n / 1000 : n
}

function printTerm(term: StorageTerm): void {
  const colour = term.level === 'ok' ? c.green : term.level === 'soon' ? c.saffron : term.level === 'unknown' ? c.dim : c.cinnabar
  console.log('  ' + colour('● ') + honestSentence(term))
}

async function cmdDoctor(bee: Bee): Promise<void> {
  heading('Node check')
  const r = await doctor(bee)
  kv('endpoint', r.url)
  kv('answers', r.reachable ? c.green('yes') : c.cinnabar('no'))
  if (r.version) kv('bee', `${r.version} (API ${r.apiVersion})`)
  kv('mode', r.mode ?? '—')
  kv('ready', r.ready ? c.green('ready') : c.saffron('not yet'))
  if (r.wallet) {
    kv('wallet', r.wallet.address)
    kv('xBZZ / xDAI', `${r.wallet.xbzz} / ${r.wallet.xdai}`)
  }
  for (const p of r.problems) console.log('  ' + c.saffron('! ') + p)
  for (const h of r.hints) console.log('  ' + c.dim('→ ' + h))
  if (r.reachable && r.canUpload && r.ready) console.log('\n  ' + c.green('Ready to buy a stamp and publish.'))
}

async function cmdStamps(bee: Bee): Promise<void> {
  heading('Postage batches — prepaid rent, with an end date')
  const batches = await listBatches(bee)
  if (batches.length === 0) {
    console.log('  No batches yet. ' + c.dim('Try: npm run archive -- quote --size 100mb --days 14'))
    return
  }
  for (const b of batches) {
    console.log(`\n  ${c.bold(b.label || '(no label)')}  ${c.dim(b.batchId)}`)
    kv('usable', b.usable ? c.green('yes') : c.saffron('not yet (new batches take ~1 min)'))
    kv('used', `${bar(b.usage)} ${(b.usage * 100).toFixed(1)}%`)
    kv('depth', String(b.depth))
    printTerm(b.term)
  }
}

async function cmdQuote(bee: Bee, sizeMb: number, days: number): Promise<void> {
  const q = await quoteBuy(bee, sizeMb, days)
  heading('Quote (nothing spent)')
  kv('size', q.size)
  kv('duration', q.duration)
  kv('cost', `${q.costXbzz} xBZZ`)
  console.log(c.dim('\n  Buy with: npm run archive -- buy --size ' + sizeMb + 'mb --days ' + days + ' --yes'))
}

async function cmdBuy(bee: Bee, sizeMb: number, days: number, yes: boolean): Promise<void> {
  await cmdQuote(bee, sizeMb, days)
  if (!yes) fail('Buying spends xBZZ. Re-run with --yes once you are happy with the quote.')
  console.log('\n  Buying… (the node waits until the batch is usable, usually about a minute)')
  const id = await buyBatch(bee, sizeMb, days)
  const b = await describeBatch(bee, id)
  console.log('  ' + c.green('✓ ') + `Batch ${id}`)
  printTerm(b.term)
}

async function cmdExtend(bee: Bee, batchId: string, days: number, yes: boolean): Promise<void> {
  const before = await describeBatch(bee, batchId)
  const cost = await quoteExtend(bee, batchId, days)
  heading('Top up')
  kv('batch', batchId)
  kv('adds', `${days} days`)
  kv('cost', `${cost} xBZZ`)
  printTerm(before.term)
  if (!yes) fail('Topping up spends xBZZ. Re-run with --yes.')
  await extendBatch(bee, batchId, days)
  const after = await describeBatch(bee, batchId)
  console.log('  ' + c.green('✓ ') + 'Extended.')
  printTerm(after.term)
}

const STEP_LABEL: Record<PublishEvent['step'], string> = {
  node: 'node',
  signer: 'signer',
  stamp: 'stamp',
  address: 'address',
  stage: 'edition',
  upload: 'upload',
  feed: 'feed',
  verify: 'verify',
  record: 'record',
}

async function cmdPublish(bee: Bee, dir: string | undefined, batch: string | undefined, dryRun: boolean): Promise<void> {
  const config = loadConfig(dir ? { foliosDir: dir } : {})
  heading(dryRun ? 'Publish — DRY RUN (no uploads, no spending)' : 'Publishing a new edition')
  const result = await publish({
    config,
    bee,
    batchId: batch,
    dryRun,
    onEvent: (e) => {
      if (e.status === 'start') return
      const mark = e.status === 'done' ? c.green('✓') : e.status === 'warn' ? c.saffron('!') : c.blue('·')
      console.log(`  ${mark} ${c.dim(STEP_LABEL[e.step].padEnd(8))} ${e.message}`)
    },
  })
  console.log()
  if (result.archiveAddress) {
    plate('ARCHIVE ADDRESS — never changes, hand this out', result.archiveAddress)
    kv('open', `${config.gatewayUrl}/bzz/${result.archiveAddress}/`)
  }
  kv('feed owner', result.owner)
  kv('feed topic', `${result.topic}  ${c.dim(`("${result.topicString}")`)}`)
  if (result.collectionReference) kv('this edition', c.dim(result.collectionReference + '  (snapshot, not the address)'))
  if (result.feedIndex) kv(dryRun ? 'next feed index' : 'feed index', result.feedIndex)
  printTerm(result.term)
  if (dryRun) {
    console.log('\n  ' + c.dim(`Staged ${result.fileCount} files in ${path.relative(process.cwd(), result.stagingDir)} — have a look at index.html.`))
  }
}

function identifiers(owner?: string, topic?: string): { owner: string; topic: string; manifest: string | null; batchId: string | null } {
  if (owner && topic) return { owner, topic, manifest: null, batchId: null }
  const ids = readPublishedIdentifiers(loadConfig().root)
  if (!ids) fail('Nothing published yet (no archive.json). Pass --owner and --topic, or publish first.')
  return { owner: ids.owner, topic: ids.topic, manifest: ids.feedManifest, batchId: ids.batchId }
}

async function cmdStatus(bee: Bee, owner?: string, topic?: string, batch?: string): Promise<void> {
  const ids = identifiers(owner, topic)
  heading('Archive status (live from the node)')
  if (ids.manifest) kv('archive address', ids.manifest)
  kv('feed owner', ids.owner)
  kv('feed topic', ids.topic)
  const head = await readFeedHead(bee, topicFrom(ids.topic), new EthAddress(ids.owner))
  kv('latest edition', head.empty ? c.saffron('none yet — the feed has no updates') : `index ${head.index} → ${head.reference}`)
  const batchId = batch ?? ids.batchId
  if (batchId) {
    const b = await describeBatch(bee, batchId)
    kv('batch', b.batchId)
    kv('used', `${bar(b.usage)} ${(b.usage * 100).toFixed(1)}%`)
    printTerm(b.term)
  }
}

async function cmdVerify(bee: Bee, gateway: boolean): Promise<void> {
  const config = loadConfig()
  const ids = identifiers()
  if (!ids.manifest) fail('No archive address recorded yet.')
  const targets: [string, Bee][] = [['your node', bee]]
  if (gateway) targets.push(['public gateway', new Bee(config.gatewayUrl)])
  heading('Can the archive address be read back?')
  for (const [name, b] of targets) {
    let ok = false
    let lastError = ''
    const deadline = Date.now() + (name === 'public gateway' ? 300_000 : 30_000)
    while (!ok && Date.now() < deadline) {
      try {
        const file = await b.file.download(ids.manifest, 'catalogue.json')
        const cat = JSON.parse(file.data.toUtf8()) as { folios: unknown[] }
        console.log(`  ${c.green('✓')} ${name}: /bzz/${ids.manifest.slice(0, 10)}…/catalogue.json lists ${cat.folios.length} folios`)
        ok = true
      } catch (e) {
        lastError = (e as Error).message
        if (name === 'public gateway') {
          process.stdout.write(c.dim('  … waiting for the network to spread the chunks\r'))
          await new Promise((r) => setTimeout(r, 15_000))
        } else break
      }
    }
    if (!ok) console.log(`  ${c.cinnabar('✗')} ${name}: ${lastError}`)
  }
}

async function main(): Promise<void> {
  // Recovery must not touch this repo's config or state: hand it straight to its own entrypoint.
  if (process.argv[2] === 'recover') {
    const { runRecoverCli } = await import('../recover/main.js')
    process.exit(await runRecoverCli(process.argv.slice(3)))
  }
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      bee: { type: 'string' },
      batch: { type: 'string' },
      size: { type: 'string', default: '100mb' },
      days: { type: 'string', default: '14' },
      dir: { type: 'string' },
      owner: { type: 'string' },
      topic: { type: 'string' },
      port: { type: 'string', default: '4173' },
      yes: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      gateway: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  })
  const [cmd] = positionals
  if (!cmd || values.help) {
    console.log(HELP)
    return
  }
  const config = loadConfig()
  const bee = makeBee(values.bee ? trimSlash(values.bee) : config.beeUrl)
  const days = Number(values.days)
  if (!Number.isFinite(days) || days <= 0) fail('--days must be a positive number')

  switch (cmd) {
    case 'doctor':
      return cmdDoctor(bee)
    case 'stamps':
      return cmdStamps(bee)
    case 'quote':
      return cmdQuote(bee, parseSizeMb(values.size!), days)
    case 'buy':
      return cmdBuy(bee, parseSizeMb(values.size!), days, values.yes!)
    case 'extend':
      if (!values.batch) fail('extend needs --batch <id>')
      return cmdExtend(bee, values.batch, days, values.yes!)
    case 'publish':
      return cmdPublish(bee, values.dir, values.batch, values['dry-run']!)
    case 'status':
      return cmdStatus(bee, values.owner, values.topic, values.batch)
    case 'verify':
      return cmdVerify(bee, values.gateway!)
    case 'serve': {
      const { startServer } = await import('../server/server.js')
      await startServer(Number(values.port))
      return
    }
    default:
      fail(`Unknown command "${cmd}".\n${HELP}`)
  }
}

main().catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)))
