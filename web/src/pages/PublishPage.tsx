import { useEffect, useState } from 'react'
import { api, publishStream } from '../api'
import { Note } from '../components/Bits'
import { formatBytes, short, tilt } from '../format'
import type { Folio, PublishEvent, PublishResult, Status, StepId } from '../types'

type FlagState = { done: Set<StepId>; failed: boolean }

export function PublishPage({ status, onFlags, onPublished }: { status: Status | null; onFlags: (f: FlagState) => void; onPublished: () => Promise<void> }) {
  const [folios, setFolios] = useState<Folio[] | null>(null)
  const [bytes, setBytes] = useState(0)
  const [dir, setDir] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [batchId, setBatchId] = useState('')
  const [agree, setAgree] = useState(false)
  const [running, setRunning] = useState<null | 'dry' | 'real'>(null)
  const [log, setLog] = useState<Array<PublishEvent | { step: 'failure'; status: 'fail'; message: string }>>([])
  const [result, setResult] = useState<PublishResult | null>(null)

  useEffect(() => {
    api
      .folios()
      .then((r) => {
        setFolios(r.folios)
        setBytes(r.bytes)
        setDir(r.dir.split('\\').join('/'))
      })
      .catch((e: Error) => setLoadError(e.message))
  }, [])

  const usable = (status?.batches ?? []).filter((b) => b.usable && b.term.level !== 'expired')
  const canPublish = !!status?.node.reachable && status.node.canUpload && status.node.ready && usable.length > 0

  async function run(dryRun: boolean) {
    setRunning(dryRun ? 'dry' : 'real')
    setLog([])
    setResult(null)
    const done = new Set<StepId>()
    onFlags({ done: new Set(), failed: false })
    await publishStream(
      { dryRun, batchId: batchId || undefined },
      {
        onStep: (e) => {
          if (e.status === 'start') return
          setLog((l) => [...l, e])
          if (e.status !== 'warn' || dryRun) done.add(e.step)
          onFlags({ done: new Set(done), failed: false })
        },
        onResult: (r) => {
          setResult(r)
          if (!dryRun) {
            ;(['node', 'signer', 'stamp', 'address', 'stage', 'upload', 'feed', 'verify', 'record'] as StepId[]).forEach((s) => done.add(s))
            onFlags({ done: new Set(done), failed: false })
          }
        },
        onFailure: (message) => {
          setLog((l) => [...l, { step: 'failure', status: 'fail', message }])
          onFlags({ done: new Set(done), failed: true })
        },
      },
    ).catch((e: Error) => setLog((l) => [...l, { step: 'failure', status: 'fail', message: e.message }]))
    setRunning(null)
    setAgree(false)
    if (!dryRun) await onPublished()
  }

  const images = folios?.filter((f) => f.kind === 'image') ?? []
  const others = folios?.filter((f) => f.kind !== 'image') ?? []

  return (
    <div className="leaf-grid">
      <div className="content">
        <h1>Publish a new edition</h1>
        <p className="lede">
          Everything in <code>{dir ?? 'the folios folder'}</code> is uploaded as one collection, together with a gallery page, a catalogue of checksums, and a
          reader. Then the archive’s feed is moved to point at it. The address you hand out stays the same.
        </p>

        <div className="section">
          <h2>On the desk</h2>
          {loadError && <p className="error">{loadError}</p>}
          {!folios && !loadError && <p className="muted">Counting folios…</p>}
          {folios && (
            <>
              <p className="muted">
                {images.length} leaves and {others.length} notes, {formatBytes(bytes)} in all.
              </p>
              <ul className="folios">
                {images.slice(0, 4).map((f, i) => (
                  <li key={f.path} className="folio" style={{ ['--tilt' as string]: tilt(i) }}>
                    <img src={api.folioUrl(f.path)} alt={`${f.title}. ${f.note ?? ''}`} loading="lazy" width={1200} height={300} />
                    <div className="caption">
                      <strong>{f.title}</strong>
                      <span>{formatBytes(f.size)}</span>
                    </div>
                  </li>
                ))}
              </ul>
              {images.length > 4 && (
                <p className="muted" style={{ marginTop: 14 }}>
                  …and {images.length - 4} more leaves.
                </p>
              )}
              {others.length > 0 && (
                <ul className="notes-strip" style={{ padding: 0, marginTop: 12 }}>
                  {others.map((f, i) => (
                    <li key={f.path} style={{ ['--tilt' as string]: tilt(i + 1) }}>
                      {f.path.split('/').pop()}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        <div className="section">
          <h2>Send it</h2>
          <div className="box">
            <label className="field" style={{ maxWidth: 440 }}>
              Postage batch
              <select value={batchId} onChange={(e) => setBatchId(e.target.value)}>
                <option value="">Pick the best usable batch for me</option>
                {usable.map((b) => (
                  <option key={b.batchId} value={b.batchId}>
                    {b.label || 'unlabelled'} ({short(b.batchId, 4)}), {b.term.daysLeft ?? '?'} days left
                  </option>
                ))}
              </select>
            </label>
            <div className="row" style={{ marginTop: 16 }}>
              <button className="btn quiet" disabled={!!running} onClick={() => void run(true)}>
                {running === 'dry' ? 'Rehearsing…' : 'Rehearse (nothing is uploaded)'}
              </button>
            </div>
            <div style={{ marginTop: 18 }}>
              <label className="check-line">
                <input type="checkbox" checked={agree} disabled={!canPublish} onChange={(e) => setAgree(e.target.checked)} />
                <span>Upload these files and stamp them with the batch. Anyone with the address will be able to read them.</span>
              </label>
              <button className="btn" style={{ marginTop: 12 }} disabled={!canPublish || !agree || !!running} onClick={() => void run(false)}>
                {running === 'real' ? 'Publishing…' : 'Publish new edition'}
              </button>
              {!canPublish && (
                <p className="muted" style={{ margin: '10px 0 0' }}>
                  {!status?.node.reachable
                    ? 'Your node isn’t answering.'
                    : usable.length === 0
                      ? 'You need a usable postage batch first.'
                      : 'Your node isn’t ready to upload yet.'}
                </p>
              )}
            </div>
          </div>

          {log.length > 0 && (
            <ol className="log" aria-live="polite">
              {log.map((e, i) => (
                <li key={i} className={e.status}>
                  <span className="mark" aria-hidden="true">
                    {e.status === 'done' ? '✓' : e.status === 'fail' ? '✕' : e.status === 'warn' ? '!' : 'i'}
                  </span>
                  <span className="msg">{e.message}</span>
                </li>
              ))}
            </ol>
          )}

          {result && (
            <div className={`slip ${result.dryRun ? 'lapis' : 'malachite'}`} style={{ marginTop: 20 }}>
              {result.dryRun ? (
                <p style={{ margin: 0 }}>
                  Rehearsal done. {result.fileCount} files would be uploaded
                  {result.feedIndex !== null ? `, into feed slot ${result.feedIndex}` : ''}. Nothing was spent and no tracked file changed. Preview the gallery
                  with <code>npm run preview:edition</code>.
                </p>
              ) : (
                <p style={{ margin: 0 }}>
                  Published. Feed slot {result.feedIndex} now points at this edition. <a href="#address">See the address to hand out</a>.
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      <aside className="margin" aria-label="Notes">
        <Note ink="soot">the feed index is asked of the network right before each write, never counted locally.</Note>
        <Note ink="lapis">a feed update holds one 32-byte reference, not the folios; they travel as their own collection.</Note>
        <Note ink="cinnabar">rehearse first. It stages the edition so you can open its gallery before paying for anything.</Note>
      </aside>
    </div>
  )
}
