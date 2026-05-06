import { Fragment, useState } from 'react'
import { useAccounting, type AccountingClosingRow } from '../hooks/useAccounting'

function toYmd(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function manilaNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' }))
}

function asNumber(v: number | string | null | undefined) {
  const next = Number(v ?? 0)
  return Number.isFinite(next) ? next : 0
}

function formatCurrency(v: number | string | null | undefined) {
  return `₱${asNumber(v).toLocaleString()}`
}

function formatPercent(v: number | string | null | undefined) {
  return `${asNumber(v).toFixed(2)}%`
}

function formatCloseTime(value: string) {
  return new Date(value).toLocaleString('en-PH', {
    timeZone: 'Asia/Manila',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function incomeTextClass(value: number | string | null | undefined) {
  const amount = asNumber(value)
  if (amount < 0) return 'text-red-400'
  if (amount > 0) return 'text-emerald-400'
  return 'text-slate-300'
}

function ClosingDetailRows({
  closings,
  colSpan,
  showDevice,
}: {
  closings: AccountingClosingRow[]
  colSpan: number
  showDevice: boolean
}) {
  return (
    <tr>
      <td className="bg-slate-950/40 px-4 py-3" colSpan={colSpan}>
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="text-slate-400">
              <tr>
                <th className="px-3 py-2 text-left">Closed At</th>
                {showDevice && <th className="px-3 py-2 text-left">Device</th>}
                <th className="px-3 py-2 text-right">Coins In</th>
                <th className="px-3 py-2 text-right">Withdrawal</th>
                <th className="px-3 py-2 text-right">Income</th>
                <th className="px-3 py-2 text-right">Bet</th>
                <th className="px-3 py-2 text-right">Win</th>
                <th className="px-3 py-2 text-right">House Take</th>
                <th className="px-3 py-2 text-right">Jackpot</th>
                <th className="px-3 py-2 text-right">Spins</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {closings.map(closing => (
                <tr key={closing.id}>
                  <td className="px-3 py-2 text-slate-200">{formatCloseTime(closing.closed_at)}</td>
                  {showDevice && (
                    <td className="px-3 py-2">
                      <div className="text-slate-100">{closing.device_name || closing.device_id}</div>
                      <div className="text-[11px] text-slate-500">{closing.device_id}</div>
                    </td>
                  )}
                  <td className="px-3 py-2 text-right font-mono text-sky-300">
                    {formatCurrency(closing.coins_in)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-rose-300">
                    {formatCurrency(closing.withdrawal)}
                  </td>
                  <td className={`px-3 py-2 text-right font-mono ${incomeTextClass(closing.income)}`}>
                    {formatCurrency(closing.income)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-amber-400">
                    {formatCurrency(closing.bet)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-red-300">
                    {formatCurrency(closing.win)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-fuchsia-400">
                    {formatCurrency(closing.house_take)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-amber-300">
                    {formatCurrency(closing.jackpot)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-cyan-300">
                    {asNumber(closing.spins).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </td>
    </tr>
  )
}

type Preset = 'today' | 'yesterday' | 'week' | 'month' | 'custom'

export default function Accounting() {
  const now = manilaNow()
  const [preset, setPreset] = useState<Preset>('today')
  const [dateFrom, setDateFrom] = useState(toYmd(now))
  const [dateTo, setDateTo] = useState(toYmd(now))
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set())
  const [expandedDevices, setExpandedDevices] = useState<Set<string>>(new Set())

  const { loading, error, deviceRows, summary, byDate } = useAccounting(dateFrom, dateTo)

  const rtp = summary.bet > 0 ? (summary.win / summary.bet) * 100 : 0
  const houseEdge = summary.bet > 0 ? (summary.houseTake / summary.bet) * 100 : 0

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

  function toggleDate(date: string) {
    setExpandedDates(current => {
      const next = new Set(current)
      if (next.has(date)) next.delete(date)
      else next.add(date)
      return next
    })
  }

  function toggleDevice(deviceId: string) {
    setExpandedDevices(current => {
      const next = new Set(current)
      if (next.has(deviceId)) next.delete(deviceId)
      else next.add(deviceId)
      return next
    })
  }

  return (
    <div className="p-6 max-w-[96rem] mx-auto space-y-8 bg-slate-900 text-slate-100">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Accounting</h1>
        <p className="text-slate-400 text-sm">
          Snapshot-based closing report. Ranges with no closings show zero.
        </p>
      </header>

      <section className="rounded-lg border border-slate-700 bg-slate-800 p-4 space-y-4">
        <div className="flex flex-wrap gap-2">
          {(['today', 'yesterday', 'week', 'month', 'custom'] as Preset[]).map(nextPreset => (
            <button
              key={nextPreset}
              className={`rounded px-3 py-2 text-sm capitalize ${
                preset === nextPreset ? 'bg-emerald-500 text-slate-950' : 'bg-slate-700 text-slate-100'
              }`}
              onClick={() => {
                if (nextPreset === 'custom') setPreset('custom')
                else applyPreset(nextPreset)
              }}
            >
              {nextPreset === 'week' ? 'This Week' : nextPreset === 'month' ? 'This Month' : nextPreset}
            </button>
          ))}
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

          {loading && <div className="text-sm text-slate-400">Loading...</div>}
          {error && <div className="text-sm text-red-300">{error}</div>}
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="rounded-lg border border-sky-700/40 bg-slate-800 p-4">
          <div className="text-xs text-sky-200/80 mb-1">Coins In</div>
          <div className="text-2xl font-bold font-mono text-sky-300">
            {formatCurrency(summary.coinsIn)}
          </div>
        </div>
        <div className="rounded-lg border border-rose-700/40 bg-slate-800 p-4">
          <div className="text-xs text-rose-200/80 mb-1">Withdrawal</div>
          <div className="text-2xl font-bold font-mono text-rose-300">
            {formatCurrency(summary.withdraw)}
          </div>
        </div>
        <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
          <div className="text-xs text-slate-400 mb-1">Income</div>
          <div className={`text-2xl font-bold font-mono ${incomeTextClass(summary.income)}`}>
            {formatCurrency(summary.income)}
          </div>
        </div>
        <div className="rounded-lg border border-orange-700/40 bg-slate-800 p-4">
          <div className="text-xs text-orange-300/80 mb-1">Bet / Win</div>
          <div className="text-base font-bold font-mono text-orange-400">
            {formatCurrency(summary.bet)} / {formatCurrency(summary.win)}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="rounded-lg border border-fuchsia-700/40 bg-slate-800 p-4">
          <div className="text-xs text-fuchsia-300/80 mb-1">House Take</div>
          <div className="text-2xl font-bold font-mono text-fuchsia-400">
            {formatCurrency(summary.houseTake)}
          </div>
        </div>
        <div className="rounded-lg border border-amber-700/40 bg-slate-800 p-4">
          <div className="text-xs text-amber-300/80 mb-1">Jackpot</div>
          <div className="text-2xl font-bold font-mono text-amber-300">
            {formatCurrency(summary.jackpot)}
          </div>
        </div>
        <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
          <div className="text-xs text-slate-400 mb-1">Closings</div>
          <div className="text-xl font-mono">{summary.closingCount.toLocaleString()}</div>
        </div>
        <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
          <div className="text-xs text-slate-400 mb-1">Devices Closed</div>
          <div className="text-xl font-mono">{summary.totalDevices.toLocaleString()}</div>
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
          <div className="text-xs text-slate-400 mb-1">Spins / RTP</div>
          <div className="text-xl font-mono">
            {asNumber(summary.spins).toLocaleString()} / {formatPercent(rtp)}
          </div>
          <div className="mt-1 text-xs text-slate-500">House Edge {formatPercent(houseEdge)}</div>
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
                <th className="w-10 px-4 py-2 text-left"></th>
                <th className="px-4 py-2 text-left">Date</th>
                <th className="px-4 py-2 text-right">Closings</th>
                <th className="px-4 py-2 text-right">Devices</th>
                <th className="px-4 py-2 text-right">Coins In</th>
                <th className="px-4 py-2 text-right">Withdrawal</th>
                <th className="px-4 py-2 text-right">Income</th>
                <th className="px-4 py-2 text-right">Bet</th>
                <th className="px-4 py-2 text-right">Win</th>
                <th className="px-4 py-2 text-right">House Take</th>
                <th className="px-4 py-2 text-right">Jackpot</th>
                <th className="px-4 py-2 text-right">Spins</th>
                <th className="px-4 py-2 text-right">RTP</th>
                <th className="px-4 py-2 text-right">House Edge</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {byDate.map(([date, row]) => (
                <Fragment key={date}>
                  <tr>
                    <td className="px-4 py-2">
                      <button
                        className="rounded border border-slate-600 px-2 py-1 text-xs"
                        onClick={() => toggleDate(date)}
                      >
                        {expandedDates.has(date) ? '-' : '+'}
                      </button>
                    </td>
                    <td className="px-4 py-2">{date}</td>
                    <td className="px-4 py-2 text-right font-mono text-slate-300">
                      {row.closing_count.toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-slate-300">
                      {row.total_devices.toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-sky-300">
                      {formatCurrency(row.total_coins_in)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-rose-300">
                      {formatCurrency(row.total_withdraw)}
                    </td>
                    <td className={`px-4 py-2 text-right font-mono ${incomeTextClass(row.total_income)}`}>
                      {formatCurrency(row.total_income)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-amber-400">
                      {formatCurrency(row.total_bet)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-red-300">
                      {formatCurrency(row.total_win)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-fuchsia-400">
                      {formatCurrency(row.total_house_take)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-amber-300">
                      {formatCurrency(row.total_jackpot)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-cyan-300">
                      {asNumber(row.total_spins).toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-emerald-400">
                      {formatPercent(row.rtp_percent)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-orange-300">
                      {formatPercent(row.house_edge_percent)}
                    </td>
                  </tr>
                  {expandedDates.has(date) && (
                    <ClosingDetailRows closings={row.closings} colSpan={14} showDevice />
                  )}
                </Fragment>
              ))}

              {!loading && byDate.length === 0 && (
                <tr>
                  <td className="px-4 py-8 text-center text-slate-400" colSpan={14}>
                    No closings in this date range.
                  </td>
                </tr>
              )}
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
                <th className="w-10 px-4 py-2 text-left"></th>
                <th className="px-4 py-2 text-left">Device</th>
                <th className="px-4 py-2 text-right">Closings</th>
                <th className="px-4 py-2 text-right">Coins In</th>
                <th className="px-4 py-2 text-right">Withdrawal</th>
                <th className="px-4 py-2 text-right">Income</th>
                <th className="px-4 py-2 text-right">Bet</th>
                <th className="px-4 py-2 text-right">Win</th>
                <th className="px-4 py-2 text-right">House Take</th>
                <th className="px-4 py-2 text-right">Jackpot</th>
                <th className="px-4 py-2 text-right">Spins</th>
                <th className="px-4 py-2 text-right">RTP</th>
                <th className="px-4 py-2 text-right">House Edge</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {deviceRows.map(row => (
                <Fragment key={row.device_id}>
                  <tr>
                    <td className="px-4 py-2">
                      <button
                        className="rounded border border-slate-600 px-2 py-1 text-xs"
                        onClick={() => toggleDevice(row.device_id)}
                      >
                        {expandedDevices.has(row.device_id) ? '-' : '+'}
                      </button>
                    </td>
                    <td className="px-4 py-2">
                      <div>{row.device_name || row.device_id}</div>
                      <div className="text-xs text-slate-500">{row.device_id}</div>
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-slate-300">
                      {row.closing_count.toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-sky-300">
                      {formatCurrency(row.coins_in_total)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-rose-300">
                      {formatCurrency(row.withdraw_total)}
                    </td>
                    <td className={`px-4 py-2 text-right font-mono ${incomeTextClass(row.income_total)}`}>
                      {formatCurrency(row.income_total)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-amber-400">
                      {formatCurrency(row.bet_total)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-red-300">
                      {formatCurrency(row.win_total)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-fuchsia-400">
                      {formatCurrency(row.house_take_total)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-amber-300">
                      {formatCurrency(row.jackpot_total)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-cyan-300">
                      {asNumber(row.spins_total).toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-emerald-400">
                      {formatPercent(row.rtp_percent)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-orange-300">
                      {formatPercent(row.house_edge_percent)}
                    </td>
                  </tr>
                  {expandedDevices.has(row.device_id) && (
                    <ClosingDetailRows closings={row.closings} colSpan={13} showDevice={false} />
                  )}
                </Fragment>
              ))}

              {!loading && deviceRows.length === 0 && (
                <tr>
                  <td className="px-4 py-8 text-center text-slate-400" colSpan={13}>
                    No device closings in this date range.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
