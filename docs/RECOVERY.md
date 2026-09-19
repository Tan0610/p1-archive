# Recovering the archive with nothing but its address

This document is written for someone who has **none** of this repository's code: only the
identifiers Tsering published (in `PUBLISHED.md`, on a note taped inside the vault door, in an
email) and access to any Swarm gateway or Bee node. Everything below can be re-implemented from
this page alone.

You need one of:

| You have | Example |
|---|---|
| the **archive address** (a feed manifest reference, 64 hex) | `PUBLISHED.md` → "The archive address" |
| the **feed owner** (20-byte address) **and topic** (32 bytes, or its text) | `PUBLISHED.md` → "The feed behind it" |

and a Bee API endpoint, e.g. the public gateway `https://api.gateway.ethswarm.org`, or your own
node at `http://localhost:1633`. (Do not confuse the API gateway with `gateway.ethswarm.org`,
without `api.` — that host serves an HTML shell for every path and refuses API calls.)

---

## Route 1 — with the archive address and `curl`

A feed manifest resolves to the newest edition on any Bee node:

```bash
GW=https://api.gateway.ethswarm.org
ADDR=<archive address>

curl -s  $GW/bzz/$ADDR/catalogue.json            # table of contents, with SHA-256 per file
curl -sO $GW/bzz/$ADDR/folios/f001-medical-compendium-12r.svg
sha256sum f001-medical-compendium-12r.svg         # compare with catalogue.json
```

Or just open `$GW/bzz/$ADDR/` in a browser: every edition carries its own gallery page
(`index.html`) and a copy of the stand-alone reader (`recover.html`).

## Route 2 — with the owner and topic, from first principles

This is what `reader/swarm-lite.js` and `src/recover/recover.ts` do.

### 1. The topic

If you were given the topic as text (e.g. `tsering/himalayan-manuscripts/v1`), the topic is
`keccak256(utf8(text))` — the original Keccak-256 used by Ethereum, not NIST SHA3-256.
If you were given 64 hex characters, use those 32 bytes directly.

### 2. Where update *i* lives

The feed is a *sequence* feed: updates are numbered 0, 1, 2, … with no gaps.

```
identifier_i = keccak256( topic(32) ‖ uint64_big_endian(i)(8) )
address_i    = keccak256( identifier_i(32) ‖ owner(20) )
```

Fetch it as a plain chunk:

```
GET /chunks/<hex(address_i)>
```

A missing update answers `404` (some gateways answer `500` for a missing chunk — retry once,
then treat it as absent).

### 3. Find the newest update

Probe `i = 0`. If it's absent (retry a miss a few times first: this is the one answer that
decides it), **nothing has been published yet**. Otherwise probe 1, 2, 4, 8, …
until one is missing, then binary-search between the last present and first missing index.
(A Bee node can also tell you directly: `GET /feeds/<owner>/<topic>` answers with the headers
`swarm-feed-index` and `swarm-feed-index-next`; browsers can't read those headers from the
public gateway, which is why the reader probes chunks instead. Bee 2.8 also answers that lookup
with `404` when the lookup itself fails, e.g. on a timeout, so a `404` there is not proof of an
empty feed: check chunk `0`.)

### 4. Read the update

The chunk body is a single-owner chunk:

| bytes | field |
|---|---|
| 0–31 | identifier — must equal `identifier_i` |
| 32–96 | signature (65 bytes) by the owner over `keccak256(identifier ‖ address_of_wrapped_chunk)`, Ethereum signed-message style |
| 97–104 | span, uint64 **little**-endian (40 here) |
| 105– | payload |

The payload of every update is 40 bytes:

| bytes | field |
|---|---|
| 0–7 | unix timestamp in seconds, uint64 **big**-endian |
| 8–39 | the **edition reference**: a 32-byte Swarm reference of the edition's collection |

### 5. Read the edition

```
GET /bzz/<edition reference>/catalogue.json
GET /bzz/<edition reference>/<path from the catalogue>
```

`catalogue.json` (`schema: "himalayan-archive/catalogue@1"`):

```jsonc
{
  "schema": "himalayan-archive/catalogue@1",
  "title": "…",
  "description": "…",
  "publishedAt": "2026-09-19T…Z",
  "feed": { "owner": "0x…", "topic": "<64 hex>", "topicString": "…", "feedManifest": "<64 hex>" },
  "storage": { "batchId": "…", "ttlSeconds": 1234567, "paidUntil": "…", "asOf": "…", "note": "…" },
  "folios": [
    { "path": "folios/f001-….svg", "title": "…", "mime": "image/svg+xml", "size": 29694,
      "sha256": "<64 hex>", "kind": "image", "note": "…" }
  ]
}
```

Check each downloaded file against its `sha256`. The edition's manifest itself also lists every
path, so if `catalogue.json` were damaged you could still walk the Mantaray manifest.

Older editions: repeat step 4 for any `i` below the newest. Each older edition is only
retrievable while its postage batch is still paid for (see `STORAGE-HONESTY.md`).

## Route 3 — tools in this repository

| Tool | Command | Needs |
|---|---|---|
| CLI | `npm run recover -- <owner> <topic> --bee https://api.gateway.ethswarm.org --out recovered` | Node 22 |
| CLI, by address | `npm run recover -- --manifest <archive address>` | Node 22 |
| Browser | open `reader/recover.html` (works from `file://`) or `$GW/bzz/$ADDR/recover.html`, paste the address or owner + topic | a browser |

The CLI writes every file plus `RECOVERY-REPORT.json` (inputs used, SHA-256 verdicts) into the
output folder. It never reads `archive.json`, `.env`, the feed key or any local state — only
the identifiers you pass it.

## How long is it still paid for?

Every edition's `catalogue.json` names its postage batch (`storage.batchId`). Ask any node or
gateway for today's estimate:

```bash
curl -s $GW/batches | grep -o '"batchID":"<batchId>"[^}]*'    # → "batchTTL": seconds left
```

(`GET /stamps/<batchId>` only answers on the node that bought the batch.) When the TTL reaches
zero, nodes may drop the folios **and** the feed updates, so the address stops resolving too.
Anyone can top the batch up; see `STORAGE-HONESTY.md`.

## If no public gateway exists any more

Run a Bee node yourself (`https://docs.ethswarm.org/docs/bee/installation/install`); an
ultra-light node can download. Point any of the routes above at `http://localhost:1633`.
The data is there as long as its postage is paid — not as long as any one company or gateway
exists.
