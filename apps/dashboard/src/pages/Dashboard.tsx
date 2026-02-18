// src/pages/Dashboard.tsx
import { useEffect, useState } from 'react'
import { useDevices } from '../hooks/useDevices'
import { toggleGame, useGames } from '../hooks/useGames'
import { DeviceModal } from '../components/DeviceModal.tsx'
import moment from 'moment'

export default function Dashboard() {
  const devices = useDevices()
  const games = useGames()

  const [selectedDevice, setSelectedDevice] = useState<any | null>(null)

  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!errorMessage) return
    const t = setTimeout(() => setErrorMessage(null), 4000)
    return () => clearTimeout(t)
  }, [errorMessage])

  return (
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

      {/* ---------------- DEVICES ---------------- */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Devices</h2>

        <div className="overflow-x-auto rounded-lg border border-slate-800">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-900 text-slate-400">
              <tr>
                <th className="px-4 py-2 text-left">Device</th>
                <th className="px-4 py-2 text-right">Balance</th>
                <th className="px-4 py-2 text-right">Last Seen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {devices.map(d => (
                <tr
                  key={d.device_id}
                  className="hover:bg-slate-900/50 cursor-pointer"
                  onClick={() => setSelectedDevice(d)}
                >
                  <td className="px-4 py-2">{d.device_id ?? 'Unnamed'}</td>
                  <td className="px-4 py-2 text-right font-mono font-bold text-green-400">
                    ₱{Number(d.balance).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-right text-xs text-slate-400">
                    {d.updated_at ? moment(d.updated_at).format('YYYY-MM-DD HH:mm') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---------------- GLOBAL GAMES ---------------- */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Global Games</h2>

        <div className="grid md:grid-cols-6 gap-4">
          {games.map(g => (
            <div
              key={g.id}
              className="flex flex-col gap-2 items-center justify-between p-2 border border-slate-800 rounded-lg"
            >
              <div className="flex  flex-col items-center">
                <div className="font-medium text-sm">{g.name}</div>
                <div className="text-[10px] text-slate-600">
                  {g.type} • v{g.version}
                </div>
              </div>

              <button
                onClick={async () => {
                  const result = await toggleGame(g.id, !g.enabled)

                  if (!result.ok) {
                    setErrorMessage(result?.error?.message ?? null)
                  } else {
                    setErrorMessage(null)
                  }
                }}
                className={`px-3 py-1 text-xs rounded ${
                  g.enabled ? 'bg-green-600/20 text-green-400' : 'bg-red-600/20 text-red-400'
                }`}
              >
                {g.enabled ? 'Enabled' : 'Disabled'}
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------- DEVICE MODAL ---------------- */}
      {selectedDevice && (
        <DeviceModal device={selectedDevice} onClose={() => setSelectedDevice(null)} />
      )}
    </div>
  )
}
