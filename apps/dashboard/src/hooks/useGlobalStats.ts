import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { isPollingVisible } from '../lib/polling'

const GLOBAL_STATS_POLL_MS = 5000
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
  const totalCoinsOutRef = useRef<number | undefined>(undefined)

  async function fetchTotalCoinsOut() {
    if (!isPollingVisible()) return null

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
    if (!isPollingVisible()) return

    const { data, error } = await supabase.from('global_stats_live').select('*').single()

    if (!error) {
      setStats(current => ({
        ...(data as GlobalStatsRow),
        total_coins_out: totalCoinsOutRef.current ?? current?.total_coins_out,
      }))
    }
  }

  async function refreshTotalCoinsOut() {
    const totalCoinsOut = await fetchTotalCoinsOut()
    if (totalCoinsOut === null) return

    totalCoinsOutRef.current = totalCoinsOut
    setStats(current =>
      current
        ? {
            ...current,
            total_coins_out: totalCoinsOut,
          }
        : current,
    )
  }

  useEffect(() => {
    void fetchStats()
    void refreshTotalCoinsOut()

    const poll = window.setInterval(() => {
      void fetchStats()
    }, GLOBAL_STATS_POLL_MS)
    const onVisibilityChange = () => {
      if (!isPollingVisible()) return
      void fetchStats()
      void refreshTotalCoinsOut()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      window.clearInterval(poll)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  useEffect(() => {
    const poll = window.setInterval(() => {
      void refreshTotalCoinsOut()
    }, GLOBAL_COINS_OUT_POLL_MS)

    return () => {
      window.clearInterval(poll)
    }
  }, [])

  return stats
}
