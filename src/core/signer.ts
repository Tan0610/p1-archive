import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { EthAddress, PrivateKey } from '@ethersphere/bee-js'

/**
 * The feed signer is the ONLY secret this tool owns.
 *
 *  - It is read from the FEED_PRIVATE_KEY environment variable (put it in the
 *    gitignored `.env`), or
 *  - from `.secrets/feed-key.hex` (gitignored, created with mode 0600 on the
 *    first real publish).
 *
 * It is never written into archive.json, PUBLISHED.md, logs, or anything the
 * web UI receives. Only its public address — the feed "owner" — is published.
 *
 * Your Swarm gift code is a different thing entirely: it belongs in Swarm
 * Desktop and nowhere in this repository.
 */
export type SignerSource = 'env' | 'file' | 'created' | 'ephemeral'

export interface FeedSigner {
  key: PrivateKey
  owner: EthAddress
  source: SignerSource
  /** Only set when source is file/created. */
  keyFile?: string
}

export const SECRETS_DIR = '.secrets'
export const KEY_FILE = 'feed-key.hex'

export function keyFilePath(root: string): string {
  return path.join(root, SECRETS_DIR, KEY_FILE)
}

function fromHex(hex: string, source: SignerSource, keyFile?: string): FeedSigner {
  const clean = hex.trim().replace(/^0x/i, '')
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) {
    throw new Error(`The feed key from ${source === 'env' ? 'FEED_PRIVATE_KEY' : keyFile} is not 64 hex characters.`)
  }
  const key = new PrivateKey(clean)
  const signer: FeedSigner = { key, owner: key.publicKey().address(), source }
  if (keyFile) signer.keyFile = keyFile
  return signer
}

/** Returns the existing signer, or null if none is configured. Never creates one. */
export function loadFeedSigner(root: string): FeedSigner | null {
  const envKey = process.env.FEED_PRIVATE_KEY
  if (envKey && envKey.trim() !== '') return fromHex(envKey, 'env')
  const file = keyFilePath(root)
  if (existsSync(file)) return fromHex(readFileSync(file, 'utf8'), 'file', file)
  return null
}

/** Used by real publishes: load, or generate once into the gitignored .secrets folder. */
export function loadOrCreateFeedSigner(root: string): FeedSigner {
  const existing = loadFeedSigner(root)
  if (existing) return existing
  const file = keyFilePath(root)
  mkdirSync(path.dirname(file), { recursive: true })
  const hex = randomBytes(32).toString('hex')
  writeFileSync(file, hex + '\n', { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  return { ...fromHex(hex, 'file', file), source: 'created' }
}

/** A throwaway key that lives only in memory — used by `publish --dry-run`. */
export function ephemeralSigner(): FeedSigner {
  const key = new PrivateKey(randomBytes(32))
  return { key, owner: key.publicKey().address(), source: 'ephemeral' }
}
