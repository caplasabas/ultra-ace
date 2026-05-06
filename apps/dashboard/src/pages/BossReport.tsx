import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

type BossRevenueRow = {
  report_date: string
  coins_in: number | string | null
  withdrawal: number | string | null
  income: number | string | null
}

function manilaDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)

  return {
    year: parts.find(part => part.type === 'year')?.value ?? '1970',
    month: parts.find(part => part.type === 'month')?.value ?? '01',
    day: parts.find(part => part.type === 'day')?.value ?? '01',
  }
}

function toManilaDateInput(date: Date) {
  const { year, month, day } = manilaDateParts(date)
  return `${year}-${month}-${day}`
}

function firstManilaMonthDateInput(date: Date) {
  const { year, month } = manilaDateParts(date)
  return `${year}-${month}-01`
}

function formatDateLabel(value: string) {
  const date = new Date(`${value}T00:00:00`)
  if (!Number.isFinite(date.getTime())) return value
  const today = toManilaDateInput(new Date())
  const label = date.toLocaleDateString('en-PH', {
    timeZone: 'Asia/Manila',
    month: 'short',
    day: '2-digit',
  })
  return value === today ? `${label} (today)` : label
}

function asNumber(value: number | string | null | undefined) {
  return Number(value ?? 0)
}

function formatCurrency(value: number | string | null | undefined) {
  return `₱${asNumber(value).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`
}

function incomeTextClass(value: number | string | null | undefined) {
  const amount = asNumber(value)
  if (amount < 0) return 'text-red-400'
  if (amount > 0) return 'text-emerald-400'
  return 'text-slate-300'
}

export default function BossReport() {
  const today = useMemo(() => new Date(), [])
  const [startDate, setStartDate] = useState(firstManilaMonthDateInput(today))
  const [endDate, setEndDate] = useState(toManilaDateInput(today))
  const [rows, setRows] = useState<BossRevenueRow[]>([])
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  async function loadReport() {
    setLoading(true)
    setErrorMessage(null)

    const { data, error } = await supabase
      .from('boss_revenue_daily')
      .select('report_date,coins_in,withdrawal,income')
      .gte('report_date', startDate)
      .lte('report_date', endDate)
      .order('report_date', { ascending: false })

    setLoading(false)

    if (error) {
      setRows([])
      setErrorMessage(error.message)
      return
    }

    setRows((data ?? []) as BossRevenueRow[])
  }

  useEffect(() => {
    void loadReport()
  }, [startDate, endDate])

  const summary = rows.reduce(
    (acc, row) => {
      acc.coinsIn += asNumber(row.coins_in)
      acc.withdrawal += asNumber(row.withdrawal)
      acc.income += asNumber(row.income)
      return acc
    },
    { coinsIn: 0, withdrawal: 0, income: 0 },
  )

  return (
    <div className="p-6 max-w-[90rem] mx-auto space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Revenue Report</h1>
          <p className="text-sm text-slate-400">Closed account totals and current open totals.</p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-sm">
            <span className="block text-slate-300">From</span>
            <input
              className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="block text-slate-300">To</span>
            <input
              className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
            />
          </label>
          <button
            className="rounded border border-slate-700 px-3 py-2 text-sm text-slate-100 disabled:opacity-50"
            disabled={loading}
            onClick={() => void loadReport()}
          >
            Refresh
          </button>
        </div>
      </header>

      {errorMessage && (
        <div className="rounded border border-red-700 bg-red-950/30 px-3 py-2 text-sm text-red-300">
          {errorMessage}
        </div>
      )}

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-sky-700/40 bg-slate-800 p-4">
          <div className="text-sm text-sky-200/80">Coins In</div>
          <div className="mt-2 text-2xl font-semibold font-mono text-sky-300">
            {formatCurrency(summary.coinsIn)}
          </div>
        </div>
        <div className="rounded-lg border border-rose-700/40 bg-slate-800 p-4">
          <div className="text-sm text-rose-200/80">Withdrawal</div>
          <div className="mt-2 text-2xl font-semibold font-mono text-rose-300">
            {formatCurrency(summary.withdrawal)}
          </div>
        </div>
        <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
          <div className="text-sm text-slate-400">Income</div>
          <div className={`mt-2 text-2xl font-semibold font-mono ${incomeTextClass(summary.income)}`}>
            {formatCurrency(summary.income)}
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-slate-700 bg-slate-800 overflow-hidden">
        <div className="border-b border-slate-700 px-4 py-3 text-sm font-semibold">History</div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-900 text-slate-300">
              <tr>
                <th className="px-4 py-3 text-left">Date</th>
                <th className="px-4 py-3 text-right">Coins In</th>
                <th className="px-4 py-3 text-right">Withdrawal</th>
                <th className="px-4 py-3 text-right">Income</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {rows.map(row => (
                <tr key={row.report_date}>
                  <td className="px-4 py-3 text-slate-100">{formatDateLabel(row.report_date)}</td>
                  <td className="px-4 py-3 text-right font-mono text-sky-300">
                    {formatCurrency(row.coins_in)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-rose-300">
                    {formatCurrency(row.withdrawal)}
                  </td>
                  <td className={`px-4 py-3 text-right font-semibold font-mono ${incomeTextClass(row.income)}`}>
                    {formatCurrency(row.income)}
                  </td>
                </tr>
              ))}

              {!loading && rows.length === 0 && (
                <tr>
                  <td className="px-4 py-8 text-center text-slate-400" colSpan={4}>
                    No revenue rows in this date range.
                  </td>
                </tr>
              )}

              {loading && (
                <tr>
                  <td className="px-4 py-8 text-center text-slate-400" colSpan={4}>
                    Loading report...
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
