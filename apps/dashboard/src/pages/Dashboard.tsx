import { useEffect, useMemo, useState } from 'react'
import { useDevices } from '../hooks/useDevices'
import { DeviceModal } from '../components/DeviceModal'
import { useGlobalStats } from '../hooks/useGlobalStats'
import { useCasinoRuntime } from '../hooks/useCasinoRuntime'
import { useGames } from '../hooks/useGames'
import moment from 'moment'
import type { DeviceRow } from '../hooks/useDevices'
import { supabase } from '../lib/supabase'

type SortField =
  | 'device_id'
  | 'balance'
  | 'coins_in_total'
  | 'hopper_balance'
  | 'bet_total'
  | 'last_bet_amount'
  | 'win_total'
  | 'house_win'
  | 'spins_total'
  | 'rtp'
  | 'updated_at'

type SortDirection = 'asc' | 'desc'

const SORT_OPTIONS: { field: SortField; label: string }[] = [
  { field: 'updated_at', label: 'Last Seen' },
  { field: 'device_id', label: 'Device' },
  { field: 'balance', label: 'Balance' },
  { field: 'coins_in_total', label: 'Coins-In' },
  { field: 'hopper_balance', label: 'Hopper' },
  { field: 'last_bet_amount', label: 'Last Bet' },
  { field: 'house_win', label: 'House Win' },
  { field: 'spins_total', label: 'Spins' },
  { field: 'rtp', label: 'RTP' },
]

export default function Dashboard() {
  const devices = useDevices()
  const games = useGames()
  const stats = useGlobalStats()
  const { runtime, profiles } = useCasinoRuntime()

  const [selectedDevice, setSelectedDevice] = useState<any | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [sortField, setSortField] = useState<SortField>('updated_at')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [showHappyPotsModal, setShowHappyPotsModal] = useState(false)
  const [showJackpotPotsModal, setShowJackpotPotsModal] = useState(false)
  const [happyPots, setHappyPots] = useState<any[]>([])
  const [jackpotPots, setJackpotPots] = useState<any[]>([])
  const [globalPowerBusy, setGlobalPowerBusy] = useState<'restart' | 'shutdown' | 'reset' | null>(null)
  const [globalOverrideBusy, setGlobalOverrideBusy] = useState(false)
  const [globalBalanceAmount, setGlobalBalanceAmount] = useState('0')
  const [globalBalanceKind, setGlobalBalanceKind] = useState<'debit' | 'credit'>('credit')
  const [globalBalanceAccountName, setGlobalBalanceAccountName] = useState('Global Manual Accounting Override')
  const [globalBalanceNotes, setGlobalBalanceNotes] = useState('')
  const [globalHopperAmount, setGlobalHopperAmount] = useState('0')
  const [globalHopperKind, setGlobalHopperKind] = useState<'debit' | 'credit'>('credit')
  const [globalHopperAccountName, setGlobalHopperAccountName] = useState('Global Manual Hopper Override')
  const [globalHopperNotes, setGlobalHopperNotes] = useState('')

  useEffect(() => {
    if (!errorMessage) return
    const t = setTimeout(() => setErrorMessage(null), 4000)
    return () => clearTimeout(t)
  }, [errorMessage])

  useEffect(() => {
    if (!successMessage) return
    const t = setTimeout(() => setSuccessMessage(null), 4000)
    return () => clearTimeout(t)
  }, [successMessage])

  useEffect(() => {
    async function fetchPots() {
      const [{ data: happyData }, { data: jackpotData }] = await Promise.all([
        supabase
          .from('happy_hour_pots')
          .select('*')
          .order('id', { ascending: false })
          .limit(50),
        supabase
          .from('jackpot_pots')
          .select('*')
          .order('id', { ascending: false })
          .limit(50),
      ])
      setHappyPots(happyData ?? [])
      setJackpotPots(jackpotData ?? [])
    }

    void fetchPots()

    const channel = supabase
      .channel('dashboard-pool-pots')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'happy_hour_pots' }, fetchPots)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jackpot_pots' }, fetchPots)
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [])

  const asNumber = (v: number | string | null | undefined) => Number(v ?? 0)
  const formatCurrency = (v: number | string | null | undefined) => `₱${asNumber(v).toLocaleString()}`
  const formatJackpotCurrency = (v: number | string | null | undefined) =>
    `₱${asNumber(v).toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })}`
  const formatPercent = (v: number | string | null | undefined) => `${asNumber(v).toFixed(2)}%`

  const globalBet = asNumber(stats?.total_bet_amount)
  const globalWin = asNumber(stats?.total_win_amount)
  const globalHouseGross = asNumber(stats?.total_house_take ?? (globalBet - globalWin))
  const globalHouseNet = asNumber(
    stats?.total_house_net ??
      (asNumber(stats?.total_coins_in) -
        asNumber(stats?.total_withdraw_amount) -
        asNumber(stats?.total_balance) -
        asNumber(runtime?.prize_pool_balance) -
        asNumber(runtime?.happy_hour_prize_balance) -
        asNumber(runtime?.jackpot_pool_balance)),
  )
  const hopperAlertThreshold = asNumber(runtime?.hopper_alert_threshold ?? 500)
  const activeProfileId =
    runtime?.active_mode === 'HAPPY' ? runtime?.happy_profile_id : runtime?.base_profile_id
  const activeProfile = profiles.find(p => p.id === activeProfileId)
  const activeHousePct = asNumber(activeProfile?.house_pct)
  const activeJackpotPct = Math.max(0, asNumber(activeProfile?.pool_pct))
  const activeHappyPct = Math.max(0, asNumber(activeProfile?.player_pct))
  const activeTargetRtpPct = asNumber(runtime?.active_target_rtp_pct ?? activeProfile?.player_pct)
  const gameTypeById = useMemo(() => {
    const index = new Map<string, string>()
    for (const game of games) {
      const id = String(game?.id ?? '').trim()
      const type = String(game?.type ?? '').trim().toLowerCase()
      if (!id) continue
      if (type === 'arcade' || type === 'casino') {
        index.set(id, type)
      }
    }
    return index
  }, [games])

  const getDeviceGameType = (device: DeviceRow): 'arcade' | 'casino' => {
    const sessionType = String((device.session_metadata as any)?.gameType ?? '')
      .trim()
      .toLowerCase()
    if (sessionType === 'arcade' || sessionType === 'casino') return sessionType

    const mappedType = gameTypeById.get(String(device.current_game_id ?? '').trim())
    if (mappedType === 'arcade' || mappedType === 'casino') return mappedType

    if (
      device.runtime_mode ||
      Boolean(device.is_free_game) ||
      asNumber(device.pending_free_spins) > 0 ||
      Boolean(device.jackpot_selected)
    ) {
      return 'casino'
    }

    return 'arcade'
  }

  const getDeviceModeLabel = (device: DeviceRow): string => {
    if (device.is_free_game) {
      return `FREE SPIN (${asNumber(device.free_spins_left)} left)`
    }

    if (asNumber(device.pending_free_spins) > 0) {
      return `FREE SPIN PENDING (${asNumber(device.pending_free_spins)})`
    }

    return String(device.runtime_mode ?? 'BASE').toUpperCase()
  }

  const getDeviceTelemetryLabel = (device: DeviceRow): string => {
    const gameType = getDeviceGameType(device)
    const gameName = String(device.current_game_name ?? device.current_game_id ?? 'No Game')
    if (gameType === 'casino') {
      return `CASINO / ${gameName} / ${getDeviceModeLabel(device)}`
    }
    return `ARCADE / ${gameName}`
  }

  const getDeviceJackpotStatus = (device: DeviceRow): string | null => {
    if (!device.jackpot_selected) return null

    if (device.is_free_game && asNumber(device.free_spins_left) > 0) {
      return `JACKPOT LIVE • FREE SPINS ${asNumber(device.free_spins_left)} left`
    }

    const delaySpins = Math.max(0, asNumber(device.jackpot_spins_until_start))
    if (delaySpins > 0) {
      return `JACKPOT ARMED • ${delaySpins} spin${delaySpins === 1 ? '' : 's'} until trigger`
    }

    return 'JACKPOT ARMED • trigger spin next'
  }

  const getSortValue = (device: DeviceRow, field: SortField): number | string => {
    if (field === 'device_id') return (device.device_id ?? '').toLowerCase()
    if (field === 'updated_at') return device.updated_at ? moment(device.updated_at).valueOf() : 0
    if (field === 'house_win') return asNumber(device.house_take_total ?? (asNumber(device.bet_total) - asNumber(device.win_total)))
    if (field === 'rtp') {
      return asNumber(device.bet_total) > 0
        ? (asNumber(device.win_total) / asNumber(device.bet_total)) * 100
        : 0
    }
    return asNumber(device[field as keyof DeviceRow] as number | string | null | undefined)
  }

  const visibleDevices = useMemo(() => {
    const search = searchTerm.trim().toLowerCase()
    const filtered = search
      ? devices.filter(d => {
          const deviceId = (d.device_id ?? '').toLowerCase()
          const name = (d.name ?? '').toLowerCase()
          return deviceId.includes(search) || name.includes(search)
        })
      : [...devices]

    filtered.sort((a, b) => {
      const left = getSortValue(a, sortField)
      const right = getSortValue(b, sortField)

      if (typeof left === 'string' || typeof right === 'string') {
        const leftText = String(left)
        const rightText = String(right)
        const compare = leftText.localeCompare(rightText)
        return sortDirection === 'asc' ? compare : -compare
      }

      const compare = left - right
      return sortDirection === 'asc' ? compare : -compare
    })

    return filtered
  }, [devices, searchTerm, sortField, sortDirection])

  const visibleDeviceIds = useMemo(
    () => visibleDevices.map(device => String(device.device_id ?? '').trim()).filter(Boolean),
    [visibleDevices],
  )

  const visibleDeviceCount = visibleDeviceIds.length

  async function enqueueGlobalPowerCommand(command: 'restart' | 'shutdown' | 'reset') {
    if (visibleDeviceCount === 0) {
      setErrorMessage('No target devices found')
      return
    }

    setGlobalPowerBusy(command)

    const { data, error } = await supabase.rpc('enqueue_bulk_device_admin_command', {
      p_command: command,
      p_device_ids: visibleDeviceIds,
      p_reason: 'dashboard_global_controls',
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
      `${label} queued for ${visibleDeviceCount.toLocaleString()} visible device${
        visibleDeviceCount === 1 ? '' : 's'
      }${dedupedCount > 0 ? ` • ${dedupedCount.toLocaleString()} already pending` : ''}${
        queuedCount > 0 ? ` • ${queuedCount.toLocaleString()} new` : ''
      }`,
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
    if (visibleDeviceCount === 0) {
      setErrorMessage('No target devices found')
      return
    }

    setGlobalOverrideBusy(true)

    const { data, error } = await supabase.rpc('post_bulk_device_admin_ledger_entry', {
      p_target: params.target,
      p_entry_kind: params.entryKind,
      p_amount: amount,
      p_account_name: params.accountName.trim(),
      p_device_ids: visibleDeviceIds,
      p_notes: params.notes.trim() || null,
      p_metadata: {
        source: 'dashboard_global_controls',
      },
    })

    setGlobalOverrideBusy(false)

    if (error) {
      setErrorMessage(error.message)
      return
    }

    const processedCount = Number((data as any)?.processed_count ?? visibleDeviceCount)
    const totalApplied = Number((data as any)?.total_applied ?? 0)
    setSuccessMessage(
      `${params.target === 'accounting_balance' ? 'Balance' : 'Hopper'} ${params.entryKind.toUpperCase()} ${formatCurrency(amount)} per device • ${processedCount.toLocaleString()} device${
        processedCount === 1 ? '' : 's'
      } • ${formatCurrency(totalApplied)} total`,
    )
    setErrorMessage(null)
  }

  const onSort = (field: SortField) => {
    if (field === sortField) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortField(field)
    setSortDirection(field === 'device_id' ? 'asc' : 'desc')
  }

  const sortLabel = SORT_OPTIONS.find(option => option.field === sortField)?.label ?? 'Last Seen'

  return (
    <>
      <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-8 sm:space-y-10">
        <header>
          <h1 className="text-xl sm:text-2xl font-semibold">Dashboard</h1>
          <p className="text-slate-400 text-sm">Live operational metrics</p>
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

        <section>
          <h2 className="text-lg font-semibold mb-3">Global Balances</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5 gap-3 sm:gap-4">
            <div className="rounded-lg border border-green-700/40 bg-green-900/20 p-4">
              <div className="text-xs text-green-300/80 mb-1">Total Balance</div>
              <div className="text-xl sm:text-2xl font-bold font-mono text-green-400">
                {formatCurrency(stats?.total_balance)}
              </div>
            </div>

            <div className="rounded-lg border border-sky-700/40 bg-sky-900/20 p-4">
              <div className="text-xs text-sky-300/80 mb-1">Total Coins-In</div>
              <div className="text-xl sm:text-2xl font-bold font-mono text-sky-300">
                {formatCurrency(stats?.total_coins_in)}
              </div>
            </div>

            <div className="rounded-lg border border-amber-700/40 bg-amber-900/20 p-4">
              <div className="text-xs text-amber-300/80 mb-1">Total Hopper</div>
              <div className="text-xl sm:text-2xl font-bold font-mono text-amber-300">
                {formatCurrency(stats?.total_hopper)}
              </div>
            </div>

            <div className="rounded-lg border border-violet-700/40 bg-violet-900/20 p-4">
              <div className="text-xs text-violet-300/80 mb-1">Total Bet Amount</div>
              <div className="text-xl sm:text-2xl font-bold font-mono text-violet-300">
                {formatCurrency(stats?.total_bet_amount)}
              </div>
            </div>

            <div className="rounded-lg border border-red-700/40 bg-red-900/20 p-4">
              <div className="text-xs text-red-300/80 mb-1">Total Win Amount</div>
              <div className="text-xl sm:text-2xl font-bold font-mono text-red-300">
                {formatCurrency(stats?.total_win_amount)}
              </div>
            </div>

            <div className="rounded-lg border border-cyan-700/40 bg-cyan-900/20 p-4">
              <div className="text-xs text-cyan-300/80 mb-1">Total Spins</div>
              <div className="text-xl sm:text-2xl font-bold font-mono text-cyan-300">
                {asNumber(stats?.total_spins).toLocaleString()}
              </div>
            </div>

            <div className="rounded-lg border border-fuchsia-700/40 bg-fuchsia-900/20 p-4">
              <div className="text-xs text-fuchsia-300/80 mb-1">Global RTP</div>
              <div className="text-xl sm:text-2xl font-bold font-mono text-fuchsia-300">
                {formatPercent(stats?.global_rtp_percent)}
              </div>
              <div className="text-[11px] text-fuchsia-200/80 mt-1 font-mono">
                Target {formatPercent(activeTargetRtpPct)}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowHappyPotsModal(true)}
              className="text-left rounded-lg border border-emerald-700/40 bg-emerald-900/20 p-4 hover:border-emerald-500/70"
            >
              <div className="text-xs text-emerald-300/80 mb-1">Mode / Pools</div>
              <div
                className={`flex items-center justify-between text-sm font-mono font-bold ${
                  runtime?.active_mode === 'HAPPY' ? 'text-amber-300' : 'text-emerald-300'
                }`}
              >
                <span>{runtime?.active_mode ?? 'BASE'}</span>
                <span className={runtime?.active_mode === 'HAPPY' ? 'animate-pulse' : ''}>
                  Happy {formatCurrency(runtime?.happy_hour_prize_balance)}
                </span>
              </div>
              <div className="text-sm text-emerald-200/90 mt-1 font-mono">
                Accum {formatCurrency(runtime?.prize_pool_balance)} / {formatCurrency(runtime?.prize_pool_goal)}
              </div>
              <div className="text-[11px] text-emerald-200/80 mt-1 font-mono">
                Split H/J/P {formatPercent(activeHousePct)} / {formatPercent(activeJackpotPct)} /{' '}
                {formatPercent(activeHappyPct)}
              </div>
              <div className="text-xs text-emerald-200/80 mt-2">
                Queued Pots: {asNumber(runtime?.happy_pots_queued_count)} (click to view)
              </div>
            </button>

            <div className="rounded-lg border border-orange-700/40 bg-orange-900/20 p-4">
              <div className="text-xs text-orange-300/80 mb-1">Global House Take (Strict 20% per bet)</div>
              <div className="text-xl sm:text-2xl font-bold font-mono text-orange-300">
                {formatCurrency(globalHouseGross)}
              </div>
              <div
                className={`text-[11px] mt-1 font-mono ${
                  globalHouseNet < 0 ? 'text-red-300' : 'text-orange-200/80'
                }`}
              >
                Net after pool liabilities {formatCurrency(globalHouseNet)}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowJackpotPotsModal(true)}
              className="text-left rounded-lg border border-indigo-700/40 bg-indigo-900/20 p-4 hover:border-indigo-500/70"
            >
              <div className="text-xs text-indigo-300/80 mb-1">Jackpot Flow</div>
              <div className="text-sm text-indigo-200/90 mt-1 font-mono">
                Contrib {formatCurrency(stats?.total_jackpot_contrib)}
              </div>
              <div className="text-sm text-indigo-200/90 mt-1 font-mono">
                Paid {formatCurrency(stats?.total_jackpot_win)}
              </div>
              <div className="text-sm text-indigo-200/90 mt-1 font-mono">
                Pool {formatCurrency(runtime?.jackpot_pool_balance)} / {formatCurrency(runtime?.jackpot_pool_goal)}
              </div>
              <div className="text-[11px] text-indigo-200/80 mt-1 font-mono">
                RTP Share {formatPercent(activeJackpotPct)}
              </div>
              <div className="text-xs text-indigo-200/80 mt-2">
                Queued Pots: {asNumber(runtime?.jackpot_pots_queued_count)} (click to view)
              </div>
            </button>
          </div>
        </section>

        <section>
          <div className="mb-3 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Devices</h2>
              <div className="text-xs text-slate-400">
                Showing {visibleDevices.length.toLocaleString()} of {devices.length.toLocaleString()}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto_auto] gap-2 sm:gap-3">
              <input
                type="search"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder="Search device ID or name"
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-slate-500 focus:outline-none"
              />
              <select
                value={sortField}
                onChange={e => onSort(e.target.value as SortField)}
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-slate-500 focus:outline-none"
              >
                {SORT_OPTIONS.map(option => (
                  <option key={option.field} value={option.field}>
                    Sort: {option.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'))}
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
              >
                {sortDirection === 'asc' ? 'Ascending' : 'Descending'}
              </button>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-100">Global Device Controls</h3>
                  <div className="text-xs text-slate-400">
                    Applies to all visible devices. Clear search to target every registered device.
                  </div>
                </div>
                <div className="text-xs font-mono text-slate-300">
                  Targeting {visibleDeviceCount.toLocaleString()} device{visibleDeviceCount === 1 ? '' : 's'}
                </div>
              </div>

              <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,1fr)]">
                <div className="rounded border border-slate-700 bg-slate-950/70 p-3">
                  <div className="text-xs text-slate-400 mb-3">Queue a power command for every visible device.</div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded border border-sky-600/80 bg-sky-900/30 px-3 py-1.5 text-xs font-semibold text-sky-200 hover:bg-sky-800/40 disabled:opacity-50"
                      disabled={globalPowerBusy !== null || globalOverrideBusy || visibleDeviceCount === 0}
                      onClick={() => void enqueueGlobalPowerCommand('reset')}
                    >
                      {globalPowerBusy === 'reset' ? 'Queueing Reset...' : 'Reset All Visible'}
                    </button>
                    <button
                      type="button"
                      className="rounded border border-amber-600/80 bg-amber-900/30 px-3 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-800/40 disabled:opacity-50"
                      disabled={globalPowerBusy !== null || globalOverrideBusy || visibleDeviceCount === 0}
                      onClick={() => void enqueueGlobalPowerCommand('restart')}
                    >
                      {globalPowerBusy === 'restart' ? 'Queueing Restart...' : 'Restart All Visible'}
                    </button>
                    <button
                      type="button"
                      className="rounded border border-red-600/80 bg-red-900/30 px-3 py-1.5 text-xs font-semibold text-red-200 hover:bg-red-800/40 disabled:opacity-50"
                      disabled={globalPowerBusy !== null || globalOverrideBusy || visibleDeviceCount === 0}
                      onClick={() => void enqueueGlobalPowerCommand('shutdown')}
                    >
                      {globalPowerBusy === 'shutdown' ? 'Queueing Shutdown...' : 'Shutdown All Visible'}
                    </button>
                  </div>
                </div>

                <div className="rounded border border-slate-700 bg-slate-950/70 p-3">
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
                    disabled={globalOverrideBusy || globalPowerBusy !== null || visibleDeviceCount === 0}
                    className="w-full rounded border border-blue-600 bg-blue-700/30 px-3 py-1 text-xs text-blue-300 disabled:opacity-50"
                  >
                    Apply to All Visible
                  </button>
                </div>

                <div className="rounded border border-slate-700 bg-slate-950/70 p-3">
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
                    disabled={globalOverrideBusy || globalPowerBusy !== null || visibleDeviceCount === 0}
                    className="w-full rounded border border-amber-600 bg-amber-700/30 px-3 py-1 text-xs text-amber-300 disabled:opacity-50"
                  >
                    Apply to All Visible
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-slate-800 md:hidden">
            <div className="space-y-2 p-2">
              {visibleDevices.map(d => {
                const deviceRtp =
                  asNumber(d.bet_total) > 0
                    ? (asNumber(d.win_total) / asNumber(d.bet_total)) * 100
                    : 0
                const deviceHouseWin = asNumber(d.house_take_total ?? (asNumber(d.bet_total) - asNumber(d.win_total)))
                const hopperLow = asNumber(d.hopper_balance) <= hopperAlertThreshold
                const gameType = getDeviceGameType(d)
                const telemetryLabel = getDeviceTelemetryLabel(d)
                const jackpotStatus = getDeviceJackpotStatus(d)

                return (
                  <button
                    key={d.device_id}
                    type="button"
                    className={`w-full rounded-lg border p-3 text-left ${
                      d.jackpot_selected
                        ? 'border-amber-300/70 bg-gradient-to-br from-amber-900/30 via-slate-900/80 to-slate-900/90 shadow-[0_0_20px_rgba(251,191,36,0.18)]'
                        : 'border-slate-800 bg-slate-900/60'
                    }`}
                    onClick={() =>
                      setSelectedDevice({
                        ...d,
                        game_type: gameType,
                      })
                    }
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-slate-100">{d.device_id ?? 'Unnamed'}</div>
                        {d.name && <div className="truncate text-xs text-slate-400">{d.name}</div>}
                        <div className="mt-1 flex items-center gap-2 text-[10px]">
                          <span
                            className={`rounded px-1.5 py-0.5 font-semibold ${
                              d.device_status === 'playing'
                                ? 'bg-emerald-900/40 text-emerald-300 border border-emerald-700/50'
                                : d.device_status === 'offline'
                                  ? 'bg-slate-800 text-slate-400 border border-slate-700'
                                  : 'bg-amber-900/40 text-amber-300 border border-amber-700/50'
                            }`}
                          >
                            {(d.device_status ?? 'idle').toUpperCase()}
                          </span>
                          <span className="rounded border border-slate-700 bg-slate-800/60 px-1.5 py-0.5 text-[10px] text-slate-300">
                            {gameType.toUpperCase()}
                          </span>
                        </div>
                        <div className="mt-1 text-[10px] text-slate-300">{telemetryLabel}</div>
                        {d.jackpot_selected && (
                          <div className="mt-1 text-[10px] font-semibold text-amber-200">
                            JACKPOT TARGET {formatJackpotCurrency(d.jackpot_target_amount)} • Remaining{' '}
                            {formatJackpotCurrency(d.jackpot_remaining_amount)}
                          </div>
                        )}
                        {jackpotStatus && <div className="mt-1 text-[10px] text-amber-300">{jackpotStatus}</div>}
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] text-slate-500">Last Seen</div>
                        <div className="text-xs text-slate-300">
                          {d.updated_at ? moment(d.updated_at).format('MM-DD HH:mm') : '—'}
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
                      <div>
                        <div className="text-[10px] text-slate-500">Balance</div>
                        <div className="font-mono text-sm font-bold text-green-400">{formatCurrency(d.balance)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-500">Hopper</div>
                        <div
                          className={`font-mono text-sm font-bold ${
                            hopperLow ? 'text-red-300 animate-pulse' : 'text-amber-300'
                          }`}
                        >
                          {formatCurrency(d.hopper_balance)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-500">Last Bet</div>
                        <div className="font-mono text-sm text-violet-300">{formatCurrency(d.last_bet_amount)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-500">House Win</div>
                        <div className={`font-mono text-sm ${deviceHouseWin < 0 ? 'text-red-300' : 'text-orange-300'}`}>
                          {formatCurrency(deviceHouseWin)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-500">Spins</div>
                        <div className="font-mono text-sm text-cyan-300">
                          {asNumber(d.spins_total).toLocaleString()}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-500">RTP</div>
                        <div className="font-mono text-sm text-fuchsia-300">{formatPercent(deviceRtp)}</div>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="hidden overflow-x-auto rounded-lg border border-slate-800 md:block">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-900 text-slate-400">
                <tr>
                  <th className="px-4 py-2 text-left">
                    <button type="button" className="hover:text-white" onClick={() => onSort('device_id')}>
                      Device {sortField === 'device_id' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
                    </button>
                  </th>
                  <th className="px-4 py-2 text-left">Status</th>
                  <th className="px-4 py-2 text-left">Game / Mode</th>
                  <th className="px-4 py-2 text-right">
                    <button type="button" className="hover:text-white" onClick={() => onSort('balance')}>
                      Balance {sortField === 'balance' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
                    </button>
                  </th>
                  <th className="px-4 py-2 text-right">
                    <button type="button" className="hover:text-white" onClick={() => onSort('coins_in_total')}>
                      Coins-In {sortField === 'coins_in_total' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
                    </button>
                  </th>
                  <th className="px-4 py-2 text-right">
                    <button type="button" className="hover:text-white" onClick={() => onSort('hopper_balance')}>
                      Hopper {sortField === 'hopper_balance' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
                    </button>
                  </th>
                  <th className="px-4 py-2 text-right">Bet</th>
                  <th className="px-4 py-2 text-right">
                    <button type="button" className="hover:text-white" onClick={() => onSort('last_bet_amount')}>
                      Last Bet {sortField === 'last_bet_amount' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
                    </button>
                  </th>
                  <th className="px-4 py-2 text-right">Win</th>
                  <th className="px-4 py-2 text-right">
                    <button type="button" className="hover:text-white" onClick={() => onSort('house_win')}>
                      House Win {sortField === 'house_win' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
                    </button>
                  </th>
                  <th className="px-4 py-2 text-right">
                    <button type="button" className="hover:text-white" onClick={() => onSort('spins_total')}>
                      Spins {sortField === 'spins_total' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
                    </button>
                  </th>
                  <th className="px-4 py-2 text-right">
                    <button type="button" className="hover:text-white" onClick={() => onSort('rtp')}>
                      RTP {sortField === 'rtp' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
                    </button>
                  </th>
                  <th className="px-4 py-2 text-right">
                    <button type="button" className="hover:text-white" onClick={() => onSort('updated_at')}>
                      Last Seen {sortField === 'updated_at' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {visibleDevices.map(d => {
                  const deviceRtp =
                    asNumber(d.bet_total) > 0
                      ? (asNumber(d.win_total) / asNumber(d.bet_total)) * 100
                      : 0
                  const deviceHouseWin = asNumber(d.house_take_total ?? (asNumber(d.bet_total) - asNumber(d.win_total)))
                  const hopperLow = asNumber(d.hopper_balance) <= hopperAlertThreshold
                  const telemetryLabel = getDeviceTelemetryLabel(d)
                  const jackpotStatus = getDeviceJackpotStatus(d)
                  const gameType = getDeviceGameType(d)

                  return (
                    <tr
                      key={d.device_id}
                      className={`cursor-pointer ${
                        d.jackpot_selected
                          ? 'bg-amber-950/25 hover:bg-amber-900/30 ring-1 ring-inset ring-amber-400/40'
                          : 'hover:bg-slate-900/50'
                      }`}
                      onClick={() =>
                        setSelectedDevice({
                          ...d,
                          game_type: gameType,
                        })
                      }
                    >
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <span>{d.device_id ?? 'Unnamed'}</span>
                          {d.jackpot_selected && (
                            <span className="rounded border border-amber-400/70 bg-amber-900/50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-200">
                              JACKPOT
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                            d.device_status === 'playing'
                              ? 'bg-emerald-900/40 text-emerald-300 border border-emerald-700/50'
                              : d.device_status === 'offline'
                                ? 'bg-slate-800 text-slate-400 border border-slate-700'
                                : 'bg-amber-900/40 text-amber-300 border border-amber-700/50'
                          }`}
                        >
                          {(d.device_status ?? 'idle').toUpperCase()}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-xs">
                        <div className="text-slate-200">{telemetryLabel}</div>
                        {jackpotStatus && <div className="text-amber-300">{jackpotStatus}</div>}
                        {d.jackpot_selected && (
                          <div className="text-amber-200/80">
                            Target {formatJackpotCurrency(d.jackpot_target_amount)} • Remaining{' '}
                            {formatJackpotCurrency(d.jackpot_remaining_amount)}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right font-mono font-bold text-green-400">
                        {formatCurrency(d.balance)}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-sky-300">
                        {formatCurrency(d.coins_in_total)}
                      </td>
                      <td className="px-4 py-2 text-right font-mono">
                        <div
                          className={`inline-flex items-center gap-2 ${
                            hopperLow ? 'text-red-300 animate-pulse font-extrabold text-base' : 'text-amber-300'
                          }`}
                        >
                          {hopperLow && (
                            <span className="rounded border-2 border-red-500 bg-red-950/80 px-2 py-0.5 text-[10px] font-black tracking-wide text-red-200">
                              LOW HOPPER
                            </span>
                          )}
                          <span>{formatCurrency(d.hopper_balance)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-violet-300">
                        {formatCurrency(d.bet_total)}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-violet-300">
                        {formatCurrency(d.last_bet_amount)}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-violet-300">
                        {formatCurrency(d.win_total)}
                      </td>
                      <td
                        className={`px-4 py-2 text-right font-mono ${
                          deviceHouseWin < 0 ? 'text-red-300 animate-pulse' : 'text-orange-300'
                        }`}
                      >
                        {formatCurrency(deviceHouseWin)}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-cyan-300">
                        {asNumber(d.spins_total).toLocaleString()}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-fuchsia-300">
                        {formatPercent(deviceRtp)}
                      </td>
                      <td className="px-4 py-2 text-right text-xs text-slate-400">
                        {d.updated_at ? moment(d.updated_at).format('YYYY-MM-DD HH:mm') : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {visibleDevices.length === 0 && (
            <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-6 text-center text-sm text-slate-400">
              {searchTerm ? `No devices found for "${searchTerm}".` : 'No devices found.'}
            </div>
          )}
          <div className="mt-2 text-xs text-slate-500">Sorted by {sortLabel} ({sortDirection.toUpperCase()})</div>
        </section>
      </div>

      {selectedDevice && (
        <DeviceModal
          device={{ ...selectedDevice, hopper_alert_threshold: hopperAlertThreshold }}
          onClose={() => setSelectedDevice(null)}
        />
      )}

      {showHappyPotsModal && (
        <div className="fixed inset-0 z-50 bg-black/80 p-4">
          <div className="mx-auto max-w-2xl rounded-lg border border-slate-700 bg-slate-950 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Happy Hour Pots Queue</h3>
              <button onClick={() => setShowHappyPotsModal(false)} className="text-slate-300 hover:text-white">
                ✕
              </button>
            </div>
            <div className="max-h-[70vh] overflow-auto space-y-2">
              {happyPots.map(p => (
                <div key={p.id} className="rounded border border-slate-800 bg-slate-900/70 p-3 text-sm">
                  <div className="font-mono">#{p.id} • {String(p.status).toUpperCase()} • {formatCurrency(p.amount_total)}</div>
                  <div className="text-slate-400 text-xs mt-1">
                    Remaining {formatCurrency(p.amount_remaining)} • {p.goal_mode}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {showJackpotPotsModal && (
        <div className="fixed inset-0 z-50 bg-black/80 p-4">
          <div className="mx-auto max-w-2xl rounded-lg border border-slate-700 bg-slate-950 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Jackpot Pots Queue</h3>
              <button onClick={() => setShowJackpotPotsModal(false)} className="text-slate-300 hover:text-white">
                ✕
              </button>
            </div>
            <div className="max-h-[70vh] overflow-auto space-y-2">
              {jackpotPots.map(p => (
                <div key={p.id} className="rounded border border-slate-800 bg-slate-900/70 p-3 text-sm">
                  <div className="font-mono">#{p.id} • {String(p.status).toUpperCase()} • {formatCurrency(p.amount_total)}</div>
                  <div className="text-slate-400 text-xs mt-1">
                    Remaining {formatCurrency(p.amount_remaining)} • {p.goal_mode}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
