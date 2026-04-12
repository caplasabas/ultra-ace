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

function startOfWeek(date: Date) {
  const next = new Date(date)
  const day = next.getDay()
  const diff = day === 0 ? -6 : 1 - day
  next.setDate(next.getDate() + diff)
  return next
}

type Preset = 'today' | 'week' | 'month' | 'custom'

export default function Accounting() {
  const now = manilaNow()
  const [preset, setPreset] = useState<Preset>('today')
  const [dateFrom, setDateFrom] = useState(toYmd(now))
  const [dateTo, setDateTo] = useState(toYmd(now))

  const { loading, deviceRows, summary, byDate } = useAccounting(dateFrom, dateTo)

  const asNumber = (v: number | string | null | undefined) => Number(v ?? 0)
  const formatCurrency = (v: number | string | null | undefined) =>
    `₱${asNumber(v).toLocaleString()}`
  const formatPercent = (v: number) => `${v.toFixed(2)}%`

  const applyPreset = (nextPreset: Preset) => {
    const base = manilaNow()
    const from = new Date(base)
    const to = new Date(base)

    if (nextPreset === 'week') {
      const weekStart = startOfWeek(base)
      setDateFrom(toYmd(weekStart))
      setDateTo(toYmd(base))
    } else if (nextPreset === 'month') {
      from.setDate(1)
      setDateFrom(toYmd(from))
      setDateTo(toYmd(to))
    } else if (nextPreset === 'today') {
      setDateFrom(toYmd(base))
      setDateTo(toYmd(base))
    }

    setPreset(nextPreset)
  }

  const byDevice = useMemo(() => {
    const map = new Map<string, (typeof deviceRows)[number]>()

    for (const row of deviceRows) {
      const key = row.device_id
      const current = map.get(key) ?? {
        ...row,
        balance: 0,
        coins_in_total: 0,
        hopper_in_total: 0,
        hopper_out_total: 0,
        hopper_balance: 0,
        bet_total: 0,
        win_total: 0,
        withdraw_total: 0,
        spins_total: 0,
        house_take_total: 0,
        arcade_total: 0,
        arcade_credit: 0,
        arcade_time_ms: 0,
        transferred_balance_to_house_take: 0,
        house_take_after_close: 0,
      }

      current.balance += Number(row.balance ?? 0)
      current.coins_in_total += Number(row.coins_in_total ?? 0)
      current.hopper_in_total += Number(row.hopper_in_total ?? 0)
      current.hopper_out_total += Number(row.hopper_out_total ?? 0)
      current.hopper_balance += Number(row.hopper_balance ?? 0)
      current.bet_total += Number(row.bet_total ?? 0)
      current.win_total += Number(row.win_total ?? 0)
      current.withdraw_total += Number(row.withdraw_total ?? 0)
      current.spins_total += Number(row.spins_total ?? 0)
      current.house_take_total += Number(row.house_take_total ?? 0)
      current.arcade_total += Number(row.arcade_total ?? 0)
      current.arcade_credit += Number(row.arcade_credit ?? 0)
      current.arcade_time_ms += Number(row.arcade_time_ms ?? 0)
      current.transferred_balance_to_house_take += Number(row.transferred_balance_to_house_take ?? 0)
      current.house_take_after_close += Number(row.house_take_after_close ?? 0)
      map.set(key, current)
    }

    return [...map.values()].sort((a, b) => a.device_id.localeCompare(b.device_id))
  }, [deviceRows])

  const rtp = summary.bet > 0 ? (summary.win / summary.bet) * 100 : 0
  const houseEdge = summary.bet > 0 ? (summary.houseTakeAfterClose / summary.bet) * 100 : 0

  return (
    <div className="p-6 max-w-[96rem] mx-auto space-y-8 bg-slate-900 text-slate-100">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Accounting</h1>
        <p className="text-slate-400 text-sm">
          Archived daily closeouts. Default range is today in Asia/Manila.
        </p>
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
          <div className="text-xs text-violet-300/80 mb-1">Coins In</div>
          <div className="text-2xl font-bold font-mono text-violet-400">
            {formatCurrency(summary.coinsIn)}
          </div>
        </div>
        <div className="rounded-lg border border-orange-700/40 bg-slate-800 p-4">
          <div className="text-xs text-orange-300/80 mb-1">Bet / Win</div>
          <div className="text-base font-bold font-mono text-orange-400">
            {formatCurrency(summary.bet)} / {formatCurrency(summary.win)}
          </div>
        </div>
        <div className="rounded-lg border border-fuchsia-700/40 bg-slate-800 p-4">
          <div className="text-xs text-fuchsia-300/80 mb-1">House Take After Close</div>
          <div className="text-2xl font-bold font-mono text-fuchsia-400">
            {formatCurrency(summary.houseTakeAfterClose)}
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
          <div className="text-xs text-slate-400 mb-1">RTP / House Edge</div>
          <div className="text-xl font-mono">
            {formatPercent(rtp)} / {formatPercent(houseEdge)}
          </div>
        </div>
        <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
          <div className="text-xs text-slate-400 mb-1">Transferred To House</div>
          <div className="text-sm font-mono space-y-1">
            <div>Devices: {formatCurrency(summary.transferredDeviceBalance)}</div>
            <div>Happy: {formatCurrency(summary.transferredHappyPool)}</div>
            <div>Jackpot: {formatCurrency(summary.transferredJackpotPool)}</div>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-slate-700 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-700 text-sm font-semibold">
          Daily Closeouts
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-800 text-slate-300">
              <tr>
                <th className="px-4 py-2 text-left">Date</th>
                <th className="px-4 py-2 text-right">Balance</th>
                <th className="px-4 py-2 text-right">Coins In</th>
                <th className="px-4 py-2 text-right">Bet</th>
                <th className="px-4 py-2 text-right">Win</th>
                <th className="px-4 py-2 text-right">Withdraw</th>
                <th className="px-4 py-2 text-right">House Take</th>
                <th className="px-4 py-2 text-right">RTP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {byDate.map(([date, row]) => (
                <tr key={date}>
                  <td className="px-4 py-2">{date}</td>
                  <td className="px-4 py-2 text-right font-mono text-cyan-400">
                    {formatCurrency(row.total_balance)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-violet-400">
                    {formatCurrency(row.total_coins_in)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-amber-400">
                    {formatCurrency(row.total_bet)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-red-400">
                    {formatCurrency(row.total_win)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-sky-400">
                    {formatCurrency(row.total_withdraw)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-fuchsia-400">
                    {formatCurrency(row.house_take_after_close)}
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
                <th className="px-4 py-2 text-right">Balance</th>
                <th className="px-4 py-2 text-right">Coins In</th>
                <th className="px-4 py-2 text-right">Bet</th>
                <th className="px-4 py-2 text-right">Win</th>
                <th className="px-4 py-2 text-right">Withdraw</th>
                <th className="px-4 py-2 text-right">House Take</th>
                <th className="px-4 py-2 text-right">Arcade</th>
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
                  <td className="px-4 py-2 text-right font-mono text-amber-400">
                    {formatCurrency(row.bet_total)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-red-400">
                    {formatCurrency(row.win_total)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-sky-400">
                    {formatCurrency(row.withdraw_total)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-fuchsia-400">
                    {formatCurrency(row.house_take_after_close)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-emerald-400">
                    {formatCurrency(row.arcade_total)}
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
