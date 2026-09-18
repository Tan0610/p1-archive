/**
 * Local API for the web UI. Binds to 127.0.0.1 only.
 *
 * The browser never talks to Bee directly and never sees the feed key: every
 * Swarm call happens here, in Node. Anything that writes or spends requires a
 * custom header (so a random web page can't trigger it cross-origin — the
 * browser would need a CORS preflight we never answer) and an explicit
 * `confirm: true` in the body.
 */
import { createReadStream, existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import path from 'node:path'
import { EthAddress } from '@ethersphere/bee-js'
import { doctor, makeBee } from '../core/bee.js'
import { mimeFor, scanFolios, totalBytes } from '../core/catalogue.js'
import { loadConfig, type AppConfig } from '../core/config.js'
import { readFeedHead, topicFrom } from '../core/feed.js'
import { publish } from '../core/publish.js'
import { archiveJsonPath, readPublishedIdentifiers } from '../core/record.js'
import { loadFeedSigner } from '../core/signer.js'
import { buyBatch, describeBatch, extendBatch, listBatches, quoteBuy, quoteExtend } from '../core/stamps.js'

const CLIENT_HEADER = 'x-archive-client'

/**
 * One publish at a time. Two overlapping publishes would both read the same
 * next index from the network and race to write that slot.
 */
let publishing = false

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)))
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}

function num(v: unknown, name: string): number {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive number`)
  return n
}

async function status(config: AppConfig) {
  const bee = makeBee(config.beeUrl)
  const node = await doctor(bee)
  const published = readPublishedIdentifiers(config.root)
  const signer = loadFeedSigner(config.root)
  let batches: Awaited<ReturnType<typeof listBatches>> = []
  let head: Awaited<ReturnType<typeof readFeedHead>> | null = null
  let headError: string | null = null
  if (node.reachable) {
    try {
      batches = await listBatches(bee)
    } catch {
      /* 503 while syncing */
    }
    if (published) {
      try {
        head = await readFeedHead(bee, topicFrom(published.topic), new EthAddress(published.owner))
      } catch (e) {
        headError = (e as Error).message
      }
    }
  }
  let archive: unknown = null
  if (published) archive = JSON.parse(await readFile(archiveJsonPath(config.root), 'utf8'))
  return {
    node,
    batches,
    archive,
    head,
    headError,
    // public info only: whether a key exists and its ADDRESS
    signer: signer ? { owner: signer.owner.toChecksum(), source: signer.source } : null,
    topicString: config.topicString,
    topic: topicFrom(config.topicString).toHex(),
    gatewayUrl: config.gatewayUrl,
    beeUrl: config.beeUrl,
  }
}

async function handle(req: IncomingMessage, res: ServerResponse, config: AppConfig, webDist: string): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const bee = makeBee(config.beeUrl)

  if (url.pathname.startsWith('/api/')) {
    if (req.method !== 'GET' && req.headers[CLIENT_HEADER] !== '1') {
      return json(res, 403, { error: 'Missing client header.' })
    }
    try {
      switch (`${req.method} ${url.pathname}`) {
        case 'GET /api/status':
          return json(res, 200, await status(config))

        case 'GET /api/folios': {
          const folios = await scanFolios(config.foliosDir)
          return json(res, 200, { dir: path.relative(config.root, config.foliosDir), folios, bytes: totalBytes(folios) })
        }

        case 'GET /api/folio-file': {
          const rel = url.searchParams.get('path') ?? ''
          const inside = path.resolve(config.foliosDir, rel.replace(/^folios\//, ''))
          if (!inside.startsWith(config.foliosDir + path.sep) || !existsSync(inside) || !statSync(inside).isFile()) {
            return json(res, 404, { error: 'No such folio' })
          }
          res.writeHead(200, { 'content-type': mimeFor(inside), 'cache-control': 'no-store' })
          createReadStream(inside).pipe(res)
          return
        }

        case 'POST /api/quote': {
          const body = await readBody(req)
          return json(res, 200, await quoteBuy(bee, num(body.sizeMb, 'sizeMb'), num(body.days, 'days')))
        }

        case 'POST /api/buy': {
          const body = await readBody(req)
          if (body.confirm !== true) return json(res, 400, { error: 'Buying spends xBZZ; confirm: true is required.' })
          const id = await buyBatch(bee, num(body.sizeMb, 'sizeMb'), num(body.days, 'days'))
          return json(res, 200, await describeBatch(bee, id))
        }

        case 'POST /api/extend-quote': {
          const body = await readBody(req)
          return json(res, 200, { costXbzz: await quoteExtend(bee, String(body.batchId), num(body.days, 'days')) })
        }

        case 'POST /api/extend': {
          const body = await readBody(req)
          if (body.confirm !== true) return json(res, 400, { error: 'Topping up spends xBZZ; confirm: true is required.' })
          await extendBatch(bee, String(body.batchId), num(body.days, 'days'))
          return json(res, 200, await describeBatch(bee, String(body.batchId)))
        }

        case 'POST /api/publish': {
          const body = await readBody(req)
          const dryRun = body.dryRun !== false
          if (!dryRun && body.confirm !== true) return json(res, 400, { error: 'A real publish uploads and stamps data; confirm: true is required.' })
          if (publishing) return json(res, 409, { error: 'A publish is already running. Wait for it to finish.' })
          publishing = true
          // Server-sent events: one line per step, so the UI can show the flags going up.
          res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
          const send = (event: string, data: unknown) =>
            res.write(`event: ${event}\ndata: ${JSON.stringify(data, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v))}\n\n`)
          try {
            const result = await publish({
              config,
              bee,
              dryRun,
              batchId: typeof body.batchId === 'string' && body.batchId ? body.batchId : undefined,
              onEvent: (e) => send('step', e),
            })
            send('result', result)
          } catch (e) {
            send('failure', { message: (e as Error).message })
          } finally {
            publishing = false
          }
          res.end()
          return
        }

        default:
          return json(res, 404, { error: `No route ${req.method} ${url.pathname}` })
      }
    } catch (e) {
      return json(res, 500, { error: (e as Error).message })
    }
  }

  // Static UI (after `npm run build:web`)
  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1))
  const file = path.resolve(webDist, rel)
  const target = file.startsWith(webDist) && existsSync(file) && statSync(file).isFile() ? file : path.join(webDist, 'index.html')
  if (!existsSync(target)) {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('API is running. For the UI, run `npm run ui` (dev) or `npm run build:web` first.')
    return
  }
  res.writeHead(200, { 'content-type': mimeFor(target) === 'application/octet-stream' ? guessWebMime(target) : mimeFor(target) })
  createReadStream(target).pipe(res)
}

function guessWebMime(file: string): string {
  const ext = path.extname(file)
  return (
    { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon' }[
      ext
    ] ?? 'application/octet-stream'
  )
}

export async function startServer(port = 4173): Promise<void> {
  const config = loadConfig()
  const webDist = path.join(config.root, 'web', 'dist')
  const server = createServer((req, res) => {
    handle(req, res, config, webDist).catch((e: unknown) => json(res, 500, { error: (e as Error).message }))
  })
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
  console.log(`\n  ༄༅།  archive UI/API on http://127.0.0.1:${port}  (Bee: ${config.beeUrl})`)
  console.log('      dev UI with hot reload: npm run ui  →  http://localhost:5173\n')
}
