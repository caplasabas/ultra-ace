// src/hooks/useDevices.ts
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const DEVICES_POLL_MS = 1000

export type DeviceRow = {
  device_id: string
  name?: string | null
  balance?: number | null
  coins_in_total?: number | null
  hopper_balance?: number | null
  bet_total?: number | null
  win_total?: number | null
  house_take_total?: number | null
  last_bet_amount?: number | null
  withdraw_total?: number | null
  spins_total?: number | null
  prize_pool_contrib_total?: number | null
  prize_pool_paid_total?: number | null
  current_game_id?: string | null
  current_game_name?: string | null
  device_status?: 'idle' | 'playing' | 'offline' | null
  active_session_id?: number | null
  session_started_at?: string | null
  session_last_heartbeat?: string | null
  session_ended_at?: string | null
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
  updated_at?: string | null
}

export function useDevices() {
  const [rows, setRows] = useState<DeviceRow[]>([])

  async function fetchAll() {
    const { data, error } = await supabase.from('devices_dashboard_live').select('*').order('name')
    if (!error) setRows(data ?? [])
  }

  useEffect(() => {
    void fetchAll()

    const channel = supabase
      .channel('dashboard-devices')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'devices' }, fetchAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'device_game_sessions' }, fetchAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jackpot_payout_queue' }, fetchAll)
      .subscribe()

    const poll = window.setInterval(() => {
      void fetchAll()
    }, DEVICES_POLL_MS)

    return () => {
      window.clearInterval(poll)
      void supabase.removeChannel(channel)
    }
  }, [])

  return rows
}
