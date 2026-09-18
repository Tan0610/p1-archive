// swarm-lite.js — read a Swarm feed and its archive with NOTHING but fetch().
//
// Zero dependencies. Works in any modern browser (also from file://) and in
// Node >= 18. Only plain GET requests are made, so it works against the public
// gateway, whose CORS rules refuse Swarm's custom request headers.
//
// Everything here follows docs/RECOVERY.md, so it can be re-implemented from
// that document alone:
//
//   topic        = keccak256(utf8(topicText))          (or 32 raw bytes, hex)
//   identifier_i = keccak256(topic ‖ uint64_be(i))
//   address_i    = keccak256(identifier_i ‖ owner20)   → GET /chunks/<address_i>
//   chunk        = identifier(32) ‖ signature(65) ‖ span(8, LE) ‖ payload
//   payload      = uint64_be(unix seconds) ‖ reference(32)
//   reference    → GET /bzz/<reference>/catalogue.json, then /bzz/<reference>/<path>

export const DEFAULT_GATEWAY = 'https://api.gateway.ethswarm.org'

// ---------------------------------------------------------------- keccak256
// Keccak-f[1600] on 32-bit halves (lo, hi) — the original Keccak padding
// (0x01), as used by Ethereum and Swarm, NOT the NIST SHA3 padding (0x06).
const RC = [
  0x00000001, 0x00000000, 0x00008082, 0x00000000, 0x0000808a, 0x80000000, 0x80008000, 0x80000000, 0x0000808b, 0x00000000, 0x80000001, 0x00000000, 0x80008081,
  0x80000000, 0x00008009, 0x80000000, 0x0000008a, 0x00000000, 0x00000088, 0x00000000, 0x80008009, 0x00000000, 0x8000000a, 0x00000000, 0x8000808b, 0x00000000,
  0x0000008b, 0x80000000, 0x00008089, 0x80000000, 0x00008003, 0x80000000, 0x00008002, 0x80000000, 0x00000080, 0x80000000, 0x0000800a, 0x00000000, 0x8000000a,
  0x80000000, 0x80008081, 0x80000000, 0x00008080, 0x80000000, 0x80000001, 0x00000000, 0x80008008, 0x80000000,
]
// rotation offsets, lane index x + 5y
const ROT = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14]

function keccakF(s) {
  const C = new Uint32Array(10)
  const B = new Uint32Array(50)
  for (let round = 0; round < 24; round++) {
    // θ
    for (let x = 0; x < 5; x++) {
      C[2 * x] = s[2 * x] ^ s[2 * x + 10] ^ s[2 * x + 20] ^ s[2 * x + 30] ^ s[2 * x + 40]
      C[2 * x + 1] = s[2 * x + 1] ^ s[2 * x + 11] ^ s[2 * x + 21] ^ s[2 * x + 31] ^ s[2 * x + 41]
    }
    for (let x = 0; x < 5; x++) {
      const x1 = (x + 1) % 5
      const x4 = (x + 4) % 5
      const lo1 = C[2 * x1]
      const hi1 = C[2 * x1 + 1]
      const dLo = C[2 * x4] ^ ((lo1 << 1) | (hi1 >>> 31))
      const dHi = C[2 * x4 + 1] ^ ((hi1 << 1) | (lo1 >>> 31))
      for (let y = 0; y < 25; y += 5) {
        s[2 * (x + y)] ^= dLo
        s[2 * (x + y) + 1] ^= dHi
      }
    }
    // ρ and π
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        const i = x + 5 * y
        const j = y + 5 * ((2 * x + 3 * y) % 5)
        let lo = s[2 * i]
        let hi = s[2 * i + 1]
        let n = ROT[i]
        if (n >= 32) {
          const t = lo
          lo = hi
          hi = t
          n -= 32
        }
        if (n > 0) {
          const l = (lo << n) | (hi >>> (32 - n))
          const h = (hi << n) | (lo >>> (32 - n))
          lo = l
          hi = h
        }
        B[2 * j] = lo
        B[2 * j + 1] = hi
      }
    }
    // χ
    for (let y = 0; y < 25; y += 5) {
      for (let x = 0; x < 5; x++) {
        const i = x + y
        const i1 = ((x + 1) % 5) + y
        const i2 = ((x + 2) % 5) + y
        s[2 * i] = B[2 * i] ^ (~B[2 * i1] & B[2 * i2])
        s[2 * i + 1] = B[2 * i + 1] ^ (~B[2 * i1 + 1] & B[2 * i2 + 1])
      }
    }
    // ι
    s[0] ^= RC[2 * round]
    s[1] ^= RC[2 * round + 1]
  }
}

/** keccak256 of a byte array → 32 bytes. */
export function keccak256(data) {
  const rate = 136
  const s = new Uint32Array(50)
  const padLen = rate - (data.length % rate)
  const msg = new Uint8Array(data.length + padLen)
  msg.set(data)
  msg[data.length] ^= 0x01
  msg[msg.length - 1] ^= 0x80
  for (let off = 0; off < msg.length; off += rate) {
    for (let i = 0; i < rate / 4; i++) {
      const p = off + 4 * i
      s[i] ^= msg[p] | (msg[p + 1] << 8) | (msg[p + 2] << 16) | (msg[p + 3] << 24)
    }
    keccakF(s)
  }
  const out = new Uint8Array(32)
  for (let i = 0; i < 8; i++) {
    const w = s[i]
    out[4 * i] = w & 0xff
    out[4 * i + 1] = (w >>> 8) & 0xff
    out[4 * i + 2] = (w >>> 16) & 0xff
    out[4 * i + 3] = (w >>> 24) & 0xff
  }
  return out
}

// ---------------------------------------------------------------- bytes
export function hexToBytes(hex) {
  const clean = String(hex).trim().replace(/^0x/i, '')
  if (clean.length % 2 !== 0 || /[^0-9a-f]/i.test(clean)) throw new Error(`Not hex: ${hex}`)
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(2 * i, 2 * i + 2), 16)
  return out
}

export function bytesToHex(bytes) {
  let s = ''
  for (const b of bytes) s += b.toString(16).padStart(2, '0')
  return s
}

export function utf8(text) {
  return new TextEncoder().encode(text)
}

export function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

export function uint64be(value) {
  let v = BigInt(value)
  const out = new Uint8Array(8)
  for (let i = 7; i >= 0; i--) {
    out[i] = Number(v & 0xffn)
    v >>= 8n
  }
  return out
}

function readUint64(bytes, littleEndian) {
  let v = 0n
  for (let i = 0; i < 8; i++) {
    const b = BigInt(bytes[littleEndian ? 7 - i : i])
    v = (v << 8n) | b
  }
  return v
}

// ---------------------------------------------------------------- feeds
/** 64 hex chars → the raw 32-byte topic; anything else → keccak256 of its UTF-8 text. */
export function normalizeTopic(input) {
  const clean = String(input).trim().replace(/^0x/i, '')
  if (/^[0-9a-f]{64}$/i.test(clean)) return hexToBytes(clean)
  return keccak256(utf8(String(input)))
}

export function normalizeOwner(input) {
  const clean = String(input).trim().replace(/^0x/i, '')
  if (!/^[0-9a-f]{40}$/i.test(clean)) throw new Error('The feed owner must be a 20-byte address (40 hex characters).')
  return hexToBytes(clean)
}

export function feedIdentifier(topic, index) {
  return keccak256(concat(topic, uint64be(index)))
}

export function socAddress(identifier, owner) {
  return keccak256(concat(identifier, owner))
}

export function feedUpdateAddress(topic, owner, index) {
  return socAddress(feedIdentifier(topic, index), owner)
}

/** identifier(32) ‖ signature(65) ‖ span(8, little-endian) ‖ payload */
export function parseSoc(bytes) {
  if (bytes.length < 32 + 65 + 8) throw new Error('Chunk too short to be a single-owner chunk.')
  return {
    identifier: bytes.slice(0, 32),
    signature: bytes.slice(32, 97),
    span: readUint64(bytes.slice(97, 105), true),
    payload: bytes.slice(105),
  }
}

/** Feed payload written by uploadReference: uint64_be(timestamp) ‖ reference (32, or 64 if encrypted). */
export function parseFeedReference(payload) {
  if (payload.length !== 40 && payload.length !== 72) {
    throw new Error(`Feed update payload is ${payload.length} bytes; expected a timestamp and a reference.`)
  }
  return {
    timestamp: Number(readUint64(payload.slice(0, 8), false)),
    reference: bytesToHex(payload.slice(8)),
  }
}

function trim(url) {
  return String(url || DEFAULT_GATEWAY).replace(/\/+$/, '')
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * GET /chunks/<address>. Returns the bytes, or null if the chunk is absent.
 * Gateways answer 404 — or sometimes 500 — for a chunk they cannot find, so
 * both are retried once before being treated as "absent".
 */
export async function fetchChunk(gateway, addressHex, { retries = 1, signal } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${trim(gateway)}/chunks/${addressHex}`, { signal })
    if (res.ok) return new Uint8Array(await res.arrayBuffer())
    if ((res.status === 404 || res.status === 500) && attempt < retries) {
      await sleep(400)
      continue
    }
    if (res.status === 404 || res.status === 500) return null
    throw new Error(`Gateway answered ${res.status} for chunk ${addressHex.slice(0, 12)}…`)
  }
}

/** Reads and checks feed update `index`. null if it does not exist. */
export async function readFeedUpdate(gateway, topic, owner, index, opts = {}) {
  const identifier = feedIdentifier(topic, index)
  const address = bytesToHex(socAddress(identifier, owner))
  const bytes = await fetchChunk(gateway, address, opts)
  if (!bytes) return null
  const soc = parseSoc(bytes)
  if (bytesToHex(soc.identifier) !== bytesToHex(identifier)) throw new Error(`Chunk ${address.slice(0, 12)}… is not feed update #${index}.`)
  return { index: BigInt(index), address, ...parseFeedReference(soc.payload) }
}

/**
 * Finds the newest index of a sequence feed by probing chunks: gallop 1, 2, 4, 8…
 * until a miss, then binary search. Returns -1n when the feed has no updates.
 *
 * Never uses Bee's feed lookup (GET /feeds/…), which answers 404 both for an
 * empty feed and for a lookup that timed out. Update #0 decides "no updates",
 * so that one read gets a few more retries before a miss is believed.
 */
export async function findLatestIndex(gateway, topic, owner, { hint, onProbe, signal } = {}) {
  const exists = async (i, retries = 1) => {
    onProbe?.(i)
    const address = bytesToHex(feedUpdateAddress(topic, owner, i))
    return (await fetchChunk(gateway, address, { retries, signal })) !== null
  }
  if (!(await exists(0n, 3))) return -1n
  let lo = 0n
  let hi = null
  if (hint !== undefined && hint !== null && BigInt(hint) > 0n) {
    if (await exists(BigInt(hint))) lo = BigInt(hint)
    else hi = BigInt(hint)
  }
  let step = 1n
  while (hi === null) {
    const candidate = lo + step
    if (await exists(candidate)) {
      lo = candidate
      step *= 2n
    } else hi = candidate
  }
  while (hi - lo > 1n) {
    const mid = (lo + hi) / 2n
    if (await exists(mid)) lo = mid
    else hi = mid
  }
  return lo
}

/** Owner + topic → latest edition. { empty: true } when nothing has been published yet. */
export async function resolveFeed(gateway, ownerInput, topicInput, opts = {}) {
  const owner = normalizeOwner(ownerInput)
  const topic = normalizeTopic(topicInput)
  const latest = await findLatestIndex(gateway, topic, owner, opts)
  if (latest < 0n) return { empty: true, owner: bytesToHex(owner), topic: bytesToHex(topic) }
  const update = await readFeedUpdate(gateway, topic, owner, latest, opts)
  if (!update) throw new Error(`Feed update #${latest} vanished between two requests — try again.`)
  return { empty: false, owner: bytesToHex(owner), topic: bytesToHex(topic), ...update }
}

// ---------------------------------------------------------------- archive
export function bzzUrl(gateway, reference, path = '') {
  const clean = String(reference).trim().replace(/^0x/i, '')
  return `${trim(gateway)}/bzz/${clean}/${path.split('/').map(encodeURIComponent).join('/')}`
}

export async function fetchBzz(gateway, reference, path, { signal } = {}) {
  const res = await fetch(bzzUrl(gateway, reference, path), { signal })
  if (!res.ok) throw new Error(`${path}: gateway answered ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

/** The edition's own table of contents. `reference` may be a collection OR a feed manifest. */
export async function fetchCatalogue(gateway, reference, opts = {}) {
  const bytes = await fetchBzz(gateway, reference, 'catalogue.json', opts)
  const catalogue = JSON.parse(new TextDecoder().decode(bytes))
  if (!catalogue || !Array.isArray(catalogue.folios)) throw new Error('catalogue.json has no folio list.')
  return catalogue
}

export async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return bytesToHex(new Uint8Array(digest))
}
