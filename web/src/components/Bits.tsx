import { useState, type ReactNode } from 'react'
import { groups } from '../format'

/** A handwritten note in the margin. Three hands, three inks — like the medical compendium. */
export function Note({ ink = 'soot', children }: { ink?: 'soot' | 'cinnabar' | 'lapis'; children: ReactNode }) {
  return <p className={`hand ${ink}`}>{children}</p>
}

export function CopyButton({ text, label = 'Copy', className = 'btn small quiet' }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1600)
        })
      }}
    >
      {copied ? 'Copied' : label}
    </button>
  )
}

/** Long hex shown in groups of eight, alternating ink, so humans can compare it. */
export function Hex({ value }: { value: string }) {
  return (
    <span className="addr" aria-label={value}>
      {groups(value).map((g, i) => (
        <span key={i}>
          {g}
          {i < value.length / 8 - 1 ? ' ' : ''}
        </span>
      ))}
    </span>
  )
}

export type SealState = 'wait' | 'reading' | 'ok' | 'bad' | 'missing'

const SEAL_TEXT: Record<SealState, string> = { ok: 'matches', bad: 'does not match', missing: 'missing', reading: 'reading…', wait: 'not checked' }

export function Seal({ state }: { state: SealState }) {
  const cls = state === 'ok' ? '' : state === 'wait' || state === 'reading' ? state : 'bad'
  return (
    <div className={`seal ${cls}`} role="status">
      {SEAL_TEXT[state]}
    </div>
  )
}
