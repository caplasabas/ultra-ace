// src/hooks/useJackpot.ts
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export function useJackpot() {
  const [state, setState] = useState<{
    goal: number
    total: number
    remaining: number
    happyHour: boolean
  } | null>(null)

  async function refresh() {
    const { data: cfg } = await supabase
      .from('jackpot_state')
      .select('goal')
      .eq('id', true)
      .single()

    const { data: total } = await supabase.from('jackpot_total').select('total').single()

    if (!cfg || !total) return

    setState({
      goal: cfg.goal,
      total: total.total,
      remaining: Math.max(cfg.goal - total.total, 0),
      happyHour: total.total >= cfg.goal,
    })
  }

  useEffect(() => {
    refresh().then(() => {})

    const channel = supabase
      .channel('jackpot-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'jackpot_ledger_events' },
        refresh,
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  return state
}
