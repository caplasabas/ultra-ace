import { supabase } from './supabase'

export type RuntimeMode = 'BASE' | 'HAPPY'
export type JackpotDeliveryMode = 'TARGET_FIRST' | 'AUTHENTIC_PAYTABLE'
export type JackpotPayoutCurve = 'flat' | 'front' | 'center' | 'back'

export type CasinoRuntimeLive = {
  id: boolean
  active_mode: RuntimeMode
  base_profile_id: string
  happy_profile_id: string
  manual_happy_enabled: boolean
  auto_happy_enabled: boolean
  prize_pool_balance: number
  happy_hour_prize_balance?: number
  prize_pool_goal: number
  base_house_pct?: number
  happy_house_pct?: number
  max_win_enabled?: boolean
  max_win_multiplier?: number
  jackpot_win_variance?: number
  jackpot_delivery_mode?: JackpotDeliveryMode
  jackpot_payout_curve?: JackpotPayoutCurve
  active_target_rtp_pct: number
  updated_at: string
}

export async function fetchCasinoRuntimeLive() {
  const { data, error } = await supabase.from('casino_runtime_live').select('*').eq('id', true).single()
  if (error) throw error
  return data as CasinoRuntimeLive
}

export function subscribeCasinoRuntimeLive(onUpdate: (next: CasinoRuntimeLive) => void) {
  return supabase
    .channel('casino-runtime-live')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'casino_runtime',
      },
      async () => {
        try {
          const next = await fetchCasinoRuntimeLive()
          onUpdate(next)
        } catch {
          // no-op
        }
      },
    )
    .subscribe()
}
