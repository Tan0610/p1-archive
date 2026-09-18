import { describe, expect, it } from 'vitest'
import { BeeModes, BeeResponseError, BZZ, DAI, type Bee } from '@ethersphere/bee-js'
import { CHEQUEBOOK_EMPTY_HINT, doctor, explainBandwidthError } from '../src/core/bee.js'

/** A light node that answers every doctor probe; only the chequebook balance varies. */
function lightNode(chequebookPlur: bigint | 'missing') {
  return {
    url: 'http://127.0.0.1:1633',
    status: {
      getHealth: async () => ({ version: '2.8.2', apiVersion: '8.0.0', status: 'ok' }),
      isSupportedApiVersion: async () => true,
      getReadiness: async () => ({ status: 'ready' }),
      getNodeInfo: async () => ({ beeMode: BeeModes.LIGHT }),
    },
    wallet: {
      getBalance: async () => ({ walletAddress: '0x' + '11'.repeat(20), bzzBalance: BZZ.fromPLUR(10n ** 16n), nativeTokenBalance: DAI.fromWei(10n ** 16n) }),
    },
    chequebook: {
      getBalance: async () => {
        if (chequebookPlur === 'missing') throw new BeeResponseError('GET', 'chequebook/balance', 'Not Found', undefined, 404, 'Not Found')
        return { totalBalance: BZZ.fromPLUR(chequebookPlur), availableBalance: BZZ.fromPLUR(chequebookPlur) }
      },
    },
  } as unknown as Bee
}

describe('chequebook preflight', () => {
  it('warns (without blocking) when the chequebook is empty', async () => {
    const r = await doctor(lightNode(0n))
    expect(r.chequebook).toEqual({ availableXbzz: expect.any(String), empty: true })
    expect(r.hints).toContain(CHEQUEBOOK_EMPTY_HINT)
    expect(r.problems).toEqual([])
    expect(CHEQUEBOOK_EMPTY_HINT).toMatch(/insufficient funds.*overdraft.*deposit/s)
  })

  it('says nothing when the chequebook has funds', async () => {
    const r = await doctor(lightNode(10n ** 15n))
    expect(r.chequebook?.empty).toBe(false)
    expect(r.hints).not.toContain(CHEQUEBOOK_EMPTY_HINT)
  })

  it('treats an unreadable chequebook as unknown, not as a problem', async () => {
    const r = await doctor(lightNode('missing'))
    expect(r.chequebook).toBeNull()
    expect(r.problems).toEqual([])
  })

  it('turns a cryptic "insufficient funds" / "overdraft" failure into advice to deposit', () => {
    const e = explainBandwidthError(new Error('Internal Server Error: {"code":500,"message":"insufficient funds"}')) as Error
    expect(e.message).toMatch(/insufficient funds/)
    expect(e.message).toMatch(/chequebook\/deposit/)
    const other = new Error('batch not usable')
    expect(explainBandwidthError(other)).toBe(other)
  })
})
