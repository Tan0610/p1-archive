export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

/** Splits a long hex string into groups of eight so it can be read aloud or compared by eye. */
export function groups(hex: string, size = 8): string[] {
  const out: string[] = []
  for (let i = 0; i < hex.length; i += size) out.push(hex.slice(i, i + size))
  return out
}

export function short(hex: string, n = 6): string {
  return hex.length > n * 2 + 1 ? `${hex.slice(0, n + 2)}…${hex.slice(-n)}` : hex
}

const TILTS = ['-0.6deg', '0.45deg', '-0.25deg', '0.7deg', '-0.45deg', '0.2deg']
export const tilt = (i: number) => TILTS[i % TILTS.length]!
