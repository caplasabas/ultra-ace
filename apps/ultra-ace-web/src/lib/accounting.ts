import { supabase } from './supabase'

type MetricEventType = 'coins_in' | 'hopper_in' | 'withdrawal' | 'bet' | 'win' | 'spin'

type MetricEventPayload = {
  device_id: string
  event_type: MetricEventType
  amount: number
  event_ts: string
  metadata?: Record<string, any>
}

const ACCOUNTING_PENDING_KEY = 'ultraace.accounting.pending.v1'
const RETRY_INTERVAL_MS = 1200

let retryInstalled = false
let flushInFlight = false

function loadPendingEvents(): MetricEventPayload[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(ACCOUNTING_PENDING_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed as MetricEventPayload[]
  } catch {
    return []
  }
}

function savePendingEvents(events: MetricEventPayload[]) {
  if (typeof window === 'undefined') return
  try {
    if (events.length === 0) {
      window.localStorage.removeItem(ACCOUNTING_PENDING_KEY)
      return
    }
    window.localStorage.setItem(ACCOUNTING_PENDING_KEY, JSON.stringify(events))
  } catch {
    // ignore storage failures
  }
}

let pendingEvents: MetricEventPayload[] = loadPendingEvents()

async function pushEvents(events: MetricEventPayload[]) {
  const { error } = await supabase.rpc('apply_metric_events', {
    p_events: events,
    p_write_ledger: true,
  })
  if (error) throw error
}

export async function flushAccountingQueue() {
  if (flushInFlight) return
  if (pendingEvents.length === 0) return

  flushInFlight = true
  try {
    while (pendingEvents.length > 0) {
      const batch = pendingEvents.slice(0, 50)
      await pushEvents(batch)
      pendingEvents = pendingEvents.slice(batch.length)
      savePendingEvents(pendingEvents)
    }
  } catch (error) {
    console.error('[accounting] flush queue failed', error)
  } finally {
    flushInFlight = false
  }
}

function enqueueEvents(events: MetricEventPayload[]) {
  if (events.length === 0) return
  pendingEvents.push(...events)
  savePendingEvents(pendingEvents)
  void flushAccountingQueue()
}

export function installAccountingRetryHooks() {
  if (retryInstalled || typeof window === 'undefined') return
  retryInstalled = true

  const flushNow = () => {
    void flushAccountingQueue()
  }

  window.addEventListener('online', flushNow)
  window.addEventListener('focus', flushNow)
  window.addEventListener('beforeunload', flushNow)
  window.addEventListener('pagehide', flushNow)

  window.setInterval(() => {
    void flushAccountingQueue()
  }, RETRY_INTERVAL_MS)

  flushNow()
}

export async function commitSpinAccounting({
  deviceId,
  spinId,
  isFreeGame,
  betAmount,
  totalWin,
  freeSpinsAwarded,
  cascades,
  triggerType,
}: {
  deviceId: string
  spinId: number
  isFreeGame: boolean
  betAmount: number
  totalWin: number
  freeSpinsAwarded: number
  cascades: number
  triggerType?: 'natural' | 'buy' | null
}) {
  installAccountingRetryHooks()

  const now = new Date().toISOString()
  const baseMetadata = {
    spinId,
    isFreeGame,
    freeSpinsAwarded,
    cascades,
    triggerType: triggerType ?? null,
  }

  const events: MetricEventPayload[] = [
    {
      device_id: deviceId,
      event_type: 'spin',
      amount: 1,
      event_ts: now,
      metadata: baseMetadata,
    },
  ]

  if (betAmount > 0) {
    events.push({
      device_id: deviceId,
      event_type: 'bet',
      amount: betAmount,
      event_ts: now,
      metadata: baseMetadata,
    })
  }

  if (totalWin > 0) {
    events.push({
      device_id: deviceId,
      event_type: 'win',
      amount: totalWin,
      event_ts: now,
      metadata: baseMetadata,
    })
  }

  try {
    await pushEvents(events)
  } catch (error) {
    throw error
  }
}

export async function logLedgerEvent({
  deviceId,
  type,
  amount,
  source,
  metadata,
}: {
  deviceId: string
  type: 'deposit' | 'withdrawal' | 'play' | 'bet' | 'win' | 'hopper_in'
  amount: number
  source?: string
  metadata?: any
}) {
  let eventType: 'coins_in' | 'hopper_in' | 'withdrawal' | 'bet' | 'win' | null = null

  if (type === 'deposit') eventType = 'coins_in'
  else if (type === 'hopper_in') eventType = 'hopper_in'
  else if (type === 'withdrawal') eventType = 'withdrawal'
  else if (type === 'bet') eventType = 'bet'
  else if (type === 'win') eventType = 'win'

  if (!eventType) return

  installAccountingRetryHooks()

  const event: MetricEventPayload = {
    device_id: deviceId,
    event_type: eventType,
    amount,
    event_ts: new Date().toISOString(),
    metadata: metadata ?? { source: source ?? null },
  }

  try {
    await pushEvents([event])
  } catch (error) {
    enqueueEvents([event])
    console.error('[metrics] apply_metric_event failed', error)
    throw error
  }
}
