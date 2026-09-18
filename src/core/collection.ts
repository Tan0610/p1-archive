import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import type { Bee, CollectionEntry, Reference } from '@ethersphere/bee-js'

/** ustar stores names in 100 bytes (plus a 155-byte prefix we don't rely on). */
export const MAX_TAR_PATH = 100

/**
 * Builds a bee-js Collection from a folder with POSIX ("/") paths.
 *
 * Why not `bee.collection.uploadFromDirectory`? In bee-js 13.1.0 it builds the
 * manifest paths with `path.join`, which on Windows produces "folios\\f001.svg"
 * — a path no browser or gateway will ever request. We build the list
 * ourselves so the manifest is the same on every OS.
 */
export async function toCollectionEntries(dir: string): Promise<CollectionEntry[]> {
  const out: CollectionEntry[] = []
  async function walk(rel: string[]): Promise<void> {
    const entries = await readdir(path.join(dir, ...rel), { withFileTypes: true })
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const segs = [...rel, entry.name]
      if (entry.isDirectory()) {
        await walk(segs)
      } else if (entry.isFile()) {
        const posix = segs.join('/')
        if (Buffer.byteLength(posix) > MAX_TAR_PATH) {
          throw new Error(`Path too long for the upload archive (${posix.length} > ${MAX_TAR_PATH}): ${posix}`)
        }
        const fsPath = path.join(dir, ...segs)
        out.push({ path: posix, size: (await stat(fsPath)).size, fsPath })
      }
    }
  }
  await walk([])
  return out
}

/**
 * Uploads a whole edition folder as ONE collection (a Mantaray manifest).
 * The returned reference is a snapshot of this edition — it changes every time
 * the contents change, which is exactly why we then put it behind a feed.
 */
export async function uploadCollection(bee: Bee, batchId: string, dir: string): Promise<{ reference: Reference; files: number }> {
  const entries = await toCollectionEntries(dir)
  const result = await bee.collection.upload(batchId, entries, {
    indexDocument: 'index.html',
    errorDocument: 'index.html',
    deferred: false,
  })
  return { reference: result.reference, files: entries.length }
}
