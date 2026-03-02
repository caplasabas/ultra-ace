import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

export type DeviceDailyRow = {
  stat_date: string
  device_id: string
  coins_in_amount: number
  hopper_in_amount: number
  hopper_out_amount: number
  bet_amount: number
  win_amount: number
  withdrawal_amount: number
  balance_change: number
  spins_count: number
}

export function useAccounting(dateFrom: string, dateTo: string) {
  const [rows, setRows] = useState<DeviceDailyRow[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!dateFrom || !dateTo) return

    let cancelled = false

    async function load() {
      setLoading(true)

      const { data, error } = await supabase
        .from('device_daily_stats')
        .select(
          'stat_date,device_id,coins_in_amount,hopper_in_amount,hopper_out_amount,bet_amount,win_amount,withdrawal_amount,balance_change,spins_count',
        )
        .gte('stat_date', dateFrom)
        .lte('stat_date', dateTo)
        .order('stat_date', { ascending: false })

      if (!cancelled && !error) {
        setRows((data ?? []) as DeviceDailyRow[])
      }

      if (!cancelled) setLoading(false)
    }

    load()

    return () => {
      cancelled = true
    }
  }, [dateFrom, dateTo])

  const summary = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        acc.coinsIn += Number(row.coins_in_amount ?? 0)
        acc.hopperIn += Number(row.hopper_in_amount ?? 0)
        acc.hopperOut += Number(row.hopper_out_amount ?? 0)
        acc.bet += Number(row.bet_amount ?? 0)
        acc.win += Number(row.win_amount ?? 0)
        acc.withdrawal += Number(row.withdrawal_amount ?? 0)
        acc.balanceChange += Number(row.balance_change ?? 0)
        acc.spins += Number(row.spins_count ?? 0)
        return acc
      },
      {
        coinsIn: 0,
        hopperIn: 0,
        hopperOut: 0,
        bet: 0,
        win: 0,
        withdrawal: 0,
        balanceChange: 0,
        spins: 0,
      },
    )
  }, [rows])

  const byDate = useMemo(() => {
    const map = new Map<string, typeof summary>()

    for (const row of rows) {
      const key = row.stat_date
      const current = map.get(key) ?? {
        coinsIn: 0,
        hopperIn: 0,
        hopperOut: 0,
        bet: 0,
        win: 0,
        withdrawal: 0,
        balanceChange: 0,
        spins: 0,
      }

      current.coinsIn += Number(row.coins_in_amount ?? 0)
      current.hopperIn += Number(row.hopper_in_amount ?? 0)
      current.hopperOut += Number(row.hopper_out_amount ?? 0)
      current.bet += Number(row.bet_amount ?? 0)
      current.win += Number(row.win_amount ?? 0)
      current.withdrawal += Number(row.withdrawal_amount ?? 0)
      current.balanceChange += Number(row.balance_change ?? 0)
      current.spins += Number(row.spins_count ?? 0)

      map.set(key, current)
    }

    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1))
  }, [rows, summary])

  return {
    loading,
    rows,
    summary,
    byDate,
  }
}
