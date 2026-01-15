// src/hooks/useDevices.ts
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export function useDevices() {
  const [rows, setRows] = useState<any[]>([])

  async function refresh() {
    const { data } = await supabase
      .from('devices_dashboard')
      .select('device_id, name, balance, last_seen')

    setRows(data ?? [])
  }

  useEffect(() => {
    refresh()

    const channel = supabase
      .channel('devices-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'devices' }, refresh)
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  return rows
}
