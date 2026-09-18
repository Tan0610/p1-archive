import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import type { FolioEntry } from '../shared/catalogue-schema.js'

const MIME: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json',
  '.pdf': 'application/pdf',
}

export function mimeFor(file: string): string {
  return MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
}

function kindFor(mime: string): FolioEntry['kind'] {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('text/')) return 'text'
  return 'other'
}

export function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

/** Optional sidecar with human titles: { "f001-x.svg": { "title": "...", "note": "..." } } */
export const META_FILE = 'folios.meta.json'
type MetaFile = Record<string, { title?: string; note?: string }>

function loadMeta(dir: string): MetaFile {
  const file = path.join(dir, META_FILE)
  if (!existsSync(file)) return {}
  return JSON.parse(readFileSync(file, 'utf8')) as MetaFile
}

function titleFromName(name: string): string {
  const base = path.basename(name, path.extname(name)).replace(/^f\d+-/, '')
  return base.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Walks a folder and returns every folio with its size and SHA-256, in stable order. */
export async function scanFolios(dir: string, prefix = 'folios'): Promise<FolioEntry[]> {
  const meta = loadMeta(dir)
  const out: FolioEntry[] = []
  async function walk(rel: string): Promise<void> {
    const entries = await readdir(path.join(dir, rel), { withFileTypes: true })
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const relPath = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        await walk(relPath)
        continue
      }
      if (!entry.isFile() || entry.name === META_FILE || entry.name.startsWith('.')) continue
      const abs = path.join(dir, ...relPath.split('/'))
      const data = await readFile(abs)
      const mime = mimeFor(entry.name)
      const m = meta[relPath] ?? meta[entry.name] ?? {}
      const folio: FolioEntry = {
        path: `${prefix}/${relPath}`,
        title: m.title ?? titleFromName(entry.name),
        mime,
        size: (await stat(abs)).size,
        sha256: sha256Hex(data),
        kind: kindFor(mime),
      }
      if (m.note) folio.note = m.note
      out.push(folio)
    }
  }
  await walk('')
  return out
}

export function totalBytes(folios: FolioEntry[]): number {
  return folios.reduce((sum, f) => sum + f.size, 0)
}
