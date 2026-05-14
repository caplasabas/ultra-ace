import { useEffect, useMemo, useState } from 'react'
import type { DeviceRow } from '../hooks/useDevices'
import { useDevices } from '../hooks/useDevices'
import { DeviceModal } from '../components/DeviceModal'
import { useGlobalStats } from '../hooks/useGlobalStats'
import { useCasinoRuntime } from '../hooks/useCasinoRuntime'
import { useGames } from '../hooks/useGames'
import type { DashboardRole } from '../hooks/useDashboardAuth'
import moment from 'moment'
import { supabase } from '../lib/supabase'
import { isPollingVisible } from '../lib/polling'

const DASHBOARD_POOL_SUMMARY_POLL_MS = 30000
const DASHBOARD_MODAL_DATA_POLL_MS = 30000
const DASHBOARD_ADMIN_RTP_POLL_MS = 30000

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
  | 'last_bet_at'

type SortDirection = 'asc' | 'desc'
type DeploymentFilter =
  | 'all'
  | 'online'
  | 'standby'
  | 'maintenance'
  | 'playing'
  | 'playing_online'
  | 'playing_standby'
  | 'playing_maintenance'
type OverrideModalView = 'manual_jackpot' | 'happy'

type AdminRtpTotals = {
  bet: number
  win: number
}

const SORT_OPTIONS: { field: SortField; label: string }[] = [
  { field: 'last_bet_at', label: 'Last Bet At' },
  { field: 'name', label: 'Device' },
  { field: 'balance', label: 'Balance' },
  { field: 'coins_in_total', label: 'Coins-In' },
  { field: 'hopper_balance', label: 'Hopper' },
  { field: 'last_bet_amount', label: 'Last Bet' },
  { field: 'house_win', label: 'House Win' },
  { field: 'spins_total', label: 'Spins' },
  { field: 'rtp', label: 'RTP' },
]

const DEPLOYMENT_FILTER_OPTIONS: { value: DeploymentFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'online', label: 'Online' },
  { value: 'standby', label: 'Standby' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'playing', label: 'Playing' },
  { value: 'playing_online', label: 'Playing Online' },
  { value: 'playing_standby', label: 'Playing Standby' },
  { value: 'playing_maintenance', label: 'Playing Maintenance' },
]

// const ENGINE_SIM_BASE_RTP_PCT = 67.29
// const ENGINE_SIM_FREE_RTP_PCT = 6.16
const ENGINE_SIM_TOTAL_RTP_PCT = 73.44

function MobileToggleButton({
  expanded,
  onClick,
  collapsedLabel = 'Show More',
  expandedLabel = 'Hide',
}: {
  expanded: boolean
  onClick: () => void
  collapsedLabel?: string
  expandedLabel?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-mono text-slate-200"
    >
      {expanded ? expandedLabel : collapsedLabel}
    </button>
  )
}

export default function Dashboard({ role }: { role: DashboardRole }) {
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
  const [showManualJackpotOverridesModal, setShowManualJackpotOverridesModal] = useState(false)
  const [overrideModalView, setOverrideModalView] = useState<OverrideModalView>('manual_jackpot')
  const [expandedStatCards, setExpandedStatCards] = useState({
    moneyFlow: false,
    gameFlow: false,
    performance: false,
    system: false,
  })
  const [showAllMobileStatCards, setShowAllMobileStatCards] = useState(false)
  const [showAllMobileDeviceCounters, setShowAllMobileDeviceCounters] = useState(false)
  const [expandedMobileDevices, setExpandedMobileDevices] = useState<Record<string, boolean>>({})
  const [durationNow, setDurationNow] = useState(() => Date.now())
  const [happyPots, setHappyPots] = useState<any[]>([])
  const [jackpotPots, setJackpotPots] = useState<any[]>([])
  const [jackpotQueues, setJackpotQueues] = useState<any[]>([])
  const [manualJackpotOverrides, setManualJackpotOverrides] = useState<any[]>([])
  const [adminRtpByDevice, setAdminRtpByDevice] = useState<Record<string, AdminRtpTotals>>({})
  const [adminRtpReady, setAdminRtpReady] = useState(false)
  const [hopperAlertsEnabled] = useState(() => {
    try {
      return localStorage.getItem('hopperAlertsEnabled') === 'true'
    } catch {
      return false
    }
  })
  const [coinsInAlertsEnabled] = useState(() => {
    try {
      return localStorage.getItem('coinsInAlertsEnabled') === 'true'
    } catch {
      return false
    }
  })
  const [coinsInAlertThreshold] = useState(() => {
    try {
      return Math.max(0, Number(localStorage.getItem('coinsInAlertThreshold') || 1000))
    } catch {
      return 1000
    }
  })
  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = 10
  const isStaffView = role === 'staff'
  const isRunnerView = role === 'runner'
  const isAdminView = !isStaffView && !isRunnerView

  useEffect(() => {
    if (!errorMessage) return
    const t = setTimeout(() => setErrorMessage(null), 4000)
    return () => clearTimeout(t)
  }, [errorMessage])

  useEffect(() => {
    const t = window.setInterval(() => {
      setDurationNow(Date.now())
    }, 1000)

    return () => window.clearInterval(t)
  }, [])

  useEffect(() => {
    if (!isAdminView) return

    async function fetchAdminRtpTotals() {
      if (!isPollingVisible()) return
      const { data, error } = await supabase.rpc('dashboard_admin_rtp_totals')
      if (error) return

      const nextByDevice: Record<string, AdminRtpTotals> = {}
      for (const row of (data ?? []) as any[]) {
        const deviceId = String(row?.device_id ?? '').trim()
        if (!deviceId) continue
        nextByDevice[deviceId] = {
          bet: Number(row?.bet ?? 0),
          win: Number(row?.win ?? 0),
        }
      }

      setAdminRtpByDevice(nextByDevice)
      setAdminRtpReady(true)
    }

    void fetchAdminRtpTotals()

    const poll = window.setInterval(() => {
      void fetchAdminRtpTotals()
    }, DASHBOARD_ADMIN_RTP_POLL_MS)
    const onVisibilityChange = () => {
      if (isPollingVisible()) void fetchAdminRtpTotals()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      window.clearInterval(poll)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [isAdminView])

  useEffect(() => {
    if (!isAdminView) return

    async function fetchPoolSummary() {
      if (!isPollingVisible()) return
      const [{ data: jackpotData }, { data: queueData }] = await Promise.all([
        supabase
          .from('jackpot_pots')
          .select('id,campaign_id,status,amount_total,amount_remaining,goal_mode,goal_snapshot,created_at')
          .order('id', { ascending: false })
          .limit(50),
        supabase
          .from('jackpot_payout_queue')
          .select(
            'id,campaign_id,device_id,target_amount,remaining_amount,spins_until_start,payouts_left,created_at,payout_ready_at,completed_at',
          )
          .order('completed_at', { ascending: true, nullsFirst: true })
          .order('created_at', { ascending: false })
          .limit(100),
      ])
      setJackpotPots(jackpotData ?? [])
      setJackpotQueues(queueData ?? [])
    }

    void fetchPoolSummary()

    const poll = window.setInterval(() => {
      void fetchPoolSummary()
    }, DASHBOARD_POOL_SUMMARY_POLL_MS)
    const onVisibilityChange = () => {
      if (isPollingVisible()) void fetchPoolSummary()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      window.clearInterval(poll)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [isAdminView])

  useEffect(() => {
    if (!showHappyPotsModal) return

    async function fetchHappyPots() {
      if (!isPollingVisible()) return
      const { data } = await supabase
        .from('happy_hour_pots')
        .select('id,status,amount_total,amount_remaining,goal_mode')
        .order('id', { ascending: false })
        .limit(50)

      setHappyPots(data ?? [])
    }

    void fetchHappyPots()

    const poll = window.setInterval(() => {
      void fetchHappyPots()
    }, DASHBOARD_MODAL_DATA_POLL_MS)
    const onVisibilityChange = () => {
      if (isPollingVisible()) void fetchHappyPots()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      window.clearInterval(poll)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [showHappyPotsModal])

  useEffect(() => {
    if (!showManualJackpotOverridesModal) return

    async function fetchManualJackpotOverrides() {
      if (!isPollingVisible()) return
      const { data } = await supabase
        .from('jackpot_pots')
        .select('id,status,amount_total,amount_remaining,goal_snapshot,created_at,completed_at')
        .contains('goal_snapshot', { source: 'dashboard_device_override' })
        .neq('status', 'processing')
        .order('created_at', { ascending: false })
        .limit(200)

      setManualJackpotOverrides(data ?? [])
    }

    void fetchManualJackpotOverrides()

    const poll = window.setInterval(() => {
      void fetchManualJackpotOverrides()
    }, DASHBOARD_MODAL_DATA_POLL_MS)
    const onVisibilityChange = () => {
      if (isPollingVisible()) void fetchManualJackpotOverrides()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      window.clearInterval(poll)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [showManualJackpotOverridesModal])

  const asNumber = (v: number | string | null | undefined) => Number(v ?? 0)
  const formatCurrency = (v: number | string | null | undefined) =>
    `₱${asNumber(v).toLocaleString()}`
  const formatJackpotCurrency = (v: number | string | null | undefined) =>
    `₱${asNumber(v).toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })}`
  const formatPercent = (v: number | string | null | undefined) => `${asNumber(v).toFixed(2)}%`
  const formatPlayDuration = (startedAt: unknown, nowMs: number) => {
    const startedMs = new Date(String(startedAt ?? '')).getTime()
    if (!Number.isFinite(startedMs) || startedMs <= 0 || nowMs < startedMs) return null

    const totalSeconds = Math.floor((nowMs - startedMs) / 1000)
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60

    if (hours > 0) return `${hours}h ${minutes}m`
    if (minutes > 0) return `${minutes}m ${seconds}s`
    return `${seconds}s`
  }
  const getDevicePlayDuration = (device: DeviceRow) => {
    if (device.device_status !== 'playing') return null
    return formatPlayDuration(device.session_started_at ?? device.arcade_session_started_at, durationNow)
  }
  const getDeviceRtpTotals = (
    device: Pick<DeviceRow, 'device_id' | 'eligible_bet_total' | 'eligible_win_total' | 'bet_total' | 'win_total'>,
  ) => {
    const raw = adminRtpByDevice[String(device.device_id ?? '').trim()] ?? { bet: 0, win: 0 }
    const currentBet = asNumber(device.eligible_bet_total ?? device.bet_total)
    const currentWin = asNumber(device.eligible_win_total ?? device.win_total)
    return {
      bet: Math.min(asNumber(raw.bet), Math.max(currentBet, 0)),
      win: Math.min(asNumber(raw.win), Math.max(currentWin, 0)),
    }
  }
  const getDeviceRtp = (
    device: Pick<DeviceRow, 'device_id' | 'eligible_bet_total' | 'eligible_win_total' | 'bet_total' | 'win_total'>,
  ) => {
    const totals = getDeviceRtpTotals(device)
    return totals.bet > 0 ? (totals.win / totals.bet) * 100 : 0
  }
  const getDeviceHouseWin = (
    device: Pick<DeviceRow, 'house_take_total' | 'bet_total' | 'win_total'>,
  ) => asNumber(device.house_take_total ?? asNumber(device.bet_total) - asNumber(device.win_total))
  const shouldShowDeviceRtp = () => adminRtpReady

  const getDeviceAverageBet = (
    row: Pick<DeviceRow, 'bet_total' | 'spins_total' | 'avg_bet_amount' | 'last_bet_amount'>,
  ) => {
    const avgBet = asNumber(row.avg_bet_amount)
    const betTotal = asNumber(row.bet_total)
    const spinsTotal = asNumber(row.spins_total)

    if (avgBet > 0) return Math.round(avgBet)
    if (betTotal <= 0 || spinsTotal <= 0) return 0

    return Math.round(betTotal / spinsTotal)
  }

  const dashboardRtpTotals = useMemo(
    () =>
      devices.reduce(
        (totals, device) => {
          const rtpTotals = getDeviceRtpTotals(device)
          return {
            bet: totals.bet + rtpTotals.bet,
            win: totals.win + rtpTotals.win,
          }
        },
        { bet: 0, win: 0 },
      ),
    [adminRtpByDevice, devices],
  )
  const globalBet = asNumber(stats?.total_bet_amount)
  const globalWin = asNumber(stats?.total_win_amount)
  const globalNormalWin = Math.min(dashboardRtpTotals.win, Math.max(globalWin, 0))
  const globalBaseRtp =
    dashboardRtpTotals.bet > 0
      ? (globalNormalWin / dashboardRtpTotals.bet) * 100
      : (stats?.global_rtp_percent ?? (globalBet > 0 ? (globalWin / globalBet) * 100 : 0))
  const globalAverageBet =
    asNumber(stats?.total_spins) > 0 ? globalBet / asNumber(stats?.total_spins) : 0
  const globalHouseGross = asNumber(stats?.total_house_take)
  const hopperAlertThreshold = asNumber(runtime?.hopper_alert_threshold ?? 500)
  const isCoinsInHigh = (device: Pick<DeviceRow, 'coins_in_total'>) =>
    coinsInAlertsEnabled && asNumber(device.coins_in_total) >= coinsInAlertThreshold
  const activeProfileId =
    runtime?.active_mode === 'HAPPY' ? runtime?.happy_profile_id : runtime?.base_profile_id
  const activeProfile = profiles.find(p => p.id === activeProfileId)
  const activeHousePct = asNumber(activeProfile?.house_pct)
  const activeJackpotPct = Math.max(0, asNumber(activeProfile?.pool_pct))
  const activeHappyPct = Math.max(0, asNumber(activeProfile?.player_pct))
  const activeTargetRtp = asNumber(runtime?.active_target_rtp_pct ?? activeHappyPct)
  const happyHourActive =
    runtime?.active_mode === 'HAPPY' && asNumber(runtime?.happy_hour_prize_balance) > 0
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

  const jackpotQueueGroups = useMemo(() => {
    const activeQueues = jackpotQueues.filter(queue => !queue?.completed_at)
    const completedQueues = jackpotQueues.filter(queue => Boolean(queue?.completed_at))
    const unassignedPendingPots = jackpotPots.filter(
      pot => String(pot?.status ?? '').toLowerCase() === 'queued',
    )

    return { activeQueues, completedQueues, unassignedPendingPots }
  }, [jackpotPots, jackpotQueues])
  const armedJackpotTotals = useMemo(
    () =>
      jackpotQueueGroups.activeQueues.reduce(
        (totals, queue) => ({
          target: totals.target + asNumber(queue?.target_amount),
          remaining: totals.remaining + asNumber(queue?.remaining_amount),
        }),
        { target: 0, remaining: 0 },
      ),
    [jackpotQueueGroups.activeQueues],
  )
  const pendingJackpotTotals = useMemo(
    () =>
      jackpotQueueGroups.unassignedPendingPots.reduce(
        (totals, pot) => ({
          total: totals.total + asNumber(pot?.amount_total),
          remaining: totals.remaining + asNumber(pot?.amount_remaining),
        }),
        { total: 0, remaining: 0 },
      ),
    [jackpotQueueGroups.unassignedPendingPots],
  )
  const overrideTotals = useMemo(() => {
    const manualJackpots = jackpotPots.filter(pot => {
      const snapshot = (pot?.goal_snapshot as Record<string, unknown> | null) ?? null
      const status = String(pot?.status ?? '').toLowerCase()
      return snapshot?.source === 'dashboard_device_override' && status !== 'completed'
    })
    const happyOverrides = devices.filter(
      device =>
        Boolean(device.happy_override_selected) &&
        asNumber(device.happy_override_remaining_amount) > 0,
    )

    return {
      manualJackpotTotal: manualJackpots.reduce(
        (sum, pot) => sum + asNumber(pot?.amount_total),
        0,
      ),
      manualJackpotRemaining: manualJackpots.reduce(
        (sum, pot) => sum + asNumber(pot?.amount_remaining),
        0,
      ),
      manualJackpotCount: manualJackpots.length,
      happyOverrideTotal: happyOverrides.reduce(
        (sum, device) => sum + asNumber(device.happy_override_target_amount),
        0,
      ),
      happyOverrideRemaining: happyOverrides.reduce(
        (sum, device) => sum + asNumber(device.happy_override_remaining_amount),
        0,
      ),
      happyOverrideCount: happyOverrides.length,
    }
  }, [devices, jackpotPots])
  const activeHappyOverrides = useMemo(
    () =>
      devices
        .filter(
          device =>
            Boolean(device.happy_override_selected) &&
            asNumber(device.happy_override_remaining_amount) > 0,
        )
        .sort((a, b) => {
          const left = String(a.name ?? a.device_id ?? '')
          const right = String(b.name ?? b.device_id ?? '')
          return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' })
        }),
    [devices],
  )
  const deviceSummaryCounts = useMemo(
    () => ({
      online: devices.filter(d => (d.deployment_mode ?? 'online') === 'online').length,
      standby: devices.filter(d => (d.deployment_mode ?? 'online') === 'standby').length,
      maintenance: devices.filter(d => (d.deployment_mode ?? 'online') === 'maintenance').length,
      offline: devices.filter(d => d.device_status === 'offline').length,
      active: devices.filter(d => d.device_status === 'playing').length,
      afk: devices.filter(d => d.device_status === 'idle').length,
      lowHopper: hopperAlertsEnabled
        ? devices.filter(d => {
            const threshold = asNumber((d as any)?.hopper_alert_threshold ?? 500)
            return asNumber(d.hopper_balance) <= threshold
          }).length
        : 0,
      highCoinsIn: devices.filter(d => isCoinsInHigh(d)).length,
      highRtp: devices.filter(d => d.device_status === 'playing' && getDeviceRtp(d) > 110)
        .length,
    }),
    [adminRtpByDevice, coinsInAlertThreshold, coinsInAlertsEnabled, devices, hopperAlertsEnabled],
  )

  useEffect(() => {
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
      Boolean(device.jackpot_selected) ||
      Boolean(device.happy_override_selected)
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

    if (asNumber(device.pending_free_spins) > 0 || device.show_free_spin_intro) {
      return `JACKPOT LIVE • FREE SPINS ${asNumber(device.pending_free_spins || device.free_spins_left)} pending`
    }

    if (device.is_free_game && asNumber(device.free_spins_left) > 0) {
      return `JACKPOT LIVE • FREE SPINS ${asNumber(device.free_spins_left)} left`
    }

    const delaySpins = Math.max(0, asNumber(device.jackpot_spins_until_start))
    if (delaySpins > 0) {
      return `JACKPOT ARMED • ${delaySpins} spin${delaySpins === 1 ? '' : 's'} until trigger`
    }

    return 'JACKPOT ARMED • trigger spin next'
  }

  const getDeviceHappyOverrideStatus = (device: DeviceRow): string | null => {
    if (!device.happy_override_selected) return null
    return `HAPPY OVERRIDE • Target ${formatJackpotCurrency(device.happy_override_target_amount)} • Remaining ${formatJackpotCurrency(device.happy_override_remaining_amount)}`
  }

  const getSortValue = (device: DeviceRow, field: SortField): number | string => {
    if (field === 'name') return (device.name ?? '').toLowerCase()
    if (field === 'last_bet_at')
      return device.last_bet_at ? moment(device.last_bet_at).valueOf() : 0
    if (field === 'house_win') return getDeviceHouseWin(device)
    if (field === 'rtp') return device.device_status === 'playing' ? getDeviceRtp(device) : -1
    return asNumber(device[field as keyof DeviceRow] as number | string | null | undefined)
  }

  const matchesDeploymentFilter = (device: DeviceRow, filter: DeploymentFilter) => {
    const deploymentMode = device.deployment_mode ?? 'online'
    const isMaintenance = deploymentMode === 'maintenance'
    const isStandby = deploymentMode === 'standby'
    const isPlaying = device.device_status === 'playing'

    switch (filter) {
      case 'all':
        return true
      case 'online':
        return !isMaintenance && !isStandby
      case 'standby':
        return isStandby
      case 'maintenance':
        return isMaintenance
      case 'playing':
        return isPlaying
      case 'playing_online':
        return isPlaying && !isMaintenance && !isStandby
      case 'playing_standby':
        return isPlaying && isStandby
      case 'playing_maintenance':
        return isPlaying && isMaintenance
      default:
        return true
    }
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

    const deploymentFiltered = filtered.filter(device =>
      matchesDeploymentFilter(device, deploymentFilter),
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
  }, [adminRtpByDevice, deploymentFilter, devices, searchTerm, sortField, sortDirection])

  const onSort = (field: SortField) => {
    if (field === sortField) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortField(field)
    setSortDirection(field === 'name' ? 'asc' : 'desc')
  }

  const toggleStatCard = (key: keyof typeof expandedStatCards) => {
    setExpandedStatCards(current => ({
      ...current,
      [key]: !current[key],
    }))
  }

  const toggleMobileDeviceCard = (deviceId: string) => {
    setExpandedMobileDevices(current => ({
      ...current,
      [deviceId]: !current[deviceId],
    }))
  }

  const sortLabel = SORT_OPTIONS.find(option => option.field === sortField)?.label ?? 'Last Bet At'
  const visibleSortOptions = isRunnerView
    ? SORT_OPTIONS.filter(option =>
        ['name', 'balance', 'coins_in_total', 'hopper_balance'].includes(option.field),
      )
    : isStaffView
    ? SORT_OPTIONS.filter(option =>
        ['last_bet_at', 'name', 'balance', 'coins_in_total', 'hopper_balance'].includes(
          option.field,
        ),
      )
    : SORT_OPTIONS
  const hiddenCount = devices.filter(d => !matchesDeploymentFilter(d, deploymentFilter)).length
  const filterSummary =
    deploymentFilter === 'all'
      ? ''
      : ` • ${hiddenCount.toLocaleString()} hidden (${
          DEPLOYMENT_FILTER_OPTIONS.find(option => option.value === deploymentFilter)
            ?.label.replace(/^Show /, '')
            .toLowerCase() ?? 'filtered'
        })`
  const totalPages = Math.max(1, Math.ceil(visibleDevices.length / pageSize))

  const paginatedDevices = visibleDevices.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  )
  const selectedLiveDevice = selectedDevice
    ? devices.find(d => d.device_id === selectedDevice.device_id) ?? selectedDevice
    : null

  return (
    <>
      <div className="p-5 sm:p-6 max-w-[90rem] mx-auto space-y-8 sm:space-y-10 bg-slate-900 text-slate-100">
        <div className="flex justify-between">
          <header>
            <h1 className="text-2xl font-semibold">Dashboard</h1>
            {isAdminView && (
              <div className="text-xs font-mono text-emerald-200/60">
                H/J/P {formatPercent(activeHousePct)} / {formatPercent(activeJackpotPct)} /{' '}
                {formatPercent(activeHappyPct)}
              </div>
            )}
          </header>

          {isAdminView && (
            <div className="mb-3 flex justify-end md:hidden">
              <MobileToggleButton
                expanded={showAllMobileStatCards}
                onClick={() => setShowAllMobileStatCards(current => !current)}
                expandedLabel="Hide More"
              />
            </div>
          )}
        </div>

        {errorMessage && (
          <div className="p-3 bg-red-900/40 border border-red-700 text-red-300 text-sm rounded">
            {errorMessage}
          </div>
        )}

        {isAdminView && (
          <section>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-xl border border-green-700/40 bg-green-900/20 p-4">
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div className="text-lg font-semibold text-green-200">Money Flow</div>
                  <button
                    type="button"
                    onClick={() => toggleStatCard('moneyFlow')}
                    className="text-lg font-mono text-green-200/70  transition hover:text-green-100"
                  >
                    {expandedStatCards.moneyFlow ? '▴' : '▾'}
                  </button>
                </div>

                <div className="space-y-3">
                  <div>
                    <div className="text-xs text-green-200/80">Total Balance</div>
                    <div className="text-3xl font-extrabold font-mono text-green-200">
                      {formatCurrency(stats?.total_balance)}
                    </div>
                  </div>

                  {expandedStatCards.moneyFlow && (
                    <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
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
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-violet-700/40 bg-violet-900/20 p-4">
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div className="text-lg font-semibold text-violet-200">Game Flow</div>
                  <button
                    type="button"
                    onClick={() => toggleStatCard('gameFlow')}
                    className="text-lg font-mono text-violet-200/70  transition hover:text-violet-100"
                  >
                    {expandedStatCards.gameFlow ? '▴' : '▾'}
                  </button>
                </div>

                <div className="space-y-3">
                  <div>
                    <div className="text-xs text-violet-200/80">Total Bet</div>
                    <div className="text-3xl font-bold font-mono text-violet-300">
                      {formatCurrency(stats?.total_bet_amount)}
                    </div>
                  </div>

                  <div className="text-xs font-mono text-violet-200/80">
                    <div>Avg Bet {formatJackpotCurrency(globalAverageBet)}</div>
                    <div>Total Spins {asNumber(stats?.total_spins).toLocaleString()}</div>
                  </div>

                  {expandedStatCards.gameFlow && (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex flex-col justify-end">
                        <div className="text-xs text-red-200/80">Total Win</div>
                        <div className="text-lg font-mono text-red-300">
                          {formatCurrency(stats?.total_win_amount)}
                        </div>
                      </div>

                      <div className="flex flex-col justify-end">
                        <div className="text-xs text-emerald-200/80">Normal Win</div>
                        <div className="text-lg font-mono text-emerald-300">
                          {adminRtpReady ? formatJackpotCurrency(globalNormalWin) : '—'}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div
                className={`rounded-xl border border-fuchsia-700/40 bg-fuchsia-900/20 p-4 ${
                  showAllMobileStatCards ? 'block' : 'hidden md:block'
                }`}
              >
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div className="text-lg font-semibold text-fuchsia-200">Performance</div>
                  <button
                    type="button"
                    onClick={() => toggleStatCard('performance')}
                    className="text-lgs font-mono text-fuchsia-200/70 transition hover:text-fuchsia-100"
                  >
                    {expandedStatCards.performance ? '▴' : '▾'}
                  </button>
                </div>

                <div className="space-y-3">
                  <div>
                    <div className="text-xs text-fuchsia-200/80">RTP</div>
                    <div className="text-3xl font-bold font-mono text-fuchsia-300">
                      {adminRtpReady ? formatPercent(globalBaseRtp) : '—'}
                    </div>
                    <div className="text-xs text-fuchsia-200/80">
                      Target {formatPercent(activeTargetRtp || ENGINE_SIM_TOTAL_RTP_PCT)}
                      {happyHourActive && (
                        <span className="ml-2 rounded border border-amber-700/60 bg-amber-900/40 px-1.5 py-0.5 text-[10px] font-semibold text-amber-200">
                          HAPPY
                        </span>
                      )}
                    </div>
                  </div>

                  {expandedStatCards.performance && (
                    <div>
                      <div className="text-xs text-orange-200/80">House Win</div>
                      <div className="text-lg font-mono text-orange-300">
                        {formatCurrency(globalHouseGross)}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* 🏦 SYSTEM / POOLS */}
              <div
                className={`rounded-xl border border-emerald-700/40 bg-emerald-900/20 p-4 ${
                  showAllMobileStatCards ? 'block' : 'hidden md:block'
                }`}
              >
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div>
                    <div className="text-lg font-semibold text-emerald-200">System</div>
                  </div>
                  <div className="flex gap-2">
                    <span
                      className={`text-lg font-bold font-mono ${
                        happyHourActive ? 'text-amber-300' : 'text-emerald-300'
                      }`}
                    >
                      {runtime?.active_mode ?? 'BASE'}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleStatCard('system')}
                      className="text-lg font-mono text-emerald-200/70  transition hover:text-emerald-100"
                    >
                      {expandedStatCards.system ? '▴' : '▾'}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="space-y-1 rounded border border-emerald-800/40 bg-emerald-950/20 p-2">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-200/60">
                      Pools
                    </div>
                    <div className="text-xs font-mono text-emerald-200/80">
                      Happy Pool {formatCurrency(runtime?.prize_pool_balance)}/{' '}
                      {formatCurrency(runtime?.prize_pool_goal)}
                    </div>
                    {happyHourActive && (
                      <div className="rounded border border-amber-700/50 bg-amber-950/30 px-2 py-1 text-xs font-mono text-amber-200">
                        Happy Hour Active • Pot Remaining{' '}
                        {formatJackpotCurrency(runtime?.happy_hour_prize_balance)} • Target RTP{' '}
                        {formatPercent(activeTargetRtp)}
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => setShowJackpotQueuesModal(true)}
                      className="block w-full text-left text-xs font-mono text-indigo-200/80 underline decoration-dotted underline-offset-2 transition hover:text-indigo-100"
                    >
                      Jackpot Pool {formatCurrency(runtime?.jackpot_pool_balance)}/{' '}
                      {formatCurrency(runtime?.jackpot_pool_goal)}
                    </button>
                  </div>

                  {expandedStatCards.system && (
                    <>
                      <div className="space-y-1 rounded border border-slate-700/60 bg-slate-950/20 p-2">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-300/60">
                          Queue Totals
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowJackpotQueuesModal(true)}
                          className="block w-full text-left text-xs font-mono text-amber-200/80 underline decoration-dotted underline-offset-2 transition hover:text-amber-100"
                        >
                          Armed Jackpot {formatJackpotCurrency(armedJackpotTotals.target)} /{' '}
                          {formatJackpotCurrency(armedJackpotTotals.remaining)} (
                          {jackpotQueueGroups.activeQueues.length})
                        </button>

                        <button
                          type="button"
                          onClick={() => setShowJackpotQueuesModal(true)}
                          className="block w-full text-left text-xs font-mono text-sky-200/80 underline decoration-dotted underline-offset-2 transition hover:text-sky-100"
                        >
                          Pending Jackpot {formatJackpotCurrency(pendingJackpotTotals.total)} /{' '}
                          {formatJackpotCurrency(pendingJackpotTotals.remaining)} (
                          {jackpotQueueGroups.unassignedPendingPots.length})
                        </button>
                      </div>

                      <div className="space-y-1 rounded border border-slate-700/60 bg-orange-950/20 p-2">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-orange-300/60">
                          Override Totals
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setOverrideModalView('manual_jackpot')
                            setShowManualJackpotOverridesModal(true)
                          }}
                          className="block text-left text-xs font-mono text-orange-300 underline decoration-dotted underline-offset-2 transition hover:text-orange-200"
                        >
                          Override Jackpot {formatJackpotCurrency(overrideTotals.manualJackpotTotal)}
                          {' / '}
                          {formatJackpotCurrency(overrideTotals.manualJackpotRemaining)} (
                          {overrideTotals.manualJackpotCount})
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setOverrideModalView('happy')
                            setShowManualJackpotOverridesModal(true)
                          }}
                          className="block text-left text-xs font-mono text-pink-300 underline decoration-dotted underline-offset-2 transition hover:text-pink-200"
                        >
                          Happy Override {formatJackpotCurrency(overrideTotals.happyOverrideTotal)}
                          {' / '}
                          {formatJackpotCurrency(overrideTotals.happyOverrideRemaining)} (
                          {overrideTotals.happyOverrideCount})
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}

        <section>
          <div className="mb-3 flex flex-col gap-3">
            <div className="flex flex-wrap justify-between gap-2 sm:gap-3 items-center">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="gap-3">
                  <h2 className="text-lg font-semibold">Devices</h2>
                </div>
                <div className="flex  md:flex-wrap  items-center md:gap-5 gap-2 text-sm text-slate-300">
                  <input
                    type="search"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    placeholder="Search ID or name"
                    className="md:min-w-64 w-40 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-slate-500 focus:outline-none"
                  />
                  <select
                    value={deploymentFilter}
                    onChange={e =>
                      setDeploymentFilter(
                        DEPLOYMENT_FILTER_OPTIONS.some(option => option.value === e.target.value)
                          ? (e.target.value as DeploymentFilter)
                          : 'all',
                      )
                    }
                    className="rounded-lg border w-32 md:w-42 border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-200 hover:border-slate-500"
                  >
                    {DEPLOYMENT_FILTER_OPTIONS.map(option => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="text-xs text-slate-400">
                  Showing {visibleDevices.length.toLocaleString()} of{' '}
                  {devices.length.toLocaleString()}
                  {filterSummary}
                </div>
              </div>

              <div className="hidden flex-wrap justify-center items-center gap-5 text-sm text-slate-300 md:flex">
                <div className="text-xs text-green-300">
                  🟢 Online: {deviceSummaryCounts.online}
                </div>
                <div className="text-xs text-amber-300">
                  ⏸ Standby: {deviceSummaryCounts.standby}
                </div>
                <div className="text-xs text-violet-300">
                  🛠 Maintenance: {deviceSummaryCounts.maintenance}
                </div>
                <div className="text-xs text-red-300">
                  🔴 Offline: {deviceSummaryCounts.offline}
                </div>
                <div className="text-xs text-blue-300">🔵 Active: {deviceSummaryCounts.active}</div>
                <div className="text-xs text-yellow-300">🟡 AFK: {deviceSummaryCounts.afk}</div>
                <div className="text-xs text-orange-300">
                  🟠 Low Hopper: {deviceSummaryCounts.lowHopper}
                </div>
                <div className="text-xs text-sky-300">
                  🔷 High Coins-In: {deviceSummaryCounts.highCoinsIn}
                </div>
                {isAdminView && (
                  <div className="text-xs text-fuchsia-300">
                    🟣 High RTP: {deviceSummaryCounts.highRtp}
                  </div>
                )}
              </div>

              <div className="flex items-center text-center space-y-2 md:hidden">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-300">
                  <div className="text-xs text-green-300">
                    🟢 Online: {deviceSummaryCounts.online}
                  </div>
                  <div className="text-xs text-amber-300">
                    ⏸ Standby: {deviceSummaryCounts.standby}
                  </div>
                  <div className="text-xs text-blue-300">
                    🔵 Active: {deviceSummaryCounts.active}
                  </div>
                  <div className="text-xs text-yellow-300">🟡 AFK: {deviceSummaryCounts.afk}</div>
                  <div className="text-xs text-orange-300">
                    🟠 Low Hopper: {deviceSummaryCounts.lowHopper}
                  </div>
                  <div className="text-xs text-sky-300">
                    🔷 High Coins-In: {deviceSummaryCounts.highCoinsIn}
                  </div>
                </div>

                {showAllMobileDeviceCounters && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-300">
                    <div className="text-xs text-violet-300">
                      🛠 Maintenance: {deviceSummaryCounts.maintenance}
                    </div>
                    <div className="text-xs text-red-300">
                      🔴 Offline: {deviceSummaryCounts.offline}
                    </div>
                    {isAdminView && (
                      <div className="text-xs text-fuchsia-300">
                        🟣 High RTP: {deviceSummaryCounts.highRtp}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="md:hidden">
                <MobileToggleButton
                  expanded={showAllMobileDeviceCounters}
                  onClick={() => setShowAllMobileDeviceCounters(current => !current)}
                />
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
                {visibleSortOptions.map(option => (
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
                const deviceAverageBet = isRunnerView ? 0 : getDeviceAverageBet(d)
                const deviceHouseWin = isRunnerView ? 0 : getDeviceHouseWin(d)
                const threshold = asNumber((d as any)?.hopper_alert_threshold ?? 500)
                const hopperLow = hopperAlertsEnabled && asNumber(d.hopper_balance) <= threshold
                const coinsInHigh = isCoinsInHigh(d)
                // --- Alert Computations ---
                const HIGH_RTP_THRESHOLD = 110
                const showDeviceRtp = shouldShowDeviceRtp()
                const highRtp =
                  isAdminView && d.device_status === 'playing' && deviceRtp > HIGH_RTP_THRESHOLD
                const gameType = getDeviceGameType(d)
                const telemetryLabel = getDeviceTelemetryLabel(d)
                const jackpotStatus = getDeviceJackpotStatus(d)
                const happyOverrideStatus = getDeviceHappyOverrideStatus(d)
                const mobileExpanded = Boolean(expandedMobileDevices[d.device_id])
                const playDuration = getDevicePlayDuration(d)
                const deviceStatus = d.device_status ?? 'idle'
                const deviceStatusLabel =
                  deviceStatus.toUpperCase() === 'IDLE' ? 'AFK' : deviceStatus.toUpperCase()
                const mobileStatusPillClass =
                  deviceStatus === 'playing'
                    ? 'bg-emerald-900/40 text-emerald-300 border border-emerald-700/50'
                    : deviceStatus === 'offline'
                      ? 'bg-slate-800 text-slate-300 border border-slate-500/80'
                      : 'bg-amber-900/40 text-amber-300 border border-amber-700/50'
                const mobileStatusFrameClass =
                  deviceStatus === 'playing'
                    ? 'border-emerald-500/70 bg-emerald-950/20 ring-1 ring-emerald-500/35'
                    : deviceStatus === 'offline'
                      ? 'border-slate-500/70 bg-slate-800/80 ring-1 ring-slate-500/40'
                      : 'border-amber-500/70 bg-amber-950/20 ring-1 ring-amber-500/35'
                const mobileFeatureFrameClass = d.jackpot_selected
                  ? 'bg-gradient-to-br from-amber-900/30 via-slate-900/80 to-slate-900/90 shadow-[0_0_20px_rgba(251,191,36,0.18)]'
                  : d.happy_override_selected
                    ? 'bg-gradient-to-br from-pink-900/30 via-slate-900/80 to-slate-900/90 shadow-[0_0_20px_rgba(236,72,153,0.16)]'
                    : ''
                return (
                  <div
                    key={d.device_id}
                    className={`w-full rounded-lg border p-3 text-left ${
                      coinsInHigh
                        ? 'border-sky-400/80 bg-sky-950/25 ring-1 ring-sky-400/40'
                        : mobileStatusFrameClass
                    } ${mobileFeatureFrameClass}`}
                  >
                    <div className="flex items-start gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedDevice({
                            ...d,
                            game_type: gameType,
                          })
                        }
                        className="min-w-0 flex-1 text-left"
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
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px]">
                              <span
                                className={`rounded px-1.5 py-0.5 font-semibold ${mobileStatusPillClass}`}
                              >
                                {deviceStatusLabel}
                              </span>
                              {playDuration && (
                                <span className="rounded border border-emerald-700/50 bg-emerald-950/40 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-emerald-200">
                                  {playDuration}
                                </span>
                              )}
                              {coinsInHigh && (
                                <span className="rounded border border-sky-400/70 bg-sky-950/60 px-1.5 py-0.5 text-[10px] font-semibold text-sky-200">
                                  COINS
                                </span>
                              )}
                              {isAdminView && d.jackpot_selected && (
                                <span className="rounded border border-amber-400/70 bg-amber-900/50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-200">
                                  JACKPOT
                                </span>
                              )}
                              {isAdminView && d.happy_override_selected && (
                                <span className="rounded border border-pink-400/70 bg-pink-900/40 px-1.5 py-0.5 text-[10px] font-semibold text-pink-200">
                                  HAPPY OVR
                                </span>
                              )}
                            </div>
                            {mobileExpanded && (
                              <>
                                <div className="mt-1 flex items-center gap-2 text-[10px]">
                                  {!isRunnerView && (
                                    <span className="rounded border border-slate-700 bg-slate-800/60 px-1.5 py-0.5 text-[10px] text-slate-300">
                                      {gameType.toUpperCase()}
                                    </span>
                                  )}
                                  {(d.deployment_mode ?? 'online') === 'standby' && (
                                    <span className="rounded border border-amber-700 bg-amber-900/40 px-1.5 py-0.5 text-[10px] text-amber-200">
                                      STANDBY
                                    </span>
                                  )}
                                  {(d.deployment_mode ?? 'online') === 'maintenance' && (
                                    <span className="rounded border border-violet-700 bg-violet-900/40 px-1.5 py-0.5 text-[10px] text-violet-200">
                                      MAINT
                                    </span>
                                  )}
                                </div>
                                {!isRunnerView && (
                                  <div className="mt-1 text-[10px] text-slate-300">
                                    {telemetryLabel}
                                  </div>
                                )}

                                <div className="mt-1 flex flex-wrap gap-1">
                                  {hopperLow && (
                                    <span className="px-1.5 py-0.5 text-[9px] font-bold rounded border border-red-500 bg-red-950 text-red-300">
                                      LOW
                                    </span>
                                  )}

                                  {coinsInHigh && (
                                    <span className="px-1.5 py-0.5 text-[9px] font-bold rounded border border-sky-500 bg-sky-950 text-sky-300">
                                      COINS
                                    </span>
                                  )}

                                  {isAdminView && highRtp && (
                                    <span className="px-1.5 py-0.5 text-[9px] font-bold rounded border border-fuchsia-500 bg-fuchsia-950 text-fuchsia-300">
                                      RTP
                                    </span>
                                  )}
                                </div>
                                {isAdminView && d.jackpot_selected && (
                                  <div className="mt-1 text-[10px] font-semibold text-amber-200">
                                    JACKPOT TARGET {formatJackpotCurrency(d.jackpot_target_amount)}{' '}
                                    • Remaining {formatJackpotCurrency(d.jackpot_remaining_amount)}
                                  </div>
                                )}
                                {isAdminView && jackpotStatus && (
                                  <div className="mt-1 text-[10px] text-amber-300">
                                    {jackpotStatus}
                                  </div>
                                )}
                                {isAdminView && d.happy_override_selected && (
                                  <div className="mt-1 text-[10px] font-semibold text-pink-200">
                                    HAPPY TARGET{' '}
                                    {formatJackpotCurrency(d.happy_override_target_amount)} •
                                    Remaining{' '}
                                    {formatJackpotCurrency(d.happy_override_remaining_amount)}
                                  </div>
                                )}
                                {isAdminView && happyOverrideStatus && (
                                  <div className="mt-1 text-[10px] text-pink-300">
                                    {happyOverrideStatus}
                                  </div>
                                )}
                              </>
                            )}
                          </div>

                          {!isRunnerView && (
                            <div className="mt-0.5 text-right">
                              <div className="text-[10px] text-slate-500">Last Bet At</div>{' '}
                              <div className="text-xs text-slate-300">
                                {d.last_bet_at ? moment(d.last_bet_at).format('MM-DD hh:mm A') : '—'}
                              </div>
                            </div>
                          )}
                        </div>

                        <div
                          className={
                            mobileExpanded
                              ? 'mt-3 grid grid-cols-2 gap-x-3 gap-y-2'
                              : 'mt-3 grid grid-cols-4 gap-x-2 gap-y-2'
                          }
                        >
                          <div className="min-w-0">
                            <div className="text-[10px] text-slate-500">Balance</div>
                            <div className="truncate font-mono text-xs font-bold text-green-400">
                              {formatCurrency(d.balance)}
                            </div>
                          </div>
                          <div className="min-w-0">
                            <div className="text-[10px] text-slate-500">Coins-In</div>
                            <div
                              className={`truncate font-mono text-xs ${
                                coinsInHigh ? 'font-bold text-sky-200 animate-pulse' : 'text-sky-300'
                              }`}
                            >
                              {formatCurrency(d.coins_in_total)}
                            </div>
                          </div>
                          <div className="min-w-0">
                            <div className="text-[10px] text-slate-500">Hopper</div>
                            <div
                              className={`truncate font-mono text-xs font-bold ${
                                hopperLow ? 'text-red-300 animate-pulse' : 'text-amber-300'
                              }`}
                            >
                              {formatCurrency(d.hopper_balance)}
                            </div>
                          </div>
                          {!isRunnerView && (
                            <div className="min-w-0">
                              <div className="text-[10px] text-slate-500">Withdrawals</div>
                              <div className="truncate font-mono text-xs text-rose-300">
                                {formatCurrency(d.withdraw_total)}
                              </div>
                            </div>
                          )}
                          {mobileExpanded && !isRunnerView && (
                            <>
                              <div>
                                <div className="text-[10px] text-slate-500">Arcade Total</div>
                                <div className="font-mono text-sm text-indigo-300">
                                  {formatCurrency(d.arcade_total)}
                                </div>
                              </div>
                              <div>
                                <div className="text-[10px] text-slate-500">Last Bet</div>
                                <div className="font-mono text-sm text-violet-300">
                                  {formatCurrency(d.last_bet_amount)}
                                </div>
                              </div>
                              {isAdminView && (
                                <>
                                  <div>
                                    <div className="text-[10px] text-slate-500">Avg Bet</div>
                                    <div className="font-mono text-sm text-violet-300">
                                      {formatJackpotCurrency(deviceAverageBet)}
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
                                      {showDeviceRtp ? formatPercent(deviceRtp) : '—'}
                                    </div>
                                  </div>
                                </>
                              )}
                            </>
                          )}
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => toggleMobileDeviceCard(d.device_id)}
                        aria-label={
                          mobileExpanded ? 'Collapse device details' : 'Expand device details'
                        }
                        aria-expanded={mobileExpanded}
                        className="mt-0.5 shrink-0 rounded p-1 text-lg leading-none text-slate-400 hover:bg-slate-700/60 hover:text-slate-200"
                      >
                        {mobileExpanded ? '▴' : '▾'}
                      </button>
                    </div>
                  </div>
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
                  {!isRunnerView && <th className="px-4 py-2 text-left">Game / Mode</th>}
                  <th className="px-4 py-2 text-right">
                    <button
                      type="button"
                      className="hover:text-white"
                      onClick={() => onSort('balance')}
                    >
                      Balance {sortField === 'balance' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
                    </button>
                  </th>
                  <th className="px-4 py-2 text-right">
                    {isRunnerView ? (
                      <button
                        type="button"
                        className="hover:text-white"
                        onClick={() => onSort('coins_in_total')}
                      >
                        Coins-In{' '}
                        {sortField === 'coins_in_total'
                          ? sortDirection === 'asc'
                            ? '↑'
                            : '↓'
                          : ''}
                      </button>
                    ) : (
                      'Money Flow'
                    )}
                  </th>
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
                  {!isRunnerView && <th className="px-4 py-2 text-right">Withdraw</th>}
                  {isAdminView && <th className="px-4 py-2 text-right">Stats</th>}

                  {isAdminView && (
                    <th className="px-4 py-2 text-right">
                      <button
                        type="button"
                        className="hover:text-white"
                        onClick={() => onSort('last_bet_amount')}
                      >
                        Bet{' '}
                        {sortField === 'last_bet_amount'
                          ? sortDirection === 'asc'
                            ? '↑'
                            : '↓'
                          : ''}
                      </button>
                    </th>
                  )}

                  {isAdminView && (
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
                  )}
                  {!isRunnerView && <th className="px-4 py-2 text-right">
                    <button
                      type="button"
                      className="hover:text-white"
                      onClick={() => onSort('last_bet_at')}
                    >
                      Last Bet At{' '}
                      {sortField === 'last_bet_at' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
                    </button>
                  </th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {paginatedDevices.map(d => {
                  const deviceRtp = getDeviceRtp(d)
                  const deviceAverageBet = isRunnerView ? 0 : getDeviceAverageBet(d)
                  const deviceHouseWin = isRunnerView ? 0 : getDeviceHouseWin(d)
                  const threshold = asNumber((d as any)?.hopper_alert_threshold ?? 500)
                  const hopperLow = hopperAlertsEnabled && asNumber(d.hopper_balance) <= threshold
                  const coinsInHigh = isCoinsInHigh(d)
                  // --- Alert Computations ---
                  const HIGH_RTP_THRESHOLD = 110
                  const showDeviceRtp = shouldShowDeviceRtp()
                  const highRtp =
                    isAdminView && d.device_status === 'playing' && deviceRtp > HIGH_RTP_THRESHOLD
                  const offline = d.device_status === 'offline'
                  const telemetryLabel = getDeviceTelemetryLabel(d)
                  const jackpotStatus = getDeviceJackpotStatus(d)
                  const happyOverrideStatus = getDeviceHappyOverrideStatus(d)
                  const gameType = getDeviceGameType(d)
                  const playDuration = getDevicePlayDuration(d)
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
                              : coinsInHigh
                                ? 'bg-sky-950/30 ring-1 ring-sky-500/40'
                                : isAdminView && highRtp
                                  ? 'bg-fuchsia-950/30 ring-1 ring-fuchsia-500/40'
                                  : isAdminView && d.jackpot_selected
                                    ? 'bg-amber-950/25 hover:bg-amber-900/30 ring-1 ring-inset ring-amber-400/40'
                                    : isAdminView && d.happy_override_selected
                                      ? 'bg-pink-950/25 hover:bg-pink-900/30 ring-1 ring-inset ring-pink-400/40'
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

                              {coinsInHigh && (
                                <span className="px-1.5 py-0.5 text-[9px] font-bold rounded border border-sky-500 bg-sky-950 text-sky-300">
                                  COINS
                                </span>
                              )}

                              {isAdminView && highRtp && (
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

                          {isAdminView && d.jackpot_selected && (
                            <span className="rounded border border-amber-400/70 bg-amber-900/50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-200">
                              JACKPOT
                            </span>
                          )}
                          {isAdminView && d.happy_override_selected && (
                            <span className="rounded border border-pink-400/70 bg-pink-900/40 px-1.5 py-0.5 text-[10px] font-semibold text-pink-200">
                              HAPPY OVR
                            </span>
                          )}
                          {(d.deployment_mode ?? 'online') === 'standby' && (
                            <span className="rounded border border-amber-700 bg-amber-900/40 px-1.5 py-0.5 text-[10px] font-semibold text-amber-200">
                              STANDBY
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
                        <div className="flex flex-col items-start gap-1">
                          <span
                            className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                              d.device_status === 'playing'
                                ? 'bg-emerald-900/40 text-emerald-300 border border-emerald-700/50'
                                : d.device_status === 'offline'
                                  ? 'bg-slate-800 text-slate-400 border border-slate-700'
                                  : 'bg-amber-900/40 text-amber-300 border border-amber-700/50'
                            }`}
                          >
                            {(d.device_status ?? 'idle').toUpperCase() === 'IDLE'
                              ? 'AFK'
                              : (d.device_status ?? 'idle').toUpperCase()}
                          </span>
                          {playDuration && (
                            <span className="font-mono text-[10px] font-semibold text-emerald-300">
                              {playDuration}
                            </span>
                          )}
                        </div>
                      </td>
                      {!isRunnerView && <td className="px-4 py-2 text-xs">
                        <div className="text-slate-200">{telemetryLabel}</div>
                        {isAdminView && jackpotStatus && (
                          <div className="text-amber-300">{jackpotStatus}</div>
                        )}
                        {isAdminView && d.jackpot_selected && (
                          <div className="text-amber-200/80">
                            Target {formatJackpotCurrency(d.jackpot_target_amount)} • Remaining{' '}
                            {formatJackpotCurrency(d.jackpot_remaining_amount)}
                          </div>
                        )}
                        {isAdminView && happyOverrideStatus && (
                          <div className="text-pink-300">{happyOverrideStatus}</div>
                        )}
                      </td>}
                      <td className="px-4 py-2 text-right font-mono font-bold text-green-400">
                        {formatCurrency(d.balance)}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <div
                          className={`flex gap-2 justify-end font-mono text-sm ${
                            coinsInHigh ? 'text-sky-200 animate-pulse' : 'text-sky-300'
                          }`}
                        >
                          {isRunnerView ? '' : 'Coins-In:'}
                          <span className="font-extrabold">{formatCurrency(d.coins_in_total)}</span>
                        </div>
                        {!isRunnerView && (
                          <div className="flex gap-2 justify-end font-mono text-sm text-indigo-300">
                            Arcade:
                            <span className="font-extrabold">{formatCurrency(d.arcade_total)}</span>
                          </div>
                        )}
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
                      {!isRunnerView && <td className="px-4 py-2 text-right font-mono text-rose-300">
                        {formatCurrency(d.withdraw_total)}
                      </td>}
                      {isAdminView && (
                        <td className="px-4 py-2 text-right">
                          <div className="flex gap-2 justify-end font-mono text-xs text-slate-300">
                            Bets:
                            <span className="font-thin">{formatCurrency(d.bet_total)}</span>
                          </div>
                          <div className="flex gap-2 justify-end  font-mono text-xs text-slate-300">
                            Wins:
                            <span className="font-thin">{formatCurrency(d.win_total)}</span>
                          </div>
                          <div className="flex gap-2 justify-end  font-mono text-xs text-fuchsia-300">
                            RTP:
                            <span className="font-thin">
                              {showDeviceRtp ? formatPercent(deviceRtp) : '—'}
                            </span>
                          </div>
                        </td>
                      )}

                      {isAdminView && (
                        <td className="px-4 py-2 text-right">
                          <div className="flex gap-2 justify-end font-mono text-xs text-slate-300">
                            Last:
                            <span className="font-thin">{formatCurrency(d.last_bet_amount)}</span>
                          </div>
                          <div className="flex gap-2 justify-end  font-mono text-xs text-slate-300">
                            Avg:
                            <span className="font-thin">{formatCurrency(deviceAverageBet)}</span>
                          </div>
                        </td>
                      )}

                      {isAdminView && (
                        <td
                          className={`px-4 py-2 text-right font-mono ${
                            deviceHouseWin < 0 ? 'text-red-300 animate-pulse' : 'text-orange-300'
                          }`}
                        >
                          {formatCurrency(deviceHouseWin)}
                        </td>
                      )}
                      {!isRunnerView && <td className="px-4 py-2 text-right text-xs text-slate-400">
                        {d.last_bet_at ? moment(d.last_bet_at).format('YYYY-MM-DD hh:mm A') : '—'}
                      </td>}
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

      {selectedLiveDevice && (
        <DeviceModal
          device={{ ...selectedLiveDevice, hopper_alert_threshold: hopperAlertThreshold }}
          hopperAlertsEnabled={hopperAlertsEnabled}
          coinsInAlertsEnabled={coinsInAlertsEnabled}
          coinsInAlertThreshold={coinsInAlertThreshold}
          role={role}
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
              {jackpotQueueGroups.activeQueues.length === 0 &&
                jackpotQueueGroups.unassignedPendingPots.length === 0 &&
                jackpotQueueGroups.completedQueues.length === 0 && (
                  <div className="rounded border border-slate-800 bg-slate-900/70 p-3 text-sm text-slate-400">
                    No jackpot payout queues found.
                  </div>
                )}
              {jackpotQueueGroups.activeQueues.map(queue => {
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
                            ? moment(queue.created_at).format('MM-DD hh:mm:ss A')
                            : '—'}
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 text-xs text-slate-400">
                      Ready{' '}
                      {queue.payout_ready_at
                        ? moment(queue.payout_ready_at).format('MM-DD hh:mm:ss A')
                        : '—'}
                      {' • '}
                      Completed{' '}
                      {queue.completed_at
                        ? moment(queue.completed_at).format('MM-DD hh:mm:ss A')
                        : '—'}
                    </div>
                  </div>
                )
              })}
              {jackpotQueueGroups.unassignedPendingPots.length > 0 && (
                <div className="pt-2">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Unassigned Pending Pots
                  </div>
                  <div className="space-y-2">
                    {jackpotQueueGroups.unassignedPendingPots.map(pot => (
                      <div
                        key={`pending-pot-${pot.id}`}
                        className="rounded border border-slate-800 bg-slate-900/70 p-3 text-sm"
                      >
                        <div className="flex flex-wrap items-center gap-2 font-mono">
                          <span>Pot #{pot.id}</span>
                          <span className="rounded border border-sky-700 bg-sky-950/60 px-2 py-0.5 text-[10px] font-semibold text-sky-300">
                            UNASSIGNED
                          </span>
                          <span className="text-slate-400">Waiting for device assignment</span>
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-300 sm:grid-cols-4">
                          <div>
                            <div className="text-slate-500">Amount Total</div>
                            <div className="font-mono">
                              {formatJackpotCurrency(pot.amount_total)}
                            </div>
                          </div>
                          <div>
                            <div className="text-slate-500">Amount Remaining</div>
                            <div className="font-mono">
                              {formatJackpotCurrency(pot.amount_remaining)}
                            </div>
                          </div>
                          <div>
                            <div className="text-slate-500">Campaign</div>
                            <div className="font-mono">{String(pot.campaign_id ?? '—')}</div>
                          </div>
                          <div>
                            <div className="text-slate-500">Created</div>
                            <div className="font-mono">
                              {pot.created_at
                                ? moment(pot.created_at).format('MM-DD hh:mm:ss A')
                                : '—'}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {jackpotQueueGroups.completedQueues.length > 0 && (
                <div className="pt-2">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Completed
                  </div>
                  <div className="space-y-2">
                    {jackpotQueueGroups.completedQueues.map(queue => {
                      const deviceId = String(queue.device_id ?? '').trim()
                      const deviceLabel = deviceNameById.get(deviceId) ?? deviceId

                      return (
                        <div
                          key={queue.id}
                          className="rounded border border-slate-800 bg-slate-900/70 p-3 text-sm"
                        >
                          <div className="flex flex-wrap items-center gap-2 font-mono">
                            <span>#{queue.id}</span>
                            <span className="rounded border border-slate-600 bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-300">
                              COMPLETED
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
                                  ? moment(queue.created_at).format('MM-DD hh:mm:ss A')
                                  : '—'}
                              </div>
                            </div>
                          </div>
                          <div className="mt-2 text-xs text-slate-400">
                            Ready{' '}
                            {queue.payout_ready_at
                              ? moment(queue.payout_ready_at).format('MM-DD hh:mm:ss A')
                              : '—'}
                            {' • '}
                            Completed{' '}
                            {queue.completed_at
                              ? moment(queue.completed_at).format('MM-DD hh:mm:ss A')
                              : '—'}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showManualJackpotOverridesModal && (
        <div className="fixed inset-0 z-50 bg-black/80 p-5 sm:p-6">
          <div className="mx-auto max-w-4xl rounded-lg border border-slate-700 bg-slate-950 p-5 sm:p-6">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold">
                  {overrideModalView === 'happy' ? 'Happy Overrides' : 'Manual Jackpot Overrides'}
                </h3>
                <div className="mt-1 text-xs text-slate-400">
                  {overrideModalView === 'happy'
                    ? 'Active per-device happy overrides.'
                    : 'Latest entries first. Shows all dashboard-triggered per-device jackpot overrides.'}
                </div>
              </div>
              <button
                onClick={() => setShowManualJackpotOverridesModal(false)}
                className="text-slate-300 hover:text-white"
              >
                ✕
              </button>
            </div>
            <div className="max-h-[70vh] overflow-auto space-y-2">
              {overrideModalView === 'manual_jackpot' && manualJackpotOverrides.length === 0 && (
                <div className="rounded border border-slate-800 bg-slate-900/70 p-3 text-sm text-slate-400">
                  No manual jackpot overrides found.
                </div>
              )}
              {overrideModalView === 'manual_jackpot' && manualJackpotOverrides.map(override => {
                const snapshot = (override.goal_snapshot as Record<string, unknown> | null) ?? null
                const deviceId = String(snapshot?.deviceId ?? '').trim()
                const snapshotDeviceName = String(snapshot?.deviceName ?? '').trim()
                const deviceLabel =
                  snapshotDeviceName || deviceNameById.get(deviceId) || deviceId || 'Unknown Device'

                return (
                  <div
                    key={override.id}
                    className="rounded border border-slate-800 bg-slate-900/70 p-3 text-sm"
                  >
                    <div className="flex flex-wrap items-center gap-2 font-mono">
                      <span>#{override.id}</span>
                      <span className="rounded border border-amber-700 bg-amber-950/60 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                        {String(override.status ?? 'queued').toUpperCase()}
                      </span>
                      <span className="text-slate-300">{deviceLabel}</span>
                      {deviceId && <span className="text-slate-500">{deviceId}</span>}
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-300 sm:grid-cols-4">
                      <div>
                        <div className="text-slate-500">Amount</div>
                        <div className="font-mono">
                          {formatJackpotCurrency(override.amount_total)}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500">Remaining</div>
                        <div className="font-mono">
                          {formatJackpotCurrency(override.amount_remaining)}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500">Created</div>
                        <div className="font-mono">
                          {override.created_at
                            ? moment(override.created_at).format('MM-DD hh:mm:ss A')
                            : '—'}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500">Completed</div>
                        <div className="font-mono">
                          {override.completed_at
                            ? moment(override.completed_at).format('MM-DD hh:mm:ss A')
                            : '—'}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
              {overrideModalView === 'happy' && activeHappyOverrides.length === 0 && (
                <div className="rounded border border-slate-800 bg-slate-900/70 p-3 text-sm text-slate-400">
                  No active happy overrides found.
                </div>
              )}
              {overrideModalView === 'happy' &&
                activeHappyOverrides.map(device => (
                  <div
                    key={device.device_id}
                    className="rounded border border-slate-800 bg-slate-900/70 p-3 text-sm"
                  >
                    <div className="flex flex-wrap items-center gap-2 font-mono">
                      <span className="rounded border border-pink-700 bg-pink-950/60 px-2 py-0.5 text-[10px] font-semibold text-pink-300">
                        ACTIVE
                      </span>
                      <span className="text-slate-300">
                        {String(device.name ?? '').trim() || device.device_id}
                      </span>
                      <span className="text-slate-500">{device.device_id}</span>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-300 sm:grid-cols-4">
                      <div>
                        <div className="text-slate-500">Target</div>
                        <div className="font-mono">
                          {formatJackpotCurrency(device.happy_override_target_amount)}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500">Remaining</div>
                        <div className="font-mono">
                          {formatJackpotCurrency(device.happy_override_remaining_amount)}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500">Area</div>
                        <div className="font-mono">
                          {[device.area_name, device.station_name].filter(Boolean).join(' / ') ||
                            '—'}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500">Status</div>
                        <div className="font-mono">
                          {String(device.device_status ?? 'idle').toUpperCase()}
                        </div>
                      </div>
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
