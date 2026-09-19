import { describe, expect, it } from 'vitest'
import { BatchId, Duration, Size, type PostageBatch } from '@ethersphere/bee-js'
import { pickUsableBatch, summarise } from '../src/core/stamps.js'
import { approxDays, honestSentence, humanDuration, termFromTtlSeconds } from '../src/core/ttl.js'

const NOW = new Date('2026-09-19T00:00:00Z')

function batch(days: number, extra: Partial<PostageBatch> = {}): PostageBatch {
  return {
    batchID: new BatchId('ab'.repeat(32)),
    utilization: 0,
    usable: true,
    label: 'himalayan-archive',
    depth: 20,
    amount: '1000' as PostageBatch['amount'],
    bucketDepth: 16,
    blockNumber: 1,
    immutableFlag: false,
    duration: Duration.fromDays(days),
    usage: 0.1,
    usageText: '10%',
    size: Size.fromGigabytes(1),
    remainingSize: Size.fromMegabytes(900),
    theoreticalSize: Size.fromGigabytes(4),
    calculateSize: () => Size.fromGigabytes(1),
    calculateRemainingSize: () => Size.fromMegabytes(900),
    ...extra,
  }
}

describe('storage term comes from the node', () => {
  it('turns the batch TTL (duration) reported by the node into a paid-until date', () => {
    const s = summarise(batch(10), NOW)
    expect(s.term.source).toBe('bee-node')
    expect(s.term.ttlSeconds).toBe(10 * 86_400)
    expect(s.term.paidUntil).toBe('2026-09-29T00:00:00.000Z')
    expect(s.term.level).toBe('soon')
  })

  it('grades the urgency', () => {
    expect(termFromTtlSeconds(90 * 86_400, NOW).level).toBe('ok')
    expect(termFromTtlSeconds(20 * 86_400, NOW).level).toBe('soon')
    expect(termFromTtlSeconds(3 * 86_400, NOW).level).toBe('urgent')
    expect(termFromTtlSeconds(0, NOW).level).toBe('expired')
  })

  it('never invents a number when the node gave none', () => {
    const t = termFromTtlSeconds(null, NOW, 'no postage batch chosen yet')
    expect(t.level).toBe('unknown')
    expect(t.paidUntil).toBeNull()
    expect(honestSentence(t)).toMatch(/unknown: no postage batch chosen yet/)
  })

  it('rounds the days it shows to the nearest day, so a fresh 7-day batch reads "7 days"', () => {
    // 604_550 s is what the node reported for a 7-day batch a few minutes after purchase.
    expect(humanDuration(604_550)).toBe('7 days')
    expect(honestSentence(termFromTtlSeconds(604_550, NOW))).toMatch(/\(≈ 7 days\)/)
    expect(humanDuration(6.4 * 86_400)).toBe('6 days')
    expect(humanDuration(6.5 * 86_400)).toBe('7 days')
    expect(approxDays(604_550)).toBe(7)
  })

  it('keeps the urgency grade on whole days left, never rounding up', () => {
    const t = termFromTtlSeconds(604_550, NOW)
    expect(t.daysLeft).toBe(6)
    expect(t.level).toBe('urgent')
  })

  it('uses hours and minutes for short terms, singular when there is one', () => {
    expect(humanDuration(36 * 3600)).toBe('36 hours')
    expect(humanDuration(3600)).toBe('1 hour')
    expect(humanDuration(10)).toBe('1 minute')
    expect(humanDuration(45 * 60)).toBe('45 minutes')
  })

  it('says what happens at the end, not just the date', () => {
    expect(honestSentence(termFromTtlSeconds(12 * 86_400, NOW))).toMatch(/may delete these folios — and the feed updates that point at them/)
  })
})

describe('choosing a batch', () => {
  it('prefers a usable, unexpired batch with room, longest-lived first', () => {
    const a = summarise(batch(3, { batchID: new BatchId('01'.repeat(32)) }), NOW)
    const b = summarise(batch(30, { batchID: new BatchId('02'.repeat(32)) }), NOW)
    const c = summarise(batch(60, { batchID: new BatchId('03'.repeat(32)), usable: false }), NOW)
    expect(pickUsableBatch([a, b, c], 1_000_000)?.batchId).toBe('02'.repeat(32))
  })

  it('returns null when nothing fits', () => {
    const tiny = summarise(batch(30, { remainingSize: Size.fromKilobytes(10) }), NOW)
    expect(pickUsableBatch([tiny], 1_000_000)).toBeNull()
  })
})
