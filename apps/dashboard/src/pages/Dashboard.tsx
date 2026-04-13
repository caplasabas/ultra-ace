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
type DeploymentFilter = 'online' | 'maintenance' | 'all'

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

// const ENGINE_SIM_BASE_RTP_PCT = 67.29
// const ENGINE_SIM_FREE_RTP_PCT = 6.16
const ENGINE_SIM_TOTAL_RTP_PCT = 73.44

export default function Dashboard() {
  const devices = useDevices()
  const games = useGames()
  const stats = useGlobalStats()
  const { runtime, profiles } = useCasinoRuntime()

  const [selectedDevice, setSelectedDevice] = useState<any | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [sortField, setSortField] = useState<SortField>('balance')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [deploymentFilter, setDeploymentFilter] = useState<DeploymentFilter>('all')
  const [showHappyPotsModal, setShowHappyPotsModal] = useState(false)
  const [showJackpotPotsModal, setShowJackpotPotsModal] = useState(false)
  const [showJackpotQueuesModal, setShowJackpotQueuesModal] = useState(false)
  const [happyPots, setHappyPots] = useState<any[]>([])
  const [jackpotPots, setJackpotPots] = useState<any[]>([])
  const [jackpotQueues, setJackpotQueues] = useState<any[]>([])
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

  useEffect(() => {
    async function fetchJackpotQueues() {
      const { data } = await supabase
        .from('jackpot_payout_queue')
        .select('*')
        .order('completed_at', { ascending: true, nullsFirst: true })
        .order('created_at', { ascending: false })
        .limit(100)

      setJackpotQueues(data ?? [])
    }

    void fetchJackpotQueues()

    const channel = supabase
      .channel('dashboard-jackpot-queues')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'jackpot_payout_queue' },
        fetchJackpotQueues,
      )
      .subscribe()

    const poll = window.setInterval(() => {
      void fetchJackpotQueues()
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
  const getBaseWinAmount = (
    row: Pick<DeviceRow, 'win_total' | 'jackpot_win_total' | 'prize_pool_paid_total'>,
  ) =>
    asNumber(row.win_total) - asNumber(row.jackpot_win_total) - asNumber(row.prize_pool_paid_total)
  const getDeviceRtp = (
    row: Pick<DeviceRow, 'bet_total' | 'win_total' | 'jackpot_win_total' | 'prize_pool_paid_total'>,
  ) => (asNumber(row.bet_total) > 0 ? (getBaseWinAmount(row) / asNumber(row.bet_total)) * 100 : 0)

  const globalBet = asNumber(stats?.total_bet_amount)
  const globalWin = asNumber(stats?.total_win_amount)
  const globalBaseWin = devices.reduce((sum, device) => sum + getBaseWinAmount(device), 0)
  const globalBaseRtp = globalBet > 0 ? (globalBaseWin / globalBet) * 100 : 0
  const devicesWithLastBet = devices.filter(device => device.last_bet_amount !== null).length
  const totalLastBetAmount = devices.reduce(
    (sum, device) => sum + asNumber(device.last_bet_amount),
    0,
  )
  const globalAverageBetByDevice =
    devicesWithLastBet > 0 ? totalLastBetAmount / devicesWithLastBet : 0
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
  const deviceNameById = useMemo(() => {
    const index = new Map<string, string>()
    for (const device of devices) {
      const deviceId = String(device?.device_id ?? '').trim()
      if (!deviceId) continue
      index.set(deviceId, String(device?.name ?? '').trim() || deviceId)
    }
    return index
  }, [devices])
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
  }, [deploymentFilter, searchTerm, sortField, sortDirection])

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
    if (field === 'rtp') return getDeviceRtp(device)
    return asNumber(device[field as keyof DeviceRow] as number | string | null | undefined)
  }

  const visibleDevices = useMemo(() => {
    const search = searchTerm.trim().toLowerCase()
    const filtered = search
      ? devices.filter(d => {
          const name = (d.name ?? '').toLowerCase()
          const deviceId = String(d.device_id ?? '').toLowerCase()
          return name.includes(search) || deviceId.includes(search)
        })
      : [...devices]

    const deploymentFiltered =
      deploymentFilter === 'all'
        ? filtered
        : filtered.filter(d =>
            deploymentFilter === 'maintenance'
              ? (d.deployment_mode ?? 'online') === 'maintenance'
              : (d.deployment_mode ?? 'online') !== 'maintenance',
          )

    deploymentFiltered.sort((a, b) => {
      const left = getSortValue(a, sortField)
      const right = getSortValue(b, sortField)

      if (typeof left === 'string' || typeof right === 'string') {
        const compare = String(left).localeCompare(String(right), undefined, {
          numeric: true,
          sensitivity: 'base',
        })

        return sortDirection === 'asc' ? compare : -compare
      }

      if (left === right) return 0

      const compare = left - right
      return sortDirection === 'asc' ? compare : -compare
    })

    return deploymentFiltered
  }, [deploymentFilter, devices, searchTerm, sortField, sortDirection])

  const onSort = (field: SortField) => {
    if (field === sortField) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortField(field)
    setSortDirection(field === 'name' ? 'asc' : 'desc')
  }

  const sortLabel = SORT_OPTIONS.find(option => option.field === sortField)?.label ?? 'Last Seen'
  const maintenanceHiddenCount = devices.filter(
    d => (d.deployment_mode ?? 'online') === 'maintenance',
  ).length
  const totalPages = Math.max(1, Math.ceil(visibleDevices.length / pageSize))

  const paginatedDevices = visibleDevices.slice(
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
            <div className="rounded-xl border border-green-700/40 bg-green-900/20 p-4">
              <div className="mb-2 text-lg font-semibold text-green-200">Money Flow</div>

              <div className="flex justify-between flex-wrap space-y-2">
                <div>
                  <div className="text-xs text-green-200/80">Total Balance</div>
                  <div className="text-3xl font-extrabold font-mono text-green-200">
                    {formatCurrency(stats?.total_balance)}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <div>
                    <div className="text-xs text-sky-200/80">Coins-In</div>
                    <div className="text-lg font-mono text-sky-300">
                      {formatCurrency(stats?.total_coins_in)}
                    </div>
                  </div>

                  <div>
                    <div className="text-xs text-amber-200/80">Hopper</div>
                    <div className="text-lg font-mono text-amber-300">
                      {formatCurrency(stats?.total_hopper)}
                    </div>
                  </div>

                  <div>
                    <div className="text-xs text-rose-200/80">Withdrawals</div>
                    <div className="text-lg font-mono text-rose-300">
                      {formatCurrency(stats?.total_withdraw_amount)}
                    </div>
                  </div>

                  <div>
                    <div className="text-xs text-indigo-200/80">Arcade</div>
                    <div className="text-lg font-mono text-indigo-300">
                      {formatCurrency(stats?.total_arcade_amount)}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-violet-700/40 bg-violet-900/20 p-4">
              <div className="mb-2 text-lg font-semibold text-violet-200">Game Flow</div>

              <div className="flex justify-between flex-wrap">
                <div>
                  <div className="text-xs text-violet-200/80">Total Bet</div>
                  <div className="text-3xl font-bold font-mono text-violet-300">
                    {formatCurrency(stats?.total_bet_amount)}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 ">
                  <div className="flex flex-col justify-end">
                    <div className="text-xs text-red-200/80">Total Win</div>
                    <div className="text-lg font-mono text-red-300">
                      {formatCurrency(stats?.total_win_amount)}
                    </div>
                  </div>

                  <div className="text-xs font-mono text-violet-200/80">
                    <div>Avg Bet {formatJackpotCurrency(globalAverageBetByDevice)}</div>
                    <div>Total Spins {asNumber(stats?.total_spins).toLocaleString()}</div>
                    <div>Avg Bet / Spin {formatJackpotCurrency(globalAverageBet)}</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-fuchsia-700/40 bg-fuchsia-900/20 p-4">
              <div className="mb-2 text-lg font-semibold text-fuchsia-200">Performance</div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-xs text-fuchsia-200/80">RTP</div>
                  <div className="text-3xl font-bold font-mono text-fuchsia-300">
                    {formatPercent(globalBaseRtp)}
                  </div>
                  <div className="text-xs text-fuchsia-200/80">
                    Target {formatPercent(ENGINE_SIM_TOTAL_RTP_PCT)}
                  </div>
                </div>

                <div>
                  <div className="text-xs text-orange-200/80">House Take</div>
                  <div className="text-lg font-mono text-orange-300">
                    {formatCurrency(globalHouseGross)}
                  </div>
                </div>
              </div>
            </div>

            {/* 🏦 SYSTEM / POOLS */}
            <div className="rounded-xl border border-emerald-700/40 bg-emerald-900/20 p-4">
              <div className="mb-2 text-lg font-semibold text-emerald-200">System</div>

              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-emerald-200/80">Mode</span>
                  <span className="text-lg font-bold font-mono text-emerald-300">
                    {runtime?.active_mode ?? 'BASE'}
                  </span>
                </div>

                <div className="text-xs font-mono text-emerald-200/80">
                  Happy Pool {formatCurrency(runtime?.prize_pool_balance)}/{' '}
                  {formatCurrency(runtime?.prize_pool_goal)}
                </div>

                <button
                  type="button"
                  onClick={() => setShowJackpotQueuesModal(true)}
                  className="block w-full text-left text-xs font-mono text-indigo-200/80 underline decoration-dotted underline-offset-2 transition hover:text-indigo-100"
                >
                  Jackpot Pool {formatCurrency(runtime?.jackpot_pool_balance)}/{' '}
                  {formatCurrency(runtime?.jackpot_pool_goal)}
                </button>

                <div className="text-xs font-mono text-emerald-200/60">
                  H/J/P {formatPercent(activeHousePct)} / {formatPercent(activeJackpotPct)} /{' '}
                  {formatPercent(activeHappyPct)}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section>
          <div className="mb-3 flex flex-col gap-3">
            <div className="flex flex-wrap justify-between gap-2 sm:gap-3 items-center">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="gap-3">
                  <h2 className="text-lg font-semibold">Devices</h2>
                </div>
                <div className="flex  flex-wrap items-center gap-5 text-sm text-slate-300">
                  <input
                    type="search"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    placeholder="Search device ID or name"
                    className="min-w-64 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-slate-500 focus:outline-none"
                  />
                  <select
                    value={deploymentFilter}
                    onChange={e =>
                      setDeploymentFilter(
                        e.target.value === 'maintenance'
                          ? 'maintenance'
                          : e.target.value === 'all'
                            ? 'all'
                            : 'online',
                      )
                    }
                    className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-200 hover:border-slate-500"
                  >
                    <option value="online">Show Online</option>
                    <option value="maintenance">Show Maintenance</option>
                    <option value="all">Show All</option>
                  </select>
                </div>
                <div className="text-xs text-slate-400">
                  Showing {visibleDevices.length.toLocaleString()} of{' '}
                  {devices.length.toLocaleString()}
                  {deploymentFilter === 'online' && maintenanceHiddenCount > 0
                    ? ` • ${maintenanceHiddenCount.toLocaleString()} hidden (maintenance)`
                    : deploymentFilter === 'maintenance'
                      ? ' • maintenance only'
                      : ''}
                </div>
              </div>

              <div className="flex flex-wrap justify-center items-center gap-5 text-sm text-slate-300">
                <div className="text-xs text-green-300">
                  🟢 Online:{' '}
                  {
                    devices.filter(
                      d =>
                        d.device_status !== 'offline' &&
                        (d.deployment_mode ?? 'online') !== 'maintenance',
                    ).length
                  }
                </div>
                <div className="text-xs text-violet-300">
                  🛠 Maintenance:{' '}
                  {devices.filter(d => (d.deployment_mode ?? 'online') === 'maintenance').length}
                </div>
                <div className="text-xs text-red-300">
                  🔴 Offline: {devices.filter(d => d.device_status === 'offline').length}
                </div>

                <div className="text-xs text-blue-300">
                  🔵 Active: {devices.filter(d => d.device_status === 'playing').length}
                </div>

                <div className="text-xs text-yellow-300">
                  🟡 Idle: {devices.filter(d => d.device_status === 'idle').length}
                </div>

                <div className="text-xs text-orange-300">
                  🟠 Low Hopper:{' '}
                  {hopperAlertsEnabled
                    ? devices.filter(d => {
                        const threshold = asNumber((d as any)?.hopper_alert_threshold ?? 500)
                        return asNumber(d.hopper_balance) <= threshold
                      }).length
                    : 0}
                </div>
                <div className="text-xs text-fuchsia-300">
                  🟣 High RTP:{' '}
                  {
                    devices.filter(d => {
                      const rtp = getDeviceRtp(d)
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
          </div>

          <div className="overflow-hidden rounded-lg border border-slate-700 md:hidden">
            <div className="flex flex-wrap items-center gap-3 mt-2 mx-2">
              <select
                value={sortField}
                onChange={e => {
                  const nextField = e.target.value as SortField
                  setSortField(nextField)
                  setSortDirection(nextField === 'name' ? 'asc' : 'desc')
                }}
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-200"
              >
                {SORT_OPTIONS.map(option => (
                  <option key={option.field} value={option.field}>
                    Sort: {option.label}
                  </option>
                ))}
              </select>

              <select
                value={sortDirection}
                onChange={e => setSortDirection(e.target.value as SortDirection)}
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-200"
              >
                <option value="asc">Ascending</option>
                <option value="desc">Descending</option>
              </select>
            </div>
            <div className="space-y-2 p-2">
              {paginatedDevices.map(d => {
                const deviceRtp = getDeviceRtp(d)
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
                        <div className="truncate text-sm font-semibold text-slate-100">
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
                          {(d.deployment_mode ?? 'online') === 'maintenance' && (
                            <span className="rounded border border-violet-700 bg-violet-900/40 px-1.5 py-0.5 text-[10px] text-violet-200">
                              MAINT
                            </span>
                          )}
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
                        <div className="text-[10px] text-slate-500">Coins-In</div>
                        <div className="font-mono text-sm text-sky-300">
                          {formatCurrency(d.coins_in_total)}
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
                        <div className="text-[10px] text-slate-500">Arcade Total</div>
                        <div className="font-mono text-sm text-indigo-300">
                          {formatCurrency(d.arcade_total)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-500">Withdraw</div>
                        <div className="font-mono text-sm text-rose-300">
                          {formatCurrency(d.withdraw_total)}
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
                  <th className="px-4 py-2 text-right">Money Flow</th>
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
                  <th className="px-4 py-2 text-right">Withdraw</th>
                  <th className="px-4 py-2 text-right">Stats</th>

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
                  const deviceRtp = getDeviceRtp(d)
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
                            <div className="truncate text-[10px] text-slate-500 font-mono">
                              {d.arcade_shell_version}
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
                          {(d.deployment_mode ?? 'online') === 'maintenance' && (
                            <span className="rounded border border-violet-700 bg-violet-900/40 px-1.5 py-0.5 text-[10px] font-semibold text-violet-200">
                              MAINT
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
                        <div className="flex gap-2 justify-end font-mono text-sm text-sky-300">
                          Coins-In:
                          <span className="font-extrabold">{formatCurrency(d.coins_in_total)}</span>
                        </div>
                        <div className="flex gap-2 justify-end font-mono text-sm text-indigo-300">
                          Arcade:
                          <span className="font-extrabold">{formatCurrency(d.arcade_total)}</span>
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
                      <td className="px-4 py-2 text-right font-mono text-rose-300">
                        {formatCurrency(d.withdraw_total)}
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
            <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-6 text-center text-sm text-slate-400">
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

      {showJackpotQueuesModal && (
        <div className="fixed inset-0 z-50 bg-black/80 p-5 sm:p-6">
          <div className="mx-auto max-w-4xl rounded-lg border border-slate-700 bg-slate-950 p-5 sm:p-6">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold">Jackpot Payout Queues</h3>
                <div className="mt-1 text-xs text-slate-400">
                  Active rows appear first. Completed rows are kept for quick inspection.
                </div>
              </div>
              <button
                onClick={() => setShowJackpotQueuesModal(false)}
                className="text-slate-300 hover:text-white"
              >
                ✕
              </button>
            </div>
            <div className="max-h-[70vh] overflow-auto space-y-2">
              {jackpotQueues.length === 0 && (
                <div className="rounded border border-slate-800 bg-slate-900/70 p-3 text-sm text-slate-400">
                  No jackpot payout queues found.
                </div>
              )}
              {jackpotQueues.map(queue => {
                const deviceId = String(queue.device_id ?? '').trim()
                const completed = Boolean(queue.completed_at)
                const payoutReady = Boolean(queue.payout_ready_at)
                const deviceLabel = deviceNameById.get(deviceId) ?? deviceId

                return (
                  <div
                    key={queue.id}
                    className="rounded border border-slate-800 bg-slate-900/70 p-3 text-sm"
                  >
                    <div className="flex flex-wrap items-center gap-2 font-mono">
                      <span>#{queue.id}</span>
                      <span
                        className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
                          completed
                            ? 'border border-slate-600 bg-slate-800 text-slate-300'
                            : payoutReady
                              ? 'border border-emerald-700 bg-emerald-950/60 text-emerald-300'
                              : 'border border-amber-700 bg-amber-950/60 text-amber-300'
                        }`}
                      >
                        {completed ? 'COMPLETED' : payoutReady ? 'READY' : 'ARMED'}
                      </span>
                      <span className="text-slate-300">{deviceLabel}</span>
                      <span className="text-slate-500">{deviceId}</span>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-300 sm:grid-cols-4">
                      <div>
                        <div className="text-slate-500">Campaign</div>
                        <div className="font-mono">{String(queue.campaign_id ?? '—')}</div>
                      </div>
                      <div>
                        <div className="text-slate-500">Target / Remaining</div>
                        <div className="font-mono">
                          {formatJackpotCurrency(queue.target_amount)} /{' '}
                          {formatJackpotCurrency(queue.remaining_amount)}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500">Delay / Payouts Left</div>
                        <div className="font-mono">
                          {asNumber(queue.spins_until_start)} / {asNumber(queue.payouts_left)}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500">Created</div>
                        <div className="font-mono">
                          {queue.created_at
                            ? moment(queue.created_at).format('MM-DD HH:mm:ss')
                            : '—'}
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 text-xs text-slate-400">
                      Ready{' '}
                      {queue.payout_ready_at
                        ? moment(queue.payout_ready_at).format('MM-DD HH:mm:ss')
                        : '—'}
                      {' • '}
                      Completed{' '}
                      {queue.completed_at
                        ? moment(queue.completed_at).format('MM-DD HH:mm:ss')
                        : '—'}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
