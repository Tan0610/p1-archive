#!/usr/bin/env node
/**
 * Stand-alone recovery entrypoint.
 *
 *   npm run recover -- <owner> <topic> [--bee URL] [--out DIR] [--all-editions]
 *   npm run recover -- --manifest <feed-manifest-or-edition-ref> [--bee URL] [--out DIR]
 *
 * Its ONLY inputs are the published identifiers and a Bee endpoint (default:
 * the public gateway). It reads no .env, no archive.json, no key, no local
 * index — delete everything else in this repo and it still works.
 */
import path from 'node:path'
import { parseArgs } from 'node:util'
import { PUBLIC_GATEWAY, recover, type RecoverInput } from './recover.js'

const USAGE = `usage:
  recover <owner> <topic> [--bee URL] [--out DIR] [--all-editions]
  recover --manifest <ref> [--bee URL] [--out DIR]

  <owner>  feed owner address (0x…)
  <topic>  feed topic: 64 hex chars, or the topic text (it is keccak256-hashed)
  --bee    any Bee node or gateway (default ${PUBLIC_GATEWAY})`

export async function runRecoverCli(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      bee: { type: 'string', default: PUBLIC_GATEWAY },
      out: { type: 'string', default: 'recovered' },
      manifest: { type: 'string' },
      owner: { type: 'string' },
      topic: { type: 'string' },
      'all-editions': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  })
  if (values.help) {
    console.log(USAGE)
    return 0
  }
  let input: RecoverInput
  if (values.manifest) input = { kind: 'manifest', reference: values.manifest }
  else {
    const owner = positionals[0] ?? values.owner
    const topic = positionals[1] ?? values.topic
    if (!owner || !topic) {
      console.error(USAGE)
      return 64
    }
    input = { kind: 'feed', owner, topic }
  }

  const beeUrl = values.bee!.replace(/\/+$/, '')
  console.log(`\n༄༅། Recovering from ${beeUrl}`)
  console.log(`   inputs: ${input.kind === 'feed' ? `owner ${input.owner}, topic ${input.topic}` : `manifest ${input.reference}`} — nothing else\n`)

  const report = await recover(input, {
    beeUrl,
    outDir: values.out!,
    allEditions: values['all-editions']!,
    onEvent: (m) => console.log('   ' + m),
  })

  if (report.status === 'empty-feed') {
    console.log('\n   The feed has no updates yet — nothing has been published there.')
    return 2
  }
  if (report.editions.length) {
    console.log('\n   editions: ' + report.editions.map((e) => `#${e.index}${e.retrievable ? '' : ' (gone)'}`).join('  '))
  }
  const verified = report.files.filter((f) => f.status === 'verified').length
  console.log(`\n   ${report.status.toUpperCase()}: ${verified}/${report.files.length} files verified by SHA-256`)
  console.log(`   written to ${path.resolve(values.out!)} (see RECOVERY-REPORT.json)`)
  for (const p of report.problems) console.log('   ! ' + p)
  return report.status === 'complete' ? 0 : 1
}

const invokedDirectly = process.argv[1] && /recover[\\/]main\.(ts|js)$/.test(process.argv[1])
if (invokedDirectly) {
  runRecoverCli(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((e: unknown) => {
      console.error('\n✗ ' + (e instanceof Error ? e.message : String(e)))
      process.exit(1)
    })
}
