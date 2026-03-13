import { supabase } from './supabase'

type MetricEventType = 'coins_in' | 'hopper_in' | 'withdrawal' | 'bet' | 'win' | 'spin'

type MetricEventPayload = {
  device_id: string
  event_type: MetricEventType
  amount: number
  event_ts: string
  metadata?: Record<string, any>
}

async function pushEvents(events: MetricEventPayload[]) {
  const { error } = await supabase.rpc('apply_metric_events', {
    p_events: events,
    p_write_ledger: true,
  })
  if (error) throw error
}

function sleep(ms: number) {
  return new Promise(resolve => {
    window.setTimeout(resolve, ms)
  })
}

async function fetchSpinJackpotPayout(deviceId: string, spinId: number): Promise<number> {
  for (let attempt = 0; attempt < 12; attempt++) {
    const { data, error } = await supabase
      .from('device_metric_events')
      .select('id,metadata,event_ts')
      .eq('device_id', deviceId)
      .eq('event_type', 'spin')
      .order('event_ts', { ascending: false })
      .order('id', { ascending: false })
      .limit(12)

    if (!error) {
      const row = (data ?? []).find(item => Number((item as any)?.metadata?.spinId ?? -1) === spinId)
      if (row) {
        const payout = Number(
          (row as any)?.metadata?.jackpotPayout ??
            (row as any)?.metadata?.jackpot_payout ??
            (row as any)?.metadata?.jackpotAmount ??
            0,
        )
        if (Number.isFinite(payout) && payout > 0) return payout
        return 0
      }
    }

    if (attempt < 11) {
      await sleep(150)
    }
  }

  return 0
}

// Kept for compatibility with existing imports; intentionally no-op.
export function installAccountingRetryHooks() {}

// Kept for compatibility with existing imports; intentionally immediate/no queue.
export async function flushAccountingQueue() {}

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
}): Promise<{ jackpotPayout: number }> {
  const now = new Date().toISOString()
  const baseMetadata = {
    spinId,
    isFreeGame,
    totalWin,
    freeSpinsAwarded,
    cascades,
    triggerType: triggerType ?? null,
  }

  const events: MetricEventPayload[] = []

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

  events.push({
    device_id: deviceId,
    event_type: 'spin',
    amount: 1,
    event_ts: now,
    metadata: baseMetadata,
  })

  await pushEvents(events)
  const jackpotPayout = await fetchSpinJackpotPayout(deviceId, spinId)
  return { jackpotPayout }
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
  let eventType: MetricEventType | null = null

  if (type === 'deposit') eventType = 'coins_in'
  else if (type === 'hopper_in') eventType = 'hopper_in'
  else if (type === 'withdrawal') eventType = 'withdrawal'
  else if (type === 'bet') eventType = 'bet'
  else if (type === 'win') eventType = 'win'

  if (!eventType) return

  await pushEvents([
    {
      device_id: deviceId,
      event_type: eventType,
      amount,
      event_ts: new Date().toISOString(),
      metadata: metadata ?? { source: source ?? null },
    },
  ])
}
