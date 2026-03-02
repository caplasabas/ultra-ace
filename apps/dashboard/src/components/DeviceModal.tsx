import { toggleCabinetGame, useCabinetGames } from '../hooks/useCabinetGames.ts'
import { useEffect, useState } from 'react'
import { prepareGamePackage, removeGamePackage } from '../lib/arcadeAdmin.ts'
import { supabase } from '../lib/supabase.ts'

export function DeviceModal({ device, onClose }: { device: any; onClose: () => void }) {
  const cabinetGames = useCabinetGames(device.device_id)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [overrideBusy, setOverrideBusy] = useState(false)
  const asNumber = (v: number | string | null | undefined) => Number(v ?? 0)
  const formatCurrency = (v: number | string | null | undefined) => `₱${asNumber(v).toLocaleString()}`
  const deviceRtp =
    asNumber(device.bet_total) > 0 ? (asNumber(device.win_total) / asNumber(device.bet_total)) * 100 : 0
  const deviceHouseWin = asNumber(device.bet_total) - asNumber(device.win_total)
  const deviceHouseEdge =
    asNumber(device.bet_total) > 0 ? (deviceHouseWin / asNumber(device.bet_total)) * 100 : 0
  const hopperAlertThreshold = asNumber((device as any)?.hopper_alert_threshold ?? 500)
  const hopperLow = asNumber(device.hopper_balance) <= hopperAlertThreshold
  const [balanceAmount, setBalanceAmount] = useState('0')
  const [balanceKind, setBalanceKind] = useState<'debit' | 'credit'>('credit')
  const [balanceAccountName, setBalanceAccountName] = useState('Manual Accounting Override')
  const [balanceNotes, setBalanceNotes] = useState('')

  const [hopperAmount, setHopperAmount] = useState('0')
  const [hopperKind, setHopperKind] = useState<'debit' | 'credit'>('credit')
  const [hopperAccountName, setHopperAccountName] = useState('Manual Hopper Override')
  const [hopperNotes, setHopperNotes] = useState('')

  useEffect(() => {
    if (!errorMessage) return
    const t = setTimeout(() => setErrorMessage(null), 4000)
    return () => clearTimeout(t)
  }, [errorMessage])

  useEffect(() => {
    setBalanceAmount('0')
    setHopperAmount('0')
  }, [device.device_id, device.balance, device.hopper_balance])

  useEffect(() => {
    if (!successMessage) return
    const t = setTimeout(() => setSuccessMessage(null), 4000)
    return () => clearTimeout(t)
  }, [successMessage])

  async function postOverrideEntry(params: {
    target: 'accounting_balance' | 'hopper_balance'
    entryKind: 'debit' | 'credit'
    amountText: string
    accountName: string
    notes: string
  }) {
    const amount = Math.max(0, Number(params.amountText || 0))
    if (!Number.isFinite(amount) || amount <= 0) {
      setErrorMessage('Amount must be greater than 0')
      return
    }
    if (!params.accountName.trim()) {
      setErrorMessage('Account name is required')
      return
    }

    setOverrideBusy(true)
    const { data, error } = await supabase.rpc('post_device_admin_ledger_entry', {
      p_device_id: device.device_id,
      p_target: params.target,
      p_entry_kind: params.entryKind,
      p_amount: amount,
      p_account_name: params.accountName.trim(),
      p_notes: params.notes.trim() || null,
      p_metadata: {
        source: 'dashboard_device_modal',
      },
    })
    setOverrideBusy(false)

    if (error) {
      setErrorMessage(error.message)
      return
    }

    const before = Number((data as any)?.before ?? 0)
    const after = Number((data as any)?.after ?? 0)
    const applied = Number((data as any)?.amount ?? amount)
    setSuccessMessage(
      `${params.target === 'accounting_balance' ? 'Balance' : 'Hopper'} ${params.entryKind.toUpperCase()} ${formatCurrency(applied)} • ${formatCurrency(before)} -> ${formatCurrency(after)}`,
    )
    setErrorMessage(null)
    return true
  }

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

            <div className="grid grid-cols-2 md:grid-cols-8 gap-2 mt-2">
              <div className="rounded border border-green-700/40 bg-green-900/20 px-2 py-1">
                <div className="text-[10px] text-green-300/80">Balance</div>
                <div className="text-sm font-mono text-green-300">{formatCurrency(device.balance)}</div>
              </div>

              <div className="rounded border border-sky-700/40 bg-sky-900/20 px-2 py-1">
                <div className="text-[10px] text-sky-300/80">Coins-In</div>
                <div className="text-sm font-mono text-sky-300">{formatCurrency(device.coins_in_total)}</div>
              </div>

              <div
                className={`rounded border px-2 py-1 ${
                  hopperLow ? 'border-red-500 bg-red-950/40' : 'border-amber-700/40 bg-amber-900/20'
                }`}
              >
                <div className="text-[10px] text-amber-300/80">Hopper</div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  {hopperLow && (
                    <span className="rounded border-2 border-red-500 bg-red-950/80 px-2 py-0.5 text-[10px] font-black tracking-wide text-red-200">
                      LOW HOPPER
                    </span>
                  )}
                  <div
                    className={`font-mono ${
                      hopperLow
                        ? 'text-red-200 animate-pulse font-extrabold text-xl leading-none'
                        : 'text-amber-300 text-sm'
                    }`}
                  >
                    {formatCurrency(device.hopper_balance)}
                  </div>
                </div>
              </div>

              <div className="rounded border border-violet-700/40 bg-violet-900/20 px-2 py-1">
                <div className="text-[10px] text-violet-300/80">Bet Amount</div>
                <div className="text-sm font-mono text-violet-300">{formatCurrency(device.bet_total)}</div>
              </div>

              <div className="rounded border border-orange-700/40 bg-orange-900/20 px-2 py-1">
                <div className="text-[10px] text-orange-300/80">House Win</div>
                <div
                  className={`text-sm font-mono ${
                    deviceHouseWin < 0 ? 'text-red-300 animate-pulse' : 'text-orange-300'
                  }`}
                >
                  {formatCurrency(deviceHouseWin)}
                </div>
              </div>

              <div className="rounded border border-rose-700/40 bg-rose-900/20 px-2 py-1">
                <div className="text-[10px] text-rose-300/80">House Edge</div>
                <div className="text-sm font-mono text-rose-300">{deviceHouseEdge.toFixed(2)}%</div>
              </div>

              <div className="rounded border border-cyan-700/40 bg-cyan-900/20 px-2 py-1">
                <div className="text-[10px] text-cyan-300/80">Spins</div>
                <div className="text-sm font-mono text-cyan-300">{asNumber(device.spins_total).toLocaleString()}</div>
              </div>

              <div className="rounded border border-fuchsia-700/40 bg-fuchsia-900/20 px-2 py-1">
                <div className="text-[10px] text-fuchsia-300/80">RTP</div>
                <div className="text-sm font-mono text-fuchsia-300">{deviceRtp.toFixed(2)}%</div>
              </div>
            </div>
          </div>

          <div className="flex flex-col overflow-hidden">
            <div className="px-4">
              <h4 className="text-sm font-semibold mb-2">Manual Overrides (Demo)</h4>
              <div className="grid md:grid-cols-2 grid-cols-1 gap-3 mb-4">
                <div className="rounded border border-slate-700 bg-slate-950/70 p-3">
                  <div className="text-xs text-slate-400 mb-2">Accounting Balance Ledger Entry</div>
                  <div className="grid grid-cols-3 gap-2 mb-2">
                    <select
                      className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
                      value={balanceKind}
                      onChange={e => setBalanceKind(e.target.value as 'debit' | 'credit')}
                    >
                      <option value="credit">Credit</option>
                      <option value="debit">Debit</option>
                    </select>
                    <input
                      className="col-span-2 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
                      type="number"
                      min={0}
                      step={1}
                      value={balanceAmount}
                      onChange={e => setBalanceAmount(e.target.value)}
                      placeholder="Amount"
                    />
                  </div>
                  <input
                    className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs mb-2"
                    value={balanceAccountName}
                    onChange={e => setBalanceAccountName(e.target.value)}
                    placeholder="Account name"
                  />
                  <input
                    className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs mb-2"
                    value={balanceNotes}
                    onChange={e => setBalanceNotes(e.target.value)}
                    placeholder="Notes"
                  />
                  <button
                    onClick={() => {
                      void postOverrideEntry({
                        target: 'accounting_balance',
                        entryKind: balanceKind,
                        amountText: balanceAmount,
                        accountName: balanceAccountName,
                        notes: balanceNotes,
                      })
                    }}
                    disabled={overrideBusy}
                    className="w-full px-3 py-1 rounded text-xs bg-blue-700/30 border border-blue-600 text-blue-300 disabled:opacity-50"
                  >
                    Post Entry
                  </button>
                </div>

                <div className="rounded border border-slate-700 bg-slate-950/70 p-3">
                  <div className="text-xs text-slate-400 mb-2">Hopper Balance Ledger Entry</div>
                  <div className="grid grid-cols-3 gap-2 mb-2">
                    <select
                      className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
                      value={hopperKind}
                      onChange={e => setHopperKind(e.target.value as 'debit' | 'credit')}
                    >
                      <option value="credit">Credit</option>
                      <option value="debit">Debit</option>
                    </select>
                    <input
                      className="col-span-2 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
                      type="number"
                      min={0}
                      step={1}
                      value={hopperAmount}
                      onChange={e => setHopperAmount(e.target.value)}
                      placeholder="Amount"
                    />
                  </div>
                  <input
                    className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs mb-2"
                    value={hopperAccountName}
                    onChange={e => setHopperAccountName(e.target.value)}
                    placeholder="Account name"
                  />
                  <input
                    className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs mb-2"
                    value={hopperNotes}
                    onChange={e => setHopperNotes(e.target.value)}
                    placeholder="Notes"
                  />
                  <button
                    onClick={() => {
                      void postOverrideEntry({
                        target: 'hopper_balance',
                        entryKind: hopperKind,
                        amountText: hopperAmount,
                        accountName: hopperAccountName,
                        notes: hopperNotes,
                      })
                    }}
                    disabled={overrideBusy}
                    className="w-full px-3 py-1 rounded text-xs bg-amber-700/30 border border-amber-600 text-amber-300 disabled:opacity-50"
                  >
                    Post Entry
                  </button>
                </div>
              </div>

              <h4 className="text-sm font-semibold mb-3">Games</h4>
              {successMessage && (
                <div className="p-2 mb-3 bg-green-900/30 border border-green-700 text-green-300 text-xs rounded">
                  {successMessage}
                </div>
              )}
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
                        const nextInstalled = !g.installed
                        const result = await toggleCabinetGame(device.device_id, g.id, nextInstalled)

                        if (!result.ok) {
                          setErrorMessage(result?.error?.message ?? null)
                        } else {
                          if (!nextInstalled) {
                            const removeResult = await removeGamePackage(
                              g.id,
                              Number(g.version ?? 1),
                              true,
                            )
                            if (!removeResult.ok) {
                              setErrorMessage(
                                `Disabled but remove failed: ${removeResult.error?.message ?? 'unknown error'}`,
                              )
                              return
                            }
                          } else if (g.package_url) {
                            const prepareResult = await prepareGamePackage(
                              g.id,
                              g.package_url,
                              Number(g.version ?? 1),
                            )
                            if (!prepareResult.ok) {
                              setErrorMessage(
                                `Enabled but prefetch failed: ${prepareResult.error?.message ?? 'unknown error'}`,
                              )
                              return
                            }
                          }
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
