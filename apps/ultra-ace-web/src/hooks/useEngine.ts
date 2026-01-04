import { useState } from 'react'
import { spin, createRNG } from '@ultra-ace/engine'
import type { CascadeStep, SpinOutcome } from '@ultra-ace/engine'
import { DebugSpinInfo } from 'src/debug/DebugHud'

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

  /* -----------------------------
     Spin execution
  ----------------------------- */
  function spinNow() {
    // 🔒 hard block during intro
    if (spinning || showFreeSpinIntro) return

    // entering free spins happens HERE
    if (!isFreeGame && pendingFreeSpins > 0) {
      setIsFreeGame(true)
      setFreeSpinsLeft(pendingFreeSpins)
      setFreeSpinTotal(0)
      setPendingFreeSpins(0)
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

  /* -----------------------------
     End-of-spin commit
  ----------------------------- */
  function commitSpin() {
    if (!pendingCascades) return

    setCommittedCascades(pendingCascades)
    setPendingCascades(null)
    setSpinning(false)

    // 🔁 free spin decrement happens AFTER spins only
    if (isFreeGame) {
      setFreeSpinsLeft(v => {
        const next = v - 1

        if (next <= 0) {
          setIsFreeGame(false)
          setBalance(b => b + freeSpinTotal)
          setFreeSpinTotal(0)
          return 0
        }

        return next
      })
    }
  }

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
  }
}
