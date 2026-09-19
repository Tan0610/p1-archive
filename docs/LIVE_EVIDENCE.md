# Live evidence

What was actually published on Swarm mainnet, and what a stranger got back. Everything here can be
re-checked without keys (commands at the end). Times are UTC.

## The address that did not change

```
f527dd8d6be60c6f82429fafe4d1b37e8acd277aaa12844a2474bdafb9ed4b28
```

It is the feed manifest for owner `0xD1f310B6E40a5a52Cde5Db122415b609EA0E6408` and topic
`86cbe92d33d89dc878e0991ed53a92aa27905b4e21fee1a78c64683eab73f415` (keccak256 of
`tsering/himalayan-manuscripts/v1`). Both publishes below printed this same address; only the feed
update behind it moved.

## Editions

| | Edition 1 | Edition 2 |
|---|---|---|
| Published | 2026-09-19 05:46:15 | 2026-09-19 06:31:55 |
| Feed index (read from the network before writing) | 0 | 1 |
| Collection reference (snapshot) | `9caa421859e4cac9ab1ad481fb128fd45ad8000d9ecc2757ae6fb9a65c1a50da` | `0fb29f8ac9c903abd05e64707ac5ae2b6763f7dda6046878be4f30ee658569a0` |
| Files in the edition | 20 (16 in `folios/` + `index.html`, `catalogue.json`, `recover.html`, `ABOUT.txt`) | 22 (18 in `folios/` + the same four) |
| Bytes | 198 642 | 220 134 |
| Batch TTL at publish (from the node) | 604 550 s ≈ 7.0 days | 601 604 s ≈ 7.0 days |
| Archive address printed | `f527dd8d…d4b28` | `f527dd8d…d4b28` (same) |

Postage batch for both: `bb1f753edc43cbdc457984ceb2fb2b1b7995489f9dfdd07525b4d7ef243d4c97` (depth 19,
about 25 % used), paid until about 26 Sept 2026. No new batch was bought and no xBZZ was spent for
edition 2; the node's chequebook is empty and the upload went through on the free bandwidth
allowance.

What changed in edition 2 (commit `1b283fe`): a ninth stand-in leaf,
`folios/f009-palm-leaf-hymn-leaf-4.svg` with its note, and a dated correction added to
`folios/notes/f003-astrological-table.txt`. Like every sample, these are generated drawings, not
real manuscripts.

The publish run for edition 2 (trimmed):

```
✓ node     Bee 2.8.2-7e703f49 is up, mode: light.
✓ stamp    Batch bb1f753edc… — Paid until about 26 Sept 2026 (≈ 7 days) …
✓ address  Archive address: f527dd8d6be60c6f82429fafe4d1b37e8acd277aaa12844a2474bdafb9ed4b28
✓ edition  22 files staged (18 in folios/ + index.html, catalogue.json, recover.html, ABOUT.txt).
✓ upload   Edition snapshot: 0fb29f8ac9c903abd05e64707ac5ae2b6763f7dda6046878be4f30ee658569a0
✓ feed     Feed index 1 now points at this edition.
✓ verify   The feed points at this edition.
```

Then `npm run archive -- status` reported `latest edition index 1 → 0fb29f8a…`, and
`npm run archive -- verify --gateway` read `catalogue.json` listing 18 folios from both the local
node and `https://api.gateway.ethswarm.org`.

## A stranger's recovery (fresh clone, public gateway)

In a fresh `gh repo clone` of this repository in a scratch folder, after `npm ci` and nothing else
(no `.env`, no `.secrets/`, no `.state/`, no Bee node):

```
$ npm run recover -- 0xD1f310B6E40a5a52Cde5Db122415b609EA0E6408 86cbe92d33d89dc878e0991ed53a92aa27905b4e21fee1a78c64683eab73f415 --out r1

༄༅། Recovering from https://api.gateway.ethswarm.org
   inputs: owner 0xD1f310B6…6408, topic 86cbe92d…f415 — nothing else

   Feed is at index 1 → edition 0fb29f8ac9c9…
   Catalogue lists 18 folios: “The Spiti Folios — scans by Tsering”.
   ✓ folios/f001-medical-compendium-12r.svg (29515 bytes)
   …
   ✓ folios/f009-palm-leaf-hymn-leaf-4.svg (21087 bytes)
   ✓ folios/notes/f001-medical-compendium-12r.txt (272 bytes)
   …
   ✓ folios/notes/f009-palm-leaf-hymn-leaf-4.txt (248 bytes)

   COMPLETE: 18/18 files verified by SHA-256
```

Exit code 0. With `--all-editions` the same command also walks the feed and lists both updates, each
still retrievable:

```
   editions: #0  #1

   COMPLETE: 18/18 files verified by SHA-256
```

`RECOVERY-REPORT.json` records `{ index 0 → 9caa4218…, retrievable }` and
`{ index 1 → 0fb29f8a…, retrievable }`. Recovering the edition-1 snapshot directly
(`npm run recover -- --manifest 9caa4218… --out r0`) gave `COMPLETE: 16/16 files verified`, and
`diff r0/…/f003-astrological-table.txt r1/…/f003-astrological-table.txt` shows exactly the added
correction. So the same address served the old contents, then the new ones, and the old edition is
still there by its snapshot reference.

## Public gateway URLs

Data, served by the public gateway (checked: HTTP 200, 7 236 bytes):

```
https://api.gateway.ethswarm.org/bzz/f527dd8d6be60c6f82429fafe4d1b37e8acd277aaa12844a2474bdafb9ed4b28/catalogue.json
https://api.gateway.ethswarm.org/bzz/f527dd8d6be60c6f82429fafe4d1b37e8acd277aaa12844a2474bdafb9ed4b28/folios/f009-palm-leaf-hymn-leaf-4.svg
```

HTML is not served for this hash: `…/bzz/f527dd8d…/` and `…/index.html` answer `302` to
`https://bzz.link/forbidden?hash=f527dd8d…`, the gateway's approval form. The gallery and the
in-edition `recover.html` open through your own Bee node (e.g. Swarm Desktop,
`http://localhost:1633/bzz/f527dd8d…/`), or use `reader/recover.html` from this repository, which
only fetches data.

## Storage watchdog

`npm run watchdog` needs no key and no node. It reads the batch TTL from the gateway's public
`GET /batches` (328 batches, about 77 KB, under a second) and cross-checks it against the
PostageStamp contract on Gnosis Chain. Output on 19 Sept 2026:

```
  TTL       600913 s ≈ 7 days, runs out ≈ 2026-09-26T05:37:04Z (from gateway)
  [OK      ] storage time    7.0 days of storage left (runs out around 2026-09-26).
  [OK      ] archive address /bzz/f527dd8d6b…/catalogue.json answers 200 and lists 18 folios
  [OK      ] feed            newest update is #1 (archive.json records #1)
  [OK      ] cross-check     gateway 600913 s vs contract 600885 s (agree within an hour)
  Overall: OK (exit 0)
```

The scheduled workflow `.github/workflows/storage-watchdog.yml` ran green on GitHub Actions
([run 35427425260](https://github.com/Tan0610/p1-archive/actions/runs/35427425260)). To test the
issue path, one manual run used `warn_days=10`
([run 35427470439](https://github.com/Tan0610/p1-archive/actions/runs/35427470439)); it opened issue
#1, "Archive storage runs out in 6 days — top it up", with both top-up routes. The next run at the
default 3-day line ([run 35427498119](https://github.com/Tan0610/p1-archive/actions/runs/35427498119))
closed it automatically.

On-chain facts the issue text relies on were read from Gnosis Chain on the same day:
`PostageStamp` at `0x45a1502382541Cd610CC9068e88727426b696293` returns `bzzToken() =
0xdBF3Ea6F5beE45c02255B2c26a16F300502F68da` (symbol `BZZ`), `batchDepth(batch) = 19`, and
`lastPrice() = 103283` PLUR per chunk per block, so 30 more days for this batch cost about 2.81 xBZZ.

## Storage extended (19 Sept 2026)

Batch `bb1f753edc43cbdc457984ceb2fb2b1b7995489f9dfdd07525b4d7ef243d4c97` (depth 19) was topped up
by 3 days with the CLI, which calls `bee.storage.extendDuration`:

```bash
npm run archive -- extend --batch bb1f753edc43cbdc457984ceb2fb2b1b7995489f9dfdd07525b4d7ef243d4c97 --days 3        # quote: 0.2821 xBZZ
npm run archive -- extend --batch bb1f753edc43cbdc457984ceb2fb2b1b7995489f9dfdd07525b4d7ef243d4c97 --days 3 --yes
```

| | Before (13:00 UTC) | After (13:01 UTC) |
|---|---|---|
| Batch `amount` (PLUR per chunk) | 12485612161 | 17867744642 |
| Node `batchTTL` | 575581 s ≈ 6.7 days | 834681 s ≈ 9.7 days |
| Paid until (node estimate) | ≈ 2026-09-26 04:53 UTC | ≈ 2026-09-29 04:53 UTC (10:23 IST) |
| Node wallet | 0.3046 xBZZ | 0.0225 xBZZ |

The cost was 5382132481 PLUR per chunk × 2^19 chunks = 0.28218 xBZZ, exactly the drop in the
wallet. At the price of 103822 PLUR per chunk per block, that buys 3 days of 17280 blocks. Gas was
about 8.2 × 10⁻¹² xDAI. The node showed the new TTL about 40 seconds after the transaction.
`npm run archive -- status` now reads "Paid until about 29 Sept 2026 (≈ 10 days)". The watchdog
agrees:

```
  TTL       834681 s ≈ 9.7 days, runs out ≈ 2026-09-29T04:53:21.548Z (from gateway)
  [OK      ] storage time    9.7 days of storage left (runs out around 2026-09-29).
  [OK      ] cross-check     gateway 834681 s vs contract 834640 s (agree within an hour)
  Overall: OK (exit 0)
```

`archive.json` and `PUBLISHED.md` still show the TTL from publish time (≈ 7 days). They are
snapshots taken at publish; the live figure always comes from the node or the gateway.

## Honest notes

- Paid storage is short: about 7 days from 19 Sept 2026 at publish, extended the same day to about
  29 Sept 2026 (above). The watchdog will open an issue once 3 or fewer days are left; anyone can
  then top the batch up (see the README).
- The public gateway serves the data but not the HTML for unapproved hashes (above).
- A new edition can take a few minutes to show through the public gateway (`verify --gateway`
  retries for up to 5 minutes). For edition 2 it was already visible when `verify --gateway` ran,
  right after the publish.
- The folios are generated stand-in drawings. The mechanics are real; the manuscripts are not.

## Re-check it yourself

```bash
npm ci
npm run recover -- 0xD1f310B6E40a5a52Cde5Db122415b609EA0E6408 86cbe92d33d89dc878e0991ed53a92aa27905b4e21fee1a78c64683eab73f415 --all-editions
curl -s https://api.gateway.ethswarm.org/bzz/f527dd8d6be60c6f82429fafe4d1b37e8acd277aaa12844a2474bdafb9ed4b28/catalogue.json
npm run watchdog
```
