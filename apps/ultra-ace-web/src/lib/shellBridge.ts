import type { MetricEventPayload } from './accounting'

export type ShellStateSnapshot = {
  initialized: boolean
  deviceId: string | null
  balance: number
  internetOnline: boolean
  networkStage?: string | null
  runningCasino?: boolean
  updatedAt?: string | null
}

const isIframe = typeof window !== 'undefined' && window.parent !== window
let latestShellState: ShellStateSnapshot | null = null
const shellStateListeners = new Set<(state: ShellStateSnapshot) => void>()
const pendingRequests = new Map<
  string,
  {
    resolve: (value: { jackpotPayout: number }) => void
    reject: (reason?: unknown) => void
    timer: number
  }
>()

if (typeof window !== 'undefined') {
  window.addEventListener('message', event => {
    if (!isIframe || event.source !== window.parent) return

    const data = event.data
    if (!data || typeof data !== 'object') return

    if (data.type === 'ARCADE_SHELL_STATE' && data.payload && typeof data.payload === 'object') {
      latestShellState = {
        initialized: Boolean((data as any).payload.initialized),
        deviceId: (data as any).payload.deviceId ? String((data as any).payload.deviceId) : null,
        balance: Number((data as any).payload.balance ?? 0),
        internetOnline: Boolean((data as any).payload.internetOnline),
        networkStage: (data as any).payload.networkStage ?? null,
        runningCasino: Boolean((data as any).payload.runningCasino),
        updatedAt: (data as any).payload.updatedAt ?? null,
      }

      shellStateListeners.forEach(listener => listener(latestShellState as ShellStateSnapshot))
      return
    }

    if (data.type === 'ARCADE_ACCOUNTING_RESPONSE') {
      const requestId = String((data as any).requestId ?? '').trim()
      const pending = pendingRequests.get(requestId)
      if (!pending) return

      window.clearTimeout(pending.timer)
      pendingRequests.delete(requestId)

      if ((data as any).ok) {
        pending.resolve({
          jackpotPayout: Math.max(0, Number((data as any).jackpotPayout ?? 0)),
        })
      } else {
        pending.reject((data as any).error ?? new Error('Unknown parent accounting error'))
      }
    }
  })
}

export function isShellIframe() {
  return isIframe
}

export function subscribeShellState(listener: (state: ShellStateSnapshot) => void) {
  if (latestShellState) {
    listener(latestShellState)
  }

  shellStateListeners.add(listener)
  return () => {
    shellStateListeners.delete(listener)
  }
}

export function requestShellState(): Promise<ShellStateSnapshot | null> {
  if (!isIframe) return Promise.resolve(null)
  if (latestShellState) return Promise.resolve(latestShellState)

  return new Promise(resolve => {
    const timer = window.setTimeout(() => {
      cleanup()
      resolve(latestShellState)
    }, 2000)

    const cleanup = subscribeShellState(state => {
      window.clearTimeout(timer)
      cleanup()
      resolve(state)
    })

    window.parent.postMessage({ type: 'ULTRAACE_SHELL_STATE_REQUEST' }, '*')
  })
}

export function applyMetricEventsViaShellParent({
  deviceId,
  events,
  spinKey,
  writeLedger = true,
}: {
  deviceId: string
  events: MetricEventPayload[]
  spinKey?: string | null
  writeLedger?: boolean
}) {
  if (!isIframe) {
    throw new Error('Shell parent accounting bridge unavailable')
  }

  const requestId = `ultraace-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

  return new Promise<{ jackpotPayout: number }>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pendingRequests.delete(requestId)
      reject(new Error('Parent accounting request timed out'))
    }, 5000)

    pendingRequests.set(requestId, {
      resolve,
      reject,
      timer,
    })

    window.parent.postMessage(
      {
        type: 'ULTRAACE_ACCOUNTING_REQUEST',
        requestId,
        action: 'apply_metric_events',
        payload: {
          deviceId,
          events,
          spinKey: spinKey ?? null,
          writeLedger,
        },
      },
      '*',
    )
  })
}
