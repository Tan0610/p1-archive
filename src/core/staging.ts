import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Catalogue } from '../shared/catalogue-schema.js'
import { META_FILE } from './catalogue.js'
import { honestSentence, type StorageTerm } from './ttl.js'

/**
 * Every edition is self-describing. The folder we upload contains:
 *
 *   index.html      the gallery — opens straight from /bzz/<archive address>/
 *   catalogue.json  titles, sizes and SHA-256 of every folio
 *   recover.html    the zero-dependency reader, so the archive carries its own way out
 *   ABOUT.txt       plain-text instructions for a stranger
 *   folios/…        the scans themselves
 *
 * So a stranger with only the address needs no app at all.
 */
export interface StageInput {
  root: string
  foliosDir: string
  catalogue: Catalogue
  term: StorageTerm
}

export function stagingDir(root: string): string {
  return path.join(root, '.staging', 'edition')
}

export function buildEdition({ root, foliosDir, catalogue, term }: StageInput): string {
  const dir = stagingDir(root)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(path.join(dir, 'folios'), { recursive: true })

  cpSync(foliosDir, path.join(dir, 'folios'), {
    recursive: true,
    filter: (src) => path.basename(src) !== META_FILE && !path.basename(src).startsWith('.'),
  })

  writeFileSync(path.join(dir, 'catalogue.json'), JSON.stringify(catalogue, null, 2) + '\n', 'utf8')

  const gallery = readFileSync(path.join(root, 'templates', 'gallery.html'), 'utf8')
  writeFileSync(path.join(dir, 'index.html'), gallery, 'utf8')

  const reader = path.join(root, 'reader', 'recover.html')
  if (!existsSync(reader)) throw new Error('reader/recover.html is missing — run `npm run build:reader` first.')
  cpSync(reader, path.join(dir, 'recover.html'))

  writeFileSync(path.join(dir, 'ABOUT.txt'), aboutText(catalogue, term), 'utf8')
  return dir
}

function aboutText(c: Catalogue, term: StorageTerm): string {
  return `${c.title}
${'='.repeat(c.title.length)}

${c.description}

${c.folios.length} folios. Every file's SHA-256 is listed in catalogue.json.

HOW TO FIND THE NEWEST EDITION
  This folder is one edition. The archive's permanent address is a feed:
    feed owner : ${c.feed.owner}
    feed topic : ${c.feed.topic}   ("${c.feed.topicString}")
    manifest   : ${c.feed.feedManifest}
  Open  https://<any-swarm-gateway>/bzz/${c.feed.feedManifest}/  for the latest edition,
  or open recover.html in this folder and paste the owner and topic.

HOW LONG IT IS PAID FOR (snapshot when this edition was published)
  ${honestSentence(term)}
`
}
