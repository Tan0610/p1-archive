import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { CopyButton, Hex, Note } from '../components/Bits'
import { formatDate } from '../format'
import type { Status } from '../types'

export function AddressPage({ status }: { status: Status | null }) {
  const archive = status?.archive
  const [qr, setQr] = useState<string | null>(null)
  // The QR holds the address itself, not a gateway URL: public gateways redirect the gallery's HTML to an approval form.
  const url = archive?.address.feedManifest ?? ''

  useEffect(() => {
    if (!url) return
    QRCode.toDataURL(url, { margin: 0, width: 264, color: { dark: '#2b1d17', light: '#fbf3ea' } })
      .then(setQr)
      .catch(() => setQr(null))
  }, [url])

  if (!archive) {
    return (
      <div className="leaf-grid">
        <div className="content">
          <h1>No address yet</h1>
          <p className="lede">The archive gets its address the first time you publish. After that it never changes, however many new editions you add.</p>
          <a className="btn" href="#publish" style={{ textDecoration: 'none' }}>
            Go to publish
          </a>
        </div>
        <aside className="margin" aria-label="Notes">
          <Note ink="lapis">the address is a feed manifest: fixed owner, fixed topic, moving contents.</Note>
        </aside>
      </div>
    )
  }

  const head = status?.head
  const galleryUrl = `${(status?.beeUrl ?? 'http://localhost:1633').replace(/\/+$/, '')}/bzz/${archive.address.feedManifest}/`
  const recoverCmd = `npm run recover -- ${archive.feed.owner} ${archive.feed.topic}`

  return (
    <div className="leaf-grid">
      <div className="content">
        <h1>The address to hand out</h1>
        <p className="lede">
          Give someone this, and they can get every folio back without this app, this computer or you. Any Swarm gateway serves the newest edition's files; its
          gallery page opens through a Bee node such as Swarm Desktop, since the public gateway holds back HTML for hashes it has not approved.
        </p>

        <div className="plate">
          <div className="plate-grid">
            <div>
              <p className="label">the archive, forever at</p>
              <p className="addr">
                <Hex value={archive.address.feedManifest} />
              </p>
              <div className="row">
                <CopyButton text={archive.address.feedManifest} label="Copy address" className="btn small" />
                <a className="btn small quiet" href={galleryUrl} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
                  Open the gallery on your node
                </a>
                <a
                  className="btn small quiet"
                  href={`${archive.address.bzzUrl}catalogue.json`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ textDecoration: 'none' }}
                >
                  Catalogue on the public gateway
                </a>
              </div>
            </div>
            {qr && (
              <div className="qr">
                <img src={qr} alt="QR code for the archive address" />
              </div>
            )}
          </div>
        </div>
        <p className="muted" style={{ fontSize: '.95rem' }}>
          Also known as <span className="hash">{archive.address.cid}</span>
        </p>

        <div className="section">
          <h2>Or go to the feed yourself</h2>
          <div className="slip lapis">
            <dl className="ledger">
              <dt>Feed owner</dt>
              <dd className="hash">
                {archive.feed.owner} <CopyButton text={archive.feed.owner} />
              </dd>
              <dt>Feed topic</dt>
              <dd className="hash">
                {archive.feed.topic} <CopyButton text={archive.feed.topic} />
              </dd>
              <dt>Topic text</dt>
              <dd>{archive.feed.topicString}</dd>
              <dt>Newest edition</dt>
              <dd>
                {head === null || head === undefined
                  ? 'unknown (node not answering)'
                  : head.empty
                    ? 'none yet'
                    : `feed slot ${head.index}, read from the network just now`}
              </dd>
            </dl>
          </div>
          <p style={{ marginTop: 16 }}>Recover everything from the command line, with nothing but these two values:</p>
          <pre className="box" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'var(--mono)', fontSize: '.85rem', margin: 0 }}>
            {recoverCmd}
          </pre>
          <div className="row" style={{ marginTop: 10 }}>
            <CopyButton text={recoverCmd} label="Copy command" />
            <a href="#recover">Try it here as a stranger</a>
          </div>
        </div>

        <div className="section">
          <h2>Where this is written down</h2>
          <p>
            <code>archive.json</code> and <code>PUBLISHED.md</code> in the repository hold these same public values. Commit them. The feed key is not in either,
            and never will be. Last edition published {formatDate(archive.latestEdition.publishedAt)}.
          </p>
        </div>
      </div>

      <aside className="margin" aria-label="Notes">
        <Note ink="cinnabar">a hash is not an address: change one folio and it changes. The feed is what stays put.</Note>
        <Note ink="soot">the folio list comes from the catalogue inside each edition, not from anything on this computer.</Note>
        <Note ink="lapis">print the QR and tape it inside the vault door.</Note>
      </aside>
    </div>
  )
}
