import { toggleCabinetGame, useCabinetGames } from '../hooks/useCabinetGames.ts'
import { useEffect, useState } from 'react'

export function DeviceModal({ device, onClose }: { device: any; onClose: () => void }) {
  const cabinetGames = useCabinetGames(device.device_id)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const asNumber = (v: number | string | null | undefined) => Number(v ?? 0)
  const formatCurrency = (v: number | string | null | undefined) => `₱${asNumber(v).toLocaleString()}`

  useEffect(() => {
    if (!errorMessage) return
    const t = setTimeout(() => setErrorMessage(null), 4000)
    return () => clearTimeout(t)
  }, [errorMessage])

  return (
    <div className="fixed inset-0   bg-black/85 z-50 overflow-y-auto">
      <div className="min-h-full flex items-start md:items-center justify-center p-4">
        <div className="bg-slate-900 w-full max-w-2xl max-h-[95vh] flex flex-col rounded-xl border border-slate-800">
          <div className="flex flex-col space-y-1 p-4">
            <button onClick={onClose} className="text-slate-400 hover:text-white self-end">
              ✕
            </button>
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-base md:text-lg font-semibold">
                  Device: {device.device_id ?? 'Unnamed Device'}
                </h3>
              </div>

              <div className="text-base md:text-lg font-mono font-bold text-green-400">
                {formatCurrency(device.balance)}
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
              <div className="rounded border border-green-700/40 bg-green-900/20 px-2 py-1">
                <div className="text-[10px] text-green-300/80">Balance</div>
                <div className="text-sm font-mono text-green-300">{formatCurrency(device.balance)}</div>
              </div>

              <div className="rounded border border-sky-700/40 bg-sky-900/20 px-2 py-1">
                <div className="text-[10px] text-sky-300/80">Coins-In</div>
                <div className="text-sm font-mono text-sky-300">{formatCurrency(device.coins_in_total)}</div>
              </div>

              <div className="rounded border border-amber-700/40 bg-amber-900/20 px-2 py-1">
                <div className="text-[10px] text-amber-300/80">Hopper</div>
                <div className="text-sm font-mono text-amber-300">{formatCurrency(device.hopper_balance)}</div>
              </div>

              <div className="rounded border border-violet-700/40 bg-violet-900/20 px-2 py-1">
                <div className="text-[10px] text-violet-300/80">Bet Amount</div>
                <div className="text-sm font-mono text-violet-300">{formatCurrency(device.bet_total)}</div>
              </div>
            </div>
          </div>

          <div className="flex flex-col overflow-hidden">
            <div className="px-4">
              <h4 className="text-sm font-semibold mb-3">Games</h4>
              {errorMessage && (
                <div className="p-2 mb-3 bg-red-900/40 border border-red-700 text-red-300 text-xs rounded">
                  {errorMessage}
                </div>
              )}
            </div>

            <div className="overflow-y-auto  px-4 pb-6">
              <div className="grid md:grid-cols-4 grid-cols-2 gap-4">
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
                        g.installed
                          ? 'bg-green-600/20 text-green-400'
                          : 'bg-red-600/20 text-red-300'
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
      </div>
    </div>
  )
}
