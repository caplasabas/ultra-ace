import { useEffect, useState } from 'react'
import { useDevices } from '../hooks/useDevices'
import { DeviceModal } from '../components/DeviceModal'
import { useGlobalStats } from '../hooks/useGlobalStats'
import { useCasinoRuntime } from '../hooks/useCasinoRuntime'
import moment from 'moment'

export default function Dashboard() {
  const devices = useDevices()
  const stats = useGlobalStats()
  const { runtime } = useCasinoRuntime()

  const [selectedDevice, setSelectedDevice] = useState<any | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

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
  const globalHouseWin = globalBet - globalWin
  const globalHouseEdge = globalBet > 0 ? (globalHouseWin / globalBet) * 100 : 0
  const hopperAlertThreshold = asNumber(runtime?.hopper_alert_threshold ?? 500)

  return (
    <>
      <div className="p-6 max-w-7xl mx-auto space-y-10">
        <header>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-slate-400 text-sm">Live operational metrics</p>
        </header>

        {errorMessage && (
          <div className="p-3 bg-red-900/40 border border-red-700 text-red-300 text-sm rounded">
            {errorMessage}
          </div>
        )}

        <section>
          <h2 className="text-lg font-semibold mb-3">Global Balances</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <div className="rounded-lg border border-green-700/40 bg-green-900/20 p-4">
              <div className="text-xs text-green-300/80 mb-1">Total Balance</div>
              <div className="text-2xl font-bold font-mono text-green-400">
                {formatCurrency(stats?.total_balance)}
              </div>
            </div>

            <div className="rounded-lg border border-sky-700/40 bg-sky-900/20 p-4">
              <div className="text-xs text-sky-300/80 mb-1">Total Coins-In</div>
              <div className="text-2xl font-bold font-mono text-sky-300">
                {formatCurrency(stats?.total_coins_in)}
              </div>
            </div>

            <div className="rounded-lg border border-amber-700/40 bg-amber-900/20 p-4">
              <div className="text-xs text-amber-300/80 mb-1">Total Hopper</div>
              <div className="text-2xl font-bold font-mono text-amber-300">
                {formatCurrency(stats?.total_hopper)}
              </div>
            </div>

            <div className="rounded-lg border border-violet-700/40 bg-violet-900/20 p-4">
              <div className="text-xs text-violet-300/80 mb-1">Total Bet Amount</div>
              <div className="text-2xl font-bold font-mono text-violet-300">
                {formatCurrency(stats?.total_bet_amount)}
              </div>
            </div>

            <div className="rounded-lg border border-red-700/40 bg-red-900/20 p-4">
              <div className="text-xs text-red-300/80 mb-1">Total Win Amount</div>
              <div className="text-2xl font-bold font-mono text-red-300">
                {formatCurrency(stats?.total_win_amount)}
              </div>
            </div>

            <div className="rounded-lg border border-cyan-700/40 bg-cyan-900/20 p-4">
              <div className="text-xs text-cyan-300/80 mb-1">Total Spins</div>
              <div className="text-2xl font-bold font-mono text-cyan-300">
                {asNumber(stats?.total_spins).toLocaleString()}
              </div>
            </div>

            <div className="rounded-lg border border-fuchsia-700/40 bg-fuchsia-900/20 p-4">
              <div className="text-xs text-fuchsia-300/80 mb-1">Global RTP</div>
              <div className="text-2xl font-bold font-mono text-fuchsia-300">
                {formatPercent(stats?.global_rtp_percent)}
              </div>
            </div>

            <div className="rounded-lg border border-emerald-700/40 bg-emerald-900/20 p-4">
              <div className="text-xs text-emerald-300/80 mb-1">Mode / Prize Pool</div>
              <div className="text-base font-bold text-emerald-300">
                {runtime?.active_mode ?? 'BASE'}
              </div>
              <div className="text-sm text-emerald-200/90 mt-1 font-mono">
                {formatCurrency(runtime?.prize_pool_balance)} / {formatCurrency(runtime?.prize_pool_goal)}
              </div>
            </div>

            <div className="rounded-lg border border-orange-700/40 bg-orange-900/20 p-4">
              <div className="text-xs text-orange-300/80 mb-1">Global House Win</div>
              <div
                className={`text-2xl font-bold font-mono ${
                  globalHouseWin < 0 ? 'text-red-300 animate-pulse' : 'text-orange-300'
                }`}
              >
                {formatCurrency(globalHouseWin)}
              </div>
            </div>

            <div className="rounded-lg border border-rose-700/40 bg-rose-900/20 p-4">
              <div className="text-xs text-rose-300/80 mb-1">Global House Edge</div>
              <div className="text-2xl font-bold font-mono text-rose-300">
                {formatPercent(globalHouseEdge)}
              </div>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-3">Devices</h2>

          <div className="overflow-x-auto rounded-lg border border-slate-800">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-900 text-slate-400">
                <tr>
                  <th className="px-4 py-2 text-left">Device</th>
                  <th className="px-4 py-2 text-right">Balance</th>
                  <th className="px-4 py-2 text-right">Coins-In</th>
                  <th className="px-4 py-2 text-right">Hopper</th>
                  <th className="px-4 py-2 text-right">Bet</th>
                  <th className="px-4 py-2 text-right">Win</th>
                  <th className="px-4 py-2 text-right">House Win</th>
                  <th className="px-4 py-2 text-right">House Edge</th>
                  <th className="px-4 py-2 text-right">Spins</th>
                  <th className="px-4 py-2 text-right">RTP</th>
                  <th className="px-4 py-2 text-right">Last Seen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {devices.map(d => {
                  const deviceRtp =
                    asNumber(d.bet_total) > 0
                      ? (asNumber(d.win_total) / asNumber(d.bet_total)) * 100
                      : 0
                  const deviceHouseWin = asNumber(d.bet_total) - asNumber(d.win_total)
                  const deviceHouseEdge =
                    asNumber(d.bet_total) > 0 ? (deviceHouseWin / asNumber(d.bet_total)) * 100 : 0
                  const hopperLow = asNumber(d.hopper_balance) <= hopperAlertThreshold

                  return (
                    <tr
                      key={d.device_id}
                      className="hover:bg-slate-900/50 cursor-pointer"
                      onClick={() => setSelectedDevice(d)}
                    >
                      <td className="px-4 py-2">{d.device_id ?? 'Unnamed'}</td>
                      <td className="px-4 py-2 text-right font-mono font-bold text-green-400">
                        {formatCurrency(d.balance)}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-sky-300">
                        {formatCurrency(d.coins_in_total)}
                      </td>
                      <td
                        className={`px-4 py-2 text-right font-mono ${
                          hopperLow ? 'text-red-300 animate-pulse' : 'text-amber-300'
                        }`}
                      >
                        {formatCurrency(d.hopper_balance)}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-violet-300">
                        {formatCurrency(d.bet_total)}
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
                      <td className="px-4 py-2 text-right font-mono text-rose-300">
                        {formatPercent(deviceHouseEdge)}
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
