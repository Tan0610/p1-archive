import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Non-secret configuration for the publishing tool.
 *
 * Secrets are deliberately NOT part of this object: the feed key is read by
 * `signer.ts` straight from the environment or from the gitignored `.secrets/`
 * folder, so it can never end up serialised into a log, an API response or a
 * generated file by accident.
 */
export interface AppConfig {
  /** Repository root (where archive.json / PUBLISHED.md are written). */
  root: string
  /** The publisher's own Bee node. Swarm Desktop exposes it on :1633. */
  beeUrl: string
  /** Public read-only gateway used for verification and as the stranger's default. */
  gatewayUrl: string
  /** Human readable feed topic; hashed with keccak256 into the 32-byte topic. */
  topicString: string
  /** Folder holding the folios to publish. */
  foliosDir: string
  /** Title shown on the archive's own gallery page. */
  title: string
}

export const DEFAULT_BEE_URL = 'http://localhost:1633'
export const DEFAULT_GATEWAY_URL = 'https://api.gateway.ethswarm.org'
export const DEFAULT_TOPIC = 'tsering/himalayan-manuscripts/v1'

export function repoRoot(): string {
  // src/core/config.ts -> repo root, and dist/core/config.js -> repo root
  const here = path.dirname(fileURLToPath(import.meta.url))
  return path.resolve(here, '..', '..')
}

let envLoaded = false

/** Loads `.env` (gitignored) once, if present. Node >= 21.7 ships loadEnvFile. */
export function loadDotEnv(root = repoRoot()): void {
  if (envLoaded) return
  envLoaded = true
  const file = path.join(root, '.env')
  if (existsSync(file)) process.loadEnvFile(file)
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const root = overrides.root ?? repoRoot()
  loadDotEnv(root)
  return {
    root,
    beeUrl: trimSlash(overrides.beeUrl ?? process.env.BEE_URL ?? DEFAULT_BEE_URL),
    gatewayUrl: trimSlash(overrides.gatewayUrl ?? process.env.GATEWAY_URL ?? DEFAULT_GATEWAY_URL),
    topicString: overrides.topicString ?? process.env.FEED_TOPIC ?? DEFAULT_TOPIC,
    foliosDir: path.resolve(root, overrides.foliosDir ?? process.env.FOLIOS_DIR ?? 'samples/folios'),
    title: overrides.title ?? process.env.ARCHIVE_TITLE ?? 'The Spiti Folios — scans by Tsering',
  }
}

export function trimSlash(url: string): string {
  return url.replace(/\/+$/, '')
}
