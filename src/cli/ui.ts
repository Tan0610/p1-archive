/* Tiny terminal helpers — no dependencies, respects NO_COLOR. */
const useColor = process.stdout.isTTY && !process.env.NO_COLOR

const wrap = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s)

export const c = {
  bold: wrap('1'),
  dim: wrap('2'),
  red: wrap('31'),
  green: wrap('32'),
  yellow: wrap('33'),
  blue: wrap('34'),
  cyan: wrap('36'),
  saffron: wrap('38;5;178'),
  cinnabar: wrap('38;5;160'),
}

export function heading(text: string): void {
  console.log('\n' + c.saffron('༄༅། ') + c.bold(text))
}

export function kv(key: string, value: string): void {
  console.log(`  ${c.dim(key.padEnd(22))} ${value}`)
}

export function plate(label: string, value: string): void {
  const line = '─'.repeat(Math.max(value.length, label.length) + 4)
  console.log(c.saffron(`  ╭${line}╮`))
  console.log(c.saffron('  │  ') + c.dim(label.padEnd(value.length)) + c.saffron('  │'))
  console.log(c.saffron('  │  ') + c.bold(value.padEnd(label.length)) + c.saffron('  │'))
  console.log(c.saffron(`  ╰${line}╯`))
}

export function bar(fraction: number, width = 24): string {
  const f = Math.min(1, Math.max(0, fraction))
  const filled = Math.round(f * width)
  return '▰'.repeat(filled) + '▱'.repeat(width - filled)
}

export function fail(message: string): never {
  console.error('\n' + c.cinnabar('✗ ') + message + '\n')
  process.exit(1)
}
