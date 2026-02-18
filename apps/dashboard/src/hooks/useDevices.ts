// src/hooks/useDevices.ts
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export function useDevices() {
  const [rows, setRows] = useState<any[]>([])

  async function fetchAll() {
    const { data, error } = await supabase
      .from('devices')
      .select('device_id, name, balance, updated_at')
      .order('name')
    if (!error) setRows(data ?? [])
  }

  useEffect(() => {
    fetchAll()

    const channel = supabase
      .channel('dashboard-devices')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'devices',
        },
        payload => {
          setRows(prev =>
            prev.map(d => (d.device_id === payload.new.device_id ? { ...d, ...payload.new } : d)),
          )
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [])

  return rows
}
