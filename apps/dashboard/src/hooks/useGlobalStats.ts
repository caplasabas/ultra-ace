import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const GLOBAL_STATS_POLL_MS = 2500

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
  total_arcade_amount?: number
  total_withdraw_amount: number
  total_spins: number
  global_rtp_percent: number
  global_house_edge_percent?: number
  global_house_net_percent?: number
  device_count: number
  global_avg_bet?: number
}

export function useGlobalStats() {
  const [stats, setStats] = useState<GlobalStatsRow | null>(null)

  async function fetchStats() {
    const { data, error } = await supabase.from('global_stats_live').select('*').single()
    if (!error) setStats(data as GlobalStatsRow)
  }

  useEffect(() => {
    void fetchStats()

    const poll = window.setInterval(() => {
      void fetchStats()
    }, GLOBAL_STATS_POLL_MS)

    return () => {
      window.clearInterval(poll)
    }
  }, [])

  return stats
}
