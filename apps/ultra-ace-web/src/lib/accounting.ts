import { supabase } from './supabase'
import { applyMetricEventsViaShellParent, isShellIframe } from './shellBridge'

type MetricEventType = 'coins_in' | 'hopper_in' | 'withdrawal' | 'bet' | 'win' | 'spin'

export type MetricEventPayload = {
  device_id: string
  event_type: MetricEventType
  amount: number
  event_ts: string
  metadata?: Record<string, any>
}

async function pushEvents(
  events: MetricEventPayload[],
  options?: { deviceId?: string; spinKey?: string | null },
) {
  if (isShellIframe() && options?.deviceId) {
    return applyMetricEventsViaShellParent({
      deviceId: options.deviceId,
      events,
      spinKey: options.spinKey ?? null,
      writeLedger: true,
    })
  }

  const { error } = await supabase.rpc('apply_metric_events', {
    p_events: events,
    p_write_ledger: true,
  })
  if (error) throw error

  return { jackpotPayout: 0 }
}

function sleep(ms: number) {
  return new Promise(resolve => {
    window.setTimeout(resolve, ms)
  })
}

async function fetchSpinJackpotPayout(deviceId: string, spinKey: string): Promise<number> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const { data, error } = await supabase
      .from('device_metric_events')
      .select('id,metadata,event_ts')
      .eq('device_id', deviceId)
      .eq('event_type', 'spin')
      .order('event_ts', { ascending: false })
      .order('id', { ascending: false })
      .limit(40)

    if (!error) {
      const row = (data ?? []).find(item => String((item as any)?.metadata?.spinKey ?? '') === spinKey)
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

    if (attempt < 19) {
      await sleep(120)
    }
  }

  return 0
}

async function fetchResolvedSpinAccounting(
  deviceId: string,
  spinKey: string,
): Promise<{ acceptedWin: number; jackpotPayout: number }> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const { data, error } = await supabase
      .from('device_metric_events')
      .select('id,event_type,amount,metadata,event_ts')
      .eq('device_id', deviceId)
      .in('event_type', ['spin', 'win'])
      .order('event_ts', { ascending: false })
      .order('id', { ascending: false })
      .limit(80)

    if (!error) {
      const rows = (data ?? []).filter(
        item => String((item as any)?.metadata?.spinKey ?? '') === String(spinKey || ''),
      )
      const winRow = rows.find(item => String((item as any)?.event_type ?? '') === 'win')
      const spinRow = rows.find(item => String((item as any)?.event_type ?? '') === 'spin')

      const acceptedWin = Number(
        (winRow as any)?.metadata?.acceptedWin ??
          (winRow as any)?.metadata?.accepted_win ??
          (winRow as any)?.amount ??
          0,
      )
      const jackpotPayout = Number(
        (spinRow as any)?.metadata?.jackpotPayout ??
          (spinRow as any)?.metadata?.jackpot_payout ??
          (spinRow as any)?.metadata?.jackpotAmount ??
          0,
      )

      return {
        acceptedWin: Number.isFinite(acceptedWin) ? Math.max(0, acceptedWin) : 0,
        jackpotPayout: Number.isFinite(jackpotPayout) ? Math.max(0, jackpotPayout) : 0,
      }
    }

    if (attempt < 19) {
      await sleep(120)
    }
  }

  return { acceptedWin: 0, jackpotPayout: 0 }
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
}): Promise<{ jackpotPayout: number; acceptedWin: number }> {
  const now = new Date().toISOString()
  const spinKey = `${spinId}:${now}:${Math.random().toString(36).slice(2, 10)}`
  const baseMetadata = {
    spinId,
    spinKey,
    isFreeGame,
    betAmount,
    totalWin,
    freeSpinsAwarded,
    cascades,
    triggerType: triggerType ?? null,
    clientApp: 'ultra-ace-web',
    clientBuild: import.meta.env.VITE_APP_VERSION ?? import.meta.env.MODE ?? null,
    clientUserAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
  }

  const events: MetricEventPayload[] = []

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
    amount: Math.max(0, Number(betAmount) || 0),
    event_ts: now,
    metadata: baseMetadata,
  })

  const shellResult = await pushEvents(events, {
    deviceId,
    spinKey,
  })
  const resolvedAccounting = await fetchResolvedSpinAccounting(deviceId, spinKey)
  if (isShellIframe()) {
    const shellPayout = Number(shellResult?.jackpotPayout ?? 0)
    if (Number.isFinite(shellPayout) && shellPayout > 0) {
      return {
        jackpotPayout: shellPayout,
        acceptedWin: resolvedAccounting.acceptedWin,
      }
    }

    return {
      jackpotPayout: resolvedAccounting.jackpotPayout,
      acceptedWin: resolvedAccounting.acceptedWin,
    }
  }

  return {
    jackpotPayout: resolvedAccounting.jackpotPayout,
    acceptedWin: resolvedAccounting.acceptedWin,
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
  let eventType: MetricEventType | null = null

  if (type === 'deposit') eventType = 'coins_in'
  else if (type === 'hopper_in') eventType = 'hopper_in'
  else if (type === 'withdrawal') eventType = 'withdrawal'
  else if (type === 'bet') eventType = 'bet'
  else if (type === 'win') eventType = 'win'

  if (!eventType) return

  await pushEvents(
    [
      {
        device_id: deviceId,
        event_type: eventType,
        amount,
        event_ts: new Date().toISOString(),
        metadata: metadata ?? { source: source ?? null },
      },
    ],
    {
      deviceId,
    },
  )
}
