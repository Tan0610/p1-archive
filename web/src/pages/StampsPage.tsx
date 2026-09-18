import { useState } from 'react'
import { api } from '../api'
import { Note } from '../components/Bits'
import { formatBytes, formatDate, short, tilt } from '../format'
import type { BatchSummary, Status } from '../types'

export function StampsPage({ status, onChanged }: { status: Status | null; onChanged: () => Promise<void> }) {
  const batches = status?.batches ?? []
  return (
    <div className="leaf-grid">
      <div className="content">
        <h1>Stamps are rent, with an end date</h1>
        <p className="lede">
          Swarm stores data for as long as a postage batch is paid for. Every figure below comes from your node, which estimates how long each batch lasts at
          today’s storage price. When a batch runs out, nodes may delete what it paid for.
        </p>

        <div className="section">
          <h2>Your batches</h2>
          {batches.length === 0 ? (
            <div className="box dashed">
              <p style={{ margin: 0 }}>
                {status?.node.reachable ? 'No batches yet. Buy one below to start the clock.' : 'Your node isn’t answering, so we can’t list batches.'}
              </p>
            </div>
          ) : (
            <ul className="batches">
              {batches.map((b, i) => (
                <BatchRow key={b.batchId} batch={b} index={i} onChanged={onChanged} />
              ))}
            </ul>
          )}
        </div>

        <BuyForm disabled={!status?.node.reachable || !status.node.canUpload} onBought={onChanged} />
      </div>

      <aside className="margin" aria-label="Notes">
        <Note ink="cinnabar">“permanent” here means paid until a date. Top up before it comes.</Note>
        <Note ink="lapis">100 MB is the smallest batch and plenty for a handful of folios. Always ask the price first; it moves with the network.</Note>
        <Note ink="soot">the feed updates are stamped too; if the batch lapses, the address goes quiet along with the folios.</Note>
      </aside>
    </div>
  )
}

function BatchRow({ batch, index, onChanged }: { batch: BatchSummary; index: number; onChanged: () => Promise<void> }) {
  const [days, setDays] = useState(7)
  const [quote, setQuote] = useState<string | null>(null)
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const t = batch.term

  return (
    <li className="batch" data-level={t.level} style={{ ['--tilt' as string]: tilt(index) }}>
      <header>
        <h3>{batch.label || 'Unlabelled batch'}</h3>
        <span className="hash" title={batch.batchId}>
          {short(batch.batchId, 8)}
        </span>
      </header>
      <div className="usage" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(batch.usage * 100)} aria-label="Space used">
        <span style={{ width: `${Math.max(2, batch.usage * 100)}%` }} />
      </div>
      <p className="muted" style={{ fontSize: '.98rem' }}>
        {Math.round(batch.usage * 100)}% used, {formatBytes(batch.remainingBytes)} left of {formatBytes(batch.sizeBytes)}.{' '}
        {batch.usable ? '' : 'Not usable yet.'}
      </p>
      <p style={{ margin: '0 0 12px' }}>
        {t.paidUntil ? (
          <>
            Paid until <strong>{formatDate(t.paidUntil)}</strong>, about {t.daysLeft} days from now.
          </>
        ) : (
          'The node did not report how long this batch lasts.'
        )}
      </p>
      <details>
        <summary style={{ cursor: 'pointer' }}>Top up this batch</summary>
        <div className="row" style={{ marginTop: 12 }}>
          <label className="field">
            Add days
            <input
              type="number"
              min={1}
              max={365}
              value={days}
              onChange={(e) => (setDays(Number(e.target.value)), setQuote(null), setAgree(false))}
              style={{ width: 110 }}
            />
          </label>
          <button
            className="btn small quiet"
            disabled={busy}
            onClick={async () => {
              setError(null)
              try {
                setQuote((await api.extendQuote(batch.batchId, days)).costXbzz)
              } catch (e) {
                setError((e as Error).message)
              }
            }}
          >
            What would it cost?
          </button>
        </div>
        {quote && (
          <div style={{ marginTop: 12 }}>
            <label className="check-line">
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
              <span>
                Spend {quote} xBZZ from the node wallet to add {days} days.
              </span>
            </label>
            <button
              className="btn small danger"
              style={{ marginTop: 10 }}
              disabled={!agree || busy}
              onClick={async () => {
                setBusy(true)
                setError(null)
                try {
                  await api.extend(batch.batchId, days)
                  setQuote(null)
                  setAgree(false)
                  await onChanged()
                } catch (e) {
                  setError((e as Error).message)
                } finally {
                  setBusy(false)
                }
              }}
            >
              {busy ? 'Topping up…' : 'Top up'}
            </button>
          </div>
        )}
        {error && <p className="error">{error}</p>}
      </details>
    </li>
  )
}

function BuyForm({ disabled, onBought }: { disabled: boolean; onBought: () => Promise<void> }) {
  const [sizeMb, setSizeMb] = useState(100)
  const [days, setDays] = useState(7)
  const [quote, setQuote] = useState<{ size: string; duration: string; costXbzz: string } | null>(null)
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reset = () => (setQuote(null), setAgree(false))

  return (
    <div className="section">
      <h2>Buy a batch</h2>
      <div className="box">
        <div className="row">
          <label className="field">
            Space
            <select value={sizeMb} onChange={(e) => (setSizeMb(Number(e.target.value)), reset())}>
              <option value={100}>100 MB</option>
              <option value={500}>500 MB</option>
              <option value={1000}>1 GB</option>
              <option value={4000}>4 GB</option>
            </select>
          </label>
          <label className="field">
            Days
            <input type="number" min={1} max={365} value={days} onChange={(e) => (setDays(Number(e.target.value)), reset())} style={{ width: 110 }} />
          </label>
          <button
            className="btn quiet"
            disabled={disabled}
            style={{ alignSelf: 'flex-end' }}
            onClick={async () => {
              setError(null)
              try {
                setQuote(await api.quote(sizeMb, days))
              } catch (e) {
                setError((e as Error).message)
              }
            }}
          >
            What would it cost?
          </button>
        </div>
        {quote && (
          <div style={{ marginTop: 16 }}>
            <p>
              {quote.size} for {quote.duration}: <strong>{quote.costXbzz} xBZZ</strong>, paid from your node’s wallet.
            </p>
            <label className="check-line">
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
              <span>I understand this spends xBZZ and can’t be undone.</span>
            </label>
            <button
              className="btn danger"
              style={{ marginTop: 12 }}
              disabled={!agree || busy}
              onClick={async () => {
                setBusy(true)
                setError(null)
                try {
                  await api.buy(sizeMb, days)
                  reset()
                  await onBought()
                } catch (e) {
                  setError((e as Error).message)
                } finally {
                  setBusy(false)
                }
              }}
            >
              {busy ? 'Buying, and waiting until it is usable…' : 'Buy this batch'}
            </button>
          </div>
        )}
        {disabled && (
          <p className="muted" style={{ margin: '12px 0 0' }}>
            Buying needs a light node that is awake.
          </p>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  )
}
