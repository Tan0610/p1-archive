import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { isSafeRelativePath, validateCatalogue } from '../src/core/catalogue-schema.js'
import { scanFolios } from '../src/core/catalogue.js'
import { toCollectionEntries } from '../src/core/collection.js'

const SAMPLES = path.resolve(__dirname, '..', 'samples', 'folios')

describe('collection entries', () => {
  it('uses forward slashes for nested paths on every OS', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'archive-'))
    mkdirSync(path.join(dir, 'folios', 'notes'), { recursive: true })
    writeFileSync(path.join(dir, 'index.html'), '<p>hi</p>')
    writeFileSync(path.join(dir, 'folios', 'notes', 'a.txt'), 'note')
    const entries = await toCollectionEntries(dir)
    expect(entries.map((e) => e.path).sort()).toEqual(['folios/notes/a.txt', 'index.html'])
    expect(entries.every((e) => !e.path.includes('\\'))).toBe(true)
    expect(entries.find((e) => e.path === 'index.html')?.size).toBe(9)
  })

  it('refuses paths too long for the upload archive', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'archive-'))
    writeFileSync(path.join(dir, 'x'.repeat(101)), '')
    await expect(toCollectionEntries(dir)).rejects.toThrow(/Path too long/)
  })
})

describe('catalogue', () => {
  it('lists every sample folio with its real SHA-256', async () => {
    const folios = await scanFolios(SAMPLES)
    expect(folios.length).toBe(16)
    const first = folios.find((f) => f.path === 'folios/f001-medical-compendium-12r.svg')!
    const bytes = readFileSync(path.join(SAMPLES, 'f001-medical-compendium-12r.svg'))
    expect(first.sha256).toBe(createHash('sha256').update(bytes).digest('hex'))
    expect(first.mime).toBe('image/svg+xml')
    expect(first.title).toBe('Medical compendium, folio 12 recto')
    expect(folios.some((f) => f.path === 'folios/notes/f001-medical-compendium-12r.txt' && f.kind === 'text')).toBe(true)
  })

  it('every sample folio is bigger than one 4 KB chunk (so it cannot live in a feed update)', async () => {
    const images = (await scanFolios(SAMPLES)).filter((f) => f.kind === 'image')
    expect(images.every((f) => f.size > 4096)).toBe(true)
  })

  it('treats a recovered catalogue as untrusted input', () => {
    const good = { schema: 'himalayan-archive/catalogue@1', folios: [{ path: 'folios/a.svg', sha256: 'a'.repeat(64), size: 1 }] }
    expect(validateCatalogue(good).ok).toBe(true)
    const evil = { schema: 'himalayan-archive/catalogue@1', folios: [{ path: '../../etc/passwd', sha256: 'a'.repeat(64), size: 1 }] }
    const r = validateCatalogue(evil)
    expect(r.ok).toBe(false)
    expect(isSafeRelativePath('C:/Windows')).toBe(false)
    expect(isSafeRelativePath('folios\\a.svg')).toBe(false)
    expect(isSafeRelativePath('folios/notes/a.txt')).toBe(true)
  })
})
