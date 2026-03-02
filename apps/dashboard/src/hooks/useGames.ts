// src/hooks/useGames.ts
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export function useGames(type?: 'arcade' | 'casino') {
  const [rows, setRows] = useState<any[]>([])

  async function fetchGames() {
    let query = supabase.from('games').select('*').order('name')

    if (type) query = query.eq('type', type)

    const { data } = await query
    setRows(data ?? [])
  }

  useEffect(() => {
    fetchGames()

    const channel = supabase
      .channel('dashboard-games')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games' }, payload => {
        const oldRow = payload.old
        const newRow = payload.new

        const relevant = oldRow.enabled !== newRow.enabled || oldRow.version !== newRow.version

        if (!relevant) return

        setRows(prev => prev.map(g => (g.id === newRow.id ? { ...g, ...newRow } : g)))
      })
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [type])

  return rows
}

export async function toggleGame(gameId: string, enabled: boolean) {
  const { error } = await supabase.from('games').update({ enabled }).eq('id', gameId)

  if (error) {
    return { ok: false, error }
  }

  return { ok: true }
}

export async function getGame(gameId: string) {
  const { data, error } = await supabase.from('games').select('*').eq('id', gameId).single()
  if (error) return { ok: false, error, data: null }
  return { ok: true, data }
}
