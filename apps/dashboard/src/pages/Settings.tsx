import { useEffect, useMemo, useState } from 'react'
import { useCasinoRuntime } from '../hooks/useCasinoRuntime'
import { getGame, toggleGame, useGames } from '../hooks/useGames'
import { prepareGamePackage, purgeGamePackages, removeGamePackage } from '../lib/arcadeAdmin'

export default function Settings() {
  const games = useGames()
  const { runtime, profiles, updateRuntime, setHappyHour } = useCasinoRuntime()

  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [baseProfileId, setBaseProfileId] = useState('')
  const [happyProfileId, setHappyProfileId] = useState('')
  const [prizePoolGoal, setPrizePoolGoal] = useState('10000')
  const [prizePoolBalance, setPrizePoolBalance] = useState('0')
  const [hopperAlertThreshold, setHopperAlertThreshold] = useState('500')
  const [autoHappy, setAutoHappy] = useState(true)

  useEffect(() => {
    if (!runtime) return

    setBaseProfileId(runtime.base_profile_id)
    setHappyProfileId(runtime.happy_profile_id)
    setPrizePoolGoal(String(runtime.prize_pool_goal ?? 0))
    setPrizePoolBalance(String(runtime.prize_pool_balance ?? 0))
    setHopperAlertThreshold(String(runtime.hopper_alert_threshold ?? 500))
    setAutoHappy(Boolean(runtime.auto_happy_enabled))
  }, [runtime])

  useEffect(() => {
    if (!errorMessage) return
    const t = setTimeout(() => setErrorMessage(null), 5000)
    return () => clearTimeout(t)
  }, [errorMessage])

  const baseProfiles = useMemo(() => profiles.filter(p => p.mode === 'BASE'), [profiles])
  const happyProfiles = useMemo(() => profiles.filter(p => p.mode === 'HAPPY'), [profiles])

  const asNumber = (v: number | string | null | undefined) => Number(v ?? 0)
  const formatCurrency = (v: number | string | null | undefined) => `₱${asNumber(v).toLocaleString()}`

  async function saveRuntime() {
    setSaving(true)

    const result = await updateRuntime({
      base_profile_id: baseProfileId,
      happy_profile_id: happyProfileId,
      auto_happy_enabled: autoHappy,
      prize_pool_goal: Math.max(0, Number(prizePoolGoal || 0)),
      prize_pool_balance: Math.max(0, Number(prizePoolBalance || 0)),
      hopper_alert_threshold: Math.max(0, Number(hopperAlertThreshold || 0)),
    })

    setSaving(false)

    if (!result.ok) {
      setErrorMessage(result.error?.message ?? 'Failed to save settings')
    }
  }

  async function toggleHappyHour(enable: boolean) {
    const result = await setHappyHour(enable)

    if (!result.ok) {
      setErrorMessage(result.error?.message ?? 'Failed to toggle happy hour')
    }
  }

  async function purgeRuntimeCache() {
    const result = await purgeGamePackages()
    if (!result.ok) {
      setErrorMessage(result.error?.message ?? 'Failed to purge runtime packages')
    } else {
      setErrorMessage(null)
    }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-10">
      <header>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-slate-400 text-sm">RTP profile and runtime controls</p>
      </header>

      {errorMessage && (
        <div className="p-3 bg-red-900/40 border border-red-700 text-red-300 text-sm rounded">
          {errorMessage}
        </div>
      )}

      <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 space-y-4">
        <h2 className="text-lg font-semibold">Happy Hour Control</h2>

        <div className="text-sm text-slate-300">
          <span className="mr-3">
            Current Mode: <strong>{runtime?.active_mode ?? 'BASE'}</strong>
          </span>
          <span className="mr-3">
            Prize Pool: <strong>{formatCurrency(runtime?.prize_pool_balance)}</strong>
          </span>
          <span>
            Goal: <strong>{formatCurrency(runtime?.prize_pool_goal)}</strong>
          </span>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => toggleHappyHour(true)}
            disabled={!runtime || asNumber(runtime.prize_pool_balance) <= 0}
            className="px-3 py-2 rounded bg-green-700/30 border border-green-600 text-green-300 disabled:opacity-50"
          >
            Start Happy Hour
          </button>

          <button
            onClick={() => toggleHappyHour(false)}
            disabled={!runtime}
            className="px-3 py-2 rounded bg-amber-700/30 border border-amber-600 text-amber-300 disabled:opacity-50"
          >
            Stop Happy Hour
          </button>
        </div>

        <p className="text-xs text-slate-400">
          Happy hour auto-reverts to BASE when prize pool reaches 0.
        </p>
      </section>

      <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 space-y-4">
        <h2 className="text-lg font-semibold">RTP Runtime Settings</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-300">Base Profile</span>
            <select
              className="bg-slate-950 border border-slate-700 rounded px-3 py-2"
              value={baseProfileId}
              onChange={e => setBaseProfileId(e.target.value)}
            >
              {baseProfiles.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.house_pct}/{p.pool_pct}/{p.player_pct})
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-300">Happy Profile</span>
            <select
              className="bg-slate-950 border border-slate-700 rounded px-3 py-2"
              value={happyProfileId}
              onChange={e => setHappyProfileId(e.target.value)}
            >
              {happyProfiles.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.house_pct}/{p.pool_pct}/{p.player_pct}/prize {p.prize_pct})
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-300">Prize Pool Goal</span>
            <input
              className="bg-slate-950 border border-slate-700 rounded px-3 py-2"
              type="number"
              min={0}
              value={prizePoolGoal}
              onChange={e => setPrizePoolGoal(e.target.value)}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-300">Prize Pool Balance</span>
            <input
              className="bg-slate-950 border border-slate-700 rounded px-3 py-2"
              type="number"
              min={0}
              value={prizePoolBalance}
              onChange={e => setPrizePoolBalance(e.target.value)}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-300">Hopper Alert Threshold</span>
            <input
              className="bg-slate-950 border border-slate-700 rounded px-3 py-2"
              type="number"
              min={0}
              value={hopperAlertThreshold}
              onChange={e => setHopperAlertThreshold(e.target.value)}
            />
          </label>
        </div>

        <label className="inline-flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={autoHappy}
            onChange={e => setAutoHappy(e.target.checked)}
          />
          Auto-trigger happy hour when prize pool reaches goal
        </label>

        <div>
          <button
            onClick={saveRuntime}
            disabled={saving}
            className="px-4 py-2 rounded bg-blue-700/30 border border-blue-600 text-blue-300 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save Settings'}
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 space-y-4">
        <h2 className="text-lg font-semibold">Global Games</h2>
        <div className="flex items-center gap-3">
          <button
            onClick={purgeRuntimeCache}
            className="px-3 py-2 rounded bg-rose-700/30 border border-rose-600 text-rose-300 text-sm"
          >
            Purge Runtime Cache
          </button>
          <span className="text-xs text-slate-400">
            Clears decrypted runtime game bundles on connected cabinet API.
          </span>
        </div>

        <div className="grid md:grid-cols-6 grid-cols-2 gap-4">
          {games.map(g => (
            <div
              key={g.id}
              className="flex flex-col gap-2 items-center justify-between p-2 border border-slate-800 rounded-lg"
            >
              <div className="flex  flex-col items-center text-center">
                <div className="font-medium text-sm">{g.name}</div>
                <div className="text-[10px] text-slate-600">
                  {g.type} • v{g.version}
                </div>
              </div>

              <button
                onClick={async () => {
                  const nextEnabled = !g.enabled
                  const result = await toggleGame(g.id, nextEnabled)

                  if (!result.ok) {
                    setErrorMessage(result?.error?.message ?? null)
                  } else {
                    const gameResult = await getGame(g.id)
                    if (gameResult.ok && gameResult.data) {
                      const game = gameResult.data as any
                      if (!nextEnabled) {
                        const removeResult = await removeGamePackage(
                          game.id,
                          Number(game.version ?? 1),
                          true,
                        )
                        if (!removeResult.ok) {
                          setErrorMessage(
                            `Disabled but remove failed: ${removeResult.error?.message ?? 'unknown error'}`,
                          )
                          return
                        }
                      } else if (game.package_url) {
                        const prepareResult = await prepareGamePackage(
                          game.id,
                          game.package_url,
                          Number(game.version ?? 1),
                        )
                        if (!prepareResult.ok) {
                          setErrorMessage(
                            `Enabled but prefetch failed: ${prepareResult.error?.message ?? 'unknown error'}`,
                          )
                          return
                        }
                      }
                    }
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
    </div>
  )
}
