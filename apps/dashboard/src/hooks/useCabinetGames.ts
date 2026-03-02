// src/hooks/useCabinetGames.ts
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export function useCabinetGames(deviceId: string | null) {
  const [rows, setRows] = useState<any[]>([])

  async function fetchCabinet() {
    if (!deviceId) return

    const { data, error } = await supabase
      .from('games')
      .select(
        `
        id,
        name,
        type,
        enabled,
        version,
        package_url,
        emulator_core,
        cabinet_games (
          installed,
          device_id
        )
      `,
      )
      .order('name')

    if (error) return

    const mapped =
      data?.map(g => {
        const cabinetRow = g.cabinet_games?.find((c: any) => c.device_id === deviceId)

        return {
          id: g.id,
          name: g.name,
          type: g.type,
          enabled: g.enabled,
          version: g.version,
          package_url: g.package_url,
          installed: cabinetRow?.installed ?? false,
        }
      }) ?? []

    setRows(mapped)
  }

  useEffect(() => {
    if (!deviceId) return

    fetchCabinet()

    const channel = supabase
      .channel(`dashboard-cabinet-${deviceId}`)

      // cabinet-specific changes
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'cabinet_games',
          filter: `device_id=eq.${deviceId}`,
        },
        fetchCabinet,
      )

      // global game changes
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'games',
        },
        fetchCabinet,
      )

      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [deviceId])

  return rows
}

export async function toggleCabinetGame(deviceId: string, gameId: string, installed: boolean) {
  const { error } = await supabase.from('cabinet_games').upsert(
    {
      device_id: deviceId,
      game_id: gameId,
      installed,
    },
    { onConflict: 'device_id,game_id' },
  )

  if (error) {
    return { ok: false, error }
  }

  return { ok: true }
}
