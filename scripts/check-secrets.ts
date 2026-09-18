/**
 * Fails if anything that looks like a credential is in a file git would commit.
 *
 *   npm run check:secrets
 *
 * Scans every tracked file plus untracked files that are not gitignored, i.e.
 * exactly what `git add -A` would pick up. Looks for:
 *   - the actual feed key (from .secrets/ or FEED_PRIVATE_KEY), anywhere
 *   - 64-hex values assigned to something called key / secret / mnemonic / gift …
 *   - PEM private key blocks
 *   - URLs with a user:password@ part, or ?token= / ?apikey= style query secrets
 *   - mnemonic / seed phrases
 *   - non-empty KEY= / SECRET= / TOKEN= lines in env-style files
 *
 * Bare 64-hex strings are NOT flagged on their own: Swarm references, topics
 * and batch IDs are public and are supposed to be in archive.json.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export interface Finding {
  file: string
  line: number
  rule: string
  excerpt: string
}

const PEM = new RegExp('-----BEGIN ' + '(?:[A-Z]+ )?PRIVATE KEY-----')

const RULES: Array<{ rule: string; re: RegExp }> = [
  {
    rule: 'labelled private key / secret (64 hex)',
    re: /(private[_-]?key|secret|mnemonic|seed|gift[_-]?code|passphrase|api[_-]?key|signer[_-]?key)["'\s]*[:=]\s*["'`]?(0x)?[0-9a-f]{64}(?![0-9a-f])/i,
  },
  { rule: 'PEM private key', re: PEM },
  { rule: 'URL with embedded credentials', re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@'"`<>]+:[^\s/@'"`<>]+@[^\s/'"`<>]+/i },
  { rule: 'secret in URL query', re: /[?&](token|apikey|api_key|access_token|auth|secret|password)=[A-Za-z0-9._~%-]{12,}/i },
  { rule: 'mnemonic / seed phrase', re: /(mnemonic|seed phrase|recovery phrase|secret phrase)\W{1,6}((?:[a-z]{3,8}\s+){11,23}[a-z]{3,8})\b/i },
  { rule: 'gift code', re: /gift[_\s-]?code\W{1,6}(0x)?[0-9a-f]{40,}/i },
]

const ENV_ASSIGN = /^\s*(?:export\s+)?[A-Z0-9_]*(KEY|SECRET|MNEMONIC|TOKEN|PASSWORD|PASSPHRASE|GIFT)[A-Z0-9_]*\s*=\s*["']?[^\s"'#]+/

function isEnvStyle(file: string): boolean {
  const base = path.basename(file)
  return base.startsWith('.env') || base.endsWith('.env')
}

/** Pure: scan one file's text. `known` are real secret values that must never appear. */
export function scanText(text: string, file: string, known: string[] = []): Finding[] {
  const findings: Finding[] = []
  const lines = text.split(/\r?\n/)
  lines.forEach((line, i) => {
    for (const { rule, re } of RULES) {
      if (re.test(line)) findings.push({ file, line: i + 1, rule, excerpt: redact(line) })
    }
    if (isEnvStyle(file) && ENV_ASSIGN.test(line)) findings.push({ file, line: i + 1, rule: 'non-empty secret in env-style file', excerpt: redact(line) })
    for (const secret of known) {
      if (secret.length >= 32 && line.toLowerCase().includes(secret.toLowerCase())) {
        findings.push({ file, line: i + 1, rule: 'the actual feed key', excerpt: redact(line) })
      }
    }
  })
  return findings
}

function redact(line: string): string {
  return line
    .trim()
    .slice(0, 160)
    .replace(/[0-9a-fA-F]{24,}/g, (m) => `${m.slice(0, 4)}…(${m.length} hex)`)
}

function knownSecrets(root: string): string[] {
  const out: string[] = []
  const keyFile = path.join(root, '.secrets', 'feed-key.hex')
  if (existsSync(keyFile)) out.push(readFileSync(keyFile, 'utf8').trim().replace(/^0x/i, ''))
  const envFile = path.join(root, '.env')
  if (existsSync(envFile)) {
    const m = /^\s*FEED_PRIVATE_KEY\s*=\s*["']?(?:0x)?([0-9a-fA-F]{64})/m.exec(readFileSync(envFile, 'utf8'))
    if (m?.[1]) out.push(m[1])
  }
  if (process.env.FEED_PRIVATE_KEY) out.push(process.env.FEED_PRIVATE_KEY.trim().replace(/^0x/i, ''))
  return out.filter(Boolean)
}

export function filesToScan(root: string): string[] {
  const out = execFileSync('git', ['ls-files', '-c', '-o', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' })
  return out.split('\0').filter(Boolean)
}

function main(): void {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const known = knownSecrets(root)
  const findings: Finding[] = []

  // The secret files themselves must be ignored.
  for (const must of ['.env', '.secrets/feed-key.hex']) {
    try {
      execFileSync('git', ['check-ignore', '-q', must], { cwd: root })
    } catch {
      findings.push({ file: '.gitignore', line: 0, rule: `${must} is not gitignored`, excerpt: '' })
    }
  }

  const files = filesToScan(root)
  for (const file of files) {
    const abs = path.join(root, file)
    if (!existsSync(abs) || statSync(abs).size > 5_000_000) continue
    const buf = readFileSync(abs)
    if (buf.includes(0)) continue // binary
    findings.push(...scanText(buf.toString('utf8'), file, known))
  }

  if (findings.length > 0) {
    console.error(`\n✗ ${findings.length} possible secret(s) in files git would commit:\n`)
    for (const f of findings) console.error(`  ${f.file}:${f.line}  ${f.rule}\n      ${f.excerpt}`)
    console.error('\nMove secrets to .env or .secrets/ (both gitignored). Your gift code belongs only in Swarm Desktop.\n')
    process.exit(1)
  }
  console.log(`✓ no secrets in ${files.length} committable files${known.length ? ` (also checked for the real feed key)` : ''}`)
}

const invokedDirectly = process.argv[1] && /check-secrets\.(ts|js)$/.test(process.argv[1])
if (invokedDirectly) main()
