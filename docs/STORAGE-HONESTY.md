# How long is it paid for? (and what "permanent" means here)

The folios lasted eight centuries in a room nobody paid for. Swarm is not that room.

**Storage on Swarm is prepaid rent.** Uploads are stamped with a *postage batch*: a balance
held by the postage contract on Gnosis Chain, drained a little every block at the network's
current storage price. While the batch has balance, storage nodes are paid to keep the chunks.
When it runs out, they are free to delete them.

So "permanent" in this project means exactly this:

> The archive is reachable for as long as its postage batch is paid for — and anybody, not just
> Tsering, can keep paying.

## What this tool tells you, and where the number comes from

Every figure is read from a Bee node at the moment you look. Nothing is a constant.

| Where | What is shown | Source |
|---|---|---|
| CLI `status`, `stamps`, `publish` | "Paid until about …, ≈ N days" | `bee.stamp.get(batchId).duration` — the node's `batchTTL` |
| Web UI lamp (top right) | flame height and date | same, refreshed every 30 s |
| `archive.json` / `PUBLISHED.md` | snapshot at publish time, with its `asOf` date | same, recorded when writing |
| `catalogue.json` inside each edition | snapshot at publish time | same |

If the node cannot be reached, the tool says **unknown** instead of guessing.

The TTL is an **estimate**: the node divides the remaining balance by today's price. If the
storage price rises, the date moves closer; if it falls, further away. That is why every
recorded figure carries the date it was taken.

## What expires together

A feed update is itself a chunk, stamped with the same batch as the folios. When the batch
expires, **the address stops resolving too** — not just the images. There is no part of the
archive that outlives its postage.

## Keeping it alive

- Top up the batch before it runs out:
  ```bash
  npm run archive -- extend --batch <batchId> --days 30          # shows the cost
  npm run archive -- extend --batch <batchId> --days 30 --yes    # spends xBZZ
  ```
  or use the **Top up** button on the Stamps screen.
- Topping up does not need the feed key, and on-chain it does not even need the node that
  bought the batch: the postage contract's `topUp(batchId, amount)` accepts payment from any
  account (only *diluting* a batch is owner-only). The batch ID is in `archive.json`, so a
  library, a funder or a stranger who cares can keep the lamp lit.
- An expired batch cannot be revived. If it lapses, republish from a copy (for example one
  made with `npm run recover`) with a new batch: the feed key still controls the same address,
  so readers keep using what they were given.

## What this tool does not do

- It does not pretend to buy permanence. There is no "forever" option.
- It does not store the gift code, the node's wallet key or any payment credential. The gift
  code goes into Swarm Desktop once and nowhere else.
