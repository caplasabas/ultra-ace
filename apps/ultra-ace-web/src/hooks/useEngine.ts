import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CascadeStep,
  createRNG,
  DEFAULT_ENGINE_CONFIG,
  DEFAULT_ENGINE_HAPPY_HOUR,
  hotUpdateEngine,
  spin,
  SpinOutcome,
  startEngine,
} from '@ultra-ace/engine'
import { DebugSpinInfo } from 'src/debug/DebugHud'
import { ensureDeviceRegistered } from '../lib/device'
import type { DeviceBalanceSnapshot } from '../lib/balance'
import { fetchDeviceBalance, subscribeToDeviceBalance } from '../lib/balance'
import { fetchCasinoRuntimeLive, subscribeCasinoRuntimeLive } from '../lib/runtime'
import { commitSpinAccounting } from '../lib/accounting'
import {
  endDeviceGameSession,
  startDeviceGameSession,
  updateDeviceGameState,
} from '../lib/deviceGameSession'
import {
  fetchActiveJackpotQueue,
  subscribeActiveJackpotQueue,
  type ActiveJackpotQueue,
} from '../lib/jackpotQueue'

const BUY_FREE_SPIN_MULTIPLIER = 50
const JACKPOT_FREE_SPIN_COUNT = 10

const SCATTER_BANNER_DURATION = 5000
const FREE_SPIN_SNAPSHOT_PREFIX = 'ultraace.free-spin-state'
const FREE_SPIN_SNAPSHOT_MAX_AGE_MS = 1000 * 60 * 60 * 6
const DEVICE_STATE_HEARTBEAT_MS = 5000
const ENABLE_DEVICE_STATE_SYNC = true
const BALANCE_FALLBACK_SYNC_MS = 15000
const JACKPOT_QUEUE_FALLBACK_SYNC_MS = 2000

type FreeSpinSnapshot = {
  updatedAt: number
  isFreeGame: boolean
  freeSpinsLeft: number
  pendingFreeSpins: number
  freeSpinTotal: number
  showFreeSpinIntro: boolean
  scatterTriggerType: 'natural' | 'buy' | null
}

function generateSeed(): string {
  const buf = new Uint32Array(4)
  crypto.getRandomValues(buf)

  return [Date.now(), buf[0], buf[1], buf[2], buf[3]].join('-')
}

export function useEngine() {
  const sessionIdRef = useRef<number | null>(null)
  const lastOutcomeRef = useRef<SpinOutcome | null>(null)
  const spinCounterRef = useRef(0)

  const rngRef = useRef<ReturnType<typeof createRNG> | null>(null)
  const seedRef = useRef<string | null>(null)

  const [deviceId, setDeviceId] = useState<string | null>(null)
  const deviceIdRef = useRef<string | null>(null)

  const [sessionReady, setSessionReady] = useState(false)
  const [runtimeMode, setRuntimeMode] = useState<'BASE' | 'HAPPY'>('BASE')
  const [activeJackpotQueue, setActiveJackpotQueue] = useState<ActiveJackpotQueue | null>(null)
  const forceJackpotScatterRef = useRef(false)
  const activeJackpotQueueIdRef = useRef<number | null>(null)

  /* -----------------------------
     Core spin state
  ----------------------------- */
  const [committedCascades, setCommittedCascades] = useState<CascadeStep[]>([])
  const [pendingCascades, setPendingCascades] = useState<CascadeStep[] | null>(null)

  const [spinning, setSpinning] = useState(false)
  const [spinId, setSpinId] = useState(0)

  /* -----------------------------
     Player economy
  ----------------------------- */
  const [bet, setBet] = useState(2)
  const [buySpinBet, setBuySpinBet] = useState(bet)

  const [balance, setBalance] = useState(0)

  const [totalWin, setTotalWin] = useState(0)
  const [freeSpinTotal, setFreeSpinTotal] = useState(0)

  const [scatterTriggerType, setScatterTriggerType] = useState<'natural' | 'buy' | null>(null)

  /* -----------------------------
     Free spin state
  ----------------------------- */
  const [isFreeGame, setIsFreeGame] = useState(false)
  const [freeSpinsLeft, setFreeSpinsLeft] = useState(0)
  const [pendingFreeSpins, setPendingFreeSpins] = useState(0)

  // Marks that the LAST free spin has been consumed
  const [showFreeSpinIntro, setShowFreeSpinIntro] = useState(false)
  const [showScatterWinBanner, setShowScatterWinBanner] = useState(false)

  const [freezeUI, setFreezeUI] = useState(false)

  const [withdrawAmount, setWithdrawAmount] = useState(60)
  const [isWithdrawing, setIsWithdrawing] = useState(false)
  const [showWithdrawModal, setShowWithdrawModal] = useState(false)
  const maxWinEnabledRef = useRef(true)
  const currentSpinMaxWinRef = useRef<number | null>(null)
  const spinLockRef = useRef(false)
  const suppressRealtimeBalanceRef = useRef(false)
  const balanceSyncInFlightRef = useRef(false)
  const balanceSyncRequestedRef = useRef(false)
  const balanceSyncSeqRef = useRef(0)
  const lastAuthoritativeUpdatedAtRef = useRef(0)
  const lastAuthoritativeBalanceRef = useRef(0)
  const isFreeGameRef = useRef(false)
  const freeSpinsLeftRef = useRef(0)
  const freeSpinTotalRef = useRef(0)

  const snapshotKeyRef = useRef<string | null>(null)

  function clearFreeSpinSnapshot() {
    if (typeof window === 'undefined') return
    if (!snapshotKeyRef.current) return
    window.localStorage.removeItem(snapshotKeyRef.current)
  }

  function persistFreeSpinSnapshot(next: FreeSpinSnapshot) {
    if (typeof window === 'undefined') return
    if (!snapshotKeyRef.current) return
    const hasActiveState =
      next.isFreeGame ||
      next.pendingFreeSpins > 0 ||
      next.freeSpinsLeft > 0 ||
      next.showFreeSpinIntro ||
      next.freeSpinTotal > 0

    if (!hasActiveState) {
      clearFreeSpinSnapshot()
      return
    }

    window.localStorage.setItem(snapshotKeyRef.current, JSON.stringify(next))
  }

  const applyAuthoritativeBalance = useCallback((snapshot: DeviceBalanceSnapshot) => {
    const nextBalance = Number(snapshot.balance ?? 0)
    if (!Number.isFinite(nextBalance)) return

    if (suppressRealtimeBalanceRef.current) return

    const updatedAtMs = snapshot.updatedAt ? Date.parse(snapshot.updatedAt) : NaN
    if (Number.isFinite(updatedAtMs) && updatedAtMs < lastAuthoritativeUpdatedAtRef.current) return
    if (
      Number.isFinite(updatedAtMs) &&
      updatedAtMs === lastAuthoritativeUpdatedAtRef.current &&
      nextBalance < lastAuthoritativeBalanceRef.current
    ) {
      return
    }
    if (Number.isFinite(updatedAtMs)) {
      lastAuthoritativeUpdatedAtRef.current = updatedAtMs
    }
    lastAuthoritativeBalanceRef.current = nextBalance

    setBalance(current => (current === nextBalance ? current : nextBalance))
  }, [])

  const syncBalanceFromDb = useCallback(async () => {
    const id = deviceIdRef.current
    if (!id) return
    if (balanceSyncInFlightRef.current) {
      balanceSyncRequestedRef.current = true
      return
    }

    const requestSeq = ++balanceSyncSeqRef.current
    const startedSuppressed = suppressRealtimeBalanceRef.current

    balanceSyncInFlightRef.current = true
    try {
      const snapshot = await fetchDeviceBalance(id)
      if (startedSuppressed) return
      if (requestSeq !== balanceSyncSeqRef.current) return
      applyAuthoritativeBalance(snapshot)
    } catch (error) {
      console.error('[engine] authoritative balance sync failed', error)
    } finally {
      balanceSyncInFlightRef.current = false
      if (balanceSyncRequestedRef.current) {
        balanceSyncRequestedRef.current = false
        window.setTimeout(() => {
          void syncBalanceFromDb()
        }, 0)
      }
    }
  }, [applyAuthoritativeBalance])

  const releaseRealtimeBalance = useCallback(() => {
    // Lift suppression only; avoid immediate fetch to prevent stale REST read overwrites.
    suppressRealtimeBalanceRef.current = false
  }, [])

  /* -----------------------------
     Debug
  ----------------------------- */
  const [debugInfo, setDebugInfo] = useState<DebugSpinInfo | undefined>()

  useEffect(() => {
    let mounted = true

    let unsubscribe: (() => void) | null = null
    let runtimeChannel: { unsubscribe: () => void } | null = null
    let jackpotQueueChannel: { unsubscribe: () => void } | null = null
    let balancePollTimer: number | null = null
    let jackpotQueuePollTimer: number | null = null

    startEngine({
      config: DEFAULT_ENGINE_CONFIG,
      version: 'ui-local-default',
    })

    const applyRuntimeMode = (runtime: { active_mode: 'BASE' | 'HAPPY'; max_win_enabled?: boolean }) => {
      const mode = runtime.active_mode === 'HAPPY' ? 'HAPPY' : 'BASE'
      const nextConfig = mode === 'HAPPY' ? DEFAULT_ENGINE_HAPPY_HOUR : DEFAULT_ENGINE_CONFIG
      maxWinEnabledRef.current = runtime.max_win_enabled ?? true

      hotUpdateEngine({
        config: nextConfig,
        version: `runtime-${mode}-${Date.now()}`,
      })
      setRuntimeMode(mode)
    }

    async function init() {
      if (!mounted) return
      const id = await ensureDeviceRegistered('Arcade Cabinet')
      setDeviceId(id)
      snapshotKeyRef.current = `${FREE_SPIN_SNAPSHOT_PREFIX}:${id}`

      const seed = `${id}:${generateSeed()}`
      seedRef.current = seed
      rngRef.current = createRNG(seed)

      try {
        const sessionId = await startDeviceGameSession({
          deviceId: id,
          gameId: 'ultra-ace',
          gameName: 'Ultra Ace',
          runtimeMode: 'BASE',
          state: {
            runtimeMode: 'BASE',
            isFreeGame: false,
            freeSpinsLeft: 0,
            pendingFreeSpins: 0,
            showFreeSpinIntro: false,
            spinId: 0,
            spinning: false,
            scatterTriggerType: null,
          },
        })
        sessionIdRef.current = sessionId
      } catch (err) {
        console.error('[device-session] start failed', err)
      }

      const initialBalance = await fetchDeviceBalance(id)
      applyAuthoritativeBalance(initialBalance)
      const loadActiveJackpotQueue = async () => {
        try {
          const next = await fetchActiveJackpotQueue(id)
          if (mounted) setActiveJackpotQueue(next)
        } catch {
          // no-op
        }
      }
      await loadActiveJackpotQueue()

      if (typeof window !== 'undefined' && snapshotKeyRef.current) {
        try {
          const raw = window.localStorage.getItem(snapshotKeyRef.current)
          if (raw) {
            const parsed = JSON.parse(raw) as FreeSpinSnapshot
            const age = Date.now() - Number(parsed.updatedAt ?? 0)
            if (age >= 0 && age <= FREE_SPIN_SNAPSHOT_MAX_AGE_MS) {
              const restoredFreeSpinsLeft = Math.max(0, Math.floor(parsed.freeSpinsLeft ?? 0))
              const restoredPendingFreeSpins = Math.max(
                0,
                Math.floor(parsed.pendingFreeSpins ?? 0),
              )
              const restoredIsFreeGame = Boolean(parsed.isFreeGame) && restoredFreeSpinsLeft > 0
              const restoredShowIntro = !restoredIsFreeGame && restoredPendingFreeSpins > 0

              setIsFreeGame(restoredIsFreeGame)
              setFreeSpinsLeft(restoredIsFreeGame ? restoredFreeSpinsLeft : 0)
              setPendingFreeSpins(restoredPendingFreeSpins)
              setFreeSpinTotal(Math.max(0, Number(parsed.freeSpinTotal ?? 0)))
              setShowFreeSpinIntro(restoredShowIntro)
              setScatterTriggerType(parsed.scatterTriggerType ?? null)
            } else {
              window.localStorage.removeItem(snapshotKeyRef.current)
            }
          }
        } catch {
          window.localStorage.removeItem(snapshotKeyRef.current)
        }
      }

      unsubscribe = subscribeToDeviceBalance(id, _snapshot => {
        applyAuthoritativeBalance(_snapshot)
      })
      jackpotQueueChannel = subscribeActiveJackpotQueue(id, next => {
        setActiveJackpotQueue(next)
      })

      balancePollTimer = window.setInterval(() => {
        void syncBalanceFromDb()
      }, BALANCE_FALLBACK_SYNC_MS)
      jackpotQueuePollTimer = window.setInterval(() => {
        void loadActiveJackpotQueue()
      }, JACKPOT_QUEUE_FALLBACK_SYNC_MS)

      setSessionReady(true)

      try {
        const runtime = await fetchCasinoRuntimeLive()
        if (mounted) {
          applyRuntimeMode(runtime)
        }
      } catch (err) {
        console.error('[runtime] initial load failed', err)
      }

      runtimeChannel = subscribeCasinoRuntimeLive(next => {
        applyRuntimeMode(next)
      })
    }

    init().catch(err => {
      console.error('Boot failed', err)
    })

    return () => {
      mounted = false
      if (unsubscribe) unsubscribe()
      if (runtimeChannel) runtimeChannel.unsubscribe()
      if (jackpotQueueChannel) jackpotQueueChannel.unsubscribe()
      if (balancePollTimer !== null) clearInterval(balancePollTimer)
      if (jackpotQueuePollTimer !== null) clearInterval(jackpotQueuePollTimer)
      if (deviceIdRef.current) {
        void endDeviceGameSession({
          deviceId: deviceIdRef.current,
          sessionId: sessionIdRef.current,
          reason: 'unmount',
        }).catch(err => {
          console.error('[device-session] end on unmount failed', err)
        })
      }
    }
  }, [])

  useEffect(() => {
    if (!ENABLE_DEVICE_STATE_SYNC) return
    if (!sessionReady || !deviceId) return

    const statePayload = {
      runtimeMode,
      isFreeGame,
      freeSpinsLeft,
      pendingFreeSpins,
      showFreeSpinIntro,
      spinId,
      spinning,
      scatterTriggerType,
    } as const

    void updateDeviceGameState({
      deviceId,
      sessionId: sessionIdRef.current,
      state: statePayload,
    }).catch(err => {
      console.error('[device-session] state update failed', err)
    })

    const heartbeatTimer = window.setInterval(() => {
      void updateDeviceGameState({
        deviceId,
        sessionId: sessionIdRef.current,
        state: statePayload,
      }).catch(err => {
        console.error('[device-session] heartbeat failed', err)
      })
    }, DEVICE_STATE_HEARTBEAT_MS)

    return () => clearInterval(heartbeatTimer)
  }, [
    sessionReady,
    deviceId,
    runtimeMode,
    isFreeGame,
    freeSpinsLeft,
    pendingFreeSpins,
    showFreeSpinIntro,
    spinId,
    spinning,
    scatterTriggerType,
  ])

  useEffect(() => {
    if (!deviceId) return

    const end = () => {
      void endDeviceGameSession({
        deviceId,
        sessionId: sessionIdRef.current,
        reason: 'pagehide',
      }).catch(err => {
        console.error('[device-session] end on pagehide failed', err)
      })
    }

    window.addEventListener('pagehide', end)
    window.addEventListener('beforeunload', end)

    return () => {
      window.removeEventListener('pagehide', end)
      window.removeEventListener('beforeunload', end)
    }
  }, [deviceId])

  async function refreshRuntimeMode() {
    try {
      const runtime = await fetchCasinoRuntimeLive()
      const mode = runtime.active_mode === 'HAPPY' ? 'HAPPY' : 'BASE'
      const nextConfig = mode === 'HAPPY' ? DEFAULT_ENGINE_HAPPY_HOUR : DEFAULT_ENGINE_CONFIG
      maxWinEnabledRef.current = runtime.max_win_enabled ?? true
      hotUpdateEngine({
        config: nextConfig,
        version: `runtime-pre-spin-${mode}-${Date.now()}`,
      })
      setRuntimeMode(mode)
    } catch (err) {
      console.error('[runtime] pre-spin refresh failed', err)
    }
  }

  function getMaxWinCapForBet(lastBetAmount: number): number | null {
    if (!maxWinEnabledRef.current) return null
    const betAmount = Math.max(0, Number(lastBetAmount || 0))
    if (betAmount <= 0) return null
    let multiplier = 700
    if (betAmount < 20) multiplier = 3000
    else if (betAmount < 100) multiplier = 2500
    else if (betAmount < 200) multiplier = 2000
    else if (betAmount < 300) multiplier = 1500
    else if (betAmount < 500) multiplier = 1000
    return betAmount * multiplier
  }

  function clampToCurrentSpinMax(nextValue: number): number {
    const cap = currentSpinMaxWinRef.current
    if (cap === null) return nextValue
    return Math.min(nextValue, cap)
  }

  function inferJackpotPayoutFromQueue(
    before: ActiveJackpotQueue | null,
    after: ActiveJackpotQueue | null,
  ): number {
    if (!before) return 0
    if (before.remaining_amount <= 0 || before.payouts_left <= 0) return 0

    if (!after || after.id !== before.id) {
      return Math.max(0, Number(before.remaining_amount ?? 0))
    }

    const paid = Number(before.remaining_amount ?? 0) - Number(after.remaining_amount ?? 0)
    if (!Number.isFinite(paid) || paid <= 0) return 0
    return paid
  }

  function applyJackpotPresentation(outcome: SpinOutcome, jackpotPayout: number): SpinOutcome {
    const bonus = Number(jackpotPayout ?? 0)
    if (!Number.isFinite(bonus) || bonus <= 0) return outcome

    const cascades = outcome.cascades ?? []
    if (cascades.length === 0) {
      return {
        ...outcome,
        win: outcome.win + bonus,
      }
    }

    const nextCascades = cascades.map(step => ({ ...step }))
    const payableCascadeIndexes = cascades
      .map((step, index) => ({
        step,
        index,
      }))
      .filter(item => item.index > 0 && (item.step.lineWins?.length ?? 0) > 0)
      .map(item => item.index)
    const fallbackIndexes =
      payableCascadeIndexes.length > 0
        ? payableCascadeIndexes
        : cascades.map((_, index) => index).filter(index => index > 0)
    const targetIndexes =
      fallbackIndexes.length > 0 ? fallbackIndexes : cascades.map((_, index) => index)
    const weights = targetIndexes.map(index => Math.max(Number(cascades[index]?.multiplier ?? 1), 1))
    const totalWeight = weights.reduce((sum, value) => sum + value, 0)
    let remaining = bonus

    for (let i = 0; i < targetIndexes.length; i++) {
      const cascadeIndex = targetIndexes[i]
      const isLast = i === targetIndexes.length - 1
      const rawShare = isLast ? remaining : (bonus * weights[i]) / Math.max(totalWeight, 1)
      const share = Math.max(0, Math.round(rawShare * 100) / 100)
      const currentCascade = nextCascades[cascadeIndex]
      currentCascade.win = Math.max(0, Number(currentCascade.win ?? 0) + share)

      const lineWins = currentCascade.lineWins ?? []
      if (lineWins.length > 0 && share > 0) {
        const lineWeights = lineWins.map(line => Math.max(Number(line.payout ?? 0), 1))
        const totalLineWeight = lineWeights.reduce((sum, value) => sum + value, 0)
        let lineRemaining = share

        currentCascade.lineWins = lineWins.map((lineWin, lineIndex) => {
          const isLastLine = lineIndex === lineWins.length - 1
          const rawLineShare = isLastLine
            ? lineRemaining
            : (share * lineWeights[lineIndex]) / Math.max(totalLineWeight, 1)
          const lineShare = Math.max(0, Math.round(rawLineShare * 100) / 100)
          lineRemaining = Math.max(0, lineRemaining - lineShare)

          return {
            ...lineWin,
            payout: Math.max(0, Number(lineWin.payout ?? 0) + lineShare),
          }
        })
      }

      remaining = Math.max(0, remaining - share)
    }

    return {
      ...outcome,
      win: Number(outcome.win ?? 0) + bonus,
      cascades: nextCascades,
    }
  }

  useEffect(() => {
    deviceIdRef.current = deviceId
    if (deviceId) {
      lastAuthoritativeUpdatedAtRef.current = 0
      lastAuthoritativeBalanceRef.current = 0
    }
  }, [deviceId])

  useEffect(() => {
    isFreeGameRef.current = isFreeGame
  }, [isFreeGame])

  useEffect(() => {
    if (!activeJackpotQueue) {
      forceJackpotScatterRef.current = false
      activeJackpotQueueIdRef.current = null
      return
    }

    if (activeJackpotQueueIdRef.current !== activeJackpotQueue.id) {
      activeJackpotQueueIdRef.current = activeJackpotQueue.id
      forceJackpotScatterRef.current = false
    }

    if (
      activeJackpotQueue.remaining_amount <= 0 ||
      activeJackpotQueue.payouts_left <= 0 ||
      isFreeGame ||
      pendingFreeSpins > 0 ||
      showFreeSpinIntro ||
      spinning
    ) {
      return
    }

    if (activeJackpotQueue.spins_until_start <= 1) {
      forceJackpotScatterRef.current = true
    }
  }, [activeJackpotQueue, isFreeGame, pendingFreeSpins, showFreeSpinIntro, spinning])

  useEffect(() => {
    freeSpinsLeftRef.current = freeSpinsLeft
  }, [freeSpinsLeft])

  useEffect(() => {
    freeSpinTotalRef.current = freeSpinTotal
  }, [freeSpinTotal])

  useEffect(() => {
    persistFreeSpinSnapshot({
      updatedAt: Date.now(),
      isFreeGame,
      freeSpinsLeft,
      pendingFreeSpins,
      freeSpinTotal,
      showFreeSpinIntro,
      scatterTriggerType,
    })
  }, [
    isFreeGame,
    freeSpinsLeft,
    pendingFreeSpins,
    freeSpinTotal,
    showFreeSpinIntro,
    scatterTriggerType,
  ])

  function startFreeSpins() {
    if (isFreeGameRef.current) return false
    if (pendingFreeSpins <= 0) return false

    // Sync refs immediately so first free-spin launch cannot be dropped by stale-ref guards.
    isFreeGameRef.current = true
    freeSpinsLeftRef.current = pendingFreeSpins
    setIsFreeGame(true)
    setFreeSpinsLeft(pendingFreeSpins)
    setShowFreeSpinIntro(false)
    setPendingFreeSpins(0)
    return true
  }

  /* -----------------------------
     Spin execution
  ----------------------------- */
  async function spinNow() {
    if (spinning) return
    if (spinLockRef.current) return
    if (!rngRef.current) return

    // Free-spin intro/manual path should explicitly enter free spins first.
    if (!isFreeGame && pendingFreeSpins > 0) return

    if (!isFreeGame && balance < bet) return
    if (isFreeGame && freeSpinsLeftRef.current <= 0) return

    const forceJackpotScatter = !isFreeGame && forceJackpotScatterRef.current
    if (forceJackpotScatter) {
      forceJackpotScatterRef.current = false
    }

    spinLockRef.current = true
    // Invalidate any in-flight authoritative sync started before this spin.
    balanceSyncSeqRef.current += 1
    suppressRealtimeBalanceRef.current = true
    setSpinning(true)
    await refreshRuntimeMode()

    if (!isFreeGame) {
      setTotalWin(0)
      setBalance(b => Math.max(0, b - bet))
      setFreeSpinTotal(0)
    } else {
      setTotalWin(0)
      // One decrement per started free spin.
      setFreeSpinsLeft(v => Math.max(v - 1, 0))
    }

    const spinAmount = isFreeGame && scatterTriggerType === 'buy' ? buySpinBet : bet
    const queueBeforeSpin = isFreeGame ? activeJackpotQueue : null

    const outcome: SpinOutcome = spin(rngRef.current, {
      betPerSpin: spinAmount,
      lines: 5,
      isFreeGame,
      forceScatter: forceJackpotScatter,
      freeSpinSource: isFreeGame ? (scatterTriggerType === 'buy' ? 'buy' : 'natural') : undefined,
    })
    const rawTotalWin = Number.isFinite(Number(outcome.win)) ? Number(outcome.win) : 0
    currentSpinMaxWinRef.current = getMaxWinCapForBet(isFreeGame ? bet : spinAmount)
    const engineTotalWin = clampToCurrentSpinMax(rawTotalWin)
    const nextSpinId = spinCounterRef.current + 1
    spinCounterRef.current = nextSpinId

    let jackpotPayoutForSpin = 0

    if (deviceIdRef.current) {
      try {
        const accounting = await commitSpinAccounting({
          deviceId: deviceIdRef.current,
          spinId: nextSpinId,
          isFreeGame,
          betAmount: isFreeGame ? 0 : spinAmount,
          totalWin: engineTotalWin,
          freeSpinsAwarded: outcome.freeSpinsAwarded ?? 0,
          cascades: outcome.cascades?.length ?? 0,
          triggerType: scatterTriggerType ?? null,
        })
        jackpotPayoutForSpin = Number(accounting?.jackpotPayout ?? 0)

        if (jackpotPayoutForSpin <= 0 && queueBeforeSpin) {
          try {
            const queueAfterSpin = await fetchActiveJackpotQueue(deviceIdRef.current)
            const inferred = inferJackpotPayoutFromQueue(queueBeforeSpin, queueAfterSpin)
            if (inferred > 0) {
              jackpotPayoutForSpin = inferred
            }
            setActiveJackpotQueue(queueAfterSpin)
          } catch {
            // no-op
          }
        }
      } catch (error) {
        console.error('[engine] spin accounting failed, skipping animation start', error)
        if (forceJackpotScatter) {
          forceJackpotScatterRef.current = true
        }
        if (!isFreeGame) {
          setBalance(b => b + spinAmount)
          setFreeSpinTotal(0)
        } else {
          setFreeSpinsLeft(v => v + 1)
        }
        releaseRealtimeBalance()
        spinLockRef.current = false
        setSpinning(false)
        return
      }
    }

    const presentedOutcome =
      jackpotPayoutForSpin > 0 ? applyJackpotPresentation(outcome, jackpotPayoutForSpin) : outcome
    const presentedTotalWin = clampToCurrentSpinMax(Number(presentedOutcome.win ?? 0))

    lastOutcomeRef.current = presentedOutcome

    setPendingCascades(presentedOutcome.cascades ?? [])
    setSpinId(v => v + 1)

    setDebugInfo({
      seed: seedRef?.current ?? undefined,
      bet,
      win: presentedTotalWin,
      cascadeWins: (presentedOutcome.cascades ?? []).map(c => c.win ?? 0),
    })

    if (!isFreeGame && forceJackpotScatter) {
      setScatterTriggerType('natural')
      setPendingFreeSpins(JACKPOT_FREE_SPIN_COUNT)
    } else if (presentedOutcome.freeSpinsAwarded > 0) {
      if (!isFreeGame) {
        setScatterTriggerType('natural')
        setPendingFreeSpins(presentedOutcome.freeSpinsAwarded)
      } else {
        // setFreeSpinsLeft(v => v + outcome.freeSpinsAwarded)
      }
    }
  }

  /* -----------------------------
     Visual win accumulator
  ----------------------------- */
  function commitWin(amount: number) {
    setTotalWin(current => {
      const next = clampToCurrentSpinMax(current + amount)
      const delta = Math.max(0, next - current)
      if (delta > 0 && !isFreeGameRef.current) {
        setBalance(v => v + delta)
      } else if (delta > 0) {
        setFreeSpinTotal(v => v + delta)
      }
      return next
    })
  }

  async function buyFreeSpins(betAmount: number) {
    if (spinning || showFreeSpinIntro || freeSpinsLeft > 0 || pendingFreeSpins > 0) return
    if (spinLockRef.current) return
    if (!rngRef.current || !deviceIdRef.current) return

    const cost = betAmount * BUY_FREE_SPIN_MULTIPLIER
    if (balance < cost) return

    spinLockRef.current = true
    // Invalidate any in-flight authoritative sync started before this spin.
    balanceSyncSeqRef.current += 1
    setBalance(b => Math.max(0, b - cost))
    suppressRealtimeBalanceRef.current = true
    setSpinning(true)
    setTotalWin(0)
    setFreeSpinTotal(0)
    await refreshRuntimeMode()

    const outcome: SpinOutcome = spin(rngRef.current, {
      betPerSpin: betAmount,
      lines: 5,
      isFreeGame: false,
      forceScatter: true,
    })

    const rawTotalWin = Number.isFinite(Number(outcome.win)) ? Number(outcome.win) : 0
    currentSpinMaxWinRef.current = getMaxWinCapForBet(betAmount)
    const totalWin = clampToCurrentSpinMax(rawTotalWin)
    const nextSpinId = spinCounterRef.current + 1
    spinCounterRef.current = nextSpinId

    try {
      await commitSpinAccounting({
        deviceId: deviceIdRef.current,
        spinId: nextSpinId,
        isFreeGame: false,
        betAmount: cost,
        totalWin,
        freeSpinsAwarded: outcome.freeSpinsAwarded ?? 0,
        cascades: outcome.cascades?.length ?? 0,
        triggerType: 'buy',
      })
    } catch (error) {
      console.error('[engine] buy spin accounting failed, skipping animation start', error)
      setBalance(b => b + cost)
      releaseRealtimeBalance()
      spinLockRef.current = false
      setSpinning(false)
      return
    }

    setScatterTriggerType('buy')
    setPendingCascades(outcome.cascades ?? [])
    setSpinId(v => v + 1)

    if (outcome.freeSpinsAwarded > 0) {
      setPendingFreeSpins(outcome.freeSpinsAwarded)
    }
  }

  /* -----------------------------
     Commit spin visuals
  ----------------------------- */
  async function commitSpin() {
    if (!pendingCascades || !deviceIdRef.current) return
    setCommittedCascades(pendingCascades)
    setPendingCascades(null)
    setSpinning(false)

    const outcome = lastOutcomeRef.current
    // const sessionId = sessionIdRef.current

    if (!outcome) return

    // await logSpin({
    //   sessionId,
    //   bet: outcome.bet,
    //   win: outcome.win ?? 0,
    //   baseWin: 0,
    //   freeWin: 0,
    //   cascades: outcome.cascades?.length ?? 0,
    //   hit: (outcome.win ?? 0) > 0,
    //   isFreeGame,
    // })

    // Jackpot contribution
    const loss = outcome.bet - (outcome.win ?? 0)

    if (loss > 0) {
      // const contribution = Math.floor(loss * 0.05)
    }

    // End free game only after the last free spin has fully settled.
    if (isFreeGameRef.current && freeSpinsLeftRef.current === 0) {
      endFreeSpin()
    }
  }

  const endFreeSpin = () => {
    setTimeout(() => {
      setIsFreeGame(false)
      setFreezeUI(true)
      setShowScatterWinBanner(true)
      releaseRealtimeBalance()

      setTimeout(() => {
        setFreeSpinTotal(0)
        setTotalWin(0)

        setShowScatterWinBanner(false)
        setScatterTriggerType(null)
        setFreezeUI(false)
        clearFreeSpinSnapshot()
      }, SCATTER_BANNER_DURATION)
    }, 600)
  }

  function settleSpinVisuals() {
    spinLockRef.current = false

    // Keep UI balance suppressed during free spins so jackpot is felt via spin wins first.
    if (isFreeGameRef.current) {
      return
    }

    releaseRealtimeBalance()
    void syncBalanceFromDb()
  }

  /* -----------------------------
     Public API
  ----------------------------- */
  return {
    cascades: committedCascades,
    spinning,
    spinId,
    spin: spinNow,
    commitSpin,
    commitWin,

    deviceId: deviceIdRef.current,
    balance,
    setBalance,
    bet,
    setBet,
    totalWin,

    buySpinBet,
    setBuySpinBet,

    isFreeGame,
    freeSpinsLeft,

    pendingFreeSpins,
    freeSpinTotal,
    setFreeSpinTotal,

    showFreeSpinIntro,
    setShowFreeSpinIntro,
    showScatterWinBanner,

    debugInfo,
    buyFreeSpins,
    scatterTriggerType,
    runtimeMode,
    startFreeSpins,
    settleSpinVisuals,

    freezeUI,
    sessionReady,

    withdrawAmount,
    setWithdrawAmount,

    isWithdrawing,
    setIsWithdrawing,

    showWithdrawModal,
    setShowWithdrawModal,
  }
}
