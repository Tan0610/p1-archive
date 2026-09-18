export declare const DEFAULT_GATEWAY: string
export declare function keccak256(data: Uint8Array): Uint8Array
export declare function hexToBytes(hex: string): Uint8Array
export declare function bytesToHex(bytes: Uint8Array): string
export declare function utf8(text: string): Uint8Array
export declare function concat(...parts: Uint8Array[]): Uint8Array
export declare function uint64be(value: bigint | number): Uint8Array
export declare function normalizeTopic(input: string): Uint8Array
export declare function normalizeOwner(input: string): Uint8Array
export declare function feedIdentifier(topic: Uint8Array, index: bigint | number): Uint8Array
export declare function socAddress(identifier: Uint8Array, owner: Uint8Array): Uint8Array
export declare function feedUpdateAddress(topic: Uint8Array, owner: Uint8Array, index: bigint | number): Uint8Array
export declare function parseSoc(bytes: Uint8Array): { identifier: Uint8Array; signature: Uint8Array; span: bigint; payload: Uint8Array }
export declare function parseFeedReference(payload: Uint8Array): { timestamp: number; reference: string }

export interface FetchOpts {
  retries?: number
  signal?: AbortSignal
}
export declare function fetchChunk(gateway: string, addressHex: string, opts?: FetchOpts): Promise<Uint8Array | null>
export declare function readFeedUpdate(
  gateway: string,
  topic: Uint8Array,
  owner: Uint8Array,
  index: bigint | number,
  opts?: FetchOpts,
): Promise<{ index: bigint; address: string; timestamp: number; reference: string } | null>

export interface FindOpts {
  hint?: bigint | number | null
  onProbe?: (index: bigint) => void
  signal?: AbortSignal
}
export declare function findLatestIndex(gateway: string, topic: Uint8Array, owner: Uint8Array, opts?: FindOpts): Promise<bigint>

export type ResolvedFeed =
  | { empty: true; owner: string; topic: string }
  | { empty: false; owner: string; topic: string; index: bigint; address: string; timestamp: number; reference: string }
export declare function resolveFeed(gateway: string, owner: string, topic: string, opts?: FindOpts): Promise<ResolvedFeed>

export interface LiteFolio {
  path: string
  title: string
  mime: string
  size: number
  sha256: string
  kind: 'image' | 'text' | 'other'
  note?: string
}
export interface LiteCatalogue {
  schema: string
  title: string
  description: string
  publishedAt: string
  feed: { owner: string; topic: string; topicString: string; feedManifest: string }
  storage: { batchId: string; ttlSeconds: number | null; paidUntil: string | null; asOf: string; note: string }
  folios: LiteFolio[]
}
export declare function bzzUrl(gateway: string, reference: string, path?: string): string
export declare function fetchBzz(gateway: string, reference: string, path: string, opts?: { signal?: AbortSignal }): Promise<Uint8Array>
export declare function fetchCatalogue(gateway: string, reference: string, opts?: { signal?: AbortSignal }): Promise<LiteCatalogue>
export declare function sha256Hex(bytes: Uint8Array): Promise<string>
