// src/hooks/useGames.ts
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { isPollingVisible } from '../lib/polling'

const GAMES_POLL_MS = 30000

export function useGames(type?: 'arcade' | 'casino') {
  const [rows, setRows] = useState<any[]>([])

  async function fetchGames() {
    if (!isPollingVisible()) return

    let query = supabase.from('games').select('*').order('name')

    if (type) query = query.eq('type', type)

    const { data } = await query
    setRows(data ?? [])
  }

  useEffect(() => {
    void fetchGames()

    const poll = window.setInterval(() => {
      void fetchGames()
    }, GAMES_POLL_MS)
    const onVisibilityChange = () => {
      if (isPollingVisible()) void fetchGames()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      window.clearInterval(poll)
      document.removeEventListener('visibilitychange', onVisibilityChange)
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
