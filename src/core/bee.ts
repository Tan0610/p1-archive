import { Bee, BeeModes } from '@ethersphere/bee-js'

export function makeBee(url: string): Bee {
  return new Bee(url, { timeout: 120_000 })
}

export interface DoctorReport {
  url: string
  reachable: boolean
  ready: boolean
  version: string | null
  apiVersion: string | null
  apiSupported: boolean | null
  mode: string | null
  /** Light (or full / dev) nodes can buy stamps and upload. Ultra-light cannot. */
  canUpload: boolean
  wallet: { address: string; xbzz: string; xdai: string } | null
  problems: string[]
  hints: string[]
}

/**
 * Read-only health check. Every probe is independent so one failing endpoint
 * (Bee answers 503 on several of them while it syncs) doesn't hide the rest.
 */
export async function doctor(bee: Bee): Promise<DoctorReport> {
  const report: DoctorReport = {
    url: bee.url,
    reachable: false,
    ready: false,
    version: null,
    apiVersion: null,
    apiSupported: null,
    mode: null,
    canUpload: false,
    wallet: null,
    problems: [],
    hints: [],
  }

  try {
    const health = await bee.status.getHealth()
    report.reachable = true
    report.version = health.version
    report.apiVersion = health.apiVersion
  } catch {
    report.problems.push(`Nothing answered at ${bee.url}.`)
    report.hints.push('Start Swarm Desktop (it bundles Bee) and try again. We cannot say anything about your storage until the node answers.')
    return report
  }

  try {
    report.apiSupported = await bee.status.isSupportedApiVersion()
    if (!report.apiSupported) {
      report.hints.push(`This tool is built against bee-js 13.1.0 (Bee API 8.x). Your node reports API ${report.apiVersion}; most things should still work.`)
    }
  } catch {
    /* informational only */
  }

  try {
    const readiness = await bee.status.getReadiness()
    report.ready = readiness.status === 'ready' || readiness.status === 'ok'
  } catch {
    report.ready = false
  }
  if (!report.ready) {
    report.problems.push('The node is up but still syncing postage data from Gnosis Chain.')
    report.hints.push('Leave Swarm Desktop running. First boot can take several minutes; nothing is broken.')
  }

  try {
    const info = await bee.status.getNodeInfo()
    report.mode = info.beeMode
    report.canUpload = info.beeMode === BeeModes.LIGHT || info.beeMode === BeeModes.FULL || info.beeMode === BeeModes.DEV
    if (info.beeMode === BeeModes.ULTRA_LIGHT) {
      report.problems.push('Node is in ultra-light mode: it can download, but it cannot buy stamps or upload.')
      report.hints.push('Redeem your gift code in Swarm Desktop (Info → Setup wallet), then wait for Mode to flip to "light".')
    }
  } catch {
    report.problems.push('Could not read the node mode.')
  }

  try {
    const balance = await bee.wallet.getBalance()
    report.wallet = {
      address: balance.walletAddress,
      xbzz: balance.bzzBalance.toSignificantDigits(4),
      xdai: balance.nativeTokenBalance.toSignificantDigits(4),
    }
  } catch {
    /* 503 while syncing — already reported above */
  }

  return report
}

export function assertCanPublish(report: DoctorReport): void {
  if (!report.reachable) throw new Error(report.problems.join(' ') + ' ' + report.hints.join(' '))
  if (!report.canUpload) throw new Error(`Node mode is "${report.mode ?? 'unknown'}"; publishing needs a light node. ${report.hints.join(' ')}`)
  if (!report.ready) throw new Error('Node is still syncing. Wait until /readiness answers "ready" and try again.')
}
