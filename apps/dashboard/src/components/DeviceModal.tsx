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
      <div className="bg-slate-900 w-full max-w-2xl rounded-xl p-6 space-y-6 border border-slate-800">
        <div className="flex justify-between items-center">
          <div>
            <h3 className="text-lg font-semibold">
              Device: {device.device_id ?? 'Unnamed Device'}
            </h3>
            <div className="text-sm text-slate-400 font-mono">
              ₱{Number(device.balance).toLocaleString()}
            </div>
          </div>

          <button onClick={onClose} className="text-slate-400 hover:text-white">
            ✕
          </button>
        </div>

        <div>
          <h4 className="text-sm font-semibold mb-3">Arcade Games</h4>
          {errorMessage && (
            <div className="p-2 mb-3 bg-red-900/40 border border-red-700 text-red-300 text-xs rounded">
              {errorMessage}
            </div>
          )}
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {cabinetGames.map(g => (
              <div
                key={g.id}
                className="flex justify-between items-center border border-slate-800 rounded p-3"
              >
                <div>
                  <div className="font-medium">{g.name}</div>
                  <div className="text-xs text-slate-400">{g.type}</div>
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
