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
import { logLedgerEvent } from '../lib/accounting'
import { ensureDeviceRegistered } from '../lib/device'
import { fetchDeviceBalance, subscribeToDeviceBalance } from '../lib/balance'
import { queueMetricEvent } from '../lib/metrics'
import { fetchCasinoRuntimeLive, subscribeCasinoRuntimeLive } from '../lib/runtime'

const BUY_FREE_SPIN_MULTIPLIER = 50

const SCATTER_BANNER_DURATION = 5000

function generateSeed(): string {
  const buf = new Uint32Array(4)
  crypto.getRandomValues(buf)

  return [Date.now(), buf[0], buf[1], buf[2], buf[3]].join('-')
}

export function useEngine() {
  const sessionIdRef = useRef<string | null>(null)
  const lastOutcomeRef = useRef<SpinOutcome | null>(null)

  const rngRef = useRef<ReturnType<typeof createRNG> | null>(null)
  const seedRef = useRef<string | null>(null)

  const [deviceId, setDeviceId] = useState<string | null>(null)
  const deviceIdRef = useRef<string | null>(null)

  const [sessionReady, setSessionReady] = useState(false)

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
    }

    async function init() {
      if (!mounted) return
      const id = await ensureDeviceRegistered('Arcade Cabinet')
      setDeviceId(id)

      const seed = `${id}:${generateSeed()}`
      seedRef.current = seed
      rngRef.current = createRNG(seed)

      const initialBalance = await fetchDeviceBalance(id)
      setBalance(initialBalance)

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

  useEffect(() => {
    deviceIdRef.current = deviceId
  }, [deviceId])

  /* -----------------------------
     Spin execution
  ----------------------------- */
  function spinNow() {
    if (spinning) return
    if (!rngRef.current) return

    // Enter free spins
    if (!isFreeGame && pendingFreeSpins > 0) {
      setIsFreeGame(true)
      setFreeSpinsLeft(pendingFreeSpins)

      setShowFreeSpinIntro(false)

      setPendingFreeSpins(0)

      return
    }

    if (balance < bet || (balance === 0 && !isFreeGame)) return

    setSpinning(true)

    if (deviceIdRef.current) {
      queueMetricEvent(deviceIdRef.current, 'spin', 1)
    }

    if (!isFreeGame) {
      setTotalWin(0)
      setBalance(b => b - bet)
      setFreeSpinTotal(0)
    }

    const spinAmount = isFreeGame && scatterTriggerType === 'buy' ? buySpinBet : bet

    if (deviceIdRef.current && !isFreeGame) {
      logLedgerEvent({
        deviceId: deviceIdRef.current,
        type: 'bet',
        amount: spinAmount,
        source: 'game',
      }).then(() => {})
    }

    const outcome: SpinOutcome = spin(rngRef.current, {
      betPerSpin: spinAmount,
      lines: 5,
      isFreeGame,
    })

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

  function buyFreeSpins(betAmount: number) {
    if (spinning || showFreeSpinIntro || freeSpinsLeft > 0 || pendingFreeSpins > 0) return
    if (!rngRef.current || !deviceIdRef.current) return

    const cost = betAmount * BUY_FREE_SPIN_MULTIPLIER
    if (balance < cost) return

    setBalance(b => b - cost)
    setSpinning(true)
    setTotalWin(0)

    queueMetricEvent(deviceIdRef.current, 'spin', 1)

    if (sessionIdRef?.current) {
      logLedgerEvent({
        deviceId: deviceIdRef.current,
        type: 'bet',
        amount: cost,
        source: 'game',
      }).then(() => {})
    }

    const outcome: SpinOutcome = spin(rngRef.current, {
      betPerSpin: betAmount,
      lines: 5,
      isFreeGame: false,
      forceScatter: true,
    })

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
  }

  /* -----------------------------
     Consume free spin (AFTER settle)
  ----------------------------- */
  function consumeFreeSpin() {
    setFreeSpinsLeft(v => {
      const next = Math.max(v - 1, -1)
      if (next === -1) {
        endFreeSpin()
      }
      return next
    })
  }

  const endFreeSpin = () => {
    setTimeout(() => {
      setIsFreeGame(false)
      setFreezeUI(true)
      setShowScatterWinBanner(true)

      setTimeout(() => {
        setBalance(balance + freeSpinTotal)
        setFreeSpinTotal(0)
        setTotalWin(0)

        setShowScatterWinBanner(false)
        setScatterTriggerType('natural')
        setFreezeUI(false)
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
    consumeFreeSpin,

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
