import { Bytes } from '@ethersphere/bee-js'
import { describe, expect, it } from 'vitest'
import {
  POSTAGE_STAMP,
  SELECTORS,
  XBZZ_TOKEN,
  daysForTitle,
  exitCode,
  findBatch,
  formatXbzz,
  issueBody,
  issueTitle,
  topUpQuote,
  ttlCheck,
  ttlFromChain,
  worst,
  type WatchdogReport,
} from '../scripts/watchdog.js'

const BATCH = 'ab'.repeat(32)
const DAY = 86_400

function report(over: Partial<WatchdogReport> = {}): WatchdogReport {
  return {
    checkedAt: '2026-09-19T00:00:00.000Z',
    gateway: 'https://gw.example',
    batchId: BATCH,
    address: 'cd'.repeat(32),
    feed: null,
    ttlSeconds: 2.5 * DAY,
    daysLeft: 2.5,
    runsOutAt: null,
    ttlSource: 'gateway',
    depth: 19,
    pricePerBlock: '103283',
    warnDays: 3,
    criticalDays: 1,
    checks: [ttlCheck(2.5 * DAY, 3, 1)],
    level: 'warn',
    ...over,
  }
}

describe('watchdog: reading the batch', () => {
  it('finds a batch in the gateway list, bare array or wrapped, with or without 0x', () => {
    const entry = { batchID: BATCH, batchTTL: 601213, depth: 19 }
    expect(findBatch([{ batchID: 'ff'.repeat(32), batchTTL: 1 }, entry], BATCH)).toEqual({ batchTTL: 601213, depth: 19 })
    expect(findBatch({ batches: [entry] }, '0x' + BATCH.toUpperCase())).toEqual({ batchTTL: 601213, depth: 19 })
    expect(findBatch([], BATCH)).toBeNull()
  })

  it('refuses an answer that is not a batch list, or a batch without a TTL, instead of guessing', () => {
    expect(() => findBatch({ nope: true }, BATCH)).toThrow(/not a batch list/)
    expect(() => findBatch([{ batchID: BATCH }], BATCH)).toThrow(/batchTTL/)
  })

  it('turns the contract numbers into seconds: balance ÷ price × 5 s blocks', () => {
    expect(ttlFromChain(103_283n * 17_280n * 7n, 103_283n)).toBe(7 * DAY)
    expect(ttlFromChain(0n, 103_283n)).toBe(0)
    expect(() => ttlFromChain(1n, 0n)).toThrow()
  })

  it('uses the real 4-byte selectors of the PostageStamp functions it calls', () => {
    const sel = (sig: string) => '0x' + Bytes.keccak256(new TextEncoder().encode(sig)).toHex().slice(0, 8)
    expect(SELECTORS.remainingBalance).toBe(sel('remainingBalance(bytes32)'))
    expect(SELECTORS.lastPrice).toBe(sel('lastPrice()'))
    expect(SELECTORS.batchDepth).toBe(sel('batchDepth(bytes32)'))
  })
})

describe('watchdog: grading', () => {
  it('grades by days left against the warn and critical lines', () => {
    expect(ttlCheck(7 * DAY, 3, 1).level).toBe('ok')
    expect(ttlCheck(3 * DAY, 3, 1).level).toBe('warn')
    expect(ttlCheck(0.5 * DAY, 3, 1).level).toBe('critical')
    expect(ttlCheck(0, 3, 1).level).toBe('critical')
  })

  it('never calls an unreadable TTL fine', () => {
    const c = ttlCheck(null, 3, 1, 'gateway: timeout')
    expect(c.level).toBe('warn')
    expect(c.detail).toContain('gateway: timeout')
  })

  it('takes the worst check as the overall level and maps it to the exit code', () => {
    expect(worst([])).toBe('ok')
    expect(worst(['ok', 'warn', 'ok'])).toBe('warn')
    expect(worst(['warn', 'critical', 'ok'])).toBe('critical')
    expect([exitCode('ok'), exitCode('warn'), exitCode('critical')]).toEqual([0, 1, 2])
  })
})

describe('watchdog: top-up quote and issue text', () => {
  it('quotes PostageStamp.topUp: per-chunk amount = price × 17 280 blocks × days, contract pulls it × 2^depth', () => {
    const q = topUpQuote(103_283n, 19, 30)
    expect(q.perChunk).toBe(103_283n * 17_280n * 30n)
    expect(q.totalPlur).toBe(q.perChunk * 2n ** 19n)
    expect(q.xbzz).toBe('2.8071')
    expect(formatXbzz(10n ** 16n)).toBe('1.0000')
  })

  it('titles the issue with whole days, rounded down', () => {
    expect(issueTitle(report())).toBe('Archive storage runs out in 2 days — top it up')
    expect(daysForTitle(0.4 * DAY)).toBe('less than a day')
    expect(daysForTitle(0)).toBe('0 days (already expired)')
    const addressDown = report({ checks: [ttlCheck(7 * DAY, 3, 1), { name: 'archive address', level: 'critical', detail: '404' }] })
    expect(issueTitle(addressDown)).toMatch(/not answering/)
  })

  it('puts both top-up routes in the issue: the node owner’s extend command and the permissionless topUp', () => {
    const body = issueBody(report(), 'https://github.com/o/r/actions/runs/1')
    expect(body).toContain(`npm run archive -- extend --batch ${BATCH} --days 30 --yes`)
    expect(body).toContain(`BATCH=0x${BATCH}`)
    expect(body).toContain(POSTAGE_STAMP)
    expect(body).toContain(XBZZ_TOKEN)
    expect(body).toContain('"topUp(bytes32,uint256)"')
    expect(body).toContain('2.8071 xBZZ')
    expect(body).toContain('[run](https://github.com/o/r/actions/runs/1)')
  })
})
