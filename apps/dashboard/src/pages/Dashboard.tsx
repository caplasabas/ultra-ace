// src/pages/Dashboard.tsx
import { useKpis } from '../hooks/useKpis'
import { useJackpot } from '../hooks/useJackpot'
import { useDevices } from '../hooks/useDevices'
import { KpiCards } from '../components/KpiCards.tsx'

export default function Dashboard() {
  const kpis = useKpis()
  const jackpot = useJackpot()
  const devices = useDevices()

  if (!kpis || !jackpot) return <div>Loading…</div>
  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">UltraAce Dashboard</h1>
        <p className="text-slate-400 text-sm">Live operational metrics</p>
      </header>

      <KpiCards gross={kpis.gross} payouts={kpis.payouts} net={kpis.net} rtp={kpis.rtp} />

      <section className="rounded-lg bg-slate-900 p-4 border border-slate-800">
        <h2 className="text-lg font-semibold mb-2">Jackpot</h2>
        <div className="flex gap-6 text-sm">
          <div>Total: ₱{Number(jackpot.total).toLocaleString()}</div>
          <div>Remaining: ₱{Number(jackpot.remaining).toLocaleString()}</div>
          <div className={jackpot.happyHour ? 'text-green-400' : 'text-slate-400'}>
            {jackpot.happyHour ? 'HAPPY HOUR' : 'Normal'}
          </div>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold mb-3">Devices</h2>

        <div className="overflow-x-auto rounded-lg border border-slate-800">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-900 text-slate-400">
              <tr>
                <th className="px-4 py-2 text-left">Device</th>
                <th className="px-4 py-2 text-right">Balance</th>
                <th className="px-4 py-2 text-left">Last Seen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {devices.map(d => (
                <tr key={d.device_id} className="hover:bg-slate-900/50">
                  <td className="px-4 py-2">{d.name ?? 'Unnamed'}</td>
                  <td className="px-4 py-2 text-right">₱{Number(d.balance).toLocaleString()}</td>
                  <td className="px-4 py-2">
                    {d.last_seen ? new Date(d.last_seen).toLocaleString() : '—'}
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
