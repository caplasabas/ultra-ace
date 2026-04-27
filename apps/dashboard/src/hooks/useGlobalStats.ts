import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const GLOBAL_STATS_POLL_MS = 2500
const GLOBAL_COINS_OUT_POLL_MS = 30000
const COINS_OUT_PAGE_SIZE = 1000

export type GlobalStatsRow = {
  total_balance: number
  total_coins_in: number
  total_coins_out?: number
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

  async function fetchTotalCoinsOut() {
    let totalCoinsOut = 0
    let from = 0

    for (;;) {
      const to = from + COINS_OUT_PAGE_SIZE - 1
      const { data, error } = await supabase
        .from('device_metric_events')
        .select('amount')
        .eq('event_type', 'coins_out')
        .eq('counts_toward_global', true)
        .order('id', { ascending: true })
        .range(from, to)

      if (error) {
        return null
      }

      const rows = data ?? []
      totalCoinsOut += rows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0)

      if (rows.length < COINS_OUT_PAGE_SIZE) {
        return totalCoinsOut
      }

      from += COINS_OUT_PAGE_SIZE
    }
  }

  async function fetchStats() {
    const [{ data, error }, totalCoinsOut] = await Promise.all([
      supabase.from('global_stats_live').select('*').single(),
      fetchTotalCoinsOut(),
    ])

    if (!error) {
      setStats({
        ...(data as GlobalStatsRow),
        total_coins_out: totalCoinsOut ?? undefined,
      })
    }
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

  useEffect(() => {
    const poll = window.setInterval(() => {
      void fetchTotalCoinsOut().then(totalCoinsOut => {
        if (totalCoinsOut === null) return
        setStats(current =>
          current
            ? {
                ...current,
                total_coins_out: totalCoinsOut,
              }
            : current,
        )
      })
    }, GLOBAL_COINS_OUT_POLL_MS)

    return () => {
      window.clearInterval(poll)
    }
  }, [])

  return stats
}
