import { useEffect, useState } from 'react'
import { spin, createRNG } from '@ultra-ace/engine'
import type { CascadeStep, SpinOutcome } from '@ultra-ace/engine'
import { DebugSpinInfo } from 'src/debug/DebugHud'

const BUY_FREE_SPIN_MULTIPLIER = 50
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

  // 🎬 intro overlay
  const [showFreeSpinIntro, setShowFreeSpinIntro] = useState(false)
  /* -----------------------------
     Debug
  ----------------------------- */
  const [debugInfo, setDebugInfo] = useState<DebugSpinInfo | undefined>()

  /* -----------------------------
     RNG
  ----------------------------- */
  const seed = new Date().toISOString()
  const rng = createRNG(seed)

  function spinNow() {
    // 🔒 hard block during intro
    if (spinning) return

    // entering free spins happens HERE
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
    setTotalWin(0)

    const outcome: SpinOutcome = spin(rng, {
      betPerSpin: bet,
      lines: 5,
      isFreeGame,
    })

    setScatterTriggerType(outcome.scatterTriggerType ?? null)

    if (!isFreeGame) {
      setBalance(b => b - bet)
    }

    setPendingCascades(outcome.cascades ?? [])
    setSpinId(v => v + 1)

    setDebugInfo({
      seed,
      bet,
      win: outcome.win ?? 0,
      cascadeWins: (outcome.cascades ?? []).map(c => c.win ?? 0),
    })

    let freeSpinsAwarded = outcome.freeSpinsAwarded

    if (freeSpinsAwarded > 0) {
      if (!isFreeGame) {
        setPendingFreeSpins(freeSpinsAwarded)
      } else {
        setFreeSpinsLeft(v => v + freeSpinsAwarded)
      }
    }
  }

  /* -----------------------------
     Visual win accumulator
  ----------------------------- */
  function commitWin(amount: number) {
    setTotalWin(v => v + amount)
  }

  function buyFreeSpins() {
    if (spinning || showFreeSpinIntro) return

    const cost = bet * BUY_FREE_SPIN_MULTIPLIER
    if (balance < cost) return

    setBalance(b => b - cost)
    setSpinning(true)
    setTotalWin(0)

    const outcome: SpinOutcome = spin(rng, {
      betPerSpin: bet,
      lines: 5,
      isFreeGame: false,
      forceScatter: true, // 🔑 HERE
    })

    setScatterTriggerType('buy')

    setPendingCascades(outcome.cascades ?? [])
    setSpinId(v => v + 1)

    if (outcome.freeSpinsAwarded > 0) {
      setPendingFreeSpins(outcome.freeSpinsAwarded)
    }
  }

  function commitSpin() {
    if (!pendingCascades) return

    setCommittedCascades(pendingCascades)
    setPendingCascades(null)
    setSpinning(false)
  }

  function consumeFreeSpin() {
    setFreeSpinsLeft(v => Math.max(v - 1, 0))
  }

  useEffect(() => {
    if (isFreeGame) {
      if (freeSpinsLeft === 0 && pendingFreeSpins === 0 && !spinning) {
        const t = setTimeout(() => {
          setIsFreeGame(false)
        }, 800)

        return () => clearTimeout(t)
      }

      if ((freeSpinsLeft > 0 || pendingFreeSpins > 0) && spinning) {
        setBalance(b => b + freeSpinTotal)
        setFreeSpinTotal(0)
      }
    }
  }, [isFreeGame, freeSpinsLeft, pendingFreeSpins, spinning])

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
    debugInfo,
    buyFreeSpins,
    scatterTriggerType,
    consumeFreeSpin,
  }
}
