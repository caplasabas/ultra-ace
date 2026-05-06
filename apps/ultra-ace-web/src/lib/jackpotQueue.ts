import { supabase } from './supabase'

let jackpotQueueChannelSeq = 0

export type ActiveJackpotQueue = {
  id: number
  campaign_id: string
  spins_until_start: number
  payouts_left: number
  remaining_amount: number
  target_amount: number
}

function toQueueRow(raw: any): ActiveJackpotQueue {
  return {
    id: Number(raw?.id ?? 0),
    campaign_id: String(raw?.campaign_id ?? ''),
    spins_until_start: Number(raw?.spins_until_start ?? 0),
    payouts_left: Number(raw?.payouts_left ?? 0),
    remaining_amount: Number(raw?.remaining_amount ?? 0),
    target_amount: Number(raw?.target_amount ?? 0),
  }
}

export async function fetchActiveJackpotQueue(deviceId: string): Promise<ActiveJackpotQueue | null> {
  const { data, error } = await supabase
    .from('jackpot_payout_queue')
    .select('id,campaign_id,spins_until_start,payouts_left,remaining_amount,target_amount')
    .eq('device_id', deviceId)
    .is('completed_at', null)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(1)

  if (error) throw error
  const first = (data ?? [])[0]
  return first ? toQueueRow(first) : null
}

export async function finalizeDeviceJackpotPayouts(deviceId: string) {
  const { error } = await supabase.rpc('finalize_device_jackpot_payouts', {
    p_device_id: deviceId,
  })

  if (error) throw error
}

export function subscribeActiveJackpotQueue(
  deviceId: string,
  onChange: (next: ActiveJackpotQueue | null) => void,
) {
  const channelName = `device-jackpot-queue-${deviceId}-${Date.now()}-${jackpotQueueChannelSeq++}`
  const channel = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'jackpot_payout_queue',
        filter: `device_id=eq.${deviceId}`,
      },
      async () => {
        try {
          const next = await fetchActiveJackpotQueue(deviceId)
          onChange(next)
        } catch {
          // no-op
        }
      },
    )
    .subscribe()

  return {
    unsubscribe: () => {
      void supabase.removeChannel(channel)
    },
  }
}
