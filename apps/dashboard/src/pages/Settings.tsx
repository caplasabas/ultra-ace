import { useEffect, useMemo, useState } from 'react'
import { type JackpotDeliveryMode, useCasinoRuntime } from '../hooks/useCasinoRuntime'
import { useDevices } from '../hooks/useDevices'
import { getGame, toggleGame, useGames } from '../hooks/useGames'
import { prepareGamePackage, purgeGamePackages, removeGamePackage } from '../lib/arcadeAdmin'
import { supabase } from '../lib/supabase'

export default function Settings() {
  const games = useGames()
  const devices = useDevices()
  const {
    runtime,
    profiles,
    updateRuntime,
    updateProfile,
    setHappyHour,
    demoReset,
    enqueueDevJackpotTest,
  } = useCasinoRuntime()

  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [isRuntimeFormDirty, setIsRuntimeFormDirty] = useState(false)
  const [hopperAlertsEnabled, setHopperAlertsEnabled] = useState(() => {
    try {
      return localStorage.getItem('hopperAlertsEnabled') === 'true'
    } catch {
      return false
    }
  })

  const [baseProfileId, setBaseProfileId] = useState('')
  const [happyProfileId, setHappyProfileId] = useState('')
  const [prizePoolGoal, setPrizePoolGoal] = useState('10000')
  const [prizePoolBalance, setPrizePoolBalance] = useState('0')
  const [jackpotPoolGoal, setJackpotPoolGoal] = useState('10000')
  const [jackpotPoolBalance, setJackpotPoolBalance] = useState('0')
  const [baseHousePctInput, setBaseHousePctInput] = useState('20')
  const [baseJackpotPctInput, setBaseJackpotPctInput] = useState('20')
  const [baseHappyPctInput, setBaseHappyPctInput] = useState('60')
  const [happyHousePctInput, setHappyHousePctInput] = useState('20')
  const [happyJackpotPctInput, setHappyJackpotPctInput] = useState('20')
  const [happyHappyPctInput, setHappyHappyPctInput] = useState('60')
  const [jackpotMinWinners, setJackpotMinWinners] = useState('1')
  const [jackpotMaxWinners, setJackpotMaxWinners] = useState('5')
  const [jackpotDelayMinSpins, setJackpotDelayMinSpins] = useState('2')
  const [jackpotDelayMaxSpins, setJackpotDelayMaxSpins] = useState('3')
  const [jackpotWinVariance, setJackpotWinVariance] = useState('90')
  const [jackpotPayoutCurve, setJackpotPayoutCurve] = useState<
    'flat' | 'front' | 'center' | 'back'
  >('center')
  const [jackpotDeliveryMode, setJackpotDeliveryMode] =
    useState<JackpotDeliveryMode>('TARGET_FIRST')
  const [poolGoalMode, setPoolGoalMode] = useState<'amount' | 'spins' | 'time'>('amount')
  const [poolGoalSpins, setPoolGoalSpins] = useState('1000')
  const [poolGoalTimeHours, setPoolGoalTimeHours] = useState('0')
  const [poolGoalTimeMinutes, setPoolGoalTimeMinutes] = useState('30')
  const [maxWinEnabled, setMaxWinEnabled] = useState(true)
  const [hopperAlertThreshold, setHopperAlertThreshold] = useState('500')
  const [autoHappy, setAutoHappy] = useState(true)
  const [resetConfirm, setResetConfirm] = useState('')
  const [testJackpotAmount, setTestJackpotAmount] = useState('5000')
  const [testJackpotWinners, setTestJackpotWinners] = useState('1')
  const [testDelayMinSpins, setTestDelayMinSpins] = useState('2')
  const [testDelayMaxSpins, setTestDelayMaxSpins] = useState('3')
  const [testIgnoreMaxWinCap, setTestIgnoreMaxWinCap] = useState(false)
  const [selectedDevDeviceIds, setSelectedDevDeviceIds] = useState<string[]>([])
  const [testSubmitting, setTestSubmitting] = useState(false)
  const [testResultMessage, setTestResultMessage] = useState<string | null>(null)
  const [globalPowerBusy, setGlobalPowerBusy] = useState<'restart' | 'shutdown' | 'reset' | null>(
    null,
  )
  const [globalOverrideBusy, setGlobalOverrideBusy] = useState(false)
  const [globalBalanceAmount, setGlobalBalanceAmount] = useState('0')
  const [globalBalanceKind, setGlobalBalanceKind] = useState<'debit' | 'credit'>('credit')
  const [globalBalanceAccountName, setGlobalBalanceAccountName] = useState(
    'Global Manual Accounting Override',
  )
  const [globalBalanceNotes, setGlobalBalanceNotes] = useState('')
  const [globalHopperAmount, setGlobalHopperAmount] = useState('0')
  const [globalHopperKind, setGlobalHopperKind] = useState<'debit' | 'credit'>('credit')
  const [globalHopperAccountName, setGlobalHopperAccountName] = useState(
    'Global Manual Hopper Override',
  )
  const [globalHopperNotes, setGlobalHopperNotes] = useState('')

  // Agents & Areas state
  const [agents, setAgents] = useState<any[]>([])
  const [areas, setAreas] = useState<any[]>([])
  const [newAgentName, setNewAgentName] = useState('')
  const [newAreaName, setNewAreaName] = useState('')
  const [selectedAgentForArea, setSelectedAgentForArea] = useState<string>('')

  // Load agents and areas
  useEffect(() => {
    async function loadAgentsAreas() {
      const { data: a } = await supabase.from('agents').select('*').order('name')
      const { data: ar } = await supabase.from('areas').select('*').order('name')
      setAgents(a ?? [])
      setAreas(ar ?? [])
    }

    loadAgentsAreas()
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem('hopperAlertsEnabled', String(hopperAlertsEnabled))
    } catch {
      /* empty */
    }
  }, [hopperAlertsEnabled])

  // CRUD functions for agents and areas
  async function createAgent() {
    if (!newAgentName.trim()) return

    await supabase.from('agents').insert({ name: newAgentName.trim() })
    setNewAgentName('')

    const { data } = await supabase.from('agents').select('*').order('name')
    setAgents(data ?? [])
  }

  async function createArea() {
    if (!newAreaName.trim() || !selectedAgentForArea) return

    await supabase.from('areas').insert({
      name: newAreaName.trim(),
      agent_id: selectedAgentForArea,
    })

    setNewAreaName('')
    setSelectedAgentForArea('')

    const { data } = await supabase.from('areas').select('*').order('name')
    setAreas(data ?? [])
  }

  // --- Helper functions for edit/delete ---
  async function deleteAgent(id: string) {
    if (!confirm('Delete this agent?')) return

    const { count } = await supabase
      .from('devices')
      .select('*', { count: 'exact', head: true })
      .eq('agent_id', id)

    if ((count ?? 0) > 0) {
      alert('Cannot delete agent: devices are still assigned')
      return
    }

    await supabase.from('agents').delete().eq('id', id)

    const { data } = await supabase.from('agents').select('*').order('name')
    setAgents(data ?? [])
  }

  async function deleteArea(id: string) {
    if (!confirm('Delete this area?')) return

    const { count } = await supabase
      .from('devices')
      .select('*', { count: 'exact', head: true })
      .eq('area_id', id)

    if ((count ?? 0) > 0) {
      alert('Cannot delete area: devices are still assigned')
      return
    }

    await supabase.from('areas').delete().eq('id', id)

    const { data } = await supabase.from('areas').select('*').order('name')
    setAreas(data ?? [])
  }

  async function renameAgent(id: string, current: string) {
    const next = prompt('Rename agent', current)
    if (!next || !next.trim()) return

    await supabase.from('agents').update({ name: next.trim() }).eq('id', id)

    const { data } = await supabase.from('agents').select('*').order('name')
    setAgents(data ?? [])
  }

  async function renameArea(id: string, current: string) {
    const next = prompt('Rename area', current)
    if (!next || !next.trim()) return

    await supabase.from('areas').update({ name: next.trim() }).eq('id', id)

    const { data } = await supabase.from('areas').select('*').order('name')
    setAreas(data ?? [])
  }

  // --- Mass Assignment state ---
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<string[]>([])
  const [bulkAgentId, setBulkAgentId] = useState('')
  const [bulkAreaId, setBulkAreaId] = useState('')

  // --- Mass Assignment function ---
  async function bulkAssign() {
    if (selectedDeviceIds.length === 0) {
      alert('No devices selected')
      return
    }

    if (!confirm('Apply assignment to selected devices?')) return

    await supabase
      .from('devices')
      .update({
        agent_id: bulkAgentId || null,
        area_id: bulkAreaId || null,
      })
      .in('device_id', selectedDeviceIds)

    alert('Assignment applied')
    setSelectedDeviceIds([])
  }

  function applyRuntimeToForm() {
    if (!runtime) return
    setBaseProfileId(runtime.base_profile_id)
    setHappyProfileId(runtime.happy_profile_id)
    setPrizePoolGoal(String(runtime.prize_pool_goal ?? 0))
    setPrizePoolBalance(String(runtime.prize_pool_balance ?? 0))
    setJackpotPoolGoal(String(runtime.jackpot_pool_goal ?? 10000))
    setJackpotPoolBalance(String(runtime.jackpot_pool_balance ?? 0))
    setJackpotMinWinners(String(runtime.jackpot_min_winners ?? 1))
    setJackpotMaxWinners(String(runtime.jackpot_max_winners ?? 5))
    setJackpotDelayMinSpins(String(runtime.jackpot_delay_min_spins ?? 2))
    setJackpotDelayMaxSpins(String(runtime.jackpot_delay_max_spins ?? 3))
    setJackpotWinVariance(String(runtime.jackpot_win_variance ?? 90))
    setJackpotPayoutCurve(
      (runtime.jackpot_payout_curve ?? 'center') as 'flat' | 'front' | 'center' | 'back',
    )
    setJackpotDeliveryMode((runtime.jackpot_delivery_mode ?? 'TARGET_FIRST') as JackpotDeliveryMode)
    setPoolGoalMode((runtime.pool_goal_mode ?? 'amount') as 'amount' | 'spins' | 'time')
    setPoolGoalSpins(String(runtime.pool_goal_spins ?? 1000))
    const totalMinutes = Math.max(1, Math.round((runtime.pool_goal_time_seconds ?? 1800) / 60))
    setPoolGoalTimeHours(String(Math.floor(totalMinutes / 60)))
    setPoolGoalTimeMinutes(String(totalMinutes % 60))
    setMaxWinEnabled(Boolean(runtime.max_win_enabled ?? true))
    setHopperAlertThreshold(String(runtime.hopper_alert_threshold ?? 500))
    setAutoHappy(Boolean(runtime.auto_happy_enabled))
  }

  useEffect(() => {
    if (!runtime) return
    if (isRuntimeFormDirty) return
    applyRuntimeToForm()
  }, [runtime, isRuntimeFormDirty])

  useEffect(() => {
    if (!errorMessage) return
    const t = setTimeout(() => setErrorMessage(null), 5000)
    return () => clearTimeout(t)
  }, [errorMessage])

  useEffect(() => {
    if (!successMessage) return
    const t = setTimeout(() => setSuccessMessage(null), 5000)
    return () => clearTimeout(t)
  }, [successMessage])

  useEffect(() => {
    if (!testResultMessage) return
    const t = setTimeout(() => setTestResultMessage(null), 5000)
    return () => clearTimeout(t)
  }, [testResultMessage])

  const baseProfiles = useMemo(() => profiles.filter(p => p.mode === 'BASE'), [profiles])
  const happyProfiles = useMemo(() => profiles.filter(p => p.mode === 'HAPPY'), [profiles])
  const devDevices = useMemo(
    () => devices.filter(device => (device.device_id ?? '').startsWith('dev-')),
    [devices],
  )
  const deviceIds = useMemo(
    () => devices.map(device => String(device.device_id ?? '').trim()).filter(Boolean),
    [devices],
  )
  const playingDevDeviceIds = useMemo(
    () =>
      devDevices
        .filter(device => device.device_status === 'playing')
        .map(device => device.device_id),
    [devDevices],
  )
  const selectedBaseProfile = useMemo(
    () => baseProfiles.find(p => p.id === baseProfileId) ?? null,
    [baseProfiles, baseProfileId],
  )
  const selectedHappyProfile = useMemo(
    () => happyProfiles.find(p => p.id === happyProfileId) ?? null,
    [happyProfiles, happyProfileId],
  )
  const baseHousePct = Math.max(0, Number(baseHousePctInput || 0))
  const baseJackpotPct = Math.max(0, Number(baseJackpotPctInput || 0))
  const baseHappyPct = Math.max(0, Number(baseHappyPctInput || 0))
  const happyHousePct = Math.max(0, Number(happyHousePctInput || 0))
  const happyJackpotPct = Math.max(0, Number(happyJackpotPctInput || 0))
  const happyHappyPct = Math.max(0, Number(happyHappyPctInput || 0))

  const baseSplitTotal = baseHousePct + baseJackpotPct + baseHappyPct
  const happySplitTotal = happyHousePct + happyJackpotPct + happyHappyPct
  const splitInvalid =
    !Number.isFinite(baseSplitTotal) ||
    !Number.isFinite(happySplitTotal) ||
    Math.abs(baseSplitTotal - 100) > 0.0001 ||
    Math.abs(happySplitTotal - 100) > 0.0001

  useEffect(() => {
    if (!selectedBaseProfile || !selectedHappyProfile) return
    if (isRuntimeFormDirty) return

    setBaseHousePctInput(String(selectedBaseProfile.house_pct ?? 0))
    setBaseJackpotPctInput(String(selectedBaseProfile.pool_pct ?? 0))
    setBaseHappyPctInput(String(selectedBaseProfile.player_pct ?? 0))
    setHappyHousePctInput(String(selectedHappyProfile.house_pct ?? 0))
    setHappyJackpotPctInput(String(selectedHappyProfile.pool_pct ?? 0))
    setHappyHappyPctInput(String(selectedHappyProfile.player_pct ?? 0))
  }, [selectedBaseProfile, selectedHappyProfile, isRuntimeFormDirty])

  useEffect(() => {
    setSelectedDevDeviceIds(current =>
      current.filter(deviceId => devDevices.some(device => device.device_id === deviceId)),
    )
  }, [devDevices])

  const asNumber = (v: number | string | null | undefined) => Number(v ?? 0)
  const formatCurrency = (v: number | string | null | undefined) =>
    `₱${asNumber(v).toLocaleString()}`
  const testJackpotAmountValue = Math.max(0, Number(testJackpotAmount || 0))
  const testJackpotWinnersValue = Math.max(1, Math.floor(Number(testJackpotWinners || 1)))
  const effectiveTestWinners = Math.max(
    1,
    Math.min(testJackpotWinnersValue, Math.max(1, selectedDevDeviceIds.length)),
  )
  const perWinnerTestAmount =
    effectiveTestWinners > 0 ? testJackpotAmountValue / effectiveTestWinners : 0
  const deviceCount = deviceIds.length

  async function enqueueGlobalPowerCommand(command: 'restart' | 'shutdown' | 'reset') {
    if (deviceCount === 0) {
      setErrorMessage('No target devices found')
      return
    }

    setGlobalPowerBusy(command)

    const { data, error } = await supabase.rpc('enqueue_bulk_device_admin_command', {
      p_command: command,
      p_device_ids: deviceIds,
      p_reason: 'settings_global_controls',
      p_requested_by: 'dashboard',
    })

    setGlobalPowerBusy(null)

    if (error) {
      setErrorMessage(error.message)
      return
    }

    const queuedCount = Number((data as any)?.queued_count ?? 0)
    const dedupedCount = Number((data as any)?.deduped_count ?? 0)
    const label = command === 'restart' ? 'Restart' : command === 'shutdown' ? 'Shutdown' : 'Reset'
    setSuccessMessage(
      `${label} queued for ${deviceCount.toLocaleString()} device${deviceCount === 1 ? '' : 's'}${
        dedupedCount > 0 ? ` • ${dedupedCount.toLocaleString()} already pending` : ''
      }${queuedCount > 0 ? ` • ${queuedCount.toLocaleString()} new` : ''}`,
    )
    setErrorMessage(null)
  }

  async function postGlobalOverride(params: {
    target: 'accounting_balance' | 'hopper_balance'
    entryKind: 'debit' | 'credit'
    amountText: string
    accountName: string
    notes: string
  }) {
    const amount = Math.max(0, Number(params.amountText || 0))
    if (!Number.isFinite(amount) || amount <= 0) {
      setErrorMessage('Amount must be greater than 0')
      return
    }
    if (!params.accountName.trim()) {
      setErrorMessage('Account name is required')
      return
    }
    if (deviceCount === 0) {
      setErrorMessage('No target devices found')
      return
    }

    setGlobalOverrideBusy(true)

    const { data, error } = await supabase.rpc('post_bulk_device_admin_ledger_entry', {
      p_target: params.target,
      p_entry_kind: params.entryKind,
      p_amount: amount,
      p_account_name: params.accountName.trim(),
      p_device_ids: deviceIds,
      p_notes: params.notes.trim() || null,
      p_metadata: {
        source: 'settings_global_controls',
      },
    })

    setGlobalOverrideBusy(false)

    if (error) {
      setErrorMessage(error.message)
      return
    }

    const processedCount = Number((data as any)?.processed_count ?? deviceCount)
    const totalApplied = Number((data as any)?.total_applied ?? 0)
    setSuccessMessage(
      `${params.target === 'accounting_balance' ? 'Balance' : 'Hopper'} ${params.entryKind.toUpperCase()} ${formatCurrency(amount)} per device • ${processedCount.toLocaleString()} device${
        processedCount === 1 ? '' : 's'
      } • ${formatCurrency(totalApplied)} total`,
    )
    setErrorMessage(null)
  }

  async function saveRuntime() {
    setSaving(true)

    const winnerMin = Math.max(1, Number(jackpotMinWinners || 1))
    const winnerMax = Math.max(winnerMin, Number(jackpotMaxWinners || winnerMin))
    const delayMin = Math.max(0, Number(jackpotDelayMinSpins || 0))
    const delayMax = Math.max(delayMin, Number(jackpotDelayMaxSpins || delayMin))
    const goalTimeHours = Math.max(0, Number(poolGoalTimeHours || 0))
    const goalTimeMinutes = Math.max(0, Number(poolGoalTimeMinutes || 0))
    const goalTimeSeconds = Math.max(60, goalTimeHours * 3600 + goalTimeMinutes * 60)
    const baseHouse = Math.max(0, Number(baseHousePctInput || 0))
    const baseJackpot = Math.max(0, Number(baseJackpotPctInput || 0))
    const baseHappy = Math.max(0, Number(baseHappyPctInput || 0))
    const happyHouse = Math.max(0, Number(happyHousePctInput || 0))
    const happyJackpot = Math.max(0, Number(happyJackpotPctInput || 0))
    const happyHappy = Math.max(0, Number(happyHappyPctInput || 0))

    if (splitInvalid) {
      setSaving(false)
      setErrorMessage(
        'Invalid split: Base and Happy profile percentages must each total exactly 100%.',
      )
      return
    }

    if (!baseProfileId || !happyProfileId) {
      setSaving(false)
      setErrorMessage('Select both Base and Happy profiles before saving.')
      return
    }

    const updateBaseProfile = await updateProfile(baseProfileId, {
      house_pct: baseHouse,
      pool_pct: baseJackpot,
      player_pct: baseHappy,
    })
    if (!updateBaseProfile.ok) {
      setSaving(false)
      setErrorMessage(updateBaseProfile.error?.message ?? 'Failed to save base profile split')
      return
    }

    const updateHappyProfile = await updateProfile(happyProfileId, {
      house_pct: happyHouse,
      pool_pct: happyJackpot,
      player_pct: happyHappy,
      prize_pct: 0,
    })
    if (!updateHappyProfile.ok) {
      setSaving(false)
      setErrorMessage(updateHappyProfile.error?.message ?? 'Failed to save happy profile split')
      return
    }

    const result = await updateRuntime({
      base_profile_id: baseProfileId,
      happy_profile_id: happyProfileId,
      auto_happy_enabled: autoHappy,
      prize_pool_goal: Math.max(0, Number(prizePoolGoal || 0)),
      prize_pool_balance: Math.max(0, Number(prizePoolBalance || 0)),
      jackpot_pool_goal: Math.max(0, Number(jackpotPoolGoal || 0)),
      jackpot_pool_balance: Math.max(0, Number(jackpotPoolBalance || 0)),
      jackpot_contrib_pct: baseJackpot,
      jackpot_min_winners: winnerMin,
      jackpot_max_winners: winnerMax,
      jackpot_delay_min_spins: delayMin,
      jackpot_delay_max_spins: delayMax,
      jackpot_win_variance: Math.max(0, Number(jackpotWinVariance || 0)),
      jackpot_payout_curve: jackpotPayoutCurve,
      jackpot_delivery_mode: jackpotDeliveryMode,
      pool_goal_mode: poolGoalMode,
      pool_goal_spins: Math.max(1, Number(poolGoalSpins || 1000)),
      pool_goal_time_seconds: goalTimeSeconds,
      max_win_enabled: maxWinEnabled,
      hopper_alert_threshold: Math.max(0, Number(hopperAlertThreshold || 0)),
    })

    setSaving(false)

    if (!result.ok) {
      setErrorMessage(result.error?.message ?? 'Failed to save settings')
      return
    }

    setIsRuntimeFormDirty(false)
  }

  async function runDevJackpotTest() {
    const amount = Math.max(0, Number(testJackpotAmount || 0))
    if (!Number.isFinite(amount) || amount <= 0) {
      setErrorMessage('DEV test jackpot amount must be greater than 0')
      return
    }

    if (selectedDevDeviceIds.length <= 0) {
      setErrorMessage('Select at least one DEV device (device_id starts with dev-)')
      return
    }

    const winners = Math.max(1, Number(testJackpotWinners || 1))
    const delayMin = Math.max(0, Number(testDelayMinSpins || 0))
    const delayMax = Math.max(delayMin, Number(testDelayMaxSpins || delayMin))

    setTestSubmitting(true)
    const result = await enqueueDevJackpotTest({
      amount,
      deviceIds: selectedDevDeviceIds,
      winners: Math.min(winners, selectedDevDeviceIds.length),
      delayMin,
      delayMax,
      ignoreMaxWin: testIgnoreMaxWinCap,
    })
    setTestSubmitting(false)

    if (!result.ok) {
      setErrorMessage(result.error?.message ?? 'Failed to queue DEV jackpot test')
      return
    }

    const payload = (result as any)?.data ?? {}
    const winnerDeviceIds = Array.isArray(payload?.winner_device_ids)
      ? payload.winner_device_ids.join(', ')
      : ''
    setTestResultMessage(
      `DEV jackpot queued: ₱${amount.toLocaleString()} for ${Math.min(winners, selectedDevDeviceIds.length)} winner(s)${
        winnerDeviceIds ? ` • ${winnerDeviceIds}` : ''
      }${testIgnoreMaxWinCap ? ' • override max-win cap: ON' : ''}`,
    )
    setErrorMessage(null)
  }

  async function toggleHappyHour(enable: boolean) {
    const result = await setHappyHour(enable)

    if (!result.ok) {
      setErrorMessage(result.error?.message ?? 'Failed to toggle happy hour')
    }
  }

  async function purgeRuntimeCache() {
    const result = await purgeGamePackages()
    if (!result.ok) {
      setErrorMessage(result.error?.message ?? 'Failed to purge runtime packages')
    } else {
      setErrorMessage(null)
    }
  }

  async function runDemoReset() {
    if (resetConfirm !== 'RESET') {
      setErrorMessage('Type RESET to confirm demo reset')
      return
    }

    const result = await demoReset()
    if (!result.ok) {
      setErrorMessage(result.error?.message ?? 'Failed to run demo reset')
      return
    }

    setErrorMessage(null)
    setResetConfirm('')
  }

  return (
    <div className="p-6 max-w-[90rem] mx-auto space-y-10">
      <header>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-slate-400 text-sm">RTP profile and runtime controls</p>
      </header>

      {errorMessage && (
        <div className="p-3 bg-red-900/40 border border-red-700 text-red-300 text-sm rounded">
          {errorMessage}
        </div>
      )}

      {successMessage && (
        <div className="p-3 bg-green-900/30 border border-green-700 text-green-300 text-sm rounded">
          {successMessage}
        </div>
      )}

      <section className="rounded-lg border border-slate-700 bg-slate-800 p-4 space-y-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Global Device Controls</h2>
            <p className="text-xs text-slate-400">
              Sends demo/admin actions to all registered devices from settings.
            </p>
          </div>
          <div className="text-xs font-mono text-slate-300">
            Targeting {deviceCount.toLocaleString()} device{deviceCount === 1 ? '' : 's'}
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <div className="rounded border border-slate-700 bg-slate-800 p-3">
            <div className="text-xs text-slate-400 mb-3">
              Queue a power command for all devices.
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded border border-sky-600/80 bg-sky-900/30 px-3 py-1.5 text-xs font-semibold text-sky-200 hover:bg-sky-800/40 disabled:opacity-50"
                disabled={globalPowerBusy !== null || globalOverrideBusy || deviceCount === 0}
                onClick={() => void enqueueGlobalPowerCommand('reset')}
              >
                {globalPowerBusy === 'reset' ? 'Queueing Reset...' : 'Reset All Devices'}
              </button>
              <button
                type="button"
                className="rounded border border-amber-600/80 bg-amber-900/30 px-3 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-800/40 disabled:opacity-50"
                disabled={globalPowerBusy !== null || globalOverrideBusy || deviceCount === 0}
                onClick={() => void enqueueGlobalPowerCommand('restart')}
              >
                {globalPowerBusy === 'restart' ? 'Queueing Restart...' : 'Restart All Devices'}
              </button>
              <button
                type="button"
                className="rounded border border-red-600/80 bg-red-900/30 px-3 py-1.5 text-xs font-semibold text-red-200 hover:bg-red-800/40 disabled:opacity-50"
                disabled={globalPowerBusy !== null || globalOverrideBusy || deviceCount === 0}
                onClick={() => void enqueueGlobalPowerCommand('shutdown')}
              >
                {globalPowerBusy === 'shutdown' ? 'Queueing Shutdown...' : 'Shutdown All Devices'}
              </button>
            </div>
          </div>

          <div className="rounded border border-slate-700 bg-slate-800 p-3">
            <div className="text-xs text-slate-400 mb-2">Global Accounting Balance Override</div>
            <div className="grid grid-cols-3 gap-2 mb-2">
              <select
                className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
                value={globalBalanceKind}
                onChange={e => setGlobalBalanceKind(e.target.value as 'debit' | 'credit')}
              >
                <option value="credit">Credit</option>
                <option value="debit">Debit</option>
              </select>
              <input
                className="col-span-2 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
                type="number"
                min={0}
                step={1}
                value={globalBalanceAmount}
                onChange={e => setGlobalBalanceAmount(e.target.value)}
                placeholder="Amount"
              />
            </div>
            <input
              className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs mb-2"
              value={globalBalanceAccountName}
              onChange={e => setGlobalBalanceAccountName(e.target.value)}
              placeholder="Account name"
            />
            <input
              className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs mb-2"
              value={globalBalanceNotes}
              onChange={e => setGlobalBalanceNotes(e.target.value)}
              placeholder="Notes"
            />
            <button
              type="button"
              onClick={() => {
                void postGlobalOverride({
                  target: 'accounting_balance',
                  entryKind: globalBalanceKind,
                  amountText: globalBalanceAmount,
                  accountName: globalBalanceAccountName,
                  notes: globalBalanceNotes,
                })
              }}
              disabled={globalOverrideBusy || globalPowerBusy !== null || deviceCount === 0}
              className="w-full rounded border border-blue-600 bg-blue-700/30 px-3 py-1 text-xs text-blue-300 disabled:opacity-50"
            >
              Apply to All Devices
            </button>
          </div>

          <div className="rounded border border-slate-700 bg-slate-800 p-3">
            <div className="text-xs text-slate-400 mb-2">Global Hopper Override</div>
            <div className="grid grid-cols-3 gap-2 mb-2">
              <select
                className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
                value={globalHopperKind}
                onChange={e => setGlobalHopperKind(e.target.value as 'debit' | 'credit')}
              >
                <option value="credit">Credit</option>
                <option value="debit">Debit</option>
              </select>
              <input
                className="col-span-2 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
                type="number"
                min={0}
                step={1}
                value={globalHopperAmount}
                onChange={e => setGlobalHopperAmount(e.target.value)}
                placeholder="Amount"
              />
            </div>
            <input
              className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs mb-2"
              value={globalHopperAccountName}
              onChange={e => setGlobalHopperAccountName(e.target.value)}
              placeholder="Account name"
            />
            <input
              className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs mb-2"
              value={globalHopperNotes}
              onChange={e => setGlobalHopperNotes(e.target.value)}
              placeholder="Notes"
            />
            <button
              type="button"
              onClick={() => {
                void postGlobalOverride({
                  target: 'hopper_balance',
                  entryKind: globalHopperKind,
                  amountText: globalHopperAmount,
                  accountName: globalHopperAccountName,
                  notes: globalHopperNotes,
                })
              }}
              disabled={globalOverrideBusy || globalPowerBusy !== null || deviceCount === 0}
              className="w-full rounded border border-amber-600 bg-amber-700/30 px-3 py-1 text-xs text-amber-300 disabled:opacity-50"
            >
              Apply to All Devices
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-slate-700 bg-slate-800 p-4 space-y-4">
        <h2 className="text-lg font-semibold">Happy Hour Control</h2>

        <div className="text-sm text-slate-300">
          <span className="mr-3">
            Current Mode:{' '}
            <strong
              className={runtime?.active_mode === 'HAPPY' ? 'text-amber-300' : 'text-sky-300'}
            >
              {runtime?.active_mode ?? 'BASE'}
            </strong>
          </span>
          <span className="mr-3">
            Pool (Accum): <strong>{formatCurrency(runtime?.prize_pool_balance)}</strong>
          </span>
          <span className="mr-3">
            Happy Bank:{' '}
            <strong className={runtime?.active_mode === 'HAPPY' ? 'text-amber-300' : ''}>
              {formatCurrency(runtime?.happy_hour_prize_balance)}
            </strong>
          </span>
          <span>
            Goal: <strong>{formatCurrency(runtime?.prize_pool_goal)}</strong>
          </span>
          <span className="ml-3">
            Jackpot Pool: <strong>{formatCurrency(runtime?.jackpot_pool_balance)}</strong>
          </span>
          <span className="ml-3">
            Jackpot Goal: <strong>{formatCurrency(runtime?.jackpot_pool_goal)}</strong>
          </span>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => toggleHappyHour(true)}
            disabled={
              !runtime ||
              (asNumber(runtime.prize_pool_balance) <= 0 &&
                asNumber(runtime.happy_hour_prize_balance) <= 0 &&
                asNumber(runtime.happy_pots_queued_count) <= 0)
            }
            className="px-3 py-2 rounded bg-green-700/30 border border-green-600 text-green-300 disabled:opacity-50"
          >
            Start Happy Hour
          </button>

          <button
            onClick={() => toggleHappyHour(false)}
            disabled={!runtime}
            className="px-3 py-2 rounded bg-amber-700/30 border border-amber-600 text-amber-300 disabled:opacity-50"
          >
            Stop Happy Hour
          </button>
        </div>

        <p className="text-xs text-slate-400">
          Happy hour auto-reverts to BASE when prize pool reaches 0.
        </p>
        <p className="text-xs text-slate-400">
          Queued Pots: Happy <strong>{asNumber(runtime?.happy_pots_queued_count)}</strong> / Jackpot{' '}
          <strong>{asNumber(runtime?.jackpot_pots_queued_count)}</strong>
        </p>
      </section>

      <section className="rounded-lg border border-slate-700 bg-slate-800 p-4 space-y-4">
        <h2 className="text-lg font-semibold">RTP Runtime Settings</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-300">Base Profile</span>
            <select
              className="bg-slate-950 border border-slate-700 rounded px-3 py-2"
              value={baseProfileId}
              onChange={e => {
                const nextBaseProfileId = e.target.value
                const nextBaseProfile = baseProfiles.find(p => p.id === nextBaseProfileId) ?? null
                setIsRuntimeFormDirty(true)
                setBaseProfileId(nextBaseProfileId)
                if (nextBaseProfile) {
                  setBaseHousePctInput(String(nextBaseProfile.house_pct ?? 0))
                  setBaseJackpotPctInput(String(nextBaseProfile.pool_pct ?? 0))
                  setBaseHappyPctInput(String(nextBaseProfile.player_pct ?? 0))
                }
              }}
            >
              {baseProfiles.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.house_pct}/{p.pool_pct}/{p.player_pct})
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-300">Happy Profile</span>
            <select
              className="bg-slate-950 border border-slate-700 rounded px-3 py-2"
              value={happyProfileId}
              onChange={e => {
                const nextHappyProfileId = e.target.value
                const nextHappyProfile =
                  happyProfiles.find(p => p.id === nextHappyProfileId) ?? null
                setIsRuntimeFormDirty(true)
                setHappyProfileId(nextHappyProfileId)
                if (nextHappyProfile) {
                  setHappyHousePctInput(String(nextHappyProfile.house_pct ?? 0))
                  setHappyJackpotPctInput(String(nextHappyProfile.pool_pct ?? 0))
                  setHappyHappyPctInput(String(nextHappyProfile.player_pct ?? 0))
                }
              }}
            >
              {happyProfiles.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.house_pct}/{p.pool_pct}/{p.player_pct}/prize {p.prize_pct})
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-300">Prize Pool Balance</span>
            <input
              className="bg-slate-950 border border-slate-700 rounded px-3 py-2"
              type="number"
              min={0}
              value={prizePoolBalance}
              onChange={e => {
                setIsRuntimeFormDirty(true)
                setPrizePoolBalance(e.target.value)
              }}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-300">Jackpot Pool Balance</span>
            <input
              className="bg-slate-950 border border-slate-700 rounded px-3 py-2"
              type="number"
              min={0}
              value={jackpotPoolBalance}
              onChange={e => {
                setIsRuntimeFormDirty(true)
                setJackpotPoolBalance(e.target.value)
              }}
            />
          </label>

          <div className="flex flex-col gap-2 text-sm">
            <span className="text-slate-300">Base Profile Split %</span>
            <div className="grid grid-cols-3 gap-2">
              <input
                className="bg-slate-950 border border-slate-700 rounded px-3 py-2"
                type="number"
                min={0}
                value={baseHousePctInput}
                onChange={e => {
                  setIsRuntimeFormDirty(true)
                  setBaseHousePctInput(e.target.value)
                }}
                placeholder="House %"
              />
              <input
                className="bg-slate-950 border border-slate-700 rounded px-3 py-2"
                type="number"
                min={0}
                value={baseJackpotPctInput}
                onChange={e => {
                  setIsRuntimeFormDirty(true)
                  setBaseJackpotPctInput(e.target.value)
                }}
                placeholder="Jackpot %"
              />
              <input
                className="bg-slate-950 border border-slate-700 rounded px-3 py-2"
                type="number"
                min={0}
                value={baseHappyPctInput}
                onChange={e => {
                  setIsRuntimeFormDirty(true)
                  setBaseHappyPctInput(e.target.value)
                }}
                placeholder="Happy %"
              />
            </div>
            <span
              className={`text-xs ${Math.abs(baseSplitTotal - 100) > 0.0001 ? 'text-red-300' : 'text-slate-500'}`}
            >
              Base Split: House {baseHousePct.toFixed(2)}% / Jackpot {baseJackpotPct.toFixed(2)}% /
              Happy {baseHappyPct.toFixed(2)}% (Total {baseSplitTotal.toFixed(2)}%)
            </span>
          </div>

          <div className="flex flex-col gap-2 text-sm">
            <span className="text-slate-300">Happy Profile Split %</span>
            <div className="grid grid-cols-3 gap-2">
              <input
                className="bg-slate-950 border border-slate-700 rounded px-3 py-2"
                type="number"
                min={0}
                value={happyHousePctInput}
                onChange={e => {
                  setIsRuntimeFormDirty(true)
                  setHappyHousePctInput(e.target.value)
                }}
                placeholder="House %"
              />
              <input
                className="bg-slate-950 border border-slate-700 rounded px-3 py-2"
                type="number"
                min={0}
                value={happyJackpotPctInput}
                onChange={e => {
                  setIsRuntimeFormDirty(true)
                  setHappyJackpotPctInput(e.target.value)
                }}
                placeholder="Jackpot %"
              />
              <input
                className="bg-slate-950 border border-slate-700 rounded px-3 py-2"
                type="number"
                min={0}
                value={happyHappyPctInput}
                onChange={e => {
                  setIsRuntimeFormDirty(true)
                  setHappyHappyPctInput(e.target.value)
                }}
                placeholder="Happy %"
              />
            </div>
            <span
              className={`text-xs ${Math.abs(happySplitTotal - 100) > 0.0001 ? 'text-red-300' : 'text-slate-500'}`}
            >
              Happy Split: House {happyHousePct.toFixed(2)}% / Jackpot {happyJackpotPct.toFixed(2)}%
              / Happy {happyHappyPct.toFixed(2)}% (Total {happySplitTotal.toFixed(2)}%)
            </span>
            {splitInvalid && (
              <span className="text-xs text-red-300">
                Base and Happy profile splits must each total exactly 100%.
              </span>
            )}
          </div>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-300">Jackpot Winners (Min)</span>
            <input
              className="bg-slate-950 border border-slate-700 rounded px-3 py-2"
              type="number"
              min={1}
              value={jackpotMinWinners}
              onChange={e => {
                setIsRuntimeFormDirty(true)
                setJackpotMinWinners(e.target.value)
              }}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-300">Jackpot Winners (Max)</span>
            <input
              className="bg-slate-950 border border-slate-700 rounded px-3 py-2"
              type="number"
              min={1}
              value={jackpotMaxWinners}
              onChange={e => {
                setIsRuntimeFormDirty(true)
                setJackpotMaxWinners(e.target.value)
              }}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-300">Delay Spins (Min)</span>
            <input
              className="bg-slate-950 border border-slate-700 rounded px-3 py-2"
              type="number"
              min={0}
              value={jackpotDelayMinSpins}
              onChange={e => {
                setIsRuntimeFormDirty(true)
                setJackpotDelayMinSpins(e.target.value)
              }}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-300">Delay Spins (Max)</span>
            <input
              className="bg-slate-950 border border-slate-700 rounded px-3 py-2"
              type="number"
              min={0}
              value={jackpotDelayMaxSpins}
              onChange={e => {
                setIsRuntimeFormDirty(true)
                setJackpotDelayMaxSpins(e.target.value)
              }}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-300">Jackpot Win Variance</span>
            <input
              className="bg-slate-950 border border-slate-700 rounded px-3 py-2"
              type="number"
              min={0}
              value={jackpotWinVariance}
              onChange={e => {
                setIsRuntimeFormDirty(true)
                setJackpotWinVariance(e.target.value)
              }}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-300">Jackpot Payout Curve</span>
            <select
              className="bg-slate-950 border border-slate-700 rounded px-3 py-2"
              value={jackpotPayoutCurve}
              onChange={e => {
                setIsRuntimeFormDirty(true)
                setJackpotPayoutCurve(e.target.value as 'flat' | 'front' | 'center' | 'back')
              }}
            >
              <option value="flat">Flat (even)</option>
              <option value="front">Front-loaded</option>
              <option value="center">Center-loaded</option>
              <option value="back">Back-loaded</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-300">Jackpot Delivery Mode</span>
            <select
              className="bg-slate-950 border border-slate-700 rounded px-3 py-2"
              value={jackpotDeliveryMode}
              onChange={e => {
                setIsRuntimeFormDirty(true)
                setJackpotDeliveryMode(e.target.value as JackpotDeliveryMode)
              }}
            >
              <option value="TARGET_FIRST">Target First (legacy)</option>
              <option value="AUTHENTIC_PAYTABLE">Authentic Paytable</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-300">Hopper Alert Threshold</span>
            <input
              className="bg-slate-950 border border-slate-700 rounded px-3 py-2"
              type="number"
              min={0}
              value={hopperAlertThreshold}
              onChange={e => {
                setIsRuntimeFormDirty(true)
                setHopperAlertThreshold(e.target.value)
              }}
            />
          </label>
        </div>

        <label className="inline-flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={autoHappy}
            onChange={e => {
              setIsRuntimeFormDirty(true)
              setAutoHappy(e.target.checked)
            }}
          />
          Auto-trigger happy hour when prize pool reaches goal
        </label>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-300">Pool Goal Mode</span>
            <select
              className="bg-slate-950 border border-slate-700 rounded px-3 py-2"
              value={poolGoalMode}
              onChange={e => {
                setIsRuntimeFormDirty(true)
                setPoolGoalMode(e.target.value as 'amount' | 'spins' | 'time')
              }}
            >
              <option value="amount">Amount</option>
              <option value="spins">Spins</option>
              <option value="time">Time</option>
            </select>
          </label>

          {poolGoalMode === 'amount' && (
            <>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-slate-300">Happy Pool Goal Amount</span>
                <input
                  className="bg-slate-950 border border-slate-700 rounded px-3 py-2"
                  type="number"
                  min={0}
                  value={prizePoolGoal}
                  onChange={e => {
                    setIsRuntimeFormDirty(true)
                    setPrizePoolGoal(e.target.value)
                  }}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-slate-300">Jackpot Pool Goal Amount</span>
                <input
                  className="bg-slate-950 border border-slate-700 rounded px-3 py-2"
                  type="number"
                  min={0}
                  value={jackpotPoolGoal}
                  onChange={e => {
                    setIsRuntimeFormDirty(true)
                    setJackpotPoolGoal(e.target.value)
                  }}
                />
              </label>
            </>
          )}

          {poolGoalMode === 'spins' && (
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-slate-300">Goal Spins</span>
              <input
                className="bg-slate-950 border border-slate-700 rounded px-3 py-2"
                type="number"
                min={1}
                value={poolGoalSpins}
                onChange={e => {
                  setIsRuntimeFormDirty(true)
                  setPoolGoalSpins(e.target.value)
                }}
              />
            </label>
          )}

          {poolGoalMode === 'time' && (
            <>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-slate-300">Goal Time (Hours)</span>
                <input
                  className="bg-slate-950 border border-slate-700 rounded px-3 py-2"
                  type="number"
                  min={0}
                  value={poolGoalTimeHours}
                  onChange={e => {
                    setIsRuntimeFormDirty(true)
                    setPoolGoalTimeHours(e.target.value)
                  }}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-slate-300">Goal Time (Minutes)</span>
                <input
                  className="bg-slate-950 border border-slate-700 rounded px-3 py-2"
                  type="number"
                  min={0}
                  max={59}
                  value={poolGoalTimeMinutes}
                  onChange={e => {
                    setIsRuntimeFormDirty(true)
                    setPoolGoalTimeMinutes(e.target.value)
                  }}
                />
              </label>
            </>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <label className="inline-flex items-center gap-2 text-sm text-slate-300 md:mt-6">
            <input
              type="checkbox"
              checked={maxWinEnabled}
              onChange={e => {
                setIsRuntimeFormDirty(true)
                setMaxWinEnabled(e.target.checked)
              }}
            />
            Enable Max Win Cap
          </label>
          <div className="text-xs text-slate-500 md:col-span-2 md:mt-7">
            Tiered cap: 1-19 x3000, 20-99 x2500, 100-199 x2000, 200-299 x1500, 300-499 x1000, 500+
            x700.
          </div>
        </div>

        <div>
          <button
            onClick={saveRuntime}
            disabled={saving}
            className="px-4 py-2 rounded bg-blue-700/30 border border-blue-600 text-blue-300 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save Settings'}
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-indigo-800/70 bg-indigo-950/20 p-4 space-y-4">
        <h2 className="text-lg font-semibold text-indigo-200">DEV Jackpot Test</h2>
        <p className="text-xs text-indigo-200/80">
          DEV-only manual jackpot trigger. DB will only accept selected devices with{' '}
          <code>dev-</code> prefix.
        </p>

        {testResultMessage && (
          <div className="p-3 bg-green-900/30 border border-green-700 text-green-300 text-sm rounded">
            {testResultMessage}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-indigo-200">Jackpot Amount</span>
            <input
              className="bg-slate-950 border border-indigo-800/60 rounded px-3 py-2"
              type="number"
              min={1}
              value={testJackpotAmount}
              onChange={e => setTestJackpotAmount(e.target.value)}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-indigo-200">Winner Count</span>
            <input
              className="bg-slate-950 border border-indigo-800/60 rounded px-3 py-2"
              type="number"
              min={1}
              value={testJackpotWinners}
              onChange={e => setTestJackpotWinners(e.target.value)}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-indigo-200">Delay Min Spins</span>
            <input
              className="bg-slate-950 border border-indigo-800/60 rounded px-3 py-2"
              type="number"
              min={0}
              value={testDelayMinSpins}
              onChange={e => setTestDelayMinSpins(e.target.value)}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-indigo-200">Delay Max Spins</span>
            <input
              className="bg-slate-950 border border-indigo-800/60 rounded px-3 py-2"
              type="number"
              min={0}
              value={testDelayMaxSpins}
              onChange={e => setTestDelayMaxSpins(e.target.value)}
            />
          </label>
        </div>

        <label className="inline-flex items-center gap-2 text-sm text-indigo-200/90">
          <input
            type="checkbox"
            checked={testIgnoreMaxWinCap}
            onChange={e => setTestIgnoreMaxWinCap(e.target.checked)}
          />
          Ignore max-win cap for this DEV test only (override)
        </label>

        <div className="text-xs text-indigo-200/80">
          Split preview: {formatCurrency(testJackpotAmountValue)} total / {effectiveTestWinners}{' '}
          winner(s) = <strong>{formatCurrency(perWinnerTestAmount)}</strong> per winner.
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => setSelectedDevDeviceIds(playingDevDeviceIds)}
            className="px-2.5 py-1.5 rounded border border-indigo-600 text-indigo-200 bg-indigo-700/20"
          >
            Select Playing DEV Devices ({playingDevDeviceIds.length})
          </button>
          <button
            type="button"
            onClick={() => setSelectedDevDeviceIds(devDevices.map(device => device.device_id))}
            className="px-2.5 py-1.5 rounded border border-indigo-600 text-indigo-200 bg-indigo-700/20"
          >
            Select All DEV Devices ({devDevices.length})
          </button>
          <button
            type="button"
            onClick={() => setSelectedDevDeviceIds([])}
            className="px-2.5 py-1.5 rounded border border-slate-600 text-slate-300 bg-slate-800/30"
          >
            Clear Selection
          </button>
          <span className="text-indigo-200/80">
            Selected: <strong>{selectedDevDeviceIds.length}</strong>
          </span>
        </div>

        <div className="max-h-44 overflow-auto rounded border border-indigo-900/70 bg-slate-950/60 p-2">
          {devDevices.length === 0 && (
            <div className="text-xs text-indigo-200/70 p-2">No DEV devices detected.</div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {devDevices.map(device => {
              const checked = selectedDevDeviceIds.includes(device.device_id)
              const status = (device.device_status ?? 'idle').toUpperCase()
              return (
                <label
                  key={device.device_id}
                  className="flex items-center justify-between gap-2 rounded border border-indigo-900/70 bg-slate-900/60 bg-white dark:bg-slate-900 px-2 py-1.5 text-xs"
                >
                  <span className="truncate">
                    <input
                      type="checkbox"
                      className="mr-2 align-middle"
                      checked={checked}
                      onChange={e => {
                        if (e.target.checked) {
                          setSelectedDevDeviceIds(current =>
                            current.includes(device.device_id)
                              ? current
                              : [...current, device.device_id],
                          )
                        } else {
                          setSelectedDevDeviceIds(current =>
                            current.filter(deviceId => deviceId !== device.device_id),
                          )
                        }
                      }}
                    />
                    {device.device_id}
                  </span>
                  <span className="text-indigo-200/80">{status}</span>
                </label>
              )
            })}
          </div>
        </div>

        <div>
          <button
            type="button"
            onClick={runDevJackpotTest}
            disabled={testSubmitting}
            className="px-4 py-2 rounded bg-indigo-700/30 border border-indigo-600 text-indigo-200 disabled:opacity-50"
          >
            {testSubmitting ? 'Queueing DEV Jackpot…' : 'Queue DEV Test Jackpot'}
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-slate-800 bg-slate-900/40 light:bg-slate-100 p-4 space-y-4">
        <h2 className="text-lg font-semibold">Global Games</h2>
        <div className="flex items-center gap-3">
          <button
            onClick={purgeRuntimeCache}
            className="px-3 py-2 rounded bg-rose-700/30 border border-rose-600 text-rose-300 text-sm"
          >
            Purge Runtime Cache
          </button>
          <span className="text-xs text-slate-400">
            Clears decrypted runtime game bundles on connected cabinet API.
          </span>
        </div>

        <div className="grid md:grid-cols-6 grid-cols-2 gap-4">
          {games.map(g => (
            <div
              key={g.id}
              className="flex flex-col gap-2 items-center justify-between p-2 border border-slate-800 rounded-lg"
            >
              <div className="flex  flex-col items-center text-center">
                <div className="font-medium text-sm">{g.name}</div>
                <div className="text-[10px] text-slate-600">
                  {g.type} • v{g.version}
                </div>
              </div>

              <button
                onClick={async () => {
                  const nextEnabled = !g.enabled
                  const result = await toggleGame(g.id, nextEnabled)

                  if (!result.ok) {
                    setErrorMessage(result?.error?.message ?? null)
                  } else {
                    const gameResult = await getGame(g.id)
                    if (gameResult.ok && gameResult.data) {
                      const game = gameResult.data as any
                      if (!nextEnabled) {
                        const removeResult = await removeGamePackage(
                          game.id,
                          Number(game.version ?? 1),
                          true,
                        )
                        if (!removeResult.ok) {
                          setErrorMessage(
                            `Disabled but remove failed: ${removeResult.error?.message ?? 'unknown error'}`,
                          )
                          return
                        }
                      } else if (game.package_url) {
                        const prepareResult = await prepareGamePackage(
                          game.id,
                          game.package_url,
                          Number(game.version ?? 1),
                        )
                        if (!prepareResult.ok) {
                          setErrorMessage(
                            `Enabled but prefetch failed: ${prepareResult.error?.message ?? 'unknown error'}`,
                          )
                          return
                        }
                      }
                    }
                    setErrorMessage(null)
                  }
                }}
                className={`px-3 py-1 text-xs rounded ${
                  g.enabled ? 'bg-green-600/20 text-green-400' : 'bg-red-600/20 text-red-400'
                }`}
              >
                {g.enabled ? 'Enabled' : 'Disabled'}
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-red-800/70 bg-red-950/20 p-4 space-y-4">
        <h2 className="text-lg font-semibold text-red-300">Demo Reset</h2>
        <p className="text-xs text-red-200/80">
          Resets balances, ledgers, jackpot/free-spin runtime, session state, and queued admin
          actions for all registered devices while keeping each device ID and name.
        </p>

        <label className="flex flex-col gap-1 text-sm max-w-xs">
          <span className="text-red-200">Type RESET to confirm</span>
          <input
            className="bg-slate-950 border border-red-800/70 rounded px-3 py-2"
            value={resetConfirm}
            onChange={e => setResetConfirm(e.target.value)}
            placeholder="RESET"
          />
        </label>

        <div>
          <button
            onClick={runDemoReset}
            className="px-4 py-2 rounded bg-red-700/30 border border-red-600 text-red-300"
          >
            Run Demo Reset
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-slate-800 bg-slate-900/40 light:bg-slate-100 p-4 space-y-4">
        <h2 className="text-lg font-semibold">Agents & Areas</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* AGENTS */}
          <div className="space-y-3">
            <div className="text-sm font-semibold text-slate-300">Agents</div>

            <div className="flex gap-2">
              <input
                value={newAgentName}
                onChange={e => setNewAgentName(e.target.value)}
                placeholder="New agent"
                className="flex-1 px-2 py-1 text-sm bg-slate-900 border border-slate-700 rounded"
              />
              <button onClick={createAgent} className="px-3 py-1 text-xs bg-blue-600 rounded">
                Add
              </button>
            </div>

            <div className="space-y-1 max-h-48 overflow-y-auto">
              {agents.length === 0 && (
                <div className="text-xs text-slate-500 text-center py-2">No agents yet</div>
              )}

              {agents.map(a => (
                <div
                  key={a.id}
                  className="flex items-center justify-between text-sm px-2 py-1 border border-slate-800 rounded"
                >
                  <span>{a.name}</span>
                  <div className="flex gap-2 text-xs">
                    <button onClick={() => renameAgent(a.id, a.name)} className="text-blue-400">
                      Edit
                    </button>
                    <button onClick={() => deleteAgent(a.id)} className="text-red-400">
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* AREAS */}
          <div className="space-y-3">
            <div className="text-sm font-semibold text-slate-300">Areas</div>

            <select
              value={selectedAgentForArea}
              onChange={e => setSelectedAgentForArea(e.target.value)}
              className="w-full px-2 py-1 text-sm bg-slate-900 border border-slate-700 rounded"
            >
              <option value="">Select Agent</option>
              {agents.map(a => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>

            <div className="flex gap-2">
              <input
                value={newAreaName}
                onChange={e => setNewAreaName(e.target.value)}
                placeholder="New area"
                className="flex-1 px-2 py-1 text-sm bg-slate-900 border border-slate-700 rounded"
              />
              <button onClick={createArea} className="px-3 py-1 text-xs bg-blue-600 rounded">
                Add
              </button>
            </div>

            <div className="space-y-1 max-h-48 overflow-y-auto">
              {areas.length === 0 && (
                <div className="text-xs text-slate-500 text-center py-2">No areas yet</div>
              )}

              {areas.map(a => {
                const agent = agents.find(x => x.id === a.agent_id)

                return (
                  <div
                    key={a.id}
                    className="flex items-center justify-between text-sm px-2 py-1 border border-slate-800 rounded"
                  >
                    <div>
                      {a.name}
                      <span className="text-xs text-slate-400 ml-2">
                        {agent?.name ?? 'No Agent'}
                      </span>
                    </div>
                    <div className="flex gap-2 text-xs">
                      <button onClick={() => renameArea(a.id, a.name)} className="text-blue-400">
                        Edit
                      </button>
                      <button onClick={() => deleteArea(a.id)} className="text-red-400">
                        Delete
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* MASS ASSIGNMENT SECTION */}
        <div className="mt-4 border-t border-slate-800 pt-4 space-y-3">
          <div className="text-sm font-semibold text-slate-300">Mass Assignment</div>

          <div className="flex gap-2">
            <select
              value={bulkAgentId}
              onChange={e => setBulkAgentId(e.target.value)}
              className="px-2 py-1 text-sm bg-slate-900 border border-slate-700 rounded"
            >
              <option value="">No Agent</option>
              {agents.map(a => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>

            <select
              value={bulkAreaId}
              onChange={e => setBulkAreaId(e.target.value)}
              className="px-2 py-1 text-sm bg-slate-900 border border-slate-700 rounded"
            >
              <option value="">No Area</option>
              {areas.map(a => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>

            <button onClick={bulkAssign} className="px-3 py-1 text-xs bg-green-600 rounded">
              Apply
            </button>
          </div>

          <div className="max-h-40 overflow-auto border border-slate-800 rounded p-2">
            {devices.map(d => {
              const checked = selectedDeviceIds.includes(d.device_id)

              return (
                <label key={d.device_id} className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={e => {
                      if (e.target.checked) {
                        setSelectedDeviceIds(prev => [...prev, d.device_id])
                      } else {
                        setSelectedDeviceIds(prev => prev.filter(id => id !== d.device_id))
                      }
                    }}
                  />
                  {d.name || d.device_id}
                </label>
              )
            })}
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-slate-700 bg-slate-800 p-4 space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Dashboard Preferences</h2>
          <p className="text-xs text-slate-400">
            Controls dashboard-only display behavior stored in this browser.
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm text-slate-200">Hopper Alerts</div>
            <div className="text-xs text-slate-400">
              Enables low-hopper warning badges and counts on the dashboard.
            </div>
          </div>

          <select
            value={hopperAlertsEnabled ? 'on' : 'off'}
            onChange={e => setHopperAlertsEnabled(e.target.value === 'on')}
            className="rounded border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200"
          >
            <option value="on">ON</option>
            <option value="off">OFF</option>
          </select>
        </div>
      </section>
    </div>
  )
}
