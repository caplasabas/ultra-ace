import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export type GlobalStatsRow = {
  total_balance: number
  total_coins_in: number
  total_hopper: number
  total_bet_amount: number
  total_win_amount: number
  total_house_take?: number
  total_house_net?: number
  total_jackpot_contrib?: number
  total_jackpot_win?: number
  total_withdraw_amount: number
  total_spins: number
  global_rtp_percent: number
  global_house_edge_percent?: number
  global_house_net_percent?: number
  device_count: number
}

export function useGlobalStats() {
  const [stats, setStats] = useState<GlobalStatsRow | null>(null)

  async function fetchStats() {
    const { data, error } = await supabase.from('global_stats_live').select('*').single()
    if (!error) setStats(data as GlobalStatsRow)
  }

  useEffect(() => {
    fetchStats()

    const channel = supabase
      .channel('dashboard-global-stats')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'devices' }, () => fetchStats())
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [])

  return stats
}
