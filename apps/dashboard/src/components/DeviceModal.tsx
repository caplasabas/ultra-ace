import { toggleCabinetGame, useCabinetGames } from '../hooks/useCabinetGames.ts'
import { useEffect, useState } from 'react'
import { prepareGamePackage, removeGamePackage } from '../lib/arcadeAdmin.ts'
import { supabase } from '../lib/supabase.ts'

export function DeviceModal({
  device,
  onClose,
  hopperAlertsEnabled,
}: {
  device: any
  onClose: () => void
  hopperAlertsEnabled?: boolean
}) {
  const cabinetGames = useCabinetGames(device.device_id)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [overrideBusy, setOverrideBusy] = useState(false)
  const [powerActionBusy, setPowerActionBusy] = useState<'restart' | 'shutdown' | 'reset' | null>(
    null,
  )
  const [nameBusy, setNameBusy] = useState(false)
  const [deviceName, setDeviceName] = useState(String(device.name ?? ''))
  const [deploymentMode, setDeploymentMode] = useState<'online' | 'maintenance'>(
    device.deployment_mode === 'maintenance' ? 'maintenance' : 'online',
  )
  const [deploymentBusy, setDeploymentBusy] = useState(false)
  const [activeTab, setActiveTab] = useState<'overview' | 'controls' | 'games'>('overview')

  // Assignment UI/Logic state
  const [agents, setAgents] = useState<any[]>([])
  const [areas, setAreas] = useState<any[]>([])
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(device.agent_id ?? null)
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(device.area_id ?? null)
  const [assignmentSaving, setAssignmentSaving] = useState(false)
  useEffect(() => {
    async function loadMeta() {
      const { data: agentData } = await supabase.from('agents').select('*')
      const { data: areaData } = await supabase.from('areas').select('*')

      setAgents(agentData ?? [])
      setAreas(areaData ?? [])
    }

    loadMeta()
  }, [])

  const filteredAreas = areas.filter(a => a.agent_id === selectedAgentId)

  function handleAgentChange(agentId: string) {
    setSelectedAgentId(agentId || null)
    setSelectedAreaId(null)
  }

  async function saveAssignment() {
    if (!device?.device_id) return

    setAssignmentSaving(true)

    const { error } = await supabase
      .from('devices')
      .update({
        agent_id: selectedAgentId,
        area_id: selectedAreaId,
        updated_at: new Date().toISOString(),
      })
      .eq('device_id', device.device_id)

    setAssignmentSaving(false)

    if (error) {
      setErrorMessage(error.message)
      return
    }

    setSuccessMessage('Assignment updated')
  }

  const asNumber = (v: number | string | null | undefined) => Number(v ?? 0)
  const formatCurrency = (v: number | string | null | undefined) =>
    `₱${asNumber(v).toLocaleString()}`
  const formatJackpotCurrency = (v: number | string | null | undefined) =>
    `₱${asNumber(v).toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })}`
  const baseWinAmount =
    asNumber(device.win_total) -
    asNumber(device.jackpot_win_total) -
    asNumber(device.prize_pool_paid_total)
  const deviceRtp =
    asNumber(device.bet_total) > 0
      ? (baseWinAmount / asNumber(device.bet_total)) * 100
      : 0
  const deviceHouseWin = asNumber(
    device.house_take_total ?? asNumber(device.bet_total) - asNumber(device.win_total),
  )
  const hopperAlertThreshold = asNumber((device as any)?.hopper_alert_threshold ?? 500)
  const hopperLow =
    (hopperAlertsEnabled ?? true) && asNumber(device.hopper_balance) <= hopperAlertThreshold

  // --- Alert Computations ---
  const HIGH_RTP_THRESHOLD = 110
  const highRtp = deviceRtp > HIGH_RTP_THRESHOLD

  const lastHeartbeat = new Date((device as any)?.session_last_heartbeat ?? 0).getTime()
  const now = Date.now()
  const STUCK_THRESHOLD_MS = 1000 * 60 * 2
  const stuckSession =
    device.device_status === 'playing' && now - lastHeartbeat > STUCK_THRESHOLD_MS

  const offline = device.device_status === 'offline'
  const gameTypeRaw = String(device.game_type ?? (device.session_metadata as any)?.gameType ?? '')
    .trim()
    .toLowerCase()
  const gameType: 'arcade' | 'casino' =
    gameTypeRaw === 'arcade' || gameTypeRaw === 'casino'
      ? (gameTypeRaw as 'arcade' | 'casino')
      : device.runtime_mode || device.is_free_game || device.jackpot_selected
        ? 'casino'
        : 'arcade'
  const gameName = String(device.current_game_name ?? device.current_game_id ?? 'No Game')
  const modeLabel = device.is_free_game
    ? `FREE SPIN (${asNumber(device.free_spins_left)} left)`
    : String(device.runtime_mode ?? 'BASE').toUpperCase()
  const telemetryLabel =
    gameType === 'casino' ? `CASINO / ${gameName} / ${modeLabel}` : `ARCADE / ${gameName}`
  const jackpotStatusLabel = (() => {
    if (!device.jackpot_selected) return null
    if (device.is_free_game && asNumber(device.free_spins_left) > 0) {
      return `JACKPOT LIVE • FREE SPINS ${asNumber(device.free_spins_left)} left`
    }
    const delaySpins = Math.max(0, asNumber(device.jackpot_spins_until_start))
    if (delaySpins > 0) {
      return `JACKPOT ARMED • ${delaySpins} spin${delaySpins === 1 ? '' : 's'} until trigger`
    }
    return 'JACKPOT ARMED • trigger spin next'
  })()
  const [balanceAmount, setBalanceAmount] = useState('0')
  const [balanceKind, setBalanceKind] = useState<'debit' | 'credit'>('credit')
  const [balanceAccountName, setBalanceAccountName] = useState('Manual Accounting Override')
  const [balanceNotes, setBalanceNotes] = useState('')

  const [hopperAmount, setHopperAmount] = useState('0')
  const [hopperKind, setHopperKind] = useState<'debit' | 'credit'>('credit')
  const [hopperAccountName, setHopperAccountName] = useState('Manual Hopper Override')
  const [hopperNotes, setHopperNotes] = useState('')

  useEffect(() => {
    if (!errorMessage) return
    const t = setTimeout(() => setErrorMessage(null), 4000)
    return () => clearTimeout(t)
  }, [errorMessage])

  useEffect(() => {
    setActiveTab('overview')
  }, [device.device_id])

  useEffect(() => {
    setBalanceAmount('0')
    setHopperAmount('0')
    setDeviceName(String(device.name ?? ''))
  }, [device.device_id, device.balance, device.hopper_balance])

  useEffect(() => {
    setDeploymentMode(device.deployment_mode === 'maintenance' ? 'maintenance' : 'online')
  }, [device.device_id, device.deployment_mode])

  useEffect(() => {
    setSelectedAgentId(device.agent_id ?? null)
    setSelectedAreaId(device.area_id ?? null)
  }, [device.device_id, device.agent_id, device.area_id])

  useEffect(() => {
    if (!successMessage) return
    const t = setTimeout(() => setSuccessMessage(null), 4000)
    return () => clearTimeout(t)
  }, [successMessage])

  async function postOverrideEntry(params: {
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

    setOverrideBusy(true)

    if (params.target === 'accounting_balance' && params.entryKind === 'credit') {
      const { error } = await supabase.rpc('apply_metric_events', {
        p_events: [
          {
            device_id: device.device_id,
            event_type: 'coins_in',
            amount,
            event_ts: new Date().toISOString(),
            metadata: {
              source: 'dashboard_device_modal',
              target: params.target,
              entry_kind: params.entryKind,
              account_name: params.accountName.trim(),
              notes: params.notes.trim() || null,
            },
          },
        ],
        p_write_ledger: true,
      })
      setOverrideBusy(false)

      if (error) {
        setErrorMessage(error.message)
        return
      }

      setSuccessMessage(`Balance CREDIT ${formatCurrency(amount)} posted as COINS IN`)
      setErrorMessage(null)
      return true
    }

    const { data, error } = await supabase.rpc('post_device_admin_ledger_entry', {
      p_device_id: device.device_id,
      p_target: params.target,
      p_entry_kind: params.entryKind,
      p_amount: amount,
      p_account_name: params.accountName.trim(),
      p_notes: params.notes.trim() || null,
      p_metadata: {
        source: 'dashboard_device_modal',
      },
    })
    setOverrideBusy(false)

    if (error) {
      setErrorMessage(error.message)
      return
    }

    const before = Number((data as any)?.before ?? 0)
    const after = Number((data as any)?.after ?? 0)
    const applied = Number((data as any)?.amount ?? amount)
    setSuccessMessage(
      `${params.target === 'accounting_balance' ? 'Balance' : 'Hopper'} ${params.entryKind.toUpperCase()} ${formatCurrency(applied)} • ${formatCurrency(before)} -> ${formatCurrency(after)}`,
    )
    setErrorMessage(null)
    return true
  }

  async function enqueuePowerCommand(command: 'restart' | 'shutdown' | 'reset') {
    if (!device?.device_id) return

    setPowerActionBusy(command)

    const { data, error } = await supabase.rpc('enqueue_device_admin_command', {
      p_device_id: device.device_id,
      p_command: command,
      p_reason: 'dashboard_device_modal',
      p_requested_by: 'dashboard',
    })

    setPowerActionBusy(null)

    if (error) {
      setErrorMessage(error.message)
      return
    }

    const deduped = Boolean((data as any)?.deduped)
    const label = command === 'restart' ? 'Restart' : command === 'shutdown' ? 'Shutdown' : 'Reset'
    setSuccessMessage(
      deduped
        ? `${label} already queued for ${device.device_id}`
        : `${label} queued for ${device.device_id}`,
    )
    setErrorMessage(null)
  }

  async function saveDeviceName() {
    if (!device?.device_id) return

    setNameBusy(true)

    const nextName = deviceName.trim()
    const { error } = await supabase
      .from('devices')
      .update({
        name: nextName || null,
        updated_at: new Date().toISOString(),
      })
      .eq('device_id', device.device_id)

    setNameBusy(false)

    if (error) {
      setErrorMessage(error.message)
      return
    }

    setSuccessMessage(
      nextName ? `Cabinet name saved: ${nextName}` : `Cabinet name cleared for ${device.device_id}`,
    )
    setErrorMessage(null)
  }

  async function saveDeploymentMode() {
    if (!device?.device_id) return

    setDeploymentBusy(true)

    const { error } = await supabase
      .from('devices')
      .update({
        deployment_mode: deploymentMode,
        updated_at: new Date().toISOString(),
      })
      .eq('device_id', device.device_id)

    setDeploymentBusy(false)

    if (error) {
      setErrorMessage(error.message)
      return
    }

    setSuccessMessage(
      deploymentMode === 'maintenance'
        ? `Device set to maintenance mode`
        : `Device set to online mode`,
    )
    setErrorMessage(null)
  }

  return (
    <div className="fixed inset-0   bg-black/50 dark:bg-black/85 z-50 overflow-y-auto">
      <div className="min-h-full flex items-start md:items-center justify-center p-4">
        <div
          className={`bg-white dark:bg-slate-900 w-full max-w-2xl h-[85vh] flex flex-col rounded-xl border ${
            device.jackpot_selected
              ? 'border-amber-400/70 shadow-[0_0_28px_rgba(251,191,36,0.2)]'
              : 'border-slate-200 dark:border-slate-800'
          }`}
        >
          <div className="flex flex-col space-y-1 p-4">
            <button onClick={onClose} className="text-slate-400 hover:text-white self-end">
              ✕
            </button>
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-base md:text-lg font-semibold">
                  {device.name?.trim() || 'Unnamed Cabinet'}
                </h3>
                <div className="mt-1">
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded font-semibold ${
                      device.device_status === 'playing'
                        ? 'bg-emerald-900/40 text-emerald-300 border border-emerald-700/50'
                        : device.device_status === 'offline'
                          ? 'bg-slate-800 text-slate-400 border border-slate-700'
                          : 'bg-amber-900/40 text-amber-300 border border-amber-700/50'
                    }`}
                  >
                    {(device.device_status ?? 'idle').toUpperCase()}
                  </span>
                </div>
                <div className="mt-1 text-xs font-mono text-slate-400">
                  Device ID: {device.device_id ?? 'Unknown Device'}
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  Arcade Shell: {String(device.arcade_shell_version ?? '').trim() || 'unknown'}
                  {' • '}
                  IP: {String(device.current_ip ?? '').trim() || 'n/a'}
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  Deployment: {(device.deployment_mode ?? 'online').toUpperCase()}
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  Agent: {device.agent_name || 'Unassigned'}
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  Location:{' '}
                  {[device.area_name, device.station_name].filter(Boolean).join(' • ') ||
                    'Unassigned'}
                </div>
                {device.jackpot_selected && (
                  <div className="mt-1 text-xs font-semibold text-amber-200">
                    JACKPOT TARGET {formatJackpotCurrency(device.jackpot_target_amount)} • Remaining{' '}
                    {formatJackpotCurrency(device.jackpot_remaining_amount)}
                  </div>
                )}
                {jackpotStatusLabel && (
                  <div className="mt-1 text-xs text-amber-300">{jackpotStatusLabel}</div>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  {hopperLow && (
                    <span className="px-2 py-0.5 text-[10px] font-bold rounded border border-red-500 bg-red-950 text-red-300">
                      LOW HOPPER
                    </span>
                  )}

                  {highRtp && (
                    <span className="px-2 py-0.5 text-[10px] font-bold rounded border border-fuchsia-500 bg-fuchsia-950 text-fuchsia-300">
                      HIGH RTP
                    </span>
                  )}

                  {stuckSession && (
                    <span className="px-2 py-0.5 text-[10px] font-bold rounded border border-yellow-500 bg-yellow-950 text-yellow-300">
                      STUCK SESSION
                    </span>
                  )}

                  {offline && (
                    <span className="px-2 py-0.5 text-[10px] font-bold rounded border border-slate-500 bg-slate-900 text-slate-300">
                      OFFLINE
                    </span>
                  )}
                </div>
              </div>

              <div className="text-base md:text-lg font-mono font-bold text-green-400">
                {formatCurrency(device.balance)}
              </div>
            </div>

            {successMessage && (
              <div className="p-2 mb-3 bg-green-900/30 border border-green-700 text-green-300 text-xs rounded">
                {successMessage}
              </div>
            )}
            {errorMessage && (
              <div className="p-2 mb-3 bg-red-900/40 border border-red-700 text-red-300 text-xs rounded">
                {errorMessage}
              </div>
            )}

            {/* Tabs UI */}
            <div className="mt-3 flex gap-2 border-b border-slate-800">
              {[
                { key: 'overview', label: 'Overview' },
                { key: 'controls', label: 'Controls' },
                { key: 'games', label: 'Games' },
              ].map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key as any)}
                  className={`px-3 py-1.5 text-xs font-semibold border-b-2 ${
                    activeTab === tab.key
                      ? 'border-blue-400 text-blue-300'
                      : 'border-transparent text-slate-400 hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {activeTab === 'overview' && (
              <div className="mt-3 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="rounded border border-green-700/40 bg-green-900/20 p-3 mt-5">
                    <div className="text-[10px] text-green-300/80">Balance</div>
                    <div className="text-lg font-mono font-bold text-green-400">
                      {formatCurrency(device.balance)}
                    </div>

                    <div className="mt-2 text-[10px] text-amber-300/80">Hopper</div>
                    <div
                      className={`text-lg font-mono font-bold ${hopperLow ? 'text-red-300 animate-pulse' : 'text-amber-300'}`}
                    >
                      {formatCurrency(device.hopper_balance)}
                    </div>
                  </div>

                  <div className="rounded border border-slate-700 bg-slate-800 p-4 mt-5 flex flex-col justify-between">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className="text-[10px] text-slate-400">Total Bet</div>
                        <div className="text-base font-mono font-bold text-violet-400">
                          {formatCurrency(device.bet_total)}
                        </div>
                      </div>

                      <div>
                        <div className="text-[10px] text-slate-400">Total Win</div>
                        <div className="text-base font-mono font-bold text-red-400">
                          {formatCurrency(device.win_total)}
                        </div>
                      </div>

                      <div>
                        <div className="text-[10px] text-slate-400">Coins In</div>
                        <div className="text-base font-mono font-bold text-sky-400">
                          {formatCurrency(device.coins_in_total)}
                        </div>
                      </div>

                      <div>
                        <div className="text-[10px] text-slate-400">Last Bet</div>
                        <div className="text-base font-mono font-bold text-violet-300">
                          {formatCurrency(device.last_bet_amount)}
                        </div>
                      </div>

                      <div>
                        <div className="text-[10px] text-slate-400">RTP</div>
                        <div className="text-base font-mono font-bold text-fuchsia-400">
                          {deviceRtp.toFixed(2)}%
                        </div>
                      </div>

                      <div>
                        <div className="text-[10px] text-slate-400">House Win</div>
                        <div className="text-base font-mono font-bold text-orange-400">
                          {formatCurrency(deviceHouseWin)}
                        </div>
                      </div>

                      <div>
                        <div className="text-[10px] text-slate-400">Spins</div>
                        <div className="text-base font-mono font-bold text-emerald-400">
                          {asNumber(device.spins_total).toLocaleString()}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-700 text-xs text-slate-400">
                      {telemetryLabel}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col flex-1 overflow-hidden">
            {/* Controls Tab */}
            {activeTab === 'controls' && (
              <>
                <div className="px-4 overflow-y-auto">
                  <h4 className="text-sm font-semibold mb-2">Cabinet Name</h4>
                  <div className="rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 mb-4">
                    <div className="text-xs text-slate-400 mb-3">
                      Set a human-friendly name for this device. This shows in the dashboard list.
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input
                        type="text"
                        value={deviceName}
                        onChange={e => setDeviceName(e.target.value)}
                        placeholder="Cabinet name"
                        className="flex-1 rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 text-slate-900 dark:text-slate-100"
                      />
                      <button
                        type="button"
                        className="rounded border border-blue-600/80 bg-blue-900/30 px-3 py-2 text-xs font-semibold text-blue-200 hover:bg-blue-800/40 disabled:opacity-50"
                        disabled={nameBusy || overrideBusy || powerActionBusy !== null}
                        onClick={() => void saveDeviceName()}
                      >
                        {nameBusy ? 'Saving Name...' : 'Save Name'}
                      </button>
                    </div>
                  </div>

                  <h4 className="text-sm font-semibold mb-2">Deployment Mode</h4>
                  <div className="rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 mb-4">
                    <div className="text-xs text-slate-400 mb-3">
                      Maintenance devices stay visible in the dashboard but are excluded from global production totals.
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <select
                        value={deploymentMode}
                        onChange={e =>
                          setDeploymentMode(
                            e.target.value === 'maintenance' ? 'maintenance' : 'online',
                          )
                        }
                        className="flex-1 rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
                      >
                        <option value="online">Online</option>
                        <option value="maintenance">Maintenance</option>
                      </select>
                      <button
                        type="button"
                        className="rounded border border-violet-600/80 bg-violet-900/30 px-3 py-2 text-xs font-semibold text-violet-200 hover:bg-violet-800/40 disabled:opacity-50"
                        disabled={deploymentBusy || overrideBusy || powerActionBusy !== null}
                        onClick={() => void saveDeploymentMode()}
                      >
                        {deploymentBusy ? 'Saving Mode...' : 'Save Mode'}
                      </button>
                    </div>
                  </div>

                  <h4 className="text-sm font-semibold mb-2">Cabinet Assignment</h4>
                  <div className="rounded border border-slate-700 bg-white dark:bg-slate-900/40 p-3 mb-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                      <select
                        value={selectedAgentId ?? ''}
                        onChange={e => handleAgentChange(e.target.value)}
                        className="border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white rounded"
                      >
                        <option value="">Select Agent</option>
                        {agents.map(a => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>

                      <select
                        value={selectedAreaId ?? ''}
                        onChange={e => setSelectedAreaId(e.target.value || null)}
                        disabled={!selectedAgentId}
                        className="border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white rounded"
                      >
                        <option value="">Select Area</option>
                        {filteredAreas.map(a => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>

                      <button
                        onClick={saveAssignment}
                        disabled={assignmentSaving}
                        className="px-2 py-1 bg-blue-600 text-white text-xs rounded"
                      >
                        {assignmentSaving ? 'Saving...' : 'Save'}
                      </button>
                    </div>
                  </div>

                  <h4 className="text-sm font-semibold mb-2">Device Power Controls</h4>
                  <div className="rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 mb-4">
                    <div className="text-xs text-slate-400 mb-3">
                      Sends command to this device only.
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="rounded border border-sky-600/80 bg-sky-900/30 px-3 py-1.5 text-xs font-semibold text-sky-200 hover:bg-sky-800/40 disabled:opacity-50"
                        disabled={powerActionBusy !== null || overrideBusy}
                        onClick={() => void enqueuePowerCommand('reset')}
                      >
                        {powerActionBusy === 'reset' ? 'Queueing Reset...' : 'Reset Device'}
                      </button>
                      <button
                        type="button"
                        className="rounded border border-amber-600/80 bg-amber-900/30 px-3 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-800/40 disabled:opacity-50"
                        disabled={powerActionBusy !== null || overrideBusy}
                        onClick={() => void enqueuePowerCommand('restart')}
                      >
                        {powerActionBusy === 'restart' ? 'Queueing Restart...' : 'Restart Device'}
                      </button>
                      <button
                        type="button"
                        className="rounded border border-red-600/80 bg-red-900/30 px-3 py-1.5 text-xs font-semibold text-red-200 hover:bg-red-800/40 disabled:opacity-50"
                        disabled={powerActionBusy !== null || overrideBusy}
                        onClick={() => void enqueuePowerCommand('shutdown')}
                      >
                        {powerActionBusy === 'shutdown'
                          ? 'Queueing Shutdown...'
                          : 'Shutdown Device'}
                      </button>
                    </div>
                  </div>

                  <h4 className="text-sm font-semibold mb-2">Manual Overrides (Demo)</h4>
                  <div className="grid md:grid-cols-2 grid-cols-1 gap-3 mb-4">
                    <div className="rounded border border-slate-700 bg-slate-950/70 bg-white dark:bg-slate-900 p-3">
                      <div className="text-xs text-slate-400 mb-2">
                        Accounting Balance Ledger Entry
                      </div>
                      <div className="grid grid-cols-3 gap-2 mb-2">
                        <select
                          className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
                          value={balanceKind}
                          onChange={e => setBalanceKind(e.target.value as 'debit' | 'credit')}
                        >
                          <option value="credit">Credit</option>
                          <option value="debit">Debit</option>
                        </select>
                        <input
                          className="col-span-2 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
                          type="number"
                          min={0}
                          step={1}
                          value={balanceAmount}
                          onChange={e => setBalanceAmount(e.target.value)}
                          placeholder="Amount"
                        />
                      </div>
                      <input
                        className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs mb-2"
                        value={balanceAccountName}
                        onChange={e => setBalanceAccountName(e.target.value)}
                        placeholder="Account name"
                      />
                      <input
                        className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs mb-2"
                        value={balanceNotes}
                        onChange={e => setBalanceNotes(e.target.value)}
                        placeholder="Notes"
                      />
                      <button
                        onClick={() => {
                          void postOverrideEntry({
                            target: 'accounting_balance',
                            entryKind: balanceKind,
                            amountText: balanceAmount,
                            accountName: balanceAccountName,
                            notes: balanceNotes,
                          })
                        }}
                        disabled={overrideBusy}
                        className="w-full px-3 py-1 rounded text-xs bg-blue-700/30 border border-blue-600 text-blue-300 disabled:opacity-50"
                      >
                        Post Entry
                      </button>
                    </div>

                    <div className="rounded border border-slate-700 bg-slate-950/70 bg-white dark:bg-slate-900 p-3">
                      <div className="text-xs text-slate-400 mb-2">Hopper Balance Ledger Entry</div>
                      <div className="grid grid-cols-3 gap-2 mb-2">
                        <select
                          className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
                          value={hopperKind}
                          onChange={e => setHopperKind(e.target.value as 'debit' | 'credit')}
                        >
                          <option value="credit">Credit</option>
                          <option value="debit">Debit</option>
                        </select>
                        <input
                          className="col-span-2 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
                          type="number"
                          min={0}
                          step={1}
                          value={hopperAmount}
                          onChange={e => setHopperAmount(e.target.value)}
                          placeholder="Amount"
                        />
                      </div>
                      <input
                        className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs mb-2"
                        value={hopperAccountName}
                        onChange={e => setHopperAccountName(e.target.value)}
                        placeholder="Account name"
                      />
                      <input
                        className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs mb-2"
                        value={hopperNotes}
                        onChange={e => setHopperNotes(e.target.value)}
                        placeholder="Notes"
                      />
                      <button
                        onClick={() => {
                          void postOverrideEntry({
                            target: 'hopper_balance',
                            entryKind: hopperKind,
                            amountText: hopperAmount,
                            accountName: hopperAccountName,
                            notes: hopperNotes,
                          })
                        }}
                        disabled={overrideBusy}
                        className="w-full px-3 py-1 rounded text-xs bg-amber-700/30 border border-amber-600 text-amber-300 disabled:opacity-50"
                      >
                        Post Entry
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* Games Tab */}
            {activeTab === 'games' && (
              <>
                <div className="overflow-y-auto  px-4 pb-6">
                  <div className="grid md:grid-cols-4 grid-cols-2 gap-4">
                    {cabinetGames.map(g => (
                      <div
                        key={g.id}
                        className="flex flex-col gap-2 justify-between items-center border border-slate-800 rounded p-3"
                      >
                        <div className="flex flex-col items-center text-center">
                          <div className="text-sm font-medium">{g.name}</div>
                          <div className="text-[10px] text-slate-600">{g.type}</div>
                        </div>

                        <button
                          onClick={async () => {
                            const nextInstalled = !g.installed
                            const result = await toggleCabinetGame(
                              device.device_id,
                              g.id,
                              nextInstalled,
                            )

                            if (!result.ok) {
                              setErrorMessage(result?.error?.message ?? null)
                            } else {
                              if (!nextInstalled) {
                                const removeResult = await removeGamePackage(
                                  g.id,
                                  Number(g.version ?? 1),
                                  true,
                                )
                                if (!removeResult.ok) {
                                  setErrorMessage(
                                    `Disabled but remove failed: ${removeResult.error?.message ?? 'unknown error'}`,
                                  )
                                  return
                                }
                              } else if (g.package_url) {
                                const prepareResult = await prepareGamePackage(
                                  g.id,
                                  g.package_url,
                                  Number(g.version ?? 1),
                                )
                                if (!prepareResult.ok) {
                                  setErrorMessage(
                                    `Enabled but prefetch failed: ${prepareResult.error?.message ?? 'unknown error'}`,
                                  )
                                  return
                                }
                              }
                              setErrorMessage(null)
                            }
                          }}
                          className={`px-3 py-1 text-xs rounded ${
                            g.installed
                              ? 'bg-green-600/20 text-green-400'
                              : 'bg-red-600/20 text-red-300'
                          }`}
                        >
                          {g.installed ? 'Enabled' : 'Disabled'}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
