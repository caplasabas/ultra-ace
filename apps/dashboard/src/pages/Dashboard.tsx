import { useEffect, useMemo, useState } from 'react'
import { useDevices } from '../hooks/useDevices'
import { DeviceModal } from '../components/DeviceModal'
import { useGlobalStats } from '../hooks/useGlobalStats'
import { useCasinoRuntime } from '../hooks/useCasinoRuntime'
import moment from 'moment'
import type { DeviceRow } from '../hooks/useDevices'

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
  const stats = useGlobalStats()
  const { runtime, profiles } = useCasinoRuntime()

  const [selectedDevice, setSelectedDevice] = useState<any | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [sortField, setSortField] = useState<SortField>('updated_at')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')

  useEffect(() => {
    if (!errorMessage) return
    const t = setTimeout(() => setErrorMessage(null), 4000)
    return () => clearTimeout(t)
  }, [errorMessage])

  const asNumber = (v: number | string | null | undefined) => Number(v ?? 0)
  const formatCurrency = (v: number | string | null | undefined) => `₱${asNumber(v).toLocaleString()}`
  const formatPercent = (v: number | string | null | undefined) => `${asNumber(v).toFixed(2)}%`

  const globalBet = asNumber(stats?.total_bet_amount)
  const globalWin = asNumber(stats?.total_win_amount)
  const globalHouseWin = asNumber(stats?.total_house_take ?? (globalBet - globalWin))
  const hopperAlertThreshold = asNumber(runtime?.hopper_alert_threshold ?? 500)
  const activeProfileId =
    runtime?.active_mode === 'HAPPY' ? runtime?.happy_profile_id : runtime?.base_profile_id
  const activeHousePct = profiles.find(p => p.id === activeProfileId)?.house_pct

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
            </div>

            <div className="rounded-lg border border-emerald-700/40 bg-emerald-900/20 p-4">
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
            </div>

            <div className="rounded-lg border border-orange-700/40 bg-orange-900/20 p-4">
              <div className="text-xs text-orange-300/80 mb-1">
                Global House Win ({activeHousePct != null ? `${activeHousePct}%` : '—'})
              </div>
              <div
                className={`text-xl sm:text-2xl font-bold font-mono ${
                  globalHouseWin < 0 ? 'text-red-300 animate-pulse' : 'text-orange-300'
                }`}
              >
                {formatCurrency(globalHouseWin)}
              </div>
            </div>
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

                return (
                  <button
                    key={d.device_id}
                    type="button"
                    className="w-full rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-left"
                    onClick={() => setSelectedDevice(d)}
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
                          <span className="text-slate-500">
                            {d.current_game_name ?? d.current_game_id ?? 'No Game'}
                          </span>
                        </div>
                        {d.is_free_game && (
                          <div className="mt-1 text-[10px] text-fuchsia-300">
                            Free Spins: {asNumber(d.free_spins_left)} left
                          </div>
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

                  return (
                    <tr
                      key={d.device_id}
                      className="hover:bg-slate-900/50 cursor-pointer"
                      onClick={() => setSelectedDevice(d)}
                    >
                      <td className="px-4 py-2">{d.device_id ?? 'Unnamed'}</td>
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
                        <div className="text-slate-200">{d.current_game_name ?? d.current_game_id ?? '—'}</div>
                        <div className="text-slate-500">
                          {d.runtime_mode ?? 'BASE'}
                          {d.is_free_game ? ` • FS ${asNumber(d.free_spins_left)} left` : ''}
                        </div>
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
    </>
  )
}
