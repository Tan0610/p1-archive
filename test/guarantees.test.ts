/**
 * Guarantees that are easy to break by accident, checked straight from the source.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { scanText } from '../scripts/check-secrets.js'

const ROOT = path.resolve(__dirname, '..')

function sources(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name)
    if (statSync(p).isDirectory()) out.push(...sources(p))
    else if (/\.(ts|tsx|js)$/.test(name)) out.push(p)
  }
  return out
}

describe('recovery depends only on published identifiers', () => {
  it('src/recover imports nothing from the publisher (no config, archive.json, key, staging)', () => {
    for (const file of sources(path.join(ROOT, 'src', 'recover'))) {
      const imports = [...readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)].map((m) => m[1]!)
      for (const spec of imports) {
        const allowed = spec.startsWith('node:') || spec === '@ethersphere/bee-js' || spec === './recover.js' || spec === '../core/catalogue-schema.js'
        expect(allowed, `${path.relative(ROOT, file)} imports ${spec}`).toBe(true)
      }
    }
  })

  it('the stand-alone reader has no imports at all', () => {
    const lib = readFileSync(path.join(ROOT, 'reader', 'swarm-lite.js'), 'utf8')
    expect(lib).not.toMatch(/^\s*import /m)
    expect(lib).not.toMatch(/require\(/)
  })
})

describe('feed writes', () => {
  const src = sources(path.join(ROOT, 'src')).map((f) => [f, readFileSync(f, 'utf8')] as const)

  it('archive contents are never passed to uploadPayload', () => {
    for (const [file, text] of src) expect(text, file).not.toMatch(/\.uploadPayload\(/)
  })

  it('no feed index is ever a literal', () => {
    for (const [file, text] of src) expect(text, file).not.toMatch(/index:\s*(\d|FeedIndex\.fromBigInt\(\d)/)
  })

  it('the feed is written with uploadReference', () => {
    const feed = readFileSync(path.join(ROOT, 'src', 'core', 'feed.ts'), 'utf8')
    expect(feed).toMatch(/writer\.uploadReference\(batchId, collectionReference, \{ index: next \}\)/)
  })
})

describe('secret scanner', () => {
  // Built at runtime so no key-shaped literal ever sits in this file.
  const fakeKey = Array.from({ length: 32 }, (_, i) => ((i * 37 + 11) & 0xff).toString(16).padStart(2, '0')).join('')

  it('catches a labelled private key', () => {
    expect(scanText(`FEED_PRIVATE_KEY=${fakeKey}`, '.env.local')).not.toHaveLength(0)
    expect(scanText(`const privateKey = "0x${fakeKey}"`, 'a.ts')).not.toHaveLength(0)
  })

  it('catches the real key anywhere, even unlabelled', () => {
    expect(scanText(`some text ${fakeKey} more`, 'notes.md', [fakeKey])).not.toHaveLength(0)
  })

  it('catches credentials in URLs', () => {
    // assembled at runtime so this file never contains a credential-shaped URL itself
    const userinfo = ['user', 'not-a-real-password'].join(':')
    const query = ['api', 'key=', 'x'.repeat(20)].join('')
    expect(scanText(`BEE=https://${userinfo}@bee.example.com`, 'README.md')).not.toHaveLength(0)
    expect(scanText(`https://rpc.example.com/?${query}`, 'README.md')).not.toHaveLength(0)
  })

  it('does not flag public Swarm references, topics or empty env placeholders', () => {
    expect(scanText(`"feedManifest": "${fakeKey}"`, 'archive.json')).toHaveLength(0)
    expect(scanText(`topic: ${fakeKey}`, 'PUBLISHED.md')).toHaveLength(0)
    expect(scanText('FEED_PRIVATE_KEY=', '.env.example')).toHaveLength(0)
  })
})
