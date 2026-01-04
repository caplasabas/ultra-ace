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

  // Per-spin visual accumulator (cleared every spin)
  const [totalWin, setTotalWin] = useState(0)

  // Free-spin session accumulator (settled once at the end)
  const [freeSpinTotal, setFreeSpinTotal] = useState(0)

  /* -----------------------------
     Free spin state
  ----------------------------- */
  const [isFreeGame, setIsFreeGame] = useState(false)
  const [freeSpinsLeft, setFreeSpinsLeft] = useState(0)
  const [pendingFreeSpins, setPendingFreeSpins] = useState(0)

  /* -----------------------------
     Debug
  ----------------------------- */
  const [debugInfo, setDebugInfo] = useState<DebugSpinInfo | undefined>(undefined)

  /* -----------------------------
     RNG
  ----------------------------- */
  const seed = new Date().toISOString()
  const rng = createRNG(seed)

  /* -----------------------------
     Spin execution
  ----------------------------- */
  function spinNow() {
    if (spinning || balance < bet || balance === 0) return

    setSpinning(true)
    setTotalWin(0) // reset per-spin visual win

    const outcome: SpinOutcome = spin(rng, {
      betPerSpin: bet,
      lines: 5,
      isFreeGame,
    })

    // Deduct bet only in base game
    if (!isFreeGame) {
      setBalance(b => b - bet)
    }

    setPendingCascades(outcome.cascades ?? [])
    setSpinId(id => id + 1)

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
        setPendingFreeSpins(0)
      }
    }
  }

  /* -----------------------------
     Visual win accumulator
     (does NOT touch balance)
  ----------------------------- */
  function commitWin(amount: number) {
    setTotalWin(w => w + amount)
  }

  /* -----------------------------
     End-of-spin commit
  ----------------------------- */
  function commitSpin() {
    if (!pendingCascades) return

    setCommittedCascades(pendingCascades)
    setPendingCascades(null)
    setSpinning(false)

    /* -----------------------------
       ENTER FREE SPINS
    ----------------------------- */
    if (!isFreeGame && pendingFreeSpins > 0) {
      setIsFreeGame(true)
      setFreeSpinsLeft(pendingFreeSpins)
      setFreeSpinTotal(0) // ✅ reset session total HERE
      setPendingFreeSpins(0)
      return
    }

    /* -----------------------------
       FREE SPIN LOOP
    ----------------------------- */
    if (isFreeGame) {
      setFreeSpinsLeft(v => {
        const next = v - 1

        // 🎉 END OF FREE SPINS → settle once
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
    /* Engine */
    cascades: committedCascades,
    spinning,
    spinId,
    spin: spinNow,
    commitSpin,
    commitWin,

    /* Economy */
    balance,
    setBalance,
    bet,
    setBet,
    totalWin,

    /* Free spins */
    isFreeGame,
    freeSpinsLeft,
    freeSpinTotal,
    setFreeSpinTotal,

    /* Debug */
    debugInfo,
  }
}
