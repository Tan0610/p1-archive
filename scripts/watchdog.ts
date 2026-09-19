/**
 * Storage-time watchdog: is the archive still paid for, and does its address still answer?
 *
 *   npm run watchdog                                    # ids from the tracked archive.json
 *   npm run watchdog -- --batch <id> [--address <ref>] [--gateway URL] [--warn-days 3] [--critical-days 1]
 *
 * Keyless and nodeless. Everything it reads is public:
 *   - the batch's remaining TTL from a public gateway's `GET /batches` (the whole
 *     list, ~80 KB, answered in about a second; the gateway has no per-batch
 *     read), and as a cross-check / fallback straight from the PostageStamp
 *     contract on Gnosis Chain (`remainingBalance / lastPrice` × 5 s blocks);
 *   - `GET /bzz/<archive address>/catalogue.json` on the gateway (must be 200 and list folios);
 *   - the feed's newest update, found by reading update chunks one index at a time.
 *
 * Exit code: 0 ok, 1 warn (runs out within --warn-days, or the TTL could not be
 * read at all), 2 critical (within --critical-days, expired, batch gone, or
 * the address / feed no longer resolves). `--json FILE` writes the report,
 * `--issue-body FILE` writes the GitHub issue text the scheduled workflow posts.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import { Bee, BeeResponseError, EthAddress, FeedIndex, Topic } from '@ethersphere/bee-js'
import { probeLatestIndex } from '../src/shared/feed-probe.js'

export const DEFAULT_GATEWAY = 'https://api.gateway.ethswarm.org'
export const DEFAULT_RPC = 'https://rpc.gnosischain.com'
/** PostageStamp and xBZZ on Gnosis Chain. Checked on-chain: PostageStamp.bzzToken() returns XBZZ_TOKEN, whose symbol() is "BZZ". */
export const POSTAGE_STAMP = '0x45a1502382541Cd610CC9068e88727426b696293'
export const XBZZ_TOKEN = '0xdBF3Ea6F5beE45c02255B2c26a16F300502F68da'
/** Gnosis Chain block time; PostageStamp prices are PLUR per chunk per block. */
export const BLOCK_SECONDS = 5
export const BLOCKS_PER_DAY = 86_400 / BLOCK_SECONDS
/** 1 xBZZ = 10^16 PLUR. */
export const PLUR_PER_XBZZ = 10n ** 16n

// 4-byte selectors (keccak256 of the signature), precomputed so this script needs no hashing library.
export const SELECTORS = {
  remainingBalance: '0xd71ba7c4', // remainingBalance(bytes32)
  lastPrice: '0x053f14da', // lastPrice()
  batchDepth: '0x44beae8e', // batchDepth(bytes32)
}

export type Level = 'ok' | 'warn' | 'critical'

export interface BatchReading {
  source: 'gateway' | 'chain'
  /** Seconds of paid storage left. 0 = expired. */
  ttlSeconds: number
  depth: number | null
  /** Current storage price in PLUR per chunk per block (chain reading only). */
  pricePerBlock: bigint | null
}

export interface Check {
  name: string
  level: Level
  detail: string
}

export interface WatchdogReport {
  checkedAt: string
  gateway: string
  batchId: string
  address: string | null
  feed: { owner: string; topic: string; recordedIndex: string | null; latestIndex: string | null } | null
  ttlSeconds: number | null
  daysLeft: number | null
  runsOutAt: string | null
  ttlSource: 'gateway' | 'chain' | null
  depth: number | null
  pricePerBlock: string | null
  warnDays: number
  criticalDays: number
  checks: Check[]
  level: Level
}

// ---------------------------------------------------------------- pure parts

const RANK: Record<Level, number> = { ok: 0, warn: 1, critical: 2 }

export function worst(levels: Level[]): Level {
  return levels.reduce<Level>((a, b) => (RANK[b] > RANK[a] ? b : a), 'ok')
}

export function exitCode(level: Level): 0 | 1 | 2 {
  return RANK[level] as 0 | 1 | 2
}

export function normaliseId(id: string): string {
  const clean = id.trim().replace(/^0x/i, '').toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(clean)) throw new Error(`"${id}" is not a 32-byte hex id`)
  return clean
}

/** Finds one batch in a gateway's `GET /batches` answer (a bare array, or `{ batches: [...] }`). */
export function findBatch(body: unknown, batchId: string): { batchTTL: number; depth: number | null } | null {
  const list = Array.isArray(body)
    ? body
    : body && typeof body === 'object' && Array.isArray((body as { batches?: unknown }).batches)
      ? (body as { batches: unknown[] }).batches
      : null
  if (!list) throw new Error('the gateway answered /batches with something that is not a batch list')
  const want = normaliseId(batchId)
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const b = item as { batchID?: unknown; batchTTL?: unknown; depth?: unknown }
    if (typeof b.batchID !== 'string' || b.batchID.replace(/^0x/i, '').toLowerCase() !== want) continue
    const ttl = Number(b.batchTTL)
    if (!Number.isFinite(ttl)) throw new Error('the gateway listed the batch without a numeric batchTTL')
    return { batchTTL: ttl, depth: typeof b.depth === 'number' ? b.depth : null }
  }
  return null
}

/** Seconds left from the contract's own numbers: remaining balance per chunk ÷ price per block × block time. */
export function ttlFromChain(remainingBalance: bigint, pricePerBlock: bigint): number {
  if (remainingBalance <= 0n) return 0
  if (pricePerBlock <= 0n) throw new Error('the contract reported a storage price of 0')
  return Number(remainingBalance / pricePerBlock) * BLOCK_SECONDS
}

/** What `PostageStamp.topUp(batch, perChunk)` needs to add `days` at today's price. The contract pulls `perChunk << depth` PLUR. */
export function topUpQuote(pricePerBlock: bigint, depth: number, days: number): { perChunk: bigint; totalPlur: bigint; xbzz: string } {
  const perChunk = pricePerBlock * BigInt(BLOCKS_PER_DAY) * BigInt(Math.ceil(days))
  const totalPlur = perChunk << BigInt(depth)
  return { perChunk, totalPlur, xbzz: formatXbzz(totalPlur) }
}

export function formatXbzz(plur: bigint): string {
  const whole = plur / PLUR_PER_XBZZ
  const frac = (plur % PLUR_PER_XBZZ).toString().padStart(16, '0').slice(0, 4)
  return `${whole}.${frac}`
}

export function ttlCheck(ttlSeconds: number | null, warnDays: number, criticalDays: number, unknownWhy = 'no source answered'): Check {
  if (ttlSeconds === null)
    return { name: 'storage time', level: 'warn', detail: `Could not read the batch's remaining TTL (${unknownWhy}). Not assuming it is fine.` }
  if (ttlSeconds <= 0)
    return { name: 'storage time', level: 'critical', detail: 'The batch has run out. Nodes may already be dropping the folios and the feed updates.' }
  const days = ttlSeconds / 86_400
  const words = `${days.toFixed(1)} days of storage left (runs out around ${dateOnly(new Date(Date.now() + ttlSeconds * 1000))})`
  if (days <= criticalDays) return { name: 'storage time', level: 'critical', detail: `${words}: at or under the ${criticalDays}-day critical line.` }
  if (days <= warnDays) return { name: 'storage time', level: 'warn', detail: `${words}: at or under the ${warnDays}-day warning line.` }
  return { name: 'storage time', level: 'ok', detail: `${words}.` }
}

function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Whole days, rounded down, for a title nobody should read as more generous than it is. */
export function daysForTitle(ttlSeconds: number | null): string {
  if (ttlSeconds === null) return 'an unknown number of days'
  const d = Math.floor(ttlSeconds / 86_400)
  if (ttlSeconds <= 0) return '0 days (already expired)'
  return d === 0 ? 'less than a day' : `${d} day${d === 1 ? '' : 's'}`
}

export const ISSUE_TITLE_PREFIX = 'Archive storage'

export function issueTitle(r: WatchdogReport): string {
  const ttl = r.checks.find((c) => c.name === 'storage time')
  if (ttl && ttl.level !== 'ok') return `${ISSUE_TITLE_PREFIX} runs out in ${daysForTitle(r.ttlSeconds)} — top it up`
  return `${ISSUE_TITLE_PREFIX} check failed — the archive address or feed is not answering`
}

const MARK: Record<Level, string> = { ok: 'OK', warn: 'WARN', critical: 'CRITICAL' }

export function issueBody(r: WatchdogReport, runUrl?: string): string {
  const batch = `0x${r.batchId}`
  const quote = r.pricePerBlock && r.depth !== null ? topUpQuote(BigInt(r.pricePerBlock), r.depth, 30) : null
  const lines = [
    `The daily storage watchdog found a problem (overall: **${MARK[r.level]}**, checked ${r.checkedAt}${runUrl ? `, [run](${runUrl})` : ''}).`,
    '',
    '| Check | Result | Detail |',
    '|---|---|---|',
    ...r.checks.map((c) => `| ${c.name} | ${MARK[c.level]} | ${c.detail.replace(/\|/g, '\\|')} |`),
    '',
    `- Postage batch: \`${r.batchId}\``,
    r.address ? `- Archive address: \`${r.address}\`` : '',
    r.ttlSource ? `- TTL read from: ${r.ttlSource === 'gateway' ? `${r.gateway}/batches` : 'the PostageStamp contract on Gnosis Chain'}` : '',
    '',
    '## Why it matters',
    '',
    'Swarm storage is prepaid rent. When this batch runs out, nodes may delete every chunk it paid for: the folios **and** the feed',
    'updates behind the archive address, so the address stops resolving too. An expired batch cannot be revived; top it up before then.',
    '',
    '## Top it up — whoever runs the node',
    '',
    '```bash',
    `npm run archive -- extend --batch ${r.batchId} --days 30          # shows the cost, spends nothing`,
    `npm run archive -- extend --batch ${r.batchId} --days 30 --yes    # spends xBZZ from the node wallet`,
    '```',
    '',
    '## Top it up — anyone else, no node and no permission needed',
    '',
    "The rent lives on Gnosis Chain. `PostageStamp.topUp(batchId, amountPerChunk)` has no owner check: any wallet holding xBZZ (plus a little xDAI for gas) can extend this batch. It pulls `amountPerChunk × 2^depth` PLUR from the caller. With [Foundry's `cast`](https://getfoundry.sh):",
    '',
    '```sh',
    `RPC=${DEFAULT_RPC}`,
    `POSTAGE=${POSTAGE_STAMP}   # PostageStamp, Gnosis Chain`,
    `XBZZ=${XBZZ_TOKEN}      # xBZZ token, Gnosis Chain`,
    `BATCH=${batch}`,
    'DAYS=30',
    '',
    'DEPTH=$(cast call $POSTAGE "batchDepth(bytes32)(uint8)" $BATCH --rpc-url $RPC | awk \'{print $1}\')',
    'PRICE=$(cast call $POSTAGE "lastPrice()(uint64)" --rpc-url $RPC | awk \'{print $1}\')   # PLUR per chunk per 5 s block',
    `PER_CHUNK=$(( PRICE * ${BLOCKS_PER_DAY} * DAYS ))`,
    'TOTAL=$(( PER_CHUNK << DEPTH ))   # PLUR the contract pulls from you (1 xBZZ = 10^16 PLUR)',
    '',
    'cast send $XBZZ "approve(address,uint256)" $POSTAGE $TOTAL --rpc-url $RPC --account <your-wallet>',
    'cast send $POSTAGE "topUp(bytes32,uint256)" $BATCH $PER_CHUNK --rpc-url $RPC --account <your-wallet>',
    '```',
    '',
    quote
      ? `At today's price (${r.pricePerBlock} PLUR per chunk per block, depth ${r.depth}) 30 more days cost about **${quote.xbzz} xBZZ** (\`PER_CHUNK=${quote.perChunk}\`).`
      : '',
    '',
    'Contract addresses: `mainnet_deployed.json` in [ethersphere/storage-incentives](https://github.com/ethersphere/storage-incentives); `topUp` source in `src/PostageStamp.sol` there.',
    '',
    'This issue is opened and updated by `.github/workflows/storage-watchdog.yml` (`npm run watchdog`), and closed by it once the checks pass again.',
  ]
  return lines.filter((l, i, all) => !(l === '' && all[i - 1] === '')).join('\n') + '\n'
}

// ---------------------------------------------------------------- network reads

const TIMEOUT_MS = 60_000
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function withTries<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let last: unknown
  for (let i = 0; i < tries; i++) {
    try {
      return await fn()
    } catch (e) {
      last = e
      if (i < tries - 1) await sleep(1_000 * 2 ** i)
    }
  }
  throw last
}

export async function readGatewayBatch(gateway: string, batchId: string): Promise<BatchReading | 'absent'> {
  const body = await withTries(async () => {
    const res = await fetch(`${gateway}/batches`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) throw new Error(`GET /batches answered ${res.status}`)
    return (await res.json()) as unknown
  })
  const b = findBatch(body, batchId)
  if (!b) return 'absent'
  return { source: 'gateway', ttlSeconds: b.batchTTL, depth: b.depth, pricePerBlock: null }
}

async function ethCall(rpc: string, data: string): Promise<string> {
  return withTries(async () => {
    const res = await fetch(rpc, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: POSTAGE_STAMP, data }, 'latest'] }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`the RPC answered ${res.status}`)
    const json = (await res.json()) as { result?: string; error?: { message?: string } }
    if (json.error) throw Object.assign(new Error(`contract call reverted: ${json.error.message ?? 'unknown'}`), { reverted: true })
    if (!json.result || json.result === '0x') throw new Error('empty eth_call result')
    return json.result
  }, 2)
}

export async function readChainBatch(rpc: string, batchId: string): Promise<BatchReading | 'absent'> {
  const id = normaliseId(batchId)
  let balance: bigint
  try {
    balance = BigInt(await ethCall(rpc, SELECTORS.remainingBalance + id))
  } catch (e) {
    // PostageStamp reverts remainingBalance() for a batch that does not exist (never bought, or expired and removed).
    if ((e as { reverted?: boolean }).reverted) return 'absent'
    throw e
  }
  const price = BigInt(await ethCall(rpc, SELECTORS.lastPrice))
  const depth = Number(BigInt(await ethCall(rpc, SELECTORS.batchDepth + id)))
  return { source: 'chain', ttlSeconds: ttlFromChain(balance, price), depth, pricePerBlock: price }
}

async function checkAddress(gateway: string, address: string): Promise<Check> {
  const url = `${gateway}/bzz/${address}/catalogue.json`
  try {
    const res = await withTries(async () => {
      const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
      if (r.status >= 500) throw new Error(`answered ${r.status}`)
      return r
    })
    if (res.status !== 200) return { name: 'archive address', level: 'critical', detail: `${url} answered ${res.status}` }
    const cat = (await res.json()) as { folios?: unknown[] }
    const n = Array.isArray(cat.folios) ? cat.folios.length : 0
    if (!n) return { name: 'archive address', level: 'critical', detail: 'catalogue.json resolved but lists no folios' }
    return { name: 'archive address', level: 'ok', detail: `/bzz/${address.slice(0, 10)}…/catalogue.json answers 200 and lists ${n} folios` }
  } catch (e) {
    return { name: 'archive address', level: 'critical', detail: `${url} did not answer: ${(e as Error).message}` }
  }
}

async function checkFeed(gateway: string, owner: string, topic: string, recorded: bigint | null): Promise<{ check: Check; latest: bigint | null }> {
  const reader = new Bee(gateway, { timeout: TIMEOUT_MS }).feed.makeReader(new Topic(normaliseId(topic)), new EthAddress(owner))
  // A plain chunk read of update #i: 404 means it is not there. Gateways sometimes answer 500 for a missing chunk; retry, then call it absent.
  const exists = async (i: bigint): Promise<boolean> => {
    for (let t = 0; t < 3; t++) {
      try {
        await reader.downloadReference({ index: FeedIndex.fromBigInt(i) })
        return true
      } catch (e) {
        const status = e instanceof BeeResponseError ? e.status : undefined
        if (status !== undefined && status < 500 && status !== 429) return false
        if (t < 2) await sleep(1_000 * 2 ** t)
      }
    }
    return false
  }
  const from = recorded ?? 0n
  if (!(await exists(from))) {
    return {
      check: { name: 'feed', level: 'critical', detail: `feed update #${from}${recorded !== null ? ' (recorded in archive.json)' : ''} is not retrievable` },
      latest: null,
    }
  }
  const latest = await probeLatestIndex(exists, from)
  return {
    check: { name: 'feed', level: 'ok', detail: `newest update is #${latest}${recorded !== null ? ` (archive.json records #${recorded})` : ''}` },
    latest,
  }
}

// ---------------------------------------------------------------- CLI

interface Tracked {
  batchId?: string
  address?: string
  owner?: string
  topic?: string
  index?: string
}

function readTracked(root: string): Tracked {
  try {
    const j = JSON.parse(readFileSync(path.join(root, 'archive.json'), 'utf8')) as {
      storage?: { batchId?: string }
      address?: { feedManifest?: string }
      feed?: { owner?: string; topic?: string }
      latestEdition?: { publishedAtIndex?: string }
    }
    return {
      batchId: j.storage?.batchId,
      address: j.address?.feedManifest,
      owner: j.feed?.owner,
      topic: j.feed?.topic,
      index: j.latestEdition?.publishedAtIndex,
    }
  } catch {
    return {}
  }
}

export async function runWatchdog(argv: string[]): Promise<{ report: WatchdogReport; code: 0 | 1 | 2 }> {
  const { values } = parseArgs({
    args: argv,
    options: {
      batch: { type: 'string' },
      address: { type: 'string' },
      owner: { type: 'string' },
      topic: { type: 'string' },
      gateway: { type: 'string', default: DEFAULT_GATEWAY },
      rpc: { type: 'string', default: DEFAULT_RPC },
      'no-chain': { type: 'boolean', default: false },
      'warn-days': { type: 'string', default: '3' },
      'critical-days': { type: 'string', default: '1' },
      json: { type: 'string' },
      'issue-body': { type: 'string' },
      'run-url': { type: 'string' },
    },
  })
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const tracked = readTracked(root)
  const batchId = normaliseId(values.batch ?? tracked.batchId ?? '')
  const explicitBatch = values.batch !== undefined
  // archive.json's address and feed belong to archive.json's batch; don't mix them with a different --batch.
  const useTracked = !explicitBatch || (tracked.batchId !== undefined && normaliseId(tracked.batchId) === batchId)
  const address = values.address ?? (useTracked ? tracked.address : undefined)
  const owner = values.owner ?? (useTracked ? tracked.owner : undefined)
  const topic = values.topic ?? (useTracked ? tracked.topic : undefined)
  const recorded = !values.owner && useTracked && tracked.index !== undefined ? BigInt(tracked.index) : null
  const gateway = values.gateway!.replace(/\/+$/, '')
  const warnDays = Number(values['warn-days'])
  const criticalDays = Number(values['critical-days'])
  if (!Number.isFinite(warnDays) || !Number.isFinite(criticalDays) || criticalDays > warnDays)
    throw new Error('--warn-days and --critical-days must be numbers, critical ≤ warn')

  // 1. Remaining TTL: gateway first, chain as cross-check (and the only source for today's price).
  const errors: string[] = []
  let gw: BatchReading | 'absent' | null = null
  let chain: BatchReading | 'absent' | null = null
  try {
    gw = await readGatewayBatch(gateway, batchId)
  } catch (e) {
    errors.push(`gateway: ${(e as Error).message}`)
  }
  if (!values['no-chain']) {
    try {
      chain = await readChainBatch(values.rpc!, batchId)
    } catch (e) {
      errors.push(`chain: ${(e as Error).message}`)
    }
  }
  const checks: Check[] = []
  const reading = gw && gw !== 'absent' ? gw : chain && chain !== 'absent' ? chain : null
  const chainReading = chain && chain !== 'absent' ? chain : null
  if (!reading && (gw === 'absent' || chain === 'absent')) {
    checks.push({
      name: 'storage time',
      level: 'critical',
      detail: `Batch ${batchId.slice(0, 10)}… is not listed by ${gw === 'absent' ? 'the gateway' : 'the contract'}: expired, or never existed.`,
    })
  } else {
    checks.push(ttlCheck(reading?.ttlSeconds ?? null, warnDays, criticalDays, errors.join('; ') || undefined))
  }

  // 2. The archive address still resolves, and 3. the feed still has its updates.
  let latest: bigint | null = null
  if (address) checks.push(await checkAddress(gateway, normaliseId(address)))
  if (owner && topic) {
    try {
      const f = await checkFeed(gateway, owner, topic, recorded)
      checks.push(f.check)
      latest = f.latest
    } catch (e) {
      checks.push({ name: 'feed', level: 'critical', detail: `could not read the feed: ${(e as Error).message}` })
    }
  }

  const level = worst(checks.map((c) => c.level))
  const ttl = reading?.ttlSeconds ?? null
  const report: WatchdogReport = {
    checkedAt: new Date().toISOString(),
    gateway,
    batchId,
    address: address ? normaliseId(address) : null,
    feed: owner && topic ? { owner, topic: normaliseId(topic), recordedIndex: recorded?.toString() ?? null, latestIndex: latest?.toString() ?? null } : null,
    ttlSeconds: ttl,
    daysLeft: ttl === null ? null : Math.round((ttl / 86_400) * 10) / 10,
    runsOutAt: ttl === null ? null : new Date(Date.now() + ttl * 1000).toISOString(),
    ttlSource: reading?.source ?? null,
    depth: reading?.depth ?? chainReading?.depth ?? null,
    pricePerBlock: chainReading?.pricePerBlock?.toString() ?? null,
    warnDays,
    criticalDays,
    checks,
    level,
  }
  if (gw && gw !== 'absent' && chainReading) {
    const drift = Math.abs(gw.ttlSeconds - chainReading.ttlSeconds)
    report.checks.push({
      name: 'cross-check',
      level: 'ok',
      detail: `gateway ${gw.ttlSeconds} s vs contract ${chainReading.ttlSeconds} s (${drift <= 3_600 ? 'agree within an hour' : `differ by ${(drift / 3_600).toFixed(1)} h; the gateway figure is used`})`,
    })
  }
  if (values.json) writeFileSync(values.json, JSON.stringify({ ...report, issueTitle: issueTitle(report) }, null, 2) + '\n', 'utf8')
  if (values['issue-body']) writeFileSync(values['issue-body'], issueBody(report, values['run-url']), 'utf8')
  return { report, code: exitCode(level) }
}

function print(r: WatchdogReport): void {
  console.log('\nStorage watchdog — public reads only, no keys\n')
  console.log(`  batch     ${r.batchId}`)
  if (r.address) console.log(`  address   ${r.address}`)
  console.log(`  gateway   ${r.gateway}`)
  if (r.daysLeft !== null) console.log(`  TTL       ${r.ttlSeconds} s ≈ ${r.daysLeft} days, runs out ≈ ${r.runsOutAt} (from ${r.ttlSource})`)
  console.log(`  lines     warn ≤ ${r.warnDays} d, critical ≤ ${r.criticalDays} d\n`)
  for (const c of r.checks) console.log(`  [${MARK[c.level].padEnd(8)}] ${c.name.padEnd(15)} ${c.detail}`)
  console.log(`\n  Overall: ${MARK[r.level]} (exit ${exitCode(r.level)})`)
  if (r.level !== 'ok')
    console.log(`  Top up: npm run archive -- extend --batch ${r.batchId} --days 30 --yes   (or PostageStamp.topUp from any wallet; see README)`)
}

const invokedDirectly = process.argv[1] && /watchdog\.(ts|js)$/.test(process.argv[1])
if (invokedDirectly) {
  runWatchdog(process.argv.slice(2))
    .then(({ report, code }) => {
      print(report)
      process.exit(code)
    })
    .catch((e: unknown) => {
      console.error('\nwatchdog: ' + (e instanceof Error ? e.message : String(e)))
      process.exit(2)
    })
}
