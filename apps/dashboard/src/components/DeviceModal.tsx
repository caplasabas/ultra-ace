import { toggleCabinetGame, useCabinetGames } from '../hooks/useCabinetGames.ts'
import { useEffect, useState } from 'react'

export function DeviceModal({ device, onClose }: { device: any; onClose: () => void }) {
  const cabinetGames = useCabinetGames(device.device_id)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!errorMessage) return
    const t = setTimeout(() => setErrorMessage(null), 4000)
    return () => clearTimeout(t)
  }, [errorMessage])

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-slate-900 w-full max-w-2xl rounded-xl p-4 space-y-6 border border-slate-800">
        <div className="flex flex-col space-y-1">
          <button onClick={onClose} className="text-slate-400 hover:text-white self-end">
            ✕
          </button>
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-lg font-semibold">
                Device: {device.device_id ?? 'Unnamed Device'}
              </h3>
            </div>

            <div className="text-lg font-mono font-bold text-green-400">
              ₱{Number(device.balance).toLocaleString()}
            </div>
          </div>
        </div>

        <div>
          <h4 className="text-sm font-semibold mb-3">Games</h4>
          {errorMessage && (
            <div className="p-2 mb-3 bg-red-900/40 border border-red-700 text-red-300 text-xs rounded">
              {errorMessage}
            </div>
          )}
          <div className="grid md:grid-cols-4 gap-4">
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
                    const result = await toggleCabinetGame(device.device_id, g.id, !g.installed)

                    if (!result.ok) {
                      setErrorMessage(result?.error?.message ?? null)
                    } else {
                      setErrorMessage(null)
                    }
                  }}
                  className={`px-3 py-1 text-xs rounded ${
                    g.installed ? 'bg-green-600/20 text-green-400' : 'bg-red-600/20 text-red-300'
                  }`}
                >
                  {g.installed ? 'Enabled' : 'Disabled'}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
