import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

type RevenueClosingRow = {
  id: number | string
  device_id: string
  closed_at: string
  coins_in_delta: number | string | null
  withdraw_delta: number | string | null
  bet_delta: number | string | null
  win_delta: number | string | null
  house_take_delta: number | string | null
  spins_delta: number | string | null
  jackpot_delta: number | string | null
  metadata: Record<string, unknown> | null
}

export type AccountingClosingRow = {
  id: string
  business_date: string
  closed_at: string
  device_id: string
  device_name: string | null
  deployment_mode: string | null
  coins_in: number
  withdrawal: number
  income: number
  bet: number
  win: number
  house_take: number
  jackpot: number
  spins: number
  rtp_percent: number
  house_edge_percent: number
}

export type AccountingDailyRow = {
  business_date: string
  closing_count: number
  total_devices: number
  total_coins_in: number
  total_withdraw: number
  total_income: number
  total_bet: number
  total_win: number
  total_spins: number
  total_house_take: number
  total_jackpot: number
  rtp_percent: number
  house_edge_percent: number
  closings: AccountingClosingRow[]
}

export type AccountingDeviceRow = {
  device_id: string
  device_name: string | null
  deployment_mode: string | null
  closing_count: number
  coins_in_total: number
  withdraw_total: number
  income_total: number
  bet_total: number
  win_total: number
  spins_total: number
  house_take_total: number
  jackpot_total: number
  rtp_percent: number
  house_edge_percent: number
  closings: AccountingClosingRow[]
}

type Summary = {
  totalDevices: number
  closingCount: number
  coinsIn: number
  withdraw: number
  income: number
  bet: number
  win: number
  spins: number
  houseTake: number
  jackpot: number
}

function asNumber(value: number | string | null | undefined) {
  const next = Number(value ?? 0)
  return Number.isFinite(next) ? next : 0
}

function formatManilaYmd(value: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value))
}

function toManilaStartIso(date: string) {
  return `${date}T00:00:00+08:00`
}

function addDaysToYmd(date: string, days: number) {
  const [year, month, day] = date.split('-').map(Number)
  const next = new Date(year, month - 1, day)
  next.setDate(next.getDate() + days)
  const nextYear = next.getFullYear()
  const nextMonth = String(next.getMonth() + 1).padStart(2, '0')
  const nextDay = String(next.getDate()).padStart(2, '0')
  return `${nextYear}-${nextMonth}-${nextDay}`
}

function toManilaEndExclusiveIso(date: string) {
  return `${addDaysToYmd(date, 1)}T00:00:00+08:00`
}

function closingFromRow(row: RevenueClosingRow): AccountingClosingRow {
  const coinsIn = Math.max(asNumber(row.coins_in_delta), 0)
  const withdrawal = Math.max(asNumber(row.withdraw_delta), 0)
  const bet = Math.max(asNumber(row.bet_delta), 0)
  const win = Math.max(asNumber(row.win_delta), 0)
  const houseTake = asNumber(row.house_take_delta)
  const jackpot = Math.max(asNumber(row.jackpot_delta), 0)
  const spins = Math.max(asNumber(row.spins_delta), 0)
  const metadata = row.metadata ?? {}
  const deviceName = String(metadata.deviceName ?? '').trim() || null
  const deploymentMode = String(metadata.deploymentMode ?? '').trim() || null

  return {
    id: String(row.id),
    business_date: formatManilaYmd(row.closed_at),
    closed_at: row.closed_at,
    device_id: String(row.device_id),
    device_name: deviceName,
    deployment_mode: deploymentMode,
    coins_in: coinsIn,
    withdrawal,
    income: coinsIn - withdrawal,
    bet,
    win,
    house_take: houseTake,
    jackpot,
    spins,
    rtp_percent: bet > 0 ? (win / bet) * 100 : 0,
    house_edge_percent: bet > 0 ? (houseTake / bet) * 100 : 0,
  }
}

function summarizeClosings(closings: AccountingClosingRow[]) {
  return closings.reduce(
    (acc, row) => {
      acc.coinsIn += row.coins_in
      acc.withdraw += row.withdrawal
      acc.income += row.income
      acc.bet += row.bet
      acc.win += row.win
      acc.spins += row.spins
      acc.houseTake += row.house_take
      acc.jackpot += row.jackpot
      return acc
    },
    {
      coinsIn: 0,
      withdraw: 0,
      income: 0,
      bet: 0,
      win: 0,
      spins: 0,
      houseTake: 0,
      jackpot: 0,
    },
  )
}

export function useAccounting(dateFrom: string, dateTo: string) {
  const [dailyRows, setDailyRows] = useState<AccountingDailyRow[]>([])
  const [deviceRows, setDeviceRows] = useState<AccountingDeviceRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!dateFrom || !dateTo) return

    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)

      const { data, error: closingsError } = await supabase
        .from('device_revenue_closings')
        .select(
          'id,device_id,closed_at,coins_in_delta,withdraw_delta,bet_delta,win_delta,house_take_delta,spins_delta,jackpot_delta,metadata',
        )
        .gte('closed_at', toManilaStartIso(dateFrom))
        .lt('closed_at', toManilaEndExclusiveIso(dateTo))
        .order('closed_at', { ascending: false })
        .order('id', { ascending: false })

      if (cancelled) return

      if (closingsError) {
        setError(closingsError.message)
        setDailyRows([])
        setDeviceRows([])
        setLoading(false)
        return
      }

      const closings = ((data ?? []) as RevenueClosingRow[]).map(closingFromRow)
      const dailyMap = new Map<string, AccountingClosingRow[]>()
      const deviceMap = new Map<string, AccountingClosingRow[]>()

      for (const closing of closings) {
        const dailyClosings = dailyMap.get(closing.business_date) ?? []
        dailyClosings.push(closing)
        dailyMap.set(closing.business_date, dailyClosings)

        const deviceClosings = deviceMap.get(closing.device_id) ?? []
        deviceClosings.push(closing)
        deviceMap.set(closing.device_id, deviceClosings)
      }

      const nextDailyRows = [...dailyMap.entries()]
        .map(([businessDate, rows]) => {
          const totals = summarizeClosings(rows)
          const totalDevices = new Set(rows.map(row => row.device_id)).size
          return {
            business_date: businessDate,
            closing_count: rows.length,
            total_devices: totalDevices,
            total_coins_in: totals.coinsIn,
            total_withdraw: totals.withdraw,
            total_income: totals.income,
            total_bet: totals.bet,
            total_win: totals.win,
            total_spins: totals.spins,
            total_house_take: totals.houseTake,
            total_jackpot: totals.jackpot,
            rtp_percent: totals.bet > 0 ? (totals.win / totals.bet) * 100 : 0,
            house_edge_percent: totals.bet > 0 ? (totals.houseTake / totals.bet) * 100 : 0,
            closings: rows,
          }
        })
        .sort((a, b) => b.business_date.localeCompare(a.business_date))

      const nextDeviceRows = [...deviceMap.entries()]
        .map(([deviceId, rows]) => {
          const totals = summarizeClosings(rows)
          const latest = rows[0]
          return {
            device_id: deviceId,
            device_name: latest?.device_name ?? null,
            deployment_mode: latest?.deployment_mode ?? null,
            closing_count: rows.length,
            coins_in_total: totals.coinsIn,
            withdraw_total: totals.withdraw,
            income_total: totals.income,
            bet_total: totals.bet,
            win_total: totals.win,
            spins_total: totals.spins,
            house_take_total: totals.houseTake,
            jackpot_total: totals.jackpot,
            rtp_percent: totals.bet > 0 ? (totals.win / totals.bet) * 100 : 0,
            house_edge_percent: totals.bet > 0 ? (totals.houseTake / totals.bet) * 100 : 0,
            closings: rows,
          }
        })
        .sort((a, b) => {
          if (b.coins_in_total !== a.coins_in_total) return b.coins_in_total - a.coins_in_total
          return a.device_id.localeCompare(b.device_id)
        })

      setDailyRows(nextDailyRows)
      setDeviceRows(nextDeviceRows)
      setLoading(false)
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [dateFrom, dateTo])

  const summary = useMemo<Summary>(() => {
    const totals = summarizeClosings(deviceRows.flatMap(row => row.closings))
    return {
      totalDevices: deviceRows.length,
      closingCount: deviceRows.reduce((acc, row) => acc + row.closing_count, 0),
      coinsIn: totals.coinsIn,
      withdraw: totals.withdraw,
      income: totals.income,
      bet: totals.bet,
      win: totals.win,
      spins: totals.spins,
      houseTake: totals.houseTake,
      jackpot: totals.jackpot,
    }
  }, [deviceRows])

  const byDate = useMemo(() => {
    return dailyRows.map(row => [row.business_date, row] as const)
  }, [dailyRows])

  return {
    loading,
    error,
    dailyRows,
    deviceRows,
    summary,
    byDate,
  }
}
