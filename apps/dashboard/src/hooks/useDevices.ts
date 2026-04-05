// src/hooks/useDevices.ts
import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

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
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'devices' }, payload => {
        const changed = payload.new ?? {}
        // only refetch for critical realtime fields
        if (
          'balance' in changed ||
          'coins_in_total' in changed ||
          'hopper_balance' in changed ||
          'last_bet_amount' in changed ||
          'bet_total' in changed ||
          'win_total' in changed ||
          'spins_total' in changed
        ) {
          fetchAll()
        }
      })
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
      .subscribe()

    return () => {
      // No poll to clear
      void supabase.removeChannel(channel)
    }
  }, [])

  return rows
}
