import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export type RuntimeMode = 'BASE' | 'HAPPY'

export type RtpProfile = {
  id: string
  name: string
  mode: RuntimeMode
  house_pct: number
  pool_pct: number
  player_pct: number
  prize_pct: number
  enabled: boolean
  sort_order: number
}

export type CasinoRuntime = {
  id: boolean
  active_mode: RuntimeMode
  base_profile_id: string
  happy_profile_id: string
  manual_happy_enabled: boolean
  auto_happy_enabled: boolean
  prize_pool_balance: number
  happy_hour_prize_balance: number
  prize_pool_goal: number
  hopper_alert_threshold: number
  updated_at: string
  active_target_rtp_pct?: number
}

export function useCasinoRuntime() {
  const [runtime, setRuntime] = useState<CasinoRuntime | null>(null)
  const [profiles, setProfiles] = useState<RtpProfile[]>([])

  async function fetchRuntime() {
    const { data, error } = await supabase.from('casino_runtime_live').select('*').eq('id', true).single()
    if (!error) setRuntime(data as CasinoRuntime)
  }

  async function fetchProfiles() {
    const { data, error } = await supabase
      .from('rtp_profiles')
      .select('*')
      .eq('enabled', true)
      .order('sort_order')

    if (!error) setProfiles((data ?? []) as RtpProfile[])
  }

  useEffect(() => {
    fetchRuntime()
    fetchProfiles()

    const runtimeChannel = supabase
      .channel('dashboard-casino-runtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'casino_runtime' }, fetchRuntime)
      .subscribe()

    const profilesChannel = supabase
      .channel('dashboard-rtp-profiles')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rtp_profiles' }, fetchProfiles)
      .subscribe()

    // Fallback polling to avoid stale runtime UI if realtime drops updates.
    const poll = window.setInterval(fetchRuntime, 2000)

    return () => {
      void supabase.removeChannel(runtimeChannel)
      void supabase.removeChannel(profilesChannel)
      window.clearInterval(poll)
    }
  }, [])

  async function updateRuntime(patch: Partial<CasinoRuntime>) {
    const { error } = await supabase.from('casino_runtime').update(patch).eq('id', true)
    if (error) return { ok: false, error }

    await supabase.rpc('recompute_casino_mode')
    await fetchRuntime()
    return { ok: true }
  }

  async function setHappyHour(enabled: boolean) {
    const { error } = await supabase.rpc('set_happy_hour_enabled', { p_enabled: enabled })
    if (error) return { ok: false, error }

    await fetchRuntime()
    return { ok: true }
  }

  async function demoReset(keepDeviceIds: string[]) {
    const payload = (keepDeviceIds ?? []).map(v => v.trim()).filter(Boolean)
    const { error } = await supabase.rpc('demo_reset_runtime_metrics', {
      p_keep_device_ids: payload,
    })
    if (error) return { ok: false, error }

    await fetchRuntime()
    return { ok: true }
  }

  return {
    runtime,
    profiles,
    updateRuntime,
    setHappyHour,
    demoReset,
  }
}
