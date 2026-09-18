import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Receipts for things that cost money, kept in the gitignored `.state/` folder.
 *
 * Right now that is one thing: the id of every postage batch this tool buys,
 * written the moment the purchase returns, BEFORE waiting for the batch to
 * become usable. If that wait times out or the terminal is closed, the paid-for
 * batch is not lost: its id is here (and was printed).
 *
 * Nothing in here is ever used for feed indexes. Those always come from the
 * network immediately before a write (src/core/feed.ts resolveNextIndex).
 */
export function stateDir(root: string): string {
  return path.join(root, '.state')
}

export function lastBatchFile(root: string): string {
  return path.join(stateDir(root), 'last-batch.txt')
}

export interface BoughtBatch {
  batchId: string
  sizeMb: number
  days: number
  boughtAt: string
}

/** Writes `.state/last-batch.txt` (the id alone) and appends to `.state/bought-batches.jsonl`. Returns the first path. */
export function saveBoughtBatch(root: string, batch: BoughtBatch): string {
  mkdirSync(stateDir(root), { recursive: true })
  const file = lastBatchFile(root)
  writeFileSync(file, batch.batchId + '\n', 'utf8')
  appendFileSync(path.join(stateDir(root), 'bought-batches.jsonl'), JSON.stringify(batch) + '\n', 'utf8')
  return file
}

/** The id of the most recently bought batch, or null. */
export function readLastBatch(root: string): string | null {
  const file = lastBatchFile(root)
  if (!existsSync(file)) return null
  const id = readFileSync(file, 'utf8').trim()
  return /^[0-9a-f]{64}$/i.test(id) ? id : null
}
