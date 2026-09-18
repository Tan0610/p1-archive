/**
 * The catalogue that travels INSIDE every published edition as `catalogue.json`.
 *
 * It is the stranger's table of contents: every folio's path inside the
 * collection, its title, type, size and SHA-256 — so whoever recovers the
 * archive can prove they got back exactly what Tsering photographed.
 *
 * This file has no Node imports so the recovery tool (and anyone else) can
 * depend on it without pulling in the publisher.
 */
export const CATALOGUE_SCHEMA = 'himalayan-archive/catalogue@1'

export interface FolioEntry {
  /** Path inside the collection, POSIX separators, e.g. "folios/f001-medical-compendium.svg". */
  path: string
  title: string
  mime: string
  size: number
  sha256: string
  kind: 'image' | 'text' | 'other'
  note?: string
}

export interface Catalogue {
  schema: typeof CATALOGUE_SCHEMA
  title: string
  description: string
  publishedAt: string
  /** How to find the LATEST edition: the feed this edition was published behind. */
  feed: {
    owner: string
    topic: string
    topicString: string
    feedManifest: string
  }
  /** Snapshot of the paid storage term at publish time. Live value: ask any Bee node. */
  storage: {
    batchId: string
    ttlSeconds: number | null
    paidUntil: string | null
    asOf: string
    note: string
  }
  folios: FolioEntry[]
}

const HEX64 = /^[0-9a-f]{64}$/i

export type CatalogueCheck = { ok: true; catalogue: Catalogue } | { ok: false; problems: string[] }

/** Defensive validation: a recovered catalogue is untrusted input. */
export function validateCatalogue(value: unknown): CatalogueCheck {
  const problems: string[] = []
  if (typeof value !== 'object' || value === null) return { ok: false, problems: ['catalogue.json is not a JSON object'] }
  const c = value as Record<string, unknown>
  if (c.schema !== CATALOGUE_SCHEMA) problems.push(`unknown schema "${String(c.schema)}" (expected ${CATALOGUE_SCHEMA})`)
  if (!Array.isArray(c.folios)) problems.push('folios is not a list')
  else {
    c.folios.forEach((f: unknown, i: number) => {
      const e = f as Record<string, unknown>
      if (typeof e?.path !== 'string' || e.path.length === 0) problems.push(`folio #${i}: missing path`)
      else if (!isSafeRelativePath(e.path)) problems.push(`folio #${i}: unsafe path "${e.path}"`)
      if (typeof e?.sha256 !== 'string' || !HEX64.test(e.sha256)) problems.push(`folio #${i}: bad sha256`)
      if (typeof e?.size !== 'number' || e.size < 0) problems.push(`folio #${i}: bad size`)
    })
  }
  if (problems.length > 0) return { ok: false, problems }
  return { ok: true, catalogue: value as Catalogue }
}

/** Rejects absolute paths, drive letters, backslashes and any `..` segment. */
export function isSafeRelativePath(p: string): boolean {
  if (p.startsWith('/') || p.includes('\\') || /^[a-zA-Z]:/.test(p) || p.includes('\0')) return false
  return p.split('/').every((seg) => seg !== '..' && seg !== '')
}
