import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

type DeviceRow = {
  device_id: string
  name: string | null
  deployment_mode: string | null
  balance: number | string | null
}

type DeviceDailyStatsRow = {
  device_id: string
  stat_date: string
  coins_in_total: number | string | null
  hopper_in_total: number | string | null
  hopper_out_total: number | string | null
  bet_total: number | string | null
  win_total: number | string | null
  withdraw_total: number | string | null
  spins_total: number | string | null
  house_take_total: number | string | null
}

type JackpotOverrideRow = {
  amount_total: number
  created_at: string
  goal_snapshot: Record<string, unknown> | null
  status: string | null
}

export type AccountingDailyRow = {
  business_date: string
  total_devices: number
  total_coins_in: number
  total_hopper_in: number
  total_hopper_out: number
  total_bet: number
  total_win: number
  total_withdraw: number
  total_spins: number
  total_house_take: number
  total_jackpot_override: number
  rtp_percent: number
  house_edge_percent: number
}

export type AccountingDeviceRow = {
  device_id: string
  device_name: string | null
  deployment_mode: string | null
  balance: number
  coins_in_total: number
  hopper_in_total: number
  hopper_out_total: number
  bet_total: number
  win_total: number
  withdraw_total: number
  spins_total: number
  house_take_total: number
  jackpot_override_total: number
  rtp_percent: number
  house_edge_percent: number
  net_income: number
  gross_income: number
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
  jackpotOverride: number
  netIncome: number
  grossIncome: number
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

function toManilaEndExclusiveIso(date: string) {
  const next = new Date(`${date}T00:00:00+08:00`)
  next.setUTCDate(next.getUTCDate() + 1)
  const year = next.getUTCFullYear()
  const month = String(next.getUTCMonth() + 1).padStart(2, '0')
  const day = String(next.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}T00:00:00+08:00`
}

function emptyDailyRow(businessDate: string): AccountingDailyRow {
  return {
    business_date: businessDate,
    total_devices: 0,
    total_coins_in: 0,
    total_hopper_in: 0,
    total_hopper_out: 0,
    total_bet: 0,
    total_win: 0,
    total_withdraw: 0,
    total_spins: 0,
    total_house_take: 0,
    total_jackpot_override: 0,
    rtp_percent: 0,
    house_edge_percent: 0,
  }
}

function emptyDeviceRow(deviceId: string, deviceInfo?: DeviceRow): AccountingDeviceRow {
  return {
    device_id: deviceId,
    device_name: deviceInfo?.name ?? null,
    deployment_mode: deviceInfo?.deployment_mode ?? null,
    balance: asNumber(deviceInfo?.balance),
    coins_in_total: 0,
    hopper_in_total: 0,
    hopper_out_total: 0,
    bet_total: 0,
    win_total: 0,
    withdraw_total: 0,
    spins_total: 0,
    house_take_total: 0,
    jackpot_override_total: 0,
    rtp_percent: 0,
    house_edge_percent: 0,
    net_income: 0,
    gross_income: 0,
  }
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

      const [dailyStatsResult, devicesResult, jackpotOverridesResult] = await Promise.all([
        supabase
          .from('device_daily_stats')
          .select(
            'device_id,stat_date,coins_in_total:included_coins_in_amount,hopper_in_total:included_hopper_in_amount,hopper_out_total:included_hopper_out_amount,bet_total:included_bet_amount,win_total:included_win_amount,withdraw_total:included_withdrawal_amount,spins_total:included_spins_count,house_take_total:included_house_take_amount',
          )
          .gte('stat_date', dateFrom)
          .lte('stat_date', dateTo),

        supabase.from('devices').select('device_id,name,deployment_mode,balance'),

        supabase
          .from('jackpot_pots')
          .select('amount_total,created_at,goal_snapshot,status')
          .contains('goal_snapshot', { source: 'dashboard_device_override' })
          .neq('status', 'processing')
          .gte('created_at', toManilaStartIso(dateFrom))
          .lt('created_at', toManilaEndExclusiveIso(dateTo))
          .order('created_at', { ascending: false }),
      ])

      if (cancelled) return

      const nextErrors = [
        dailyStatsResult.error?.message,
        devicesResult.error?.message,
        jackpotOverridesResult.error?.message,
      ].filter(Boolean)

      if (nextErrors.length > 0) {
        setError(nextErrors.join(' | '))
      }

      const statRows = (dailyStatsResult.data ?? []) as DeviceDailyStatsRow[]
      const deviceInfoRows = (devicesResult.data ?? []) as DeviceRow[]
      const jackpotRows = (jackpotOverridesResult.data ?? []) as JackpotOverrideRow[]

      const deviceInfoById = new Map(deviceInfoRows.map(row => [row.device_id, row] as const))
      const dailyMap = new Map<string, AccountingDailyRow>()
      const dailyDeviceSets = new Map<string, Set<string>>()
      const deviceMap = new Map<string, AccountingDeviceRow>()

      for (const stat of statRows) {
        const businessDate = String(stat.stat_date)
        const deviceId = String(stat.device_id)
        const deviceInfo = deviceInfoById.get(deviceId)
        const coinsIn = Math.max(asNumber(stat.coins_in_total), 0)

        const dailyCurrent = dailyMap.get(businessDate) ?? emptyDailyRow(businessDate)

        dailyCurrent.total_coins_in += coinsIn
        dailyCurrent.total_hopper_in += asNumber(stat.hopper_in_total)
        dailyCurrent.total_hopper_out += asNumber(stat.hopper_out_total)
        dailyCurrent.total_bet += asNumber(stat.bet_total)
        dailyCurrent.total_win += asNumber(stat.win_total)
        dailyCurrent.total_withdraw += asNumber(stat.withdraw_total)
        dailyCurrent.total_spins += asNumber(stat.spins_total)
        dailyCurrent.total_house_take += asNumber(stat.house_take_total)
        dailyMap.set(businessDate, dailyCurrent)

        const dailyDeviceSet = dailyDeviceSets.get(businessDate) ?? new Set<string>()
        dailyDeviceSet.add(deviceId)
        dailyDeviceSets.set(businessDate, dailyDeviceSet)

        const deviceCurrent = deviceMap.get(deviceId) ?? emptyDeviceRow(deviceId, deviceInfo)

        deviceCurrent.device_name = deviceInfo?.name ?? deviceCurrent.device_name
        deviceCurrent.deployment_mode = deviceInfo?.deployment_mode ?? deviceCurrent.deployment_mode
        deviceCurrent.balance = asNumber(deviceInfo?.balance ?? deviceCurrent.balance)
        deviceCurrent.coins_in_total += coinsIn
        deviceCurrent.hopper_in_total += asNumber(stat.hopper_in_total)
        deviceCurrent.hopper_out_total += asNumber(stat.hopper_out_total)
        deviceCurrent.bet_total += asNumber(stat.bet_total)
        deviceCurrent.win_total += asNumber(stat.win_total)
        deviceCurrent.withdraw_total += asNumber(stat.withdraw_total)
        deviceCurrent.spins_total += asNumber(stat.spins_total)
        deviceCurrent.house_take_total += asNumber(stat.house_take_total)

        deviceMap.set(deviceId, deviceCurrent)
      }

      for (const override of jackpotRows) {
        const businessDate = formatManilaYmd(String(override.created_at))
        const amount = asNumber(override.amount_total)
        const snapshot = (override.goal_snapshot ?? {}) as Record<string, unknown>
        const deviceId = String(snapshot.deviceId ?? '').trim()

        const dailyCurrent = dailyMap.get(businessDate) ?? emptyDailyRow(businessDate)
        dailyCurrent.total_jackpot_override += amount
        dailyMap.set(businessDate, dailyCurrent)

        if (deviceId) {
          const deviceInfo = deviceInfoById.get(deviceId)
          const deviceCurrent = deviceMap.get(deviceId) ?? emptyDeviceRow(deviceId, deviceInfo)
          deviceCurrent.jackpot_override_total += amount
          deviceMap.set(deviceId, deviceCurrent)
        }
      }

      const nextDailyRows = [...dailyMap.values()]
        .map(row => {
          const totalDevices = dailyDeviceSets.get(row.business_date)?.size ?? 0
          const rtpPercent = row.total_bet > 0 ? (row.total_win / row.total_bet) * 100 : 0
          const houseEdgePercent =
            row.total_bet > 0 ? (row.total_house_take / row.total_bet) * 100 : 0

          return {
            ...row,
            total_devices: totalDevices,
            rtp_percent: rtpPercent,
            house_edge_percent: houseEdgePercent,
          }
        })
        .sort((a, b) => b.business_date.localeCompare(a.business_date))

      const nextDeviceRows = [...deviceMap.values()]
        .map(row => {
          const rtpPercent = row.bet_total > 0 ? (row.win_total / row.bet_total) * 100 : 0
          const houseEdgePercent =
            row.bet_total > 0 ? (row.house_take_total / row.bet_total) * 100 : 0
          const coinsOut = row.hopper_out_total
          const netIncome =
            row.coins_in_total +
            coinsOut -
            row.balance -
            row.house_take_total -
            row.jackpot_override_total
          const grossIncome = row.house_take_total + netIncome

          return {
            ...row,
            rtp_percent: rtpPercent,
            house_edge_percent: houseEdgePercent,
            net_income: netIncome,
            gross_income: grossIncome,
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
    return deviceRows.reduce(
      (acc, row) => {
        acc.totalDevices += 1
        acc.balance += asNumber(row.balance)
        acc.coinsIn += asNumber(row.coins_in_total)
        acc.hopperIn += asNumber(row.hopper_in_total)
        acc.hopperOut += asNumber(row.hopper_out_total)
        acc.bet += asNumber(row.bet_total)
        acc.win += asNumber(row.win_total)
        acc.withdraw += asNumber(row.withdraw_total)
        acc.spins += asNumber(row.spins_total)
        acc.houseTake += asNumber(row.house_take_total)
        acc.jackpotOverride += asNumber(row.jackpot_override_total)
        acc.netIncome += asNumber(row.net_income)
        acc.grossIncome += asNumber(row.gross_income)
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
        jackpotOverride: 0,
        netIncome: 0,
        grossIncome: 0,
      },
    )
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
