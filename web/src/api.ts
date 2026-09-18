import type { BatchSummary, Folio, PublishEvent, PublishResult, Status } from './types'

// Any request that changes something carries this header. The local server
// refuses writes without it, so another website can't trigger them.
const WRITE_HEADERS = { 'content-type': 'application/json', 'x-archive-client': '1' }

async function readJson<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(body.error ?? `The local server answered ${res.status}`)
  return body
}

async function get<T>(url: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(url)
  } catch {
    throw new Error('The local archive server is not running. Start it with: npm run serve')
  }
  return readJson<T>(res)
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: WRITE_HEADERS, body: JSON.stringify(body) })
  return readJson<T>(res)
}

export const api = {
  status: () => get<Status>('/api/status'),
  folios: () => get<{ dir: string; folios: Folio[]; bytes: number }>('/api/folios'),
  folioUrl: (path: string) => `/api/folio-file?path=${encodeURIComponent(path)}`,
  quote: (sizeMb: number, days: number) => post<{ size: string; duration: string; costXbzz: string }>('/api/quote', { sizeMb, days }),
  buy: (sizeMb: number, days: number) => post<BatchSummary>('/api/buy', { sizeMb, days, confirm: true }),
  extendQuote: (batchId: string, days: number) => post<{ costXbzz: string }>('/api/extend-quote', { batchId, days }),
  extend: (batchId: string, days: number) => post<BatchSummary>('/api/extend', { batchId, days, confirm: true }),
}

export interface PublishHandlers {
  onStep: (e: PublishEvent) => void
  onResult: (r: PublishResult) => void
  onFailure: (message: string) => void
}

/** Streams server-sent events from POST /api/publish. */
export async function publishStream(opts: { dryRun: boolean; batchId?: string }, h: PublishHandlers): Promise<void> {
  const res = await fetch('/api/publish', {
    method: 'POST',
    headers: WRITE_HEADERS,
    body: JSON.stringify({ dryRun: opts.dryRun, batchId: opts.batchId, confirm: !opts.dryRun }),
  })
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    h.onFailure(body.error ?? `The local server answered ${res.status}`)
    return
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += value
    let cut: number
    while ((cut = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, cut)
      buffer = buffer.slice(cut + 2)
      const event = /^event: (.*)$/m.exec(block)?.[1]
      const data = /^data: (.*)$/m.exec(block)?.[1]
      if (!event || !data) continue
      const parsed: unknown = JSON.parse(data)
      if (event === 'step') h.onStep(parsed as PublishEvent)
      else if (event === 'result') h.onResult(parsed as PublishResult)
      else if (event === 'failure') h.onFailure((parsed as { message: string }).message)
    }
  }
}
