import { useMemo, useState } from 'react'
import { useAccounting } from '../hooks/useAccounting'

function toYmd(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function manilaNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' }))
}

type Preset = 'today' | 'yesterday' | 'week' | 'month' | 'custom'

export default function Accounting() {
  const now = manilaNow()
  const [preset, setPreset] = useState<Preset>('today')
  const [dateFrom, setDateFrom] = useState(toYmd(now))
  const [dateTo, setDateTo] = useState(toYmd(now))

  const { loading, error, deviceRows, summary, byDate } = useAccounting(dateFrom, dateTo)

  const asNumber = (v: number | string | null | undefined) => Number(v ?? 0)
  const formatCurrency = (v: number | string | null | undefined) =>
    `₱${asNumber(v).toLocaleString()}`
  const formatPercent = (v: number) => `${v.toFixed(2)}%`

  const applyPreset = (nextPreset: Preset) => {
    const base = manilaNow()
    const from = new Date(base)
    const to = new Date(base)

    if (nextPreset === 'today') {
      setDateFrom(toYmd(base))
      setDateTo(toYmd(base))
    } else if (nextPreset === 'yesterday') {
      from.setDate(base.getDate() - 1)
      setDateFrom(toYmd(from))
      setDateTo(toYmd(from))
    } else if (nextPreset === 'week') {
      from.setDate(base.getDate() - 6)
      setDateFrom(toYmd(from))
      setDateTo(toYmd(base))
    } else if (nextPreset === 'month') {
      from.setDate(1)
      setDateFrom(toYmd(from))
      setDateTo(toYmd(to))
    }

    setPreset(nextPreset)
  }

  const byDevice = useMemo(() => deviceRows, [deviceRows])
  const rtp = summary.bet > 0 ? (summary.win / summary.bet) * 100 : 0
  const houseEdge = summary.bet > 0 ? (summary.houseTake / summary.bet) * 100 : 0
  const netIncomeTextClass = summary.netIncome >= 0 ? 'text-emerald-400' : 'text-red-400'
  const grossIncomeTextClass = summary.grossIncome >= 0 ? 'text-emerald-400' : 'text-red-400'

  return (
    <div className="p-6 max-w-[96rem] mx-auto space-y-8 bg-slate-900 text-slate-100">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Accounting</h1>
        <p className="text-slate-400 text-sm">Default range is today in Asia/Manila.</p>
      </header>

      <section className="rounded-lg border border-slate-700 bg-slate-800 p-4 space-y-4">
        <div className="flex flex-wrap gap-2">
          <button
            className={`rounded px-3 py-2 text-sm ${preset === 'today' ? 'bg-emerald-500 text-slate-950' : 'bg-slate-700 text-slate-100'}`}
            onClick={() => applyPreset('today')}
          >
            Today
          </button>
          <button
            className={`rounded px-3 py-2 text-sm ${preset === 'yesterday' ? 'bg-emerald-500 text-slate-950' : 'bg-slate-700 text-slate-100'}`}
            onClick={() => applyPreset('yesterday')}
          >
            Yesterday
          </button>
          <button
            className={`rounded px-3 py-2 text-sm ${preset === 'week' ? 'bg-emerald-500 text-slate-950' : 'bg-slate-700 text-slate-100'}`}
            onClick={() => applyPreset('week')}
          >
            This Week
          </button>
          <button
            className={`rounded px-3 py-2 text-sm ${preset === 'month' ? 'bg-emerald-500 text-slate-950' : 'bg-slate-700 text-slate-100'}`}
            onClick={() => applyPreset('month')}
          >
            This Month
          </button>
          <button
            className={`rounded px-3 py-2 text-sm ${preset === 'custom' ? 'bg-emerald-500 text-slate-950' : 'bg-slate-700 text-slate-100'}`}
            onClick={() => setPreset('custom')}
          >
            Custom
          </button>
        </div>

        <div className="flex flex-wrap gap-4 items-end">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-300">From</span>
            <input
              type="date"
              className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-slate-100"
              value={dateFrom}
              onChange={e => {
                setPreset('custom')
                setDateFrom(e.target.value)
              }}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-300">To</span>
            <input
              type="date"
              className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-slate-100"
              value={dateTo}
              onChange={e => {
                setPreset('custom')
                setDateTo(e.target.value)
              }}
            />
          </label>

          {loading && <div className="text-sm text-slate-400">Loading…</div>}
          {error && <div className="text-sm text-red-300">{error}</div>}
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="rounded-lg border border-cyan-700/40 bg-slate-800 p-4">
          <div className="text-xs text-cyan-300/80 mb-1">Balance</div>
          <div className="text-2xl font-bold font-mono text-cyan-400">
            {formatCurrency(summary.balance)}
          </div>
        </div>
        <div className="rounded-lg border border-violet-700/40 bg-slate-800 p-4">
          <div className="text-xs text-violet-300/80 mb-1">Coins In / Out</div>
          <div className="text-base font-bold font-mono text-violet-400">
            {formatCurrency(summary.coinsIn)} / {formatCurrency(summary.coinsOut)}
          </div>
        </div>
        <div className="rounded-lg border border-orange-700/40 bg-slate-800 p-4">
          <div className="text-xs text-orange-300/80 mb-1">Bet / Win</div>
          <div className="text-base font-bold font-mono text-orange-400">
            {formatCurrency(summary.bet)} / {formatCurrency(summary.win)}
          </div>
        </div>
        <div className="rounded-lg border border-fuchsia-700/40 bg-slate-800 p-4">
          <div className="text-xs text-fuchsia-300/80 mb-1">House Take</div>
          <div className="text-2xl font-bold font-mono text-fuchsia-400">
            {formatCurrency(summary.houseTake)}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
          <div className="text-xs text-slate-400 mb-1">Withdraw</div>
          <div className="text-xl font-mono">{formatCurrency(summary.withdraw)}</div>
        </div>
        <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
          <div className="text-xs text-slate-400 mb-1">Hopper In / Out</div>
          <div className="text-xl font-mono">
            {formatCurrency(summary.hopperIn)} / {formatCurrency(summary.hopperOut)}
          </div>
        </div>
        <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
          <div className="text-xs text-slate-400 mb-1">Jackpot Override</div>
          <div className="text-xl font-mono text-amber-300">
            {formatCurrency(summary.jackpotOverride)}
          </div>
        </div>
        <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
          <div className="text-xs text-slate-400 mb-1">RTP / House Edge</div>
          <div className="text-xl font-mono">
            {formatPercent(rtp)} / {formatPercent(houseEdge)}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="rounded-lg border border-emerald-700/40 bg-slate-800 p-4">
          <div className="text-xs text-slate-400 mb-1">Net Income</div>
          <div className={`text-2xl font-mono font-bold ${netIncomeTextClass}`}>
            {formatCurrency(summary.netIncome)}
          </div>
        </div>
        <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
          <div className="text-xs text-slate-400 mb-1">Gross</div>
          <div className={`text-2xl font-mono font-bold ${grossIncomeTextClass}`}>
            {formatCurrency(summary.grossIncome)}
          </div>
        </div>
        <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
          <div className="text-xs text-slate-400 mb-1">Active Devices In Range</div>
          <div className="text-xl font-mono">{byDevice.length.toLocaleString()}</div>
        </div>
        <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
          <div className="text-xs text-slate-400 mb-1">Event Spins</div>
          <div className="text-xl font-mono">{asNumber(summary.spins).toLocaleString()}</div>
        </div>
      </section>

      <section className="rounded-lg border border-slate-700 bg-slate-800 p-4">
        <div className="text-xs text-slate-400 mb-2">Net Income Formula</div>
        <div className="text-sm font-mono text-slate-200">
          Net Income = (Balance + House Take + Withdrawal + Jackpot Override)-(Coins In + Coins Out)
        </div>
      </section>

      <section className="rounded-lg border border-slate-700 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-700 text-sm font-semibold">
          Daily Rollups
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-800 text-slate-300">
              <tr>
                <th className="px-4 py-2 text-left">Date</th>
                <th className="px-4 py-2 text-right">Devices</th>
                <th className="px-4 py-2 text-right">Coins In</th>
                <th className="px-4 py-2 text-right">Bet</th>
                <th className="px-4 py-2 text-right">Win</th>
                <th className="px-4 py-2 text-right">Coins Out</th>

                <th className="px-4 py-2 text-right">Balance</th>

                <th className="px-4 py-2 text-right">House Take</th>
                <th className="px-4 py-2 text-right">Jackpot Override</th>
                <th className="px-4 py-2 text-right">RTP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {byDate.map(([date, row]) => (
                <tr key={date}>
                  <td className="px-4 py-2">{date}</td>
                  <td className="px-4 py-2 text-right font-mono text-slate-300">
                    {asNumber(row.total_devices).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-violet-400">
                    {formatCurrency(row.total_coins_in)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-amber-400">
                    {formatCurrency(row.total_bet)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-rose-400">
                    {formatCurrency(row.total_win)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-sky-400">
                    {formatCurrency(row.total_coins_out)}
                  </td>

                  <td className="px-4 py-2 text-right font-mono text-cyan-400">
                    {formatCurrency(row.total_balance_change)}
                  </td>

                  <td className="px-4 py-2 text-right font-mono text-fuchsia-400">
                    {formatCurrency(row.total_house_take)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-amber-300">
                    {formatCurrency(row.total_jackpot_override)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-emerald-400">
                    {formatPercent(Number(row.rtp_percent ?? 0))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-slate-700 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-700 text-sm font-semibold">By Device</div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-800 text-slate-300">
              <tr>
                <th className="px-4 py-2 text-left">Device</th>
                <th className="px-4 py-2 text-right">Balance Δ</th>
                <th className="px-4 py-2 text-right">Coins In</th>
                <th className="px-4 py-2 text-right">Coins Out</th>
                <th className="px-4 py-2 text-right">House Take</th>
                <th className="px-4 py-2 text-right">Jackpot Override</th>
                <th className="px-4 py-2 text-right">Net Income</th>
                <th className="px-4 py-2 text-right">Gross</th>
                <th className="px-4 py-2 text-right">RTP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {byDevice.map(row => (
                <tr key={row.device_id}>
                  <td className="px-4 py-2">
                    <div>{row.device_name || row.device_id}</div>
                    <div className="text-xs text-slate-500">{row.device_id}</div>
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-cyan-400">
                    {formatCurrency(row.balance)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-violet-400">
                    {formatCurrency(row.coins_in_total)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-sky-400">
                    {formatCurrency(row.coins_out_total)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-fuchsia-400">
                    {formatCurrency(row.house_take_total)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-amber-300">
                    {formatCurrency(row.jackpot_override_total)}
                  </td>
                  <td
                    className={`px-4 py-2 text-right font-mono ${
                      row.net_income >= 0 ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {formatCurrency(row.net_income)}
                  </td>
                  <td
                    className={`px-4 py-2 text-right font-mono ${
                      row.gross_income >= 0 ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {formatCurrency(row.gross_income)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-emerald-400">
                    {formatPercent(Number(row.rtp_percent ?? 0))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-slate-700 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-700 text-sm font-semibold">
          Detailed Device Metrics
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-800 text-slate-300">
              <tr>
                <th className="px-4 py-2 text-left">Device</th>
                <th className="px-4 py-2 text-right">Bet</th>
                <th className="px-4 py-2 text-right">Win</th>
                <th className="px-4 py-2 text-right">Hopper In</th>
                <th className="px-4 py-2 text-right">Hopper Out</th>
                <th className="px-4 py-2 text-right">Spins</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {byDevice.map(row => (
                <tr key={`${row.device_id}-detail`}>
                  <td className="px-4 py-2">
                    <div>{row.device_name || row.device_id}</div>
                    <div className="text-xs text-slate-500">{row.device_id}</div>
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-amber-400">
                    {formatCurrency(row.bet_total)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-rose-400">
                    {formatCurrency(row.win_total)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-slate-300">
                    {formatCurrency(row.hopper_in_total)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-slate-300">
                    {formatCurrency(row.hopper_out_total)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-cyan-300">
                    {asNumber(row.spins_total).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
