import { useMemo, useState } from 'react'
import { useAccounting } from '../hooks/useAccounting'

function toYmd(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export default function Accounting() {
  const now = new Date()
  const thirtyDaysAgo = new Date(now)
  thirtyDaysAgo.setDate(now.getDate() - 30)

  const [dateFrom, setDateFrom] = useState(toYmd(thirtyDaysAgo))
  const [dateTo, setDateTo] = useState(toYmd(now))

  const { loading, rows, summary, byDate } = useAccounting(dateFrom, dateTo)

  const asNumber = (v: number | string | null | undefined) => Number(v ?? 0)
  const formatCurrency = (v: number | string | null | undefined) => `₱${asNumber(v).toLocaleString()}`
  const formatPercent = (v: number) => `${v.toFixed(2)}%`

  const houseWin = summary.bet - summary.win
  const houseEdge = summary.bet > 0 ? (houseWin / summary.bet) * 100 : 0
  const rtp = summary.bet > 0 ? (summary.win / summary.bet) * 100 : 0

  const byDevice = useMemo(() => {
    const map = new Map<string, typeof summary>()

    for (const row of rows) {
      const key = row.device_id
      const current = map.get(key) ?? {
        coinsIn: 0,
        hopperIn: 0,
        hopperOut: 0,
        bet: 0,
        win: 0,
        withdrawal: 0,
        balanceChange: 0,
        spins: 0,
      }

      current.coinsIn += Number(row.coins_in_amount ?? 0)
      current.hopperIn += Number(row.hopper_in_amount ?? 0)
      current.hopperOut += Number(row.hopper_out_amount ?? 0)
      current.bet += Number(row.bet_amount ?? 0)
      current.win += Number(row.win_amount ?? 0)
      current.withdrawal += Number(row.withdrawal_amount ?? 0)
      current.balanceChange += Number(row.balance_change ?? 0)
      current.spins += Number(row.spins_count ?? 0)

      map.set(key, current)
    }

    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [rows])

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">Accounting</h1>
        <p className="text-slate-400 text-sm">Daily balance sheets with date-range filtering</p>
      </header>

      <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
        <div className="flex flex-wrap gap-4 items-end">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-300">From</span>
            <input
              type="date"
              className="bg-slate-950 border border-slate-700 rounded px-3 py-2"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-300">To</span>
            <input
              type="date"
              className="bg-slate-950 border border-slate-700 rounded px-3 py-2"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
            />
          </label>

          {loading && <div className="text-sm text-slate-400">Loading…</div>}
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="rounded-lg border border-violet-700/40 bg-violet-900/20 p-4">
          <div className="text-xs text-violet-300/80 mb-1">Total Bet</div>
          <div className="text-2xl font-bold font-mono text-violet-300">{formatCurrency(summary.bet)}</div>
        </div>
        <div className="rounded-lg border border-red-700/40 bg-red-900/20 p-4">
          <div className="text-xs text-red-300/80 mb-1">Total Win</div>
          <div className="text-2xl font-bold font-mono text-red-300">{formatCurrency(summary.win)}</div>
        </div>
        <div className="rounded-lg border border-orange-700/40 bg-orange-900/20 p-4">
          <div className="text-xs text-orange-300/80 mb-1">House Win</div>
          <div className={`text-2xl font-bold font-mono ${houseWin < 0 ? 'text-red-300' : 'text-orange-300'}`}>
            {formatCurrency(houseWin)}
          </div>
        </div>
        <div className="rounded-lg border border-fuchsia-700/40 bg-fuchsia-900/20 p-4">
          <div className="text-xs text-fuchsia-300/80 mb-1">RTP / House Edge</div>
          <div className="text-base font-bold font-mono text-fuchsia-300">
            RTP {formatPercent(rtp)} • HE {formatPercent(houseEdge)}
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-slate-800 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800 text-sm font-semibold">Daily Totals</div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-900 text-slate-400">
              <tr>
                <th className="px-4 py-2 text-left">Date</th>
                <th className="px-4 py-2 text-right">Bet</th>
                <th className="px-4 py-2 text-right">Win</th>
                <th className="px-4 py-2 text-right">House Win</th>
                <th className="px-4 py-2 text-right">Spins</th>
                <th className="px-4 py-2 text-right">RTP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {byDate.map(([date, s]) => {
                const dayHouseWin = s.bet - s.win
                const dayRtp = s.bet > 0 ? (s.win / s.bet) * 100 : 0

                return (
                  <tr key={date}>
                    <td className="px-4 py-2">{date}</td>
                    <td className="px-4 py-2 text-right font-mono text-violet-300">{formatCurrency(s.bet)}</td>
                    <td className="px-4 py-2 text-right font-mono text-red-300">{formatCurrency(s.win)}</td>
                    <td className={`px-4 py-2 text-right font-mono ${dayHouseWin < 0 ? 'text-red-300' : 'text-orange-300'}`}>
                      {formatCurrency(dayHouseWin)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-cyan-300">{asNumber(s.spins).toLocaleString()}</td>
                    <td className="px-4 py-2 text-right font-mono text-fuchsia-300">{formatPercent(dayRtp)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-slate-800 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800 text-sm font-semibold">By Device</div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-900 text-slate-400">
              <tr>
                <th className="px-4 py-2 text-left">Device</th>
                <th className="px-4 py-2 text-right">Bet</th>
                <th className="px-4 py-2 text-right">Win</th>
                <th className="px-4 py-2 text-right">House Win</th>
                <th className="px-4 py-2 text-right">Spins</th>
                <th className="px-4 py-2 text-right">RTP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {byDevice.map(([deviceId, s]) => {
                const dHouseWin = s.bet - s.win
                const dRtp = s.bet > 0 ? (s.win / s.bet) * 100 : 0

                return (
                  <tr key={deviceId}>
                    <td className="px-4 py-2">{deviceId}</td>
                    <td className="px-4 py-2 text-right font-mono text-violet-300">{formatCurrency(s.bet)}</td>
                    <td className="px-4 py-2 text-right font-mono text-red-300">{formatCurrency(s.win)}</td>
                    <td className={`px-4 py-2 text-right font-mono ${dHouseWin < 0 ? 'text-red-300' : 'text-orange-300'}`}>
                      {formatCurrency(dHouseWin)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-cyan-300">{asNumber(s.spins).toLocaleString()}</td>
                    <td className="px-4 py-2 text-right font-mono text-fuchsia-300">{formatPercent(dRtp)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
