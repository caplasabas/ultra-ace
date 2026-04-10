import { useEffect, useMemo, useState } from 'react'
import type { DeviceRow } from '../hooks/useDevices'
import { useDevices } from '../hooks/useDevices'
import { DeviceModal } from '../components/DeviceModal'
import { useGlobalStats } from '../hooks/useGlobalStats'
import { useCasinoRuntime } from '../hooks/useCasinoRuntime'
import { useGames } from '../hooks/useGames'
import moment from 'moment'
import { supabase } from '../lib/supabase'

type SortField =
  | 'name'
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
  { field: 'name', label: 'Device' },
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
  const [searchTerm, setSearchTerm] = useState('')
  const [sortField, setSortField] = useState<SortField>('name')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [showHappyPotsModal, setShowHappyPotsModal] = useState(false)
  const [showJackpotPotsModal, setShowJackpotPotsModal] = useState(false)
  const [happyPots, setHappyPots] = useState<any[]>([])
  const [jackpotPots, setJackpotPots] = useState<any[]>([])
  const [hopperAlertsEnabled, setHopperAlertsEnabled] = useState(() => {
    try {
      return localStorage.getItem('hopperAlertsEnabled') === 'true'
    } catch {
      return false
    }
  })
  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = 10

  useEffect(() => {
    try {
      localStorage.setItem('hopperAlertsEnabled', String(hopperAlertsEnabled))
    } catch {
      /* empty */
    }
  }, [hopperAlertsEnabled])

  useEffect(() => {
    if (!errorMessage) return
    const t = setTimeout(() => setErrorMessage(null), 4000)
    return () => clearTimeout(t)
  }, [errorMessage])

  useEffect(() => {
    async function fetchPots() {
      const [{ data: happyData }, { data: jackpotData }] = await Promise.all([
        supabase.from('happy_hour_pots').select('*').order('id', { ascending: false }).limit(50),
        supabase.from('jackpot_pots').select('*').order('id', { ascending: false }).limit(50),
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

    const poll = window.setInterval(() => {
      void fetchPots()
    }, 1000)

    return () => {
      window.clearInterval(poll)
      void supabase.removeChannel(channel)
    }
  }, [])

  const asNumber = (v: number | string | null | undefined) => Number(v ?? 0)
  const formatCurrency = (v: number | string | null | undefined) =>
    `₱${asNumber(v).toLocaleString()}`
  const formatJackpotCurrency = (v: number | string | null | undefined) =>
    `₱${asNumber(v).toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })}`
  const formatPercent = (v: number | string | null | undefined) => `${asNumber(v).toFixed(2)}%`

  const globalBet = asNumber(stats?.total_bet_amount)
  const globalWin = asNumber(stats?.total_win_amount)
  const globalAverageBet =
    asNumber(stats?.total_spins) > 0 ? globalBet / asNumber(stats?.total_spins) : 0
  const globalHouseGross = asNumber(stats?.total_house_take ?? globalBet - globalWin)
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
      const type = String(game?.type ?? '')
        .trim()
        .toLowerCase()
      if (!id) continue
      if (type === 'arcade' || type === 'casino') {
        index.set(id, type)
      }
    }
    return index
  }, [games])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCurrentPage(1)
  }, [searchTerm, sortField, sortDirection])

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
    if (field === 'name') return (device.name ?? '').toLowerCase()
    if (field === 'updated_at') return device.updated_at ? moment(device.updated_at).valueOf() : 0
    if (field === 'house_win')
      return asNumber(
        device.house_take_total ?? asNumber(device.bet_total) - asNumber(device.win_total),
      )
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
          const name = (d.name ?? '').toLowerCase()
          return name.includes(search)
        })
      : [...devices]

    filtered.sort((a, b) => {
      const left = getSortValue(a, sortField)
      const right = getSortValue(b, sortField)

      if (typeof left === 'string' || typeof right === 'string') {
        const leftText = String(left)
        const rightText = String(right)

        const compare = leftText.localeCompare(rightText, undefined, {
          numeric: true,
          sensitivity: 'base',
        })

        return sortDirection === 'asc' ? compare : -compare
      }

      const compare = left - right
      return sortDirection === 'asc' ? compare : -compare
    })

    return filtered
  }, [devices, searchTerm, sortField, sortDirection])

  const onSort = (field: SortField) => {
    if (field === sortField) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortField(field)
    setSortDirection(field === 'name' ? 'asc' : 'desc')
  }

  const sortLabel = SORT_OPTIONS.find(option => option.field === sortField)?.label ?? 'Last Seen'
  const prioritizedDevices = [...visibleDevices].sort((a, b) => {
    const computeRisk = (d: any) => {
      const deviceRtp =
        asNumber(d.bet_total) > 0 ? (asNumber(d.win_total) / asNumber(d.bet_total)) * 100 : 0

      const threshold = asNumber((d as any)?.hopper_alert_threshold ?? 500)
      const hopperLow = asNumber(d.hopper_balance) <= threshold

      const highRtp = deviceRtp > 110

      // const lastHeartbeat = new Date((d as any)?.session_last_heartbeat ?? 0).getTime()
      // const stuckSession =
      //   d.device_status === 'playing' && Date.now() - lastHeartbeat > 1000 * 60 * 2

      const offline = d.device_status === 'offline'

      let score = 0
      if (offline) score += 100
      // if (stuckSession) score += 80
      if (hopperLow) score += 60
      if (highRtp) score += 40

      return score
    }

    return computeRisk(b) - computeRisk(a)
  })
  const totalPages = Math.max(1, Math.ceil(prioritizedDevices.length / pageSize))

  const paginatedDevices = prioritizedDevices.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  )

  return (
    <>
      <div className="p-5 sm:p-6 max-w-[90rem] mx-auto space-y-8 sm:space-y-10 bg-slate-900 text-slate-100">
        <header>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
        </header>

        {errorMessage && (
          <div className="p-3 bg-red-900/40 border border-red-700 text-red-300 text-sm rounded">
            {errorMessage}
          </div>
        )}

        <section>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <div className="rounded-xl border border-green-700/40 bg-green-100 dark:bg-green-900/20 p-4">
              <div className="text-lg font-semibold text-green-700 dark:text-green-200 mb-2">
                Money Flow
              </div>

              <div className="space-y-3">
                <div>
                  <div className="text-xs text-green-700/80 dark:text-green-200/80">
                    Total Balance
                  </div>
                  <div className="text-3xl font-extrabold font-mono text-green-700 dark:text-green-200">
                    {formatCurrency(stats?.total_balance)}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <div className="text-xs text-sky-700/80 dark:text-sky-200/80">Coins-In</div>
                    <div className="text-lg font-mono text-sky-700 dark:text-sky-300">
                      {formatCurrency(stats?.total_coins_in)}
                    </div>
                  </div>

                  <div>
                    <div className="text-xs text-amber-700/80 dark:text-amber-200/80">Hopper</div>
                    <div className="text-lg font-mono text-amber-700 dark:text-amber-300">
                      {formatCurrency(stats?.total_hopper)}
                    </div>
                  </div>

                  <div>
                    <div className="text-xs text-rose-700/80 dark:text-rose-200/80">
                      Withdraw Total
                    </div>
                    <div className="text-lg font-mono text-rose-700 dark:text-rose-300">
                      {formatCurrency(stats?.total_withdraw_amount)}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-violet-700/40 bg-violet-100 dark:bg-violet-900/20 p-4">
              <div className="text-lg font-semibold text-violet-700 dark:text-violet-200 mb-2">
                Game Flow
              </div>

              <div className="space-y-3">
                <div>
                  <div className="text-xs text-violet-700/80 dark:text-violet-200/80">
                    Total Bet
                  </div>
                  <div className="text-3xl font-bold font-mono text-violet-700 dark:text-violet-300">
                    {formatCurrency(stats?.total_bet_amount)}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 items-end">
                  <div>
                    <div className="text-xs text-red-700/80 dark:text-red-200/80">Total Win</div>
                    <div className="text-lg font-mono text-red-700 dark:text-red-300">
                      {formatCurrency(stats?.total_win_amount)}
                    </div>
                  </div>

                  <div className="text-xs text-violet-700/80 dark:text-violet-200/80 font-mono">
                    Avg Bet / Spin {formatJackpotCurrency(globalAverageBet)}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-fuchsia-700/40 bg-fuchsia-100 dark:bg-fuchsia-900/20 p-4">
              <div className="text-lg font-semibold text-fuchsia-700 dark:text-fuchsia-200 mb-2">
                Performance
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-xs text-fuchsia-700/80 dark:text-fuchsia-200/80">RTP</div>
                  <div className="text-3xl font-bold font-mono text-fuchsia-700 dark:text-fuchsia-300">
                    {formatPercent(stats?.global_rtp_percent)}
                  </div>
                  <div className="text-xs text-fuchsia-700/80 dark:text-fuchsia-200/80">
                    Target {formatPercent(activeTargetRtpPct)}
                  </div>
                </div>

                <div>
                  <div className="text-xs text-orange-700/80 dark:text-orange-200/80">
                    House Take
                  </div>
                  <div className="text-lg font-mono text-orange-700 dark:text-orange-300">
                    {formatCurrency(globalHouseGross)}
                  </div>
                </div>
              </div>
            </div>

            {/* 🏦 SYSTEM / POOLS */}
            <div className="rounded-xl border border-emerald-700/40 bg-emerald-100 dark:bg-emerald-900/20 p-4">
              <div className="text-lg font-semibold text-emerald-700 dark:text-emerald-200 mb-2">
                System
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-emerald-700/80 dark:text-emerald-200/80">Mode</span>
                  <span className="text-lg font-bold font-mono text-emerald-700 dark:text-emerald-300">
                    {runtime?.active_mode ?? 'BASE'}
                  </span>
                </div>

                <div className="text-xs text-emerald-700/80 dark:text-emerald-200/80 font-mono">
                  Happy Pool {formatCurrency(runtime?.happy_hour_prize_balance)}
                </div>

                <div className="text-xs text-indigo-700/80 dark:text-indigo-200/80 font-mono">
                  Jackpot Pool {formatCurrency(runtime?.jackpot_pool_balance)}/{' '}
                  {formatCurrency(runtime?.jackpot_pool_goal)}
                </div>

                <div className="text-xs text-emerald-700/60 dark:text-emerald-200/60 font-mono">
                  H/J/P {formatPercent(activeHousePct)} / {formatPercent(activeJackpotPct)} /{' '}
                  {formatPercent(activeHappyPct)}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section>
          <div className="mb-3 flex flex-col gap-3">
            <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto_auto] gap-2 sm:gap-3 items-center">
              <div className="flex items-center justify-between gap-3">
                <div className="gap-3">
                  <h2 className="text-lg font-semibold">Devices</h2>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <div className="text-xs text-red-300">
                    🔴 Offline {devices.filter(d => d.device_status === 'offline').length}
                  </div>

                  {/*<div className="text-xs text-yellow-300">*/}
                  {/*  🟡 Stuck{' '}*/}
                  {/*  {*/}
                  {/*    devices.filter(d => {*/}
                  {/*      return (*/}
                  {/*        d.device_status === 'playing' &&*/}
                  {/*        Date.now() - new Date((d as any)?.session_last_heartbeat ?? 0).getTime() >*/}
                  {/*          120000*/}
                  {/*      )*/}
                  {/*    }).length*/}
                  {/*  }*/}
                  {/*</div>*/}

                  <div className="text-xs text-orange-300">
                    🟠 Low Hopper{' '}
                    {hopperAlertsEnabled
                      ? devices.filter(d => {
                          const threshold = asNumber((d as any)?.hopper_alert_threshold ?? 500)
                          return asNumber(d.hopper_balance) <= threshold
                        }).length
                      : 0}
                  </div>

                  <div className="text-xs text-fuchsia-300">
                    🟣 High RTP{' '}
                    {
                      devices.filter(d => {
                        const rtp =
                          asNumber(d.bet_total) > 0
                            ? (asNumber(d.win_total) / asNumber(d.bet_total)) * 100
                            : 0
                        return rtp > 110
                      }).length
                    }
                  </div>
                </div>

                <div className="flex items-center gap-2 text-sm text-slate-300">
                  <span className="text-slate-400">Alerts</span>

                  <select
                    value={hopperAlertsEnabled ? 'on' : 'off'}
                    onChange={e => setHopperAlertsEnabled(e.target.value === 'on')}
                    className="rounded border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200"
                  >
                    <option value="on">Hopper Alerts: ON</option>
                    <option value="off">Hopper Alerts: OFF</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-5 text-sm text-slate-300">
                <input
                  type="search"
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  placeholder="Search device ID or name"
                  className="rounded-lg border border-slate-700 bg-white dark:bg-slate-900 px-3 min-w-64 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-500 focus:border-slate-500 focus:outline-none"
                />
                <select
                  value={sortField}
                  onChange={e => onSort(e.target.value as SortField)}
                  className="rounded-lg border border-slate-700 bg-white dark:bg-slate-900 px-3 min-w-36 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-slate-500 focus:outline-none"
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

              <div className="text-xs text-slate-400">
                Showing {visibleDevices.length.toLocaleString()} of{' '}
                {devices.length.toLocaleString()}
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-slate-700 md:hidden">
            <div className="space-y-2 p-2">
              {paginatedDevices.map(d => {
                const deviceRtp =
                  asNumber(d.bet_total) > 0
                    ? (asNumber(d.win_total) / asNumber(d.bet_total)) * 100
                    : 0
                const deviceHouseWin = asNumber(
                  d.house_take_total ?? asNumber(d.bet_total) - asNumber(d.win_total),
                )
                const threshold = asNumber((d as any)?.hopper_alert_threshold ?? 500)
                const hopperLow = hopperAlertsEnabled && asNumber(d.hopper_balance) <= threshold
                // --- Alert Computations ---
                const HIGH_RTP_THRESHOLD = 110
                const highRtp = deviceRtp > HIGH_RTP_THRESHOLD
                const offline = d.device_status === 'offline'
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
                        : 'border-slate-700 bg-slate-800'
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
                        <div className="truncate text-sm font-semibold text-slate-100 text-slate-900 dark:text-slate-100">
                          {d.name?.trim() || 'Unnamed Cabinet'}
                        </div>
                        <div className="truncate text-[10px] text-slate-400">
                          {[d.area_name, d.station_name].filter(Boolean).join(' • ') ||
                            'Unassigned'}
                        </div>
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

                        <div className="mt-1 flex flex-wrap gap-1">
                          {hopperLow && (
                            <span className="px-1.5 py-0.5 text-[9px] font-bold rounded border border-red-500 bg-red-950 text-red-300">
                              LOW
                            </span>
                          )}

                          {highRtp && (
                            <span className="px-1.5 py-0.5 text-[9px] font-bold rounded border border-fuchsia-500 bg-fuchsia-950 text-fuchsia-300">
                              RTP
                            </span>
                          )}

                          {/*{stuckSession && (*/}
                          {/*  <span className="px-1.5 py-0.5 text-[9px] font-bold rounded border border-yellow-500 bg-yellow-950 text-yellow-300">*/}
                          {/*    STUCK*/}
                          {/*  </span>*/}
                          {/*)}*/}

                          {offline && (
                            <span className="px-1.5 py-0.5 text-[9px] font-bold rounded border border-slate-500 bg-slate-900 text-slate-300">
                              OFF
                            </span>
                          )}
                        </div>
                        {d.jackpot_selected && (
                          <div className="mt-1 text-[10px] font-semibold text-amber-200">
                            JACKPOT TARGET {formatJackpotCurrency(d.jackpot_target_amount)} •
                            Remaining {formatJackpotCurrency(d.jackpot_remaining_amount)}
                          </div>
                        )}
                        {jackpotStatus && (
                          <div className="mt-1 text-[10px] text-amber-300">{jackpotStatus}</div>
                        )}
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
                        <div className="font-mono text-sm font-bold text-green-400">
                          {formatCurrency(d.balance)}
                        </div>
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
                        <div className="font-mono text-sm text-violet-300">
                          {formatCurrency(d.last_bet_amount)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-500">House Win</div>
                        <div
                          className={`font-mono text-sm ${deviceHouseWin < 0 ? 'text-red-300' : 'text-orange-300'}`}
                        >
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
                        <div className="font-mono text-sm text-fuchsia-300">
                          {formatPercent(deviceRtp)}
                        </div>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="hidden overflow-x-auto rounded-lg border border-slate-700 md:block">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-800 text-slate-300">
                <tr>
                  <th className="px-4 py-2 text-left">
                    <button
                      type="button"
                      className="hover:text-white"
                      onClick={() => onSort('name')}
                    >
                      Device {sortField === 'name' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
                    </button>
                  </th>
                  <th className="px-4 py-2 text-left">Status</th>
                  <th className="px-4 py-2 text-left">Game / Mode</th>
                  <th className="px-4 py-2 text-right">
                    <button
                      type="button"
                      className="hover:text-white"
                      onClick={() => onSort('balance')}
                    >
                      Balance {sortField === 'balance' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
                    </button>
                  </th>
                  <th className="px-4 py-2 text-right">Stats</th>
                  <th className="px-4 py-2 text-right">
                    <button
                      type="button"
                      className="hover:text-white"
                      onClick={() => onSort('hopper_balance')}
                    >
                      Hopper{' '}
                      {sortField === 'hopper_balance' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
                    </button>
                  </th>

                  <th className="px-4 py-2 text-right">
                    <button
                      type="button"
                      className="hover:text-white"
                      onClick={() => onSort('last_bet_amount')}
                    >
                      Last Bet{' '}
                      {sortField === 'last_bet_amount' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
                    </button>
                  </th>

                  <th className="px-4 py-2 text-right">
                    <button
                      type="button"
                      className="hover:text-white"
                      onClick={() => onSort('house_win')}
                    >
                      House Win{' '}
                      {sortField === 'house_win' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
                    </button>
                  </th>
                  <th className="px-4 py-2 text-right">
                    <button
                      type="button"
                      className="hover:text-white"
                      onClick={() => onSort('updated_at')}
                    >
                      Last Seen{' '}
                      {sortField === 'updated_at' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {paginatedDevices.map(d => {
                  const deviceRtp =
                    asNumber(d.bet_total) > 0
                      ? (asNumber(d.win_total) / asNumber(d.bet_total)) * 100
                      : 0
                  const deviceHouseWin = asNumber(
                    d.house_take_total ?? asNumber(d.bet_total) - asNumber(d.win_total),
                  )
                  const threshold = asNumber((d as any)?.hopper_alert_threshold ?? 500)
                  const hopperLow = hopperAlertsEnabled && asNumber(d.hopper_balance) <= threshold
                  // --- Alert Computations ---
                  const HIGH_RTP_THRESHOLD = 110
                  const highRtp = deviceRtp > HIGH_RTP_THRESHOLD
                  const offline = d.device_status === 'offline'
                  const telemetryLabel = getDeviceTelemetryLabel(d)
                  const jackpotStatus = getDeviceJackpotStatus(d)
                  const gameType = getDeviceGameType(d)

                  return (
                    <tr
                      key={d.device_id}
                      className={`cursor-pointer ${
                        offline
                          ? 'bg-slate-800/60 ring-1 ring-slate-500/40'
                          : // : stuckSession
                            //   ? 'bg-yellow-950/30 ring-1 ring-yellow-500/40'
                            hopperLow
                            ? 'bg-red-950/30 ring-1 ring-red-500/40'
                            : highRtp
                              ? 'bg-fuchsia-950/30 ring-1 ring-fuchsia-500/40'
                              : d.jackpot_selected
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
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate font-medium">
                              {d.name?.trim() || 'Unnamed Cabinet'}
                            </div>

                            <div className="truncate text-sm text-slate-400">
                              {[d.area_name, d.station_name].filter(Boolean).join(' • ') ||
                                'Unassigned'}
                            </div>

                            <div className="truncate text-[10px] text-slate-500 font-mono">
                              {d.device_id}
                            </div>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {hopperLow && (
                                <span className="px-1.5 py-0.5 text-[9px] font-bold rounded border border-red-500 bg-red-950 text-red-300">
                                  LOW
                                </span>
                              )}

                              {highRtp && (
                                <span className="px-1.5 py-0.5 text-[9px] font-bold rounded border border-fuchsia-500 bg-fuchsia-950 text-fuchsia-300">
                                  RTP
                                </span>
                              )}

                              {/*{stuckSession && (*/}
                              {/*  <span className="px-1.5 py-0.5 text-[9px] font-bold rounded border border-yellow-500 bg-yellow-950 text-yellow-300">*/}
                              {/*    STUCK*/}
                              {/*  </span>*/}
                              {/*)}*/}

                              {offline && (
                                <span className="px-1.5 py-0.5 text-[9px] font-bold rounded border border-slate-500 bg-slate-900 text-slate-300">
                                  OFF
                                </span>
                              )}
                            </div>
                          </div>

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
                      <td className="px-4 py-2 text-right">
                        <div className="flex gap-2 justify-end font-mono text-sm text-slate-300">
                          Bets:
                          <span className="font-extrabold">{formatCurrency(d.bet_total)}</span>
                        </div>
                        <div className="flex gap-2 justify-end  font-mono text-sm text-slate-300">
                          Wins:
                          <span className="font-extrabold">{formatCurrency(d.win_total)}</span>
                        </div>
                        <div className="flex gap-2 justify-end  font-mono text-sm text-fuchsia-300">
                          RTP:
                          <span className="font-extrabold">{formatPercent(deviceRtp)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2 text-right font-mono">
                        <div
                          className={`inline-flex items-center gap-2 ${
                            hopperLow
                              ? 'text-red-300 animate-pulse font-extrabold text-base'
                              : 'text-amber-300'
                          }`}
                        >
                          {hopperLow && (
                            <span className="rounded border-2  text-center border-red-500 bg-red-950/80 px-2 py-0.5 text-[10px] font-black tracking-wide text-red-200">
                              LOW
                            </span>
                          )}
                          <span>{formatCurrency(d.hopper_balance)}</span>
                        </div>
                      </td>

                      <td className="px-4 py-2 text-right font-mono text-violet-300">
                        {formatCurrency(d.last_bet_amount)}
                      </td>

                      <td
                        className={`px-4 py-2 text-right font-mono ${
                          deviceHouseWin < 0 ? 'text-red-300 animate-pulse' : 'text-orange-300'
                        }`}
                      >
                        {formatCurrency(deviceHouseWin)}
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
            <div className="rounded-lg border border-slate-800 bg-slate-900/40 light:bg-slate-100 p-6 text-center text-sm text-slate-400">
              {searchTerm ? `No devices found for "${searchTerm}".` : 'No devices found.'}
            </div>
          )}
          <div className="mt-4 flex items-center justify-between text-sm">
            <div className="text-slate-400">
              Page {currentPage} of {totalPages || 1}
            </div>

            <div className="flex items-center gap-2">
              <button
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                className="px-3 py-1 rounded border border-slate-700 bg-slate-900 disabled:opacity-40"
              >
                Prev
              </button>

              <button
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                className="px-3 py-1 rounded border border-slate-700 bg-slate-900 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
          <div className="mt-2 text-xs text-slate-500">
            Sorted by {sortLabel} ({sortDirection.toUpperCase()})
          </div>
        </section>
      </div>

      {selectedDevice && (
        <DeviceModal
          device={{ ...selectedDevice, hopper_alert_threshold: hopperAlertThreshold }}
          hopperAlertsEnabled={hopperAlertsEnabled}
          onClose={() => setSelectedDevice(null)}
        />
      )}

      {showHappyPotsModal && (
        <div className="fixed inset-0 z-50 bg-black/80 p-5 sm:p-6">
          <div className="mx-auto max-w-2xl rounded-lg border border-slate-700 bg-slate-950 p-5 sm:p-6">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Happy Hour Pots Queue</h3>
              <button
                onClick={() => setShowHappyPotsModal(false)}
                className="text-slate-300 hover:text-white"
              >
                ✕
              </button>
            </div>
            <div className="max-h-[70vh] overflow-auto space-y-2">
              {happyPots.map(p => (
                <div
                  key={p.id}
                  className="rounded border border-slate-800 bg-slate-900/70 p-3 text-sm"
                >
                  <div className="font-mono">
                    #{p.id} • {String(p.status).toUpperCase()} • {formatCurrency(p.amount_total)}
                  </div>
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
        <div className="fixed inset-0 z-50 bg-black/80 p-5 sm:p-6">
          <div className="mx-auto max-w-2xl rounded-lg border border-slate-700 bg-slate-950 p-5 sm:p-6">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Jackpot Pots Queue</h3>
              <button
                onClick={() => setShowJackpotPotsModal(false)}
                className="text-slate-300 hover:text-white"
              >
                ✕
              </button>
            </div>
            <div className="max-h-[70vh] overflow-auto space-y-2">
              {jackpotPots.map(p => (
                <div
                  key={p.id}
                  className="rounded border border-slate-800 bg-slate-900/70 p-3 text-sm"
                >
                  <div className="font-mono">
                    #{p.id} • {String(p.status).toUpperCase()} • {formatCurrency(p.amount_total)}
                  </div>
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
