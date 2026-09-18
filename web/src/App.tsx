import { useCallback, useEffect, useState } from 'react'
import { api } from './api'
import { Lamp } from './components/Lamp'
import { PrayerFlags } from './components/PrayerFlags'
import { AddressPage } from './pages/AddressPage'
import { NodePage } from './pages/NodePage'
import { PublishPage } from './pages/PublishPage'
import { RecoverPage } from './pages/RecoverPage'
import { StampsPage } from './pages/StampsPage'
import type { Status, StepId } from './types'

const PAGES = [
  { id: 'node', title: 'Your node', sub: 'is it awake?' },
  { id: 'stamps', title: 'Stamps', sub: 'the rent' },
  { id: 'publish', title: 'Publish', sub: 'a new edition' },
  { id: 'address', title: 'The address', sub: 'hand it out' },
  { id: 'recover', title: 'Recover', sub: 'as a stranger' },
] as const
type PageId = (typeof PAGES)[number]['id']

function pageFromHash(): PageId {
  const h = window.location.hash.replace('#', '')
  return (PAGES.find((p) => p.id === h)?.id ?? 'node') as PageId
}

export function App() {
  const [page, setPage] = useState<PageId>(pageFromHash)
  const [status, setStatus] = useState<Status | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [flags, setFlags] = useState<{ done: Set<StepId>; failed: boolean }>({ done: new Set(), failed: false })

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.status())
      setStatusError(null)
    } catch (e) {
      setStatusError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const t = setInterval(() => void refresh(), 30_000)
    const onHash = () => setPage(pageFromHash())
    window.addEventListener('hashchange', onHash)
    return () => {
      clearInterval(t)
      window.removeEventListener('hashchange', onHash)
    }
  }, [refresh])

  // The lamp shows the batch behind the published archive, else the longest-lived usable batch.
  const archiveBatch = status?.archive ? status.batches.find((b) => b.batchId === status.archive!.storage.batchId) : undefined
  const bestBatch = archiveBatch ?? [...(status?.batches ?? [])].filter((b) => b.usable).sort((a, b) => (b.term.ttlSeconds ?? 0) - (a.term.ttlSeconds ?? 0))[0]
  const term = status
    ? (bestBatch?.term ?? null)
    : {
        ttlSeconds: null,
        paidUntil: null,
        daysLeft: null,
        asOf: '',
        level: 'unknown' as const,
        source: 'none' as const,
        unknownReason: 'the local server is not answering',
      }

  return (
    <div className="shell">
      <nav className="cord" aria-label="Sections">
        <div className="knot" aria-hidden="true" />
        <ul>
          {PAGES.map((p) => (
            <li key={p.id}>
              <a className="tag" href={`#${p.id}`} aria-current={page === p.id ? 'page' : undefined}>
                {p.title}
                <small>{p.sub}</small>
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="page">
        <div className="top">
          <PrayerFlags done={flags.done} failed={flags.failed} />
          <Lamp term={term} batchLabel={bestBatch?.label} />
        </div>

        {statusError && (
          <div className="box dashed" role="alert" style={{ marginBottom: 24 }}>
            <p className="error">{statusError}</p>
            <p className="muted" style={{ margin: 0 }}>
              In a second terminal: <code>npm run serve</code>. This page will pick it up within 30 seconds, or{' '}
              <button className="btn small quiet" onClick={() => void refresh()}>
                check again
              </button>
            </p>
          </div>
        )}

        <main>
          {page === 'node' && <NodePage status={status} onRefresh={refresh} />}
          {page === 'stamps' && <StampsPage status={status} onChanged={refresh} />}
          {page === 'publish' && <PublishPage status={status} onFlags={setFlags} onPublished={refresh} />}
          {page === 'address' && <AddressPage status={status} />}
          {page === 'recover' && <RecoverPage status={status} />}
        </main>
      </div>
    </div>
  )
}
