import { Note } from '../components/Bits'
import type { Status } from '../types'

export function NodePage({ status, onRefresh }: { status: Status | null; onRefresh: () => Promise<void> }) {
  const node = status?.node
  let verdict: { cls: string; text: string }
  if (!node) verdict = { cls: 'wait', text: 'Looking for your node…' }
  else if (!node.reachable) verdict = { cls: 'bad', text: `Nothing answered at ${node.url}.` }
  else if (node.mode === 'ultra-light') verdict = { cls: 'bad', text: 'Your node is awake, but only in ultra-light mode.' }
  else if (!node.ready) verdict = { cls: 'wait', text: 'Your node is awake and still catching up with the chain.' }
  else verdict = { cls: '', text: `Your node is awake and in ${node.mode} mode.` }

  return (
    <div className="leaf-grid">
      <div className="content">
        <span className="tibetan" aria-hidden="true">
          ༄༅།
        </span>
        <h1>Eight hundred winters, one lapsed invoice</h1>
        <p className="lede">
          The folios survived eight centuries in a cold stone room. The scans nearly died in six years because one cloud account stopped being paid for. This
          desk puts them on Swarm behind one address that never changes, and tells you plainly how long that storage is paid for.
        </p>

        <p className={`verdict ${verdict.cls}`} role="status">
          <span className="dot" aria-hidden="true" />
          {verdict.text}
        </p>

        {node && (
          <div className="slip lapis">
            <dl className="ledger">
              <dt>Endpoint</dt>
              <dd>{node.url}</dd>
              <dt>Bee</dt>
              <dd>{node.version ? `${node.version} (API ${node.apiVersion})` : 'unknown'}</dd>
              <dt>Mode</dt>
              <dd>{node.mode ?? 'unknown'}</dd>
              <dt>Ready</dt>
              <dd>{node.ready ? 'yes' : 'not yet'}</dd>
              {node.wallet && (
                <>
                  <dt>Node wallet</dt>
                  <dd className="hash">{node.wallet.address}</dd>
                  <dt>Balance</dt>
                  <dd>
                    {node.wallet.xbzz} xBZZ, {node.wallet.xdai} xDAI
                  </dd>
                </>
              )}
            </dl>
          </div>
        )}

        {node && (node.problems.length > 0 || node.hints.length > 0) && (
          <div className="section">
            <h2>What to do</h2>
            <ul>
              {node.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
              {node.hints.map((h) => (
                <li key={h} className="muted">
                  {h}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="row section">
          <button className="btn quiet" onClick={() => void onRefresh()}>
            Check again
          </button>
          {node?.reachable && node.canUpload && node.ready && (
            <a className="btn" href="#stamps" style={{ textDecoration: 'none' }}>
              Look at stamps
            </a>
          )}
        </div>
      </div>

      <aside className="margin" aria-label="Notes">
        <Note ink="lapis">ultra-light nodes can only download. Redeeming the gift code in Swarm Desktop is what makes it light.</Note>
        <Note ink="cinnabar">the gift code lives in Swarm Desktop. Never in this repo, never in a screenshot.</Note>
        <Note ink="soot">the browser never talks to Bee directly; the local server does, and keeps the feed key to itself.</Note>
      </aside>
    </div>
  )
}
