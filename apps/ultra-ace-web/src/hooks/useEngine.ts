import { useEffect, useRef, useState } from 'react'
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
import { fetchDeviceBalance, subscribeToDeviceBalance } from '../lib/balance'
import { fetchCasinoRuntimeLive, subscribeCasinoRuntimeLive } from '../lib/runtime'
import { commitSpinAccounting } from '../lib/accounting'

const BUY_FREE_SPIN_MULTIPLIER = 50

const SCATTER_BANNER_DURATION = 5000
const FREE_SPIN_SNAPSHOT_PREFIX = 'ultraace.free-spin-state'
const FREE_SPIN_SNAPSHOT_MAX_AGE_MS = 1000 * 60 * 60 * 6

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
  const sessionIdRef = useRef<string | null>(null)
  const lastOutcomeRef = useRef<SpinOutcome | null>(null)
  const spinCounterRef = useRef(0)

  const rngRef = useRef<ReturnType<typeof createRNG> | null>(null)
  const seedRef = useRef<string | null>(null)

  const [deviceId, setDeviceId] = useState<string | null>(null)
  const deviceIdRef = useRef<string | null>(null)

  const [sessionReady, setSessionReady] = useState(false)
  const [runtimeMode, setRuntimeMode] = useState<'BASE' | 'HAPPY'>('BASE')

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

  /* -----------------------------
     Debug
  ----------------------------- */
  const [debugInfo, setDebugInfo] = useState<DebugSpinInfo | undefined>()

  useEffect(() => {
    let mounted = true

    let unsubscribe: (() => void) | null = null
    let runtimeChannel: { unsubscribe: () => void } | null = null

    startEngine({
      config: DEFAULT_ENGINE_CONFIG,
      version: 'ui-local-default',
    })

    const applyRuntimeMode = (mode: 'BASE' | 'HAPPY') => {
      const nextConfig = mode === 'HAPPY' ? DEFAULT_ENGINE_HAPPY_HOUR : DEFAULT_ENGINE_CONFIG

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

      const initialBalance = await fetchDeviceBalance(id)
      setBalance(initialBalance)

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

      unsubscribe = subscribeToDeviceBalance(id, newBalance => {
        setBalance(dbBalance => {
          if (dbBalance !== newBalance) {
            return newBalance
          }
          return dbBalance
        })
      })

      setSessionReady(true)

      try {
        const runtime = await fetchCasinoRuntimeLive()
        if (mounted) {
          applyRuntimeMode(runtime.active_mode)
        }
      } catch (err) {
        console.error('[runtime] initial load failed', err)
      }

      runtimeChannel = subscribeCasinoRuntimeLive(next => {
        applyRuntimeMode(next.active_mode)
      })
    }

    init().catch(err => {
      console.error('Boot failed', err)
    })

    return () => {
      mounted = false
      if (unsubscribe) unsubscribe()
      if (runtimeChannel) runtimeChannel.unsubscribe()
    }
  }, [])

  async function refreshRuntimeMode() {
    try {
      const runtime = await fetchCasinoRuntimeLive()
      const mode = runtime.active_mode === 'HAPPY' ? 'HAPPY' : 'BASE'
      const nextConfig = mode === 'HAPPY' ? DEFAULT_ENGINE_HAPPY_HOUR : DEFAULT_ENGINE_CONFIG
      hotUpdateEngine({
        config: nextConfig,
        version: `runtime-pre-spin-${mode}-${Date.now()}`,
      })
      setRuntimeMode(mode)
    } catch (err) {
      console.error('[runtime] pre-spin refresh failed', err)
    }
  }

  useEffect(() => {
    deviceIdRef.current = deviceId
  }, [deviceId])

  useEffect(() => {
    isFreeGameRef.current = isFreeGame
  }, [isFreeGame])

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
    if (!rngRef.current) return

    // Free-spin intro/manual path should explicitly enter free spins first.
    if (!isFreeGame && pendingFreeSpins > 0) return

    if (!isFreeGame && balance < bet) return
    if (isFreeGame && freeSpinsLeftRef.current <= 0) return

    setSpinning(true)
    await refreshRuntimeMode()

    if (!isFreeGame) {
      setTotalWin(0)
      setBalance(b => b - bet)
      setFreeSpinTotal(0)
    } else {
      // One decrement per started free spin.
      setFreeSpinsLeft(v => Math.max(v - 1, 0))
    }

    const spinAmount = isFreeGame && scatterTriggerType === 'buy' ? buySpinBet : bet

    const outcome: SpinOutcome = spin(rngRef.current, {
      betPerSpin: spinAmount,
      lines: 5,
      isFreeGame,
    })
    const totalWin = (outcome.cascades ?? []).reduce((sum, c) => sum + Number(c.win ?? 0), 0)
    const nextSpinId = spinCounterRef.current + 1
    spinCounterRef.current = nextSpinId

    if (deviceIdRef.current) {
      try {
        await commitSpinAccounting({
          deviceId: deviceIdRef.current,
          spinId: nextSpinId,
          isFreeGame,
          betAmount: isFreeGame ? 0 : spinAmount,
          totalWin,
          freeSpinsAwarded: outcome.freeSpinsAwarded ?? 0,
          cascades: outcome.cascades?.length ?? 0,
          triggerType: scatterTriggerType ?? null,
        })
      } catch (error) {
        console.error('[engine] spin accounting failed, skipping animation start', error)
        if (!isFreeGame) {
          setBalance(b => b + bet)
          setFreeSpinTotal(0)
        } else {
          setFreeSpinsLeft(v => v + 1)
        }
        setSpinning(false)
        return
      }
    }

    if (!isFreeGame) {
      if (outcome.freeSpinsAwarded > 0) {
        if (totalWin > 0) setFreeSpinTotal(totalWin)
      } else if (totalWin > 0) {
        setBalance(b => b + totalWin)
      }
    } else if (totalWin > 0) {
      setFreeSpinTotal(v => v + totalWin)
    }

    lastOutcomeRef.current = outcome

    setPendingCascades(outcome.cascades ?? [])
    setSpinId(v => v + 1)

    setDebugInfo({
      seed: seedRef?.current ?? undefined,
      bet,
      win: outcome.win ?? 0,
      cascadeWins: (outcome.cascades ?? []).map(c => c.win ?? 0),
    })

    if (outcome.freeSpinsAwarded > 0) {
      if (!isFreeGame) {
        setPendingFreeSpins(outcome.freeSpinsAwarded)
      } else {
        // setFreeSpinsLeft(v => v + outcome.freeSpinsAwarded)
      }
    }
  }

  /* -----------------------------
     Visual win accumulator
  ----------------------------- */
  function commitWin(amount: number) {
    setTotalWin(v => v + amount)
  }

  async function buyFreeSpins(betAmount: number) {
    if (spinning || showFreeSpinIntro || freeSpinsLeft > 0 || pendingFreeSpins > 0) return
    if (!rngRef.current || !deviceIdRef.current) return

    const cost = betAmount * BUY_FREE_SPIN_MULTIPLIER
    if (balance < cost) return

    setBalance(b => b - cost)
    setSpinning(true)
    setTotalWin(0)
    await refreshRuntimeMode()

    const outcome: SpinOutcome = spin(rngRef.current, {
      betPerSpin: betAmount,
      lines: 5,
      isFreeGame: false,
      forceScatter: true,
    })

    const totalWin = (outcome.cascades ?? []).reduce((sum, c) => sum + Number(c.win ?? 0), 0)
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
      setSpinning(false)
      return
    }

    setScatterTriggerType('buy')
    if (outcome.freeSpinsAwarded > 0) {
      if (totalWin > 0) setFreeSpinTotal(totalWin)
    } else if (totalWin > 0) {
      setBalance(b => b + totalWin)
    }
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

      setTimeout(() => {
        setBalance(v => v + freeSpinTotalRef.current)
        setFreeSpinTotal(0)
        setTotalWin(0)

        setShowScatterWinBanner(false)
        setScatterTriggerType('natural')
        setFreezeUI(false)
        clearFreeSpinSnapshot()
      }, SCATTER_BANNER_DURATION)
    }, 600)
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
