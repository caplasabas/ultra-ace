// src/hooks/useDevices.ts
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export type DeviceRow = {
  device_id: string
  name?: string | null
  balance?: number | null
  coins_in_total?: number | null
  hopper_balance?: number | null
  bet_total?: number | null
  win_total?: number | null
  withdraw_total?: number | null
  spins_total?: number | null
  prize_pool_contrib_total?: number | null
  prize_pool_paid_total?: number | null
  updated_at?: string | null
}

export function useDevices() {
  const [rows, setRows] = useState<DeviceRow[]>([])

  async function fetchAll() {
    const { data, error } = await supabase.from('devices').select('*').order('name')
    if (!error) setRows(data ?? [])
  }

  useEffect(() => {
    fetchAll()

    const channel = supabase
      .channel('dashboard-devices')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'devices',
        },
        payload => {
          if (payload.eventType === 'DELETE') {
            setRows(prev => prev.filter(d => d.device_id !== payload.old.device_id))
            return
          }

          if (payload.eventType === 'INSERT') {
            setRows(prev => {
              if (prev.some(d => d.device_id === payload.new.device_id)) return prev
              return [...prev, payload.new as DeviceRow]
            })
            return
          }

          setRows(prev => prev.map(d => (d.device_id === payload.new.device_id ? { ...d, ...payload.new } : d)))
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [])

  return rows
}
