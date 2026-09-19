import { useState } from 'react'
import {
  bytesToHex,
  bzzUrl,
  DEFAULT_GATEWAY,
  fetchBzz,
  fetchCatalogue,
  findLatestIndex,
  normalizeOwner,
  normalizeTopic,
  readFeedUpdate,
  sha256Hex,
  type LiteCatalogue,
} from '../../../reader/swarm-lite.js'
import { Note, Seal } from '../components/Bits'
import { formatBytes, formatDate, tilt } from '../format'
import type { Status } from '../types'

type Bead = 'probe' | 'yes' | 'no'
type SealState = 'wait' | 'ok' | 'bad' | 'missing'

/**
 * Recovery as a stranger would do it: this screen uses the same zero-dependency
 * reader as reader/recover.html and talks straight to a public gateway. It does
 * not ask the local server for anything — only what you type goes in.
 */
export function RecoverPage({ status }: { status: Status | null }) {
  const [mode, setMode] = useState<'address' | 'feed'>('address')
  const [address, setAddress] = useState('')
  const [owner, setOwner] = useState('')
  const [topic, setTopic] = useState('')
  const [gateway, setGateway] = useState(DEFAULT_GATEWAY)
  const [beads, setBeads] = useState<Bead[]>([])
  const [message, setMessage] = useState<{ text: string; bad?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  /** `index` is null when the gateway followed the feed for us (address mode). */
  const [found, setFound] = useState<{ reference: string; index: bigint | null; catalogue: LiteCatalogue } | null>(null)
  const [seals, setSeals] = useState<Record<string, SealState>>({})

  async function find(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setFound(null)
    setSeals({})
    setBeads([])
    const gw = gateway.trim().replace(/\/+$/, '')
    try {
      if (mode === 'address') {
        const ref = address.trim().replace(/^0x/i, '')
        if (!/^[0-9a-f]{64}$/i.test(ref)) throw new Error('An archive address is 64 hex characters.')
        setMessage({ text: 'Opening the address; the gateway follows the feed to the newest edition…' })
        const catalogue = await fetchCatalogue(gw, ref)
        setFound({ reference: ref, index: null, catalogue })
        setMessage({ text: `The address opens the edition published ${formatDate(catalogue.publishedAt)}. ${catalogue.folios.length} files listed.` })
        return
      }
      setMessage({ text: 'Asking the network which feed updates exist…' })
      const o = normalizeOwner(owner)
      const t = normalizeTopic(topic)
      const probed: bigint[] = []
      const latest = await findLatestIndex(gw, t, o, {
        onProbe: (i) => {
          probed.push(i)
          setBeads((b) => [...b, 'probe'])
        },
      })
      setBeads(probed.map((i) => (latest >= 0n && i <= latest ? 'yes' : 'no')))
      if (latest < 0n) {
        setMessage({ text: 'This feed has no updates yet. Nothing has been published under this owner and topic.', bad: true })
        return
      }
      const update = await readFeedUpdate(gw, t, o, latest)
      if (!update) throw new Error('The newest update vanished between two requests. Try again.')
      const catalogue = await fetchCatalogue(gw, update.reference)
      setFound({ reference: update.reference, index: latest, catalogue })
      setMessage({
        text: `Newest edition is feed update ${latest}, written ${new Date(update.timestamp * 1000).toLocaleString()}. ${catalogue.folios.length} files listed.`,
      })
    } catch (err) {
      const m = (err as Error).message
      setMessage({
        text: /Failed to fetch|NetworkError/i.test(m) ? 'That gateway could not be reached from this browser. Check the address or try another gateway.' : m,
        bad: true,
      })
    } finally {
      setBusy(false)
    }
  }

  async function verifyAll() {
    if (!found) return
    const gw = gateway.trim().replace(/\/+$/, '')
    for (const f of found.catalogue.folios) {
      try {
        const bytes = await fetchBzz(gw, found.reference, f.path)
        const sum = await sha256Hex(bytes)
        setSeals((s) => ({ ...s, [f.path]: sum === f.sha256 ? 'ok' : 'bad' }))
      } catch {
        setSeals((s) => ({ ...s, [f.path]: 'missing' }))
      }
    }
  }

  const ok = Object.values(seals).filter((s) => s === 'ok').length

  return (
    <div className="leaf-grid">
      <div className="content">
        <h1>Get it back, as a stranger</h1>
        <p className="lede">
          Pretend the app is deleted. Type the one address someone handed you, or the feed owner and topic behind it. This page finds the newest edition and
          checks every file, using only a public gateway.
        </p>

        <form className="box section" onSubmit={find}>
          <div style={{ display: 'grid', gap: 14 }}>
            <fieldset className="given">
              <legend>What were you handed?</legend>
              <label>
                <input type="radio" name="given" checked={mode === 'address'} onChange={() => setMode('address')} />
                <span>one address</span>
              </label>
              <label>
                <input type="radio" name="given" checked={mode === 'feed'} onChange={() => setMode('feed')} />
                <span>an owner and a topic</span>
              </label>
            </fieldset>
            {mode === 'address' ? (
              <label className="field">
                Archive address <small>the feed manifest, 64 hex characters</small>
                <input className="mono" value={address} onChange={(e) => setAddress(e.target.value)} spellCheck={false} required />
              </label>
            ) : (
              <>
                <label className="field">
                  Feed owner <small>0x followed by 40 hex characters</small>
                  <input className="mono" value={owner} onChange={(e) => setOwner(e.target.value)} spellCheck={false} placeholder="0x…" required />
                </label>
                <label className="field">
                  Feed topic <small>64 hex characters, or the topic text</small>
                  <input className="mono" value={topic} onChange={(e) => setTopic(e.target.value)} spellCheck={false} required />
                </label>
              </>
            )}
            <label className="field">
              Gateway <small>any Bee node or public gateway</small>
              <input className="mono" value={gateway} onChange={(e) => setGateway(e.target.value)} spellCheck={false} />
            </label>
          </div>
          <div className="row" style={{ marginTop: 16 }}>
            <button className="btn" type="submit" disabled={busy}>
              {busy ? 'Looking…' : 'Find the newest edition'}
            </button>
            {status?.archive && (
              <button
                type="button"
                className="btn small quiet"
                onClick={() => {
                  setAddress(status.archive!.address.feedManifest)
                  setOwner(status.archive!.feed.owner)
                  setTopic(status.archive!.feed.topic)
                }}
              >
                Paste this archive’s published values
              </button>
            )}
          </div>
          <div className="mala" aria-hidden="true">
            {beads.map((b, i) => (
              <span key={i} className={`bead ${b === 'probe' ? '' : b}`} />
            ))}
          </div>
          {message && (
            <p role="status" className={message.bad ? 'error' : 'muted'} style={{ margin: 0 }}>
              {message.text}
            </p>
          )}
        </form>

        {found && (
          <div className="section">
            <h2>{found.catalogue.title}</h2>
            <p className="muted">
              Published {formatDate(found.catalogue.publishedAt)}.{' '}
              {found.catalogue.storage.paidUntil
                ? `Its storage was paid until about ${formatDate(found.catalogue.storage.paidUntil)} when it was published.`
                : 'How long it was paid for was not recorded.'}
            </p>
            <div className="row">
              <button className="btn" onClick={() => void verifyAll()}>
                Download and check every file
              </button>
              <span className="hand lapis" aria-live="polite">
                {Object.keys(seals).length > 0 ? `${ok} of ${found.catalogue.folios.length} match` : ''}
              </span>
            </div>
            <ul className="recovered">
              {found.catalogue.folios.map((f, i) => (
                <li key={f.path} style={{ ['--tilt' as string]: tilt(i) }}>
                  {f.kind === 'image' ? (
                    <img src={bzzUrl(gateway, found.reference, f.path)} alt={f.title} loading="lazy" />
                  ) : (
                    <span className="thumbless">a written note</span>
                  )}
                  <div>
                    <strong>{f.title}</strong>
                    <div className="muted" style={{ fontSize: '.92rem' }}>
                      {formatBytes(f.size)}
                    </div>
                    <div className="hash">sha256 {f.sha256}</div>
                  </div>
                  <Seal state={seals[f.path] ?? 'wait'} />
                </li>
              ))}
            </ul>
            <p className="hash" style={{ marginTop: 16 }}>
              {found.index === null
                ? `archive address ${found.reference}, feed owner ${found.catalogue.feed.owner}, topic ${found.catalogue.feed.topic}`
                : `edition reference ${found.reference}, feed update ${found.index.toString()}, owner ${bytesToHex(normalizeOwner(owner))}`}
            </p>
          </div>
        )}
      </div>

      <aside className="margin" aria-label="Notes">
        <Note ink="lapis">given an owner and topic, each bead is one question to the network: does update number i exist?</Note>
        <Note ink="soot">this screen uses the same reader as recover.html, which ships inside every edition.</Note>
        <Note ink="cinnabar">new editions can take a few minutes to reach the public gateway.</Note>
      </aside>
    </div>
  )
}
