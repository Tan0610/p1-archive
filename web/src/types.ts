// Shapes returned by the local API (src/server/server.ts). Kept separate so the
// browser bundle never imports Node-side code.

export type TermLevel = 'ok' | 'soon' | 'urgent' | 'expired' | 'unknown'

export interface StorageTerm {
  ttlSeconds: number | null
  paidUntil: string | null
  daysLeft: number | null
  asOf: string
  level: TermLevel
  source: 'bee-node' | 'none'
  unknownReason?: string
}

export interface BatchSummary {
  batchId: string
  label: string
  usable: boolean
  depth: number
  immutable: boolean
  usage: number
  sizeBytes: number
  remainingBytes: number
  term: StorageTerm
}

export interface DoctorReport {
  url: string
  reachable: boolean
  ready: boolean
  version: string | null
  apiVersion: string | null
  apiSupported: boolean | null
  mode: string | null
  canUpload: boolean
  wallet: { address: string; xbzz: string; xdai: string } | null
  chequebook: { availableXbzz: string; empty: boolean } | null
  problems: string[]
  hints: string[]
}

export interface ArchiveRecord {
  title: string
  feed: { owner: string; topic: string; topicString: string; type: string }
  address: { feedManifest: string; bzzUrl: string; cid: string }
  latestEdition: { collectionReference: string; publishedAtIndex: string; publishedAt: string; fileCount: number; bytes: number }
  storage: { batchId: string; ttlSecondsAtPublish: number | null; paidUntil: string | null; asOf: string; note: string }
  recover: { cli: string; curl: string; reader: string }
}

export interface Status {
  node: DoctorReport
  batches: BatchSummary[]
  archive: ArchiveRecord | null
  head: { empty: boolean; index: string | null; reference: string | null } | null
  headError: string | null
  signer: { owner: string; source: string } | null
  topicString: string
  topic: string
  gatewayUrl: string
  beeUrl: string
}

export interface Folio {
  path: string
  title: string
  mime: string
  size: number
  sha256: string
  kind: 'image' | 'text' | 'other'
  note?: string
}

export type StepId = 'node' | 'signer' | 'stamp' | 'address' | 'stage' | 'upload' | 'feed' | 'verify' | 'record'

export interface PublishEvent {
  step: StepId
  status: 'start' | 'done' | 'info' | 'warn'
  message: string
  data?: Record<string, unknown>
}

export interface PublishResult {
  dryRun: boolean
  archiveAddress: string | null
  owner: string
  topic: string
  topicString: string
  collectionReference: string | null
  feedIndex: string | null
  firstRun: boolean | null
  fileCount: number
  bytes: number
  term: StorageTerm
  files: string[]
}
