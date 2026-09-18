import type { StorageTerm } from '../types'
import { formatDate } from '../format'

/**
 * A butter lamp whose flame is the paid storage left. It is only ever lit by a
 * number the Bee node gave us; when we don't know, the lamp is unlit and says so.
 */
export function Lamp({ term, batchLabel }: { term: StorageTerm | null; batchLabel?: string }) {
  const known = term && term.level !== 'unknown' && term.daysLeft !== null && term.paidUntil
  const days = known ? term.daysLeft! : 0
  const flame = known ? Math.max(0.2, Math.min(1, days / 60)) : 0
  const level = term?.level ?? 'unknown'

  let headline: string
  let detail: string
  if (!term) {
    headline = 'Not paid for yet'
    detail = 'Buy a postage batch to start the clock.'
  } else if (!known) {
    headline = 'Paid-until unknown'
    detail = term.unknownReason ? `${capitalise(term.unknownReason)}.` : 'The node did not say, so we won’t guess.'
  } else if (level === 'expired') {
    headline = 'The oil has run out'
    detail = 'This batch has expired. Nodes may already be dropping the folios.'
  } else {
    headline = `Paid until ${formatDate(term.paidUntil!)}`
    detail = `About ${days} day${days === 1 ? '' : 's'} left, by the node’s estimate${batchLabel ? ` for “${batchLabel}”` : ''}.`
  }

  return (
    <div className={`lamp ${level}`} role="status" aria-live="polite">
      <svg viewBox="0 0 54 64" width="54" height="64" aria-hidden="true">
        {flame > 0 && (
          <g className="flame" style={{ transform: `scaleY(${flame})` }}>
            <path d="M27 6 C35 20 36 28 27 34 C18 28 19 20 27 6Z" fill="#e2a93b" />
            <path d="M27 16 C31 24 31 29 27 32 C23 29 23 24 27 16Z" fill="#fbf3ea" />
          </g>
        )}
        <path d="M27 34 v4" stroke="#2b1d17" strokeWidth="2" strokeLinecap="round" />
        <path d="M8 38 h38 c-2 9 -9 13 -19 13 s-17 -4 -19 -13Z" fill={level === 'expired' ? '#5d463b' : '#c8923a'} stroke="#2b1d17" strokeWidth="1.5" />
        <path d="M22 51 h10 l2 6 h-14Z" fill="#c8923a" stroke="#2b1d17" strokeWidth="1.5" />
        <path d="M14 58 h26" stroke="#2b1d17" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
      <p>
        <strong>{headline}</strong>
        {detail}
      </p>
    </div>
  )
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
