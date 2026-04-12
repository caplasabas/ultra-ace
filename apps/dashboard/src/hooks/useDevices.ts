// src/hooks/useDevices.ts
import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

const DEVICES_POLL_MS = 1000

export type DeviceRow = {
  device_id: string
  name?: string | null
  balance?: number | null
  all_balance?: number | null
  eligible_balance?: number | null
  coins_in_total?: number | null
  all_coins_in_total?: number | null
  eligible_coins_in_total?: number | null
  hopper_balance?: number | null
  hopper_in_total?: number | null
  hopper_out_total?: number | null
  all_hopper_balance?: number | null
  all_hopper_in_total?: number | null
  all_hopper_out_total?: number | null
  eligible_hopper_balance?: number | null
  eligible_hopper_in_total?: number | null
  eligible_hopper_out_total?: number | null
  bet_total?: number | null
  all_bet_total?: number | null
  eligible_bet_total?: number | null
  win_total?: number | null
  all_win_total?: number | null
  eligible_win_total?: number | null
  house_take_total?: number | null
  all_house_take_total?: number | null
  eligible_house_take_total?: number | null
  last_bet_amount?: number | null
  withdraw_total?: number | null
  all_withdraw_total?: number | null
  eligible_withdraw_total?: number | null
  spins_total?: number | null
  all_spins_total?: number | null
  eligible_spins_total?: number | null
  prize_pool_contrib_total?: number | null
  prize_pool_paid_total?: number | null
  all_prize_pool_contrib_total?: number | null
  all_prize_pool_paid_total?: number | null
  eligible_prize_pool_contrib_total?: number | null
  eligible_prize_pool_paid_total?: number | null
  jackpot_contrib_total?: number | null
  all_jackpot_contrib_total?: number | null
  eligible_jackpot_contrib_total?: number | null
  jackpot_win_total?: number | null
  all_jackpot_win_total?: number | null
  eligible_jackpot_win_total?: number | null
  arcade_total?: number | null
  all_arcade_total?: number | null
  eligible_arcade_total?: number | null
  arcade_credit?: number | null
  all_arcade_credit?: number | null
  eligible_arcade_credit?: number | null
  arcade_credit_updated_at?: string | null
  arcade_time_ms?: number | null
  all_arcade_time_ms?: number | null
  eligible_arcade_time_ms?: number | null
  arcade_time_updated_at?: string | null
  arcade_session_started_at?: string | null
  arcade_time_last_deducted_at?: string | null
  current_game_id?: string | null
  current_game_name?: string | null
  current_game_type?: 'arcade' | 'casino' | null
  device_status?: 'idle' | 'playing' | 'offline' | null
  deployment_mode?: 'online' | 'maintenance' | null
  withdraw_enabled?: boolean | null
  active_session_id?: number | null
  session_started_at?: string | null
  session_last_heartbeat?: string | null
  session_ended_at?: string | null
  last_seen_at?: string | null
  last_activity_at?: string | null
  runtime_mode?: 'BASE' | 'HAPPY' | null
  is_free_game?: boolean | null
  free_spins_left?: number | null
  pending_free_spins?: number | null
  show_free_spin_intro?: boolean | null
  current_spin_id?: number | null
  session_metadata?: Record<string, any> | null
  jackpot_selected?: boolean | null
  jackpot_target_amount?: number | null
  jackpot_remaining_amount?: number | null
  jackpot_spins_until_start?: number | null
  arcade_shell_version?: string | null
  current_ip?: string | null
  updated_at?: string | null
  agent_name?: string | null
  area_name?: string | null
  station_name?: string | null
}

export function useDevices() {
  const [rows, setRows] = useState<DeviceRow[]>([])

  // Debounce fetchAll to reduce initial load churn and rapid updates
  const fetchTimeoutRef = useRef<any>(null)

  async function fetchAll() {
    if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current)

    fetchTimeoutRef.current = setTimeout(async () => {
      const { data, error } = await supabase
        .from('devices_dashboard_live')
        .select('*')
        .order('name')
      if (!error) setRows(data ?? [])
    }, 100)
  }

  useEffect(() => {
    void fetchAll()

    const channel = supabase
      .channel('dashboard-devices')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'devices' }, fetchAll)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'device_game_sessions' },
        fetchAll,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'jackpot_payout_queue' },
        fetchAll,
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'device_daily_stats' }, fetchAll)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'device_metric_events' },
        fetchAll,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'device_admin_commands' },
        fetchAll,
      )
      .subscribe()

    const poll = window.setInterval(() => {
      void fetchAll()
    }, DEVICES_POLL_MS)

    return () => {
      if (fetchTimeoutRef.current) {
        clearTimeout(fetchTimeoutRef.current)
        fetchTimeoutRef.current = null
      }
      window.clearInterval(poll)
      void supabase.removeChannel(channel)
    }
  }, [])

  return rows
}
