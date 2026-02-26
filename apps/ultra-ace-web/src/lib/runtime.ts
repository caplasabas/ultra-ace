import { supabase } from './supabase'

export type RuntimeMode = 'BASE' | 'HAPPY'

export type CasinoRuntimeLive = {
  id: boolean
  active_mode: RuntimeMode
  base_profile_id: string
  happy_profile_id: string
  manual_happy_enabled: boolean
  auto_happy_enabled: boolean
  prize_pool_balance: number
  prize_pool_goal: number
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
