import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

export type AccountingDailyRow = {
  business_date: string
  total_devices: number
  total_balance: number
  total_coins_in: number
  total_hopper_in: number
  total_hopper_out: number
  total_bet: number
  total_win: number
  total_withdraw: number
  total_spins: number
  total_house_take: number
  total_arcade_amount: number
  transferred_device_balance: number
  transferred_happy_pool: number
  transferred_jackpot_pool: number
  house_take_after_close: number
  rtp_percent: number
  house_edge_percent: number
  closed_at: string
}

export type AccountingDeviceRow = {
  business_date: string
  device_id: string
  device_name: string | null
  deployment_mode: string | null
  balance: number
  coins_in_total: number
  hopper_in_total: number
  hopper_out_total: number
  hopper_balance: number
  bet_total: number
  win_total: number
  withdraw_total: number
  spins_total: number
  house_take_total: number
  arcade_total: number
  arcade_credit: number
  arcade_time_ms: number
  transferred_balance_to_house_take: number
  house_take_after_close: number
}

type Summary = {
  totalDevices: number
  balance: number
  coinsIn: number
  hopperIn: number
  hopperOut: number
  bet: number
  win: number
  withdraw: number
  spins: number
  houseTake: number
  arcadeTotal: number
  transferredDeviceBalance: number
  transferredHappyPool: number
  transferredJackpotPool: number
  houseTakeAfterClose: number
}

export function useAccounting(dateFrom: string, dateTo: string) {
  const [dailyRows, setDailyRows] = useState<AccountingDailyRow[]>([])
  const [deviceRows, setDeviceRows] = useState<AccountingDeviceRow[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!dateFrom || !dateTo) return

    let cancelled = false

    async function load() {
      setLoading(true)

      const [dailyResult, deviceResult] = await Promise.all([
        supabase
          .from('accounting_daily_closures')
          .select(
            'business_date,total_devices,total_balance,total_coins_in,total_hopper_in,total_hopper_out,total_bet,total_win,total_withdraw,total_spins,total_house_take,total_arcade_amount,transferred_device_balance,transferred_happy_pool,transferred_jackpot_pool,house_take_after_close,rtp_percent,house_edge_percent,closed_at',
          )
          .gte('business_date', dateFrom)
          .lte('business_date', dateTo)
          .order('business_date', { ascending: false }),
        supabase
          .from('accounting_daily_device_closures')
          .select(
            'business_date,device_id,device_name,deployment_mode,balance,coins_in_total,hopper_in_total,hopper_out_total,hopper_balance,bet_total,win_total,withdraw_total,spins_total,house_take_total,arcade_total,arcade_credit,arcade_time_ms,transferred_balance_to_house_take,house_take_after_close',
          )
          .gte('business_date', dateFrom)
          .lte('business_date', dateTo)
          .order('business_date', { ascending: false })
          .order('device_id', { ascending: true }),
      ])

      if (!cancelled) {
        if (!dailyResult.error) {
          setDailyRows((dailyResult.data ?? []) as AccountingDailyRow[])
        }
        if (!deviceResult.error) {
          setDeviceRows((deviceResult.data ?? []) as AccountingDeviceRow[])
        }
        setLoading(false)
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [dateFrom, dateTo])

  const summary = useMemo<Summary>(() => {
    return dailyRows.reduce(
      (acc, row) => {
        acc.totalDevices += Number(row.total_devices ?? 0)
        acc.balance += Number(row.total_balance ?? 0)
        acc.coinsIn += Number(row.total_coins_in ?? 0)
        acc.hopperIn += Number(row.total_hopper_in ?? 0)
        acc.hopperOut += Number(row.total_hopper_out ?? 0)
        acc.bet += Number(row.total_bet ?? 0)
        acc.win += Number(row.total_win ?? 0)
        acc.withdraw += Number(row.total_withdraw ?? 0)
        acc.spins += Number(row.total_spins ?? 0)
        acc.houseTake += Number(row.total_house_take ?? 0)
        acc.arcadeTotal += Number(row.total_arcade_amount ?? 0)
        acc.transferredDeviceBalance += Number(row.transferred_device_balance ?? 0)
        acc.transferredHappyPool += Number(row.transferred_happy_pool ?? 0)
        acc.transferredJackpotPool += Number(row.transferred_jackpot_pool ?? 0)
        acc.houseTakeAfterClose += Number(row.house_take_after_close ?? 0)
        return acc
      },
      {
        totalDevices: 0,
        balance: 0,
        coinsIn: 0,
        hopperIn: 0,
        hopperOut: 0,
        bet: 0,
        win: 0,
        withdraw: 0,
        spins: 0,
        houseTake: 0,
        arcadeTotal: 0,
        transferredDeviceBalance: 0,
        transferredHappyPool: 0,
        transferredJackpotPool: 0,
        houseTakeAfterClose: 0,
      },
    )
  }, [dailyRows])

  const byDate = useMemo(() => {
    return dailyRows.map(row => [row.business_date, row] as const)
  }, [dailyRows])

  return {
    loading,
    dailyRows,
    deviceRows,
    summary,
    byDate,
  }
}
