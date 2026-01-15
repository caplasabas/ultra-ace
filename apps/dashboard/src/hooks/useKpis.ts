// src/hooks/useKpis.ts
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export function useKpis() {
  const [data, setData] = useState<any>(null)

  async function refresh() {
    const { data } = await supabase.rpc('dashboard_kpis')
    if (data && data.length > 0) {
      setData(data[0])
    }
  }

  useEffect(() => {
    refresh().then(() => {})

    const channel = supabase
      .channel('kpis-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ledger_events' }, refresh)
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  return data
}
