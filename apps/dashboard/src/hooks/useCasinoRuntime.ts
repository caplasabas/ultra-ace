import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const RUNTIME_POLL_MS = 2500
const RTP_PROFILES_POLL_MS = 3000

export type RuntimeMode = 'BASE' | 'HAPPY'
export type JackpotDeliveryMode = 'TARGET_FIRST' | 'AUTHENTIC_PAYTABLE'

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

export type UpdateRtpProfilePatch = Partial<
  Pick<RtpProfile, 'name' | 'house_pct' | 'pool_pct' | 'player_pct' | 'prize_pct' | 'enabled' | 'sort_order'>
>

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
  jackpot_pool_balance: number
  jackpot_pool_goal: number
  jackpot_contrib_pct: number
  jackpot_min_winners: number
  jackpot_max_winners: number
  jackpot_delay_min_spins: number
  jackpot_delay_max_spins: number
  jackpot_chunk_min: number
  jackpot_chunk_max: number
  jackpot_win_variance: number
  jackpot_payout_curve: 'flat' | 'front' | 'center' | 'back'
  jackpot_delivery_mode: JackpotDeliveryMode
  jackpot_pending_payout: boolean
  last_jackpot_triggered_at: string | null
  active_happy_pot_id: number | null
  active_jackpot_pot_id: number | null
  pool_goal_mode: 'amount' | 'spins' | 'time'
  pool_goal_spins: number
  pool_goal_time_seconds: number
  happy_pool_spin_counter: number
  jackpot_pool_spin_counter: number
  happy_pool_goal_anchor_at: string | null
  jackpot_pool_goal_anchor_at: string | null
  happy_pots_queued_count: number
  happy_pots_queued_amount: number
  jackpot_pots_queued_count: number
  jackpot_pots_queued_amount: number
  max_win_enabled: boolean
  max_win_multiplier: number
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
    void fetchRuntime()
    void fetchProfiles()

    const runtimePoll = window.setInterval(() => {
      void fetchRuntime()
    }, RUNTIME_POLL_MS)
    const profilesPoll = window.setInterval(() => {
      void fetchProfiles()
    }, RTP_PROFILES_POLL_MS)

    return () => {
      window.clearInterval(runtimePoll)
      window.clearInterval(profilesPoll)
    }
  }, [])

  async function updateRuntime(patch: Partial<CasinoRuntime>) {
    const { error } = await supabase.from('casino_runtime').update(patch).eq('id', true)
    if (error) return { ok: false, error }

    await supabase.rpc('recompute_casino_mode')
    await fetchRuntime()
    return { ok: true }
  }

  async function updateProfile(profileId: string, patch: UpdateRtpProfilePatch) {
    const { error } = await supabase.from('rtp_profiles').update(patch).eq('id', profileId)
    if (error) return { ok: false, error }

    await fetchProfiles()
    await fetchRuntime()
    return { ok: true }
  }

  async function setHappyHour(enabled: boolean) {
    const { error } = await supabase.rpc('set_happy_hour_enabled', { p_enabled: enabled })
    if (error) return { ok: false, error }

    await fetchRuntime()
    return { ok: true }
  }

  async function demoReset() {
    const { error } = await supabase.rpc('demo_reset_runtime_metrics', {
      p_keep_device_ids: [],
    })
    if (error) return { ok: false, error }

    await fetchRuntime()
    return { ok: true }
  }

  async function enqueueDevJackpotTest({
    amount,
    deviceIds,
    winners,
    delayMin,
    delayMax,
    ignoreMaxWin,
  }: {
    amount: number
    deviceIds: string[]
    winners: number
    delayMin: number
    delayMax: number
    ignoreMaxWin?: boolean
  }) {
    const { data, error } = await supabase.rpc('enqueue_dev_jackpot_test', {
      p_amount: amount,
      p_device_ids: deviceIds,
      p_winners: winners,
      p_delay_min: delayMin,
      p_delay_max: delayMax,
      p_ignore_max_win: Boolean(ignoreMaxWin),
    })
    if (error) return { ok: false, error }

    await fetchRuntime()
    return { ok: true, data }
  }

  return {
    runtime,
    profiles,
    updateRuntime,
    updateProfile,
    setHappyHour,
    demoReset,
    enqueueDevJackpotTest,
  }
}
