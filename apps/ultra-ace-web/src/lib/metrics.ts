import { supabase } from './supabase'

type MetricEventType = 'coins_in' | 'hopper_in' | 'withdrawal' | 'bet' | 'win' | 'spin'

type MetricBucket = {
  device_id: string
  event_type: MetricEventType
  amount: number
  event_ts: string
}

const FLUSH_SOON_MS = Number(import.meta.env.VITE_METRIC_FLUSH_SOON_MS ?? 220)
const PERIODIC_FLUSH_MS = Number(import.meta.env.VITE_METRIC_PERIODIC_FLUSH_MS ?? 900)
const RETRY_FLUSH_MS = Number(import.meta.env.VITE_METRIC_RETRY_MS ?? 900)
const SHOULD_WRITE_LEDGER = import.meta.env.VITE_METRIC_WRITE_LEDGER === '1'

const buckets = new Map<string, MetricBucket>()

let installed = false
let flushInFlight = false
let flushTimer: number | null = null
let periodicTimer: number | null = null

function bucketKey(deviceId: string, eventType: MetricEventType) {
  return `${deviceId}::${eventType}`
}

function scheduleFlushSoon(delayMs = FLUSH_SOON_MS) {
  if (flushTimer) return

  flushTimer = window.setTimeout(() => {
    flushTimer = null
    void flushMetricEvents()
  }, delayMs)
}

function requeueSnapshot(snapshot: MetricBucket[]) {
  for (const item of snapshot) {
    const key = bucketKey(item.device_id, item.event_type)
    const existing = buckets.get(key)

    if (existing) {
      existing.amount += item.amount
      existing.event_ts = item.event_ts
      continue
    }

    buckets.set(key, { ...item })
  }
}

export function queueMetricEvent(
  deviceId: string | null | undefined,
  eventType: MetricEventType,
  amount: number,
  eventTs = new Date().toISOString(),
) {
  if (!deviceId) return

  const safeAmount = Number(amount ?? 0)
  if (safeAmount <= 0) return

  installMetricFlushHooks()

  const key = bucketKey(deviceId, eventType)
  const existing = buckets.get(key)

  if (existing) {
    existing.amount += safeAmount
    existing.event_ts = eventTs
  } else {
    buckets.set(key, {
      device_id: deviceId,
      event_type: eventType,
      amount: safeAmount,
      event_ts: eventTs,
    })
  }

  scheduleFlushSoon()
}

export async function flushMetricEvents() {
  if (flushInFlight) return
  if (buckets.size === 0) return

  flushInFlight = true

  const snapshot = [...buckets.values()].map(item => ({ ...item }))
  buckets.clear()

  try {
    const { error } = await supabase.rpc('apply_metric_events', {
      p_events: snapshot,
      p_write_ledger: SHOULD_WRITE_LEDGER,
    })

    if (error) throw error
  } catch (error) {
    requeueSnapshot(snapshot)
    console.error('[metrics] flush failed', error)
    scheduleFlushSoon(RETRY_FLUSH_MS)
  } finally {
    flushInFlight = false
  }
}

export function mapLedgerTypeToMetricEvent(type: string): MetricEventType | null {
  if (type === 'deposit') return 'coins_in'
  if (type === 'withdrawal') return 'withdrawal'
  if (type === 'bet') return 'bet'
  if (type === 'win') return 'win'
  return null
}

export function installMetricFlushHooks() {
  if (installed) return
  installed = true

  periodicTimer = window.setInterval(() => {
    void flushMetricEvents()
  }, PERIODIC_FLUSH_MS)

  const flushNow = () => {
    void flushMetricEvents()
  }

  const onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      flushNow()
    }
  }

  window.addEventListener('beforeunload', flushNow)
  window.addEventListener('pagehide', flushNow)
  window.addEventListener('online', flushNow)
  document.addEventListener('visibilitychange', onVisibility)
}
