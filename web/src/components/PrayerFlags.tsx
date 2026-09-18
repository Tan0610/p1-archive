import type { StepId } from '../types'

/**
 * Five prayer flags strung across the top of the page. While a publish runs,
 * each goes up (colour + one flutter) as its part of the work finishes:
 *   blue: node + signer · white: stamp + address · red: edition + upload
 *   green: feed update · yellow: read back + record
 */
export const FLAG_STEPS: StepId[][] = [['node', 'signer'], ['stamp', 'address'], ['stage', 'upload'], ['feed'], ['verify', 'record']]
const COLOURS = ['#2b4c9b', '#fbf3ea', '#b8322a', '#3f7f5e', '#e2a93b']
const NAMES = ['node and signer', 'stamp and address', 'edition uploaded', 'feed updated', 'read back and recorded']

export function PrayerFlags({ done, failed }: { done: Set<StepId>; failed: boolean }) {
  const up = FLAG_STEPS.map((steps) => steps.every((s) => done.has(s)))
  const count = up.filter(Boolean).length
  return (
    <div className="flags">
      <svg
        viewBox="0 0 600 70"
        preserveAspectRatio="none"
        role="img"
        aria-label={`Publishing progress: ${count} of 5 flags up${failed ? ', stopped by an error' : ''}`}
      >
        <path d="M0 8 Q300 34 600 6" fill="none" stroke="#7a3b27" strokeWidth="2" />
        {COLOURS.map((colour, i) => {
          const x = 70 + i * 110
          // the string is the quadratic curve above; hang each flag where it crosses the string
          const t = (x + 28) / 600
          const y = (1 - t) ** 2 * 8 + 2 * t * (1 - t) * 34 + t ** 2 * 6 - 1
          return (
            <g key={colour}>
              <title>{NAMES[i]}</title>
              <path
                className={`flag ${up[i] ? 'up' : ''}`}
                d={`M${x} ${y} h56 l-3 34 l-5 -3 l-6 4 l-6 -4 l-6 4 l-6 -4 l-6 4 l-6 -4 l-6 4 l-6 -3 Z`}
                fill={up[i] ? colour : 'transparent'}
                stroke={up[i] ? '#2b1d17' : failed && !up[i] ? '#b8322a' : '#a88270'}
                strokeWidth="1.3"
                strokeDasharray={up[i] ? undefined : '4 3'}
              />
            </g>
          )
        })}
      </svg>
    </div>
  )
}
