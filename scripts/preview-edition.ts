/**
 * Serves the last staged edition (.staging/edition) exactly as a gateway would
 * serve /bzz/<ref>/, so you can see the gallery before spending anything.
 *
 *   npm run archive -- publish --dry-run && npm run preview:edition
 */
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mimeFor } from '../src/core/catalogue.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dir = path.join(root, '.staging', 'edition')
const port = Number(process.env.PORT ?? 4174)

if (!existsSync(dir)) {
  console.error('Nothing staged yet. Run: npm run archive -- publish --dry-run')
  process.exit(1)
}

const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript' }

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x')
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html'
  const file = path.resolve(dir, rel)
  if (!file.startsWith(dir) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found')
    return
  }
  res.writeHead(200, { 'content-type': types[path.extname(file)] ?? mimeFor(file) })
  createReadStream(file).pipe(res)
}).listen(port, '127.0.0.1', () => console.log(`Staged edition on http://127.0.0.1:${port}/`))
