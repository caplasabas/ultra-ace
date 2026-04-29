import { useEffect, useMemo, useRef, useState } from 'react'
import type { DeviceRow } from '../hooks/useDevices'
import { useDevices } from '../hooks/useDevices'
import { DeviceModal } from '../components/DeviceModal'
import { useGlobalStats } from '../hooks/useGlobalStats'
import { useCasinoRuntime } from '../hooks/useCasinoRuntime'
import { useGames } from '../hooks/useGames'
import type { DashboardRole } from '../hooks/useDashboardAuth'
import moment from 'moment'
import { supabase } from '../lib/supabase'

const DASHBOARD_POTS_POLL_MS = 2500
const DASHBOARD_JACKPOT_QUEUE_POLL_MS = 2500
const DASHBOARD_MANUAL_OVERRIDE_POLL_MS = 5000
const DASHBOARD_ACTIVITY_RTP_POLL_MS = 2500
const DASHBOARD_ACTIVITY_RTP_PAGE_SIZE = 1000

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

type ActivityRtpTotals = {
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
  const [expandedStatCards, setExpandedStatCards] = useState({
    moneyFlow: false,
    gameFlow: false,
    performance: false,
    system: false,
  })
  const [showAllMobileStatCards, setShowAllMobileStatCards] = useState(false)
  const [showAllMobileDeviceCounters, setShowAllMobileDeviceCounters] = useState(false)
  const [expandedMobileDevices, setExpandedMobileDevices] = useState<Record<string, boolean>>({})
  const [happyPots, setHappyPots] = useState<any[]>([])
  const [jackpotPots, setJackpotPots] = useState<any[]>([])
  const [jackpotQueues, setJackpotQueues] = useState<any[]>([])
  const [manualJackpotOverrides, setManualJackpotOverrides] = useState<any[]>([])
  const [activityRtpByDevice, setActivityRtpByDevice] = useState<Record<string, ActivityRtpTotals>>(
    {},
  )
  const [activityGlobalRtpTotals, setActivityGlobalRtpTotals] = useState<ActivityRtpTotals>({
    bet: 0,
    win: 0,
  })
  const [activityRtpReady, setActivityRtpReady] = useState(false)
  const [hopperAlertsEnabled] = useState(() => {
    try {
      return localStorage.getItem('hopperAlertsEnabled') === 'true'
    } catch {
      return false
    }
  })
  const [currentPage, setCurrentPage] = useState(1)
  const activityRtpByDeviceRef = useRef<Record<string, ActivityRtpTotals>>({})
  const activityGlobalRtpTotalsRef = useRef<ActivityRtpTotals>({ bet: 0, win: 0 })
  const lastActivityMetricIdRef = useRef(0)
  const pageSize = 10
  const isStaffView = role === 'staff'

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

    const poll = window.setInterval(() => {
      void fetchPots()
    }, DASHBOARD_POTS_POLL_MS)

    return () => {
      window.clearInterval(poll)
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

    const poll = window.setInterval(() => {
      void fetchJackpotQueues()
    }, DASHBOARD_JACKPOT_QUEUE_POLL_MS)

    return () => {
      window.clearInterval(poll)
    }
  }, [])

  useEffect(() => {
    async function fetchManualJackpotOverrides() {
      const { data } = await supabase
        .from('jackpot_pots')
        .select('*')
        .contains('goal_snapshot', { source: 'dashboard_device_override' })
        .neq('status', 'processing')
        .order('created_at', { ascending: false })
        .limit(200)

      setManualJackpotOverrides(data ?? [])
    }

    void fetchManualJackpotOverrides()

    const poll = window.setInterval(() => {
      void fetchManualJackpotOverrides()
    }, DASHBOARD_MANUAL_OVERRIDE_POLL_MS)

    return () => {
      window.clearInterval(poll)
    }
  }, [])

  useEffect(() => {
    function getActivityFundingSource(row: any) {
      return String(row?.metadata?.winFundingSource ?? '')
        .trim()
        .toLowerCase()
    }

    function getActivityRtpAmount(row: any, eventType: 'spin' | 'win') {
      const fundingSource = getActivityFundingSource(row)
      if (fundingSource === 'happy_prize_pool') return 0
      if (fundingSource === 'device_happy_override') return 0
      if (
        String(row?.metadata?.triggerType ?? '')
          .trim()
          .toLowerCase() === 'buy'
      )
        return 0
      if (row?.metadata?.isFreeGame) return 0
      if (row?.metadata?.jackpotCampaignPayout) return 0
      if (Number(row?.metadata?.jackpotPayout ?? row?.metadata?.jackpot_payout ?? 0) > 0) return 0

      if (eventType === 'spin') {
        const spinAmount = Number(row?.amount ?? 0)
        return Number.isFinite(spinAmount) && spinAmount > 0 ? spinAmount : 0
      }

      const acceptedWin = Number(
        row?.metadata?.acceptedWin ?? row?.metadata?.accepted_win ?? row?.amount ?? 0,
      )
      return Number.isFinite(acceptedWin) && acceptedWin > 0 ? acceptedWin : 0
    }

    function accumulateActivityRtpRows(
      rows: any[],
      byDevice: Record<string, ActivityRtpTotals>,
      global: ActivityRtpTotals,
    ) {
      if (!rows.length) return

      for (const row of rows) {
        const id = Number(row?.id ?? 0)
        if (id > lastActivityMetricIdRef.current) {
          lastActivityMetricIdRef.current = id
        }

        if (!row?.counts_toward_global) continue

        const eventType = String(row?.event_type ?? '')
          .trim()
          .toLowerCase()
        if (eventType !== 'spin' && eventType !== 'win') continue

        const deviceId = String(row?.device_id ?? '').trim()
        if (!deviceId) continue

        const amount = getActivityRtpAmount(row, eventType as 'spin' | 'win')
        if (amount <= 0) continue

        const current = byDevice[deviceId] ?? { bet: 0, win: 0 }
        byDevice[deviceId] =
          eventType === 'spin'
            ? { bet: current.bet + amount, win: current.win }
            : { bet: current.bet, win: current.win + amount }

        if (eventType === 'spin') {
          global.bet += amount
        } else {
          global.win += amount
        }
      }
    }

    function applyActivityRtpRows(rows: any[]) {
      if (!rows.length) return

      const nextByDevice = { ...activityRtpByDeviceRef.current }
      const nextGlobal = { ...activityGlobalRtpTotalsRef.current }
      accumulateActivityRtpRows(rows, nextByDevice, nextGlobal)

      activityRtpByDeviceRef.current = nextByDevice
      activityGlobalRtpTotalsRef.current = nextGlobal
      setActivityRtpByDevice(nextByDevice)
      setActivityGlobalRtpTotals(nextGlobal)
    }

    async function fetchActivityRtpInitial() {
      setActivityRtpReady(false)
      activityRtpByDeviceRef.current = {}
      activityGlobalRtpTotalsRef.current = { bet: 0, win: 0 }
      lastActivityMetricIdRef.current = 0
      const nextByDevice: Record<string, ActivityRtpTotals> = {}
      const nextGlobal: ActivityRtpTotals = { bet: 0, win: 0 }

      let from = 0

      for (;;) {
        const to = from + DASHBOARD_ACTIVITY_RTP_PAGE_SIZE - 1
        const { data } = await supabase
          .from('device_metric_events')
          .select('id,device_id,event_type,amount,metadata,counts_toward_global')
          .in('event_type', ['spin', 'win'])
          .order('id', { ascending: true })
          .range(from, to)

        const rows = data ?? []
        accumulateActivityRtpRows(rows, nextByDevice, nextGlobal)

        if (rows.length < DASHBOARD_ACTIVITY_RTP_PAGE_SIZE) break
        from += DASHBOARD_ACTIVITY_RTP_PAGE_SIZE
      }

      activityRtpByDeviceRef.current = nextByDevice
      activityGlobalRtpTotalsRef.current = nextGlobal
      setActivityRtpByDevice(nextByDevice)
      setActivityGlobalRtpTotals(nextGlobal)
      setActivityRtpReady(true)
    }

    async function fetchActivityRtpIncremental() {
      let fromId = lastActivityMetricIdRef.current

      for (;;) {
        const { data } = await supabase
          .from('device_metric_events')
          .select('id,device_id,event_type,amount,metadata,counts_toward_global')
          .in('event_type', ['spin', 'win'])
          .gt('id', fromId)
          .order('id', { ascending: true })
          .limit(DASHBOARD_ACTIVITY_RTP_PAGE_SIZE)

        const rows = data ?? []
        if (!rows.length) break

        applyActivityRtpRows(rows)
        setActivityRtpReady(true)
        fromId = lastActivityMetricIdRef.current

        if (rows.length < DASHBOARD_ACTIVITY_RTP_PAGE_SIZE) break
      }
    }

    void fetchActivityRtpInitial()

    const poll = window.setInterval(() => {
      void fetchActivityRtpIncremental()
    }, DASHBOARD_ACTIVITY_RTP_POLL_MS)

    return () => {
      window.clearInterval(poll)
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
  const getDeviceRtp = (deviceId: string | null | undefined) => {
    const totals = activityRtpByDevice[String(deviceId ?? '').trim()]
    return totals?.bet ? (totals.win / totals.bet) * 100 : 0
  }

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

  const globalBet = asNumber(stats?.total_bet_amount)
  const globalWin = asNumber(stats?.total_win_amount)
  const globalNormalWin = activityGlobalRtpTotals.win
  const globalBaseRtp =
    activityGlobalRtpTotals.bet > 0
      ? (activityGlobalRtpTotals.win / activityGlobalRtpTotals.bet) * 100
      : 0
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
      highRtp: devices.filter(d => getDeviceRtp(d.device_id) > 110).length,
    }),
    [devices, hopperAlertsEnabled],
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
    if (field === 'house_win')
      return asNumber(
        device.house_take_total ?? asNumber(device.bet_total) - asNumber(device.win_total),
      )
    if (field === 'rtp') return getDeviceRtp(device.device_id)
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
  }, [deploymentFilter, devices, searchTerm, sortField, sortDirection])

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
  const visibleSortOptions = isStaffView
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

  return (
    <>
      <div className="p-5 sm:p-6 max-w-[90rem] mx-auto space-y-8 sm:space-y-10 bg-slate-900 text-slate-100">
        <div className="flex justify-between">
          <header>
            <h1 className="text-2xl font-semibold">Dashboard</h1>
            {!isStaffView && (
              <div className="text-xs font-mono text-emerald-200/60">
                H/J/P {formatPercent(activeHousePct)} / {formatPercent(activeJackpotPct)} /{' '}
                {formatPercent(activeHappyPct)}
              </div>
            )}
          </header>

          {!isStaffView && (
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

        {!isStaffView && <section>
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
                      <div className="text-xs text-orange-200/80">Coins-Out</div>
                      <div className="text-lg font-mono text-orange-300">
                        {formatCurrency(stats?.total_coins_out)}
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
                        {activityRtpReady ? formatJackpotCurrency(globalNormalWin) : '—'}
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
                    {activityRtpReady ? formatPercent(globalBaseRtp) : '—'}
                  </div>
                  <div className="text-xs text-fuchsia-200/80">
                    Target {formatPercent(ENGINE_SIM_TOTAL_RTP_PCT)}
                  </div>
                </div>

                {expandedStatCards.performance && (
                  <div>
                    <div className="text-xs text-orange-200/80">House Take</div>
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
                  <span className="text-lg font-bold font-mono text-emerald-300">
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
                        onClick={() => setShowManualJackpotOverridesModal(true)}
                        className="block text-left text-xs font-mono text-orange-300 underline decoration-dotted underline-offset-2 transition hover:text-orange-200"
                      >
                        Override Jackpot Total{' '}
                        {formatJackpotCurrency(runtime?.manual_jackpot_override_total)}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </section>}

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
                <div className="text-xs text-fuchsia-300">
                  🟣 High RTP: {deviceSummaryCounts.highRtp}
                </div>
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
                </div>

                {showAllMobileDeviceCounters && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-300">
                    <div className="text-xs text-violet-300">
                      🛠 Maintenance: {deviceSummaryCounts.maintenance}
                    </div>
                    <div className="text-xs text-red-300">
                      🔴 Offline: {deviceSummaryCounts.offline}
                    </div>
                    <div className="text-xs text-fuchsia-300">
                      🟣 High RTP: {deviceSummaryCounts.highRtp}
                    </div>
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
                const deviceRtp = getDeviceRtp(d.device_id)
                const deviceAverageBet = getDeviceAverageBet(d)

                const deviceHouseWin = asNumber(
                  d.house_take_total ?? asNumber(d.bet_total) - asNumber(d.win_total),
                )
                const threshold = asNumber((d as any)?.hopper_alert_threshold ?? 500)
                const hopperLow = hopperAlertsEnabled && asNumber(d.hopper_balance) <= threshold
                // --- Alert Computations ---
                const HIGH_RTP_THRESHOLD = 110
                const highRtp = deviceRtp > HIGH_RTP_THRESHOLD
                const gameType = getDeviceGameType(d)
                const telemetryLabel = getDeviceTelemetryLabel(d)
                const jackpotStatus = getDeviceJackpotStatus(d)
                const happyOverrideStatus = getDeviceHappyOverrideStatus(d)
                const mobileExpanded = Boolean(expandedMobileDevices[d.device_id])
                return (
                  <div
                    key={d.device_id}
                    className={`w-full rounded-lg border p-3 text-left ${
                      d.jackpot_selected
                        ? 'border-amber-300/70 bg-gradient-to-br from-amber-900/30 via-slate-900/80 to-slate-900/90 shadow-[0_0_20px_rgba(251,191,36,0.18)]'
                        : d.happy_override_selected
                          ? 'border-pink-300/70 bg-gradient-to-br from-pink-900/30 via-slate-900/80 to-slate-900/90 shadow-[0_0_20px_rgba(236,72,153,0.16)]'
                        : 'border-slate-700 bg-slate-800'
                    }`}
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
                            {mobileExpanded && (
                              <>
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
                                    {(d.device_status ?? 'idle').toUpperCase() === 'IDLE'
                                      ? 'AFK'
                                      : (d.device_status ?? 'idle').toUpperCase()}
                                  </span>
                                  <span className="rounded border border-slate-700 bg-slate-800/60 px-1.5 py-0.5 text-[10px] text-slate-300">
                                    {gameType.toUpperCase()}
                                  </span>
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
                                <div className="mt-1 text-[10px] text-slate-300">
                                  {telemetryLabel}
                                </div>

                                <div className="mt-1 flex flex-wrap gap-1">
                                  {hopperLow && (
                                    <span className="px-1.5 py-0.5 text-[9px] font-bold rounded border border-red-500 bg-red-950 text-red-300">
                                      LOW
                                    </span>
                                  )}

                                  {!isStaffView && highRtp && (
                                    <span className="px-1.5 py-0.5 text-[9px] font-bold rounded border border-fuchsia-500 bg-fuchsia-950 text-fuchsia-300">
                                      RTP
                                    </span>
                                  )}
                                </div>
                                {!isStaffView && d.jackpot_selected && (
                                  <div className="mt-1 text-[10px] font-semibold text-amber-200">
                                    JACKPOT TARGET {formatJackpotCurrency(d.jackpot_target_amount)}{' '}
                                    • Remaining {formatJackpotCurrency(d.jackpot_remaining_amount)}
                                  </div>
                                )}
                                {!isStaffView && jackpotStatus && (
                                  <div className="mt-1 text-[10px] text-amber-300">
                                    {jackpotStatus}
                                  </div>
                                )}
                                {!isStaffView && d.happy_override_selected && (
                                  <div className="mt-1 text-[10px] font-semibold text-pink-200">
                                    HAPPY TARGET{' '}
                                    {formatJackpotCurrency(d.happy_override_target_amount)} •
                                    Remaining{' '}
                                    {formatJackpotCurrency(d.happy_override_remaining_amount)}
                                  </div>
                                )}
                                {!isStaffView && happyOverrideStatus && (
                                  <div className="mt-1 text-[10px] text-pink-300">
                                    {happyOverrideStatus}
                                  </div>
                                )}
                              </>
                            )}
                          </div>

                          <div className="mt-0.5 text-right">
                            <div className="text-[10px] text-slate-500">Last Bet At</div>{' '}
                            <div className="text-xs text-slate-300">
                              {d.last_bet_at ? moment(d.last_bet_at).format('MM-DD hh:mm A') : '—'}
                            </div>
                          </div>
                        </div>

                        <div
                          className={
                            mobileExpanded
                              ? 'mt-3 grid grid-cols-2 gap-x-3 gap-y-2'
                              : 'mt-3 flex flex-wrap gap-y-2'
                          }
                        >
                          <div className={mobileExpanded ? undefined : 'min-w-[88px] flex-1'}>
                            <div className="text-[10px] text-slate-500">Balance</div>
                            <div className="font-mono text-sm font-bold text-green-400">
                              {formatCurrency(d.balance)}
                            </div>
                          </div>
                          <div className={mobileExpanded ? undefined : 'min-w-[88px] flex-1'}>
                            <div className="text-[10px] text-slate-500">Coins-In</div>
                            <div className="font-mono text-sm text-sky-300">
                              {formatCurrency(d.coins_in_total)}
                            </div>
                          </div>
                          <div className={mobileExpanded ? undefined : 'min-w-[88px] flex-1'}>
                            <div className="text-[10px] text-slate-500">Hopper</div>
                            <div
                              className={`font-mono text-sm font-bold ${
                                hopperLow ? 'text-red-300 animate-pulse' : 'text-amber-300'
                              }`}
                            >
                              {formatCurrency(d.hopper_balance)}
                            </div>
                          </div>
                          {mobileExpanded && (
                            <>
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
                              {!isStaffView && (
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
                                      {activityRtpReady ? formatPercent(deviceRtp) : '—'}
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
                  {!isStaffView && <th className="px-4 py-2 text-right">Stats</th>}

                  {!isStaffView && (
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

                  {!isStaffView && (
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
                  <th className="px-4 py-2 text-right">
                    <button
                      type="button"
                      className="hover:text-white"
                      onClick={() => onSort('last_bet_at')}
                    >
                      Last Bet At{' '}
                      {sortField === 'last_bet_at' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {paginatedDevices.map(d => {
                  const deviceRtp = getDeviceRtp(d.device_id)
                  const deviceAverageBet = getDeviceAverageBet(d)
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
                  const happyOverrideStatus = getDeviceHappyOverrideStatus(d)
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
                            : !isStaffView && highRtp
                              ? 'bg-fuchsia-950/30 ring-1 ring-fuchsia-500/40'
                              : !isStaffView && d.jackpot_selected
                                ? 'bg-amber-950/25 hover:bg-amber-900/30 ring-1 ring-inset ring-amber-400/40'
                                : !isStaffView && d.happy_override_selected
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

                              {!isStaffView && highRtp && (
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

                          {!isStaffView && d.jackpot_selected && (
                            <span className="rounded border border-amber-400/70 bg-amber-900/50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-200">
                              JACKPOT
                            </span>
                          )}
                          {!isStaffView && d.happy_override_selected && (
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
                      </td>
                      <td className="px-4 py-2 text-xs">
                        <div className="text-slate-200">{telemetryLabel}</div>
                        {!isStaffView && jackpotStatus && (
                          <div className="text-amber-300">{jackpotStatus}</div>
                        )}
                        {!isStaffView && d.jackpot_selected && (
                          <div className="text-amber-200/80">
                            Target {formatJackpotCurrency(d.jackpot_target_amount)} • Remaining{' '}
                            {formatJackpotCurrency(d.jackpot_remaining_amount)}
                          </div>
                        )}
                        {!isStaffView && happyOverrideStatus && (
                          <div className="text-pink-300">{happyOverrideStatus}</div>
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
                      {!isStaffView && (
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
                              {activityRtpReady ? formatPercent(deviceRtp) : '—'}
                            </span>
                          </div>
                        </td>
                      )}

                      {!isStaffView && (
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

                      {!isStaffView && (
                        <td
                          className={`px-4 py-2 text-right font-mono ${
                            deviceHouseWin < 0 ? 'text-red-300 animate-pulse' : 'text-orange-300'
                          }`}
                        >
                          {formatCurrency(deviceHouseWin)}
                        </td>
                      )}
                      <td className="px-4 py-2 text-right text-xs text-slate-400">
                        {d.last_bet_at ? moment(d.last_bet_at).format('YYYY-MM-DD hh:mm A') : '—'}
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
                <h3 className="text-lg font-semibold">Manual Jackpot Overrides</h3>
                <div className="mt-1 text-xs text-slate-400">
                  Latest entries first. Shows all dashboard-triggered per-device jackpot overrides.
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
              {manualJackpotOverrides.length === 0 && (
                <div className="rounded border border-slate-800 bg-slate-900/70 p-3 text-sm text-slate-400">
                  No manual jackpot overrides found.
                </div>
              )}
              {manualJackpotOverrides.map(override => {
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
            </div>
          </div>
        </div>
      )}
    </>
  )
}
