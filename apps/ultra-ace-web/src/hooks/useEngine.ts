import { useEffect, useState } from 'react'
import { spin, createRNG } from '@ultra-ace/engine'
import type { CascadeStep, SpinOutcome } from '@ultra-ace/engine'
import { DebugSpinInfo } from 'src/debug/DebugHud'

const BUY_FREE_SPIN_MULTIPLIER = 50

const SCATTER_BANNER_DURATION = 5000

export function useEngine() {
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
  const [balance, setBalance] = useState(5000)

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

  /* -----------------------------
     Debug
  ----------------------------- */
  const [debugInfo, setDebugInfo] = useState<DebugSpinInfo | undefined>()

  /* -----------------------------
     RNG
  ----------------------------- */
  const seed = new Date().toISOString()
  const rng = createRNG(seed)

  /* -----------------------------
     Spin execution
  ----------------------------- */
  function spinNow() {
    if (spinning) return

    // Enter free spins
    if (!isFreeGame && pendingFreeSpins > 0) {
      setIsFreeGame(true)
      setFreeSpinsLeft(pendingFreeSpins)
      setFreeSpinTotal(0)
      setPendingFreeSpins(0)
      setShowFreeSpinIntro(false)
      return
    }

    if (balance < bet || balance === 0) return

    setSpinning(true)

    if (!isFreeGame) {
      setTotalWin(0)
      setBalance(b => b - bet)
    }

    const outcome: SpinOutcome = spin(rng, {
      betPerSpin: bet,
      lines: 5,
      isFreeGame,
    })

    setScatterTriggerType(outcome.scatterTriggerType ?? null)
    setPendingCascades(outcome.cascades ?? [])
    setSpinId(v => v + 1)

    setDebugInfo({
      seed,
      bet,
      win: outcome.win ?? 0,
      cascadeWins: (outcome.cascades ?? []).map(c => c.win ?? 0),
    })

    if (outcome.freeSpinsAwarded > 0) {
      if (!isFreeGame) {
        setPendingFreeSpins(outcome.freeSpinsAwarded)
      } else {
        setFreeSpinsLeft(v => v + outcome.freeSpinsAwarded)
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

    const cost = betAmount * BUY_FREE_SPIN_MULTIPLIER
    if (balance < cost) return

    setBalance(b => b - cost)
    setSpinning(true)
    setTotalWin(0)

    const outcome: SpinOutcome = spin(rng, {
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
  function commitSpin() {
    if (!pendingCascades) return
    setCommittedCascades(pendingCascades)
    setPendingCascades(null)
    setSpinning(false)
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
        setBalance(b => b + freeSpinTotal)
        setFreeSpinTotal(0)
        setTotalWin(0)

        setShowScatterWinBanner(false)
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

    balance,
    setBalance,
    bet,
    setBet,
    totalWin,

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
  }
}
