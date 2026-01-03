import { useState } from 'react'
import { spin, createRNG } from '@ultra-ace/engine'
import type { CascadeStep, SpinOutcome } from '@ultra-ace/engine'
import { DebugSpinInfo } from 'src/debug/DebugHud'

export function useEngine() {
  const [committedCascades, setCommittedCascades] = useState<CascadeStep[]>([])
  const [pendingCascades, setPendingCascades] = useState<CascadeStep[] | null>(null)

  const [bet, setBet] = useState(2)
  const [balance, setBalance] = useState(5000)
  const [totalWin, setTotalWin] = useState(0)
  const [pendingWin, setPendingWin] = useState(0)

  const [spinning, setSpinning] = useState(false)
  const [spinId, setSpinId] = useState(0)
  const [debugInfo, setDebugInfo] = useState<DebugSpinInfo | undefined>(undefined)

  // 🔑 NEW
  const [isFreeGame, setIsFreeGame] = useState(false)
  const [freeSpinsLeft, setFreeSpinsLeft] = useState(0)

  const [pendingFreeSpins, setPendingFreeSpins] = useState(0)

  const seed = new Date().toISOString()
  const rng = createRNG(seed)

  function spinNow() {
    if (spinning || balance < bet || balance === 0) return
    setTotalWin(0)
    setSpinning(true)

    const outcome: SpinOutcome = spin(rng, {
      betPerSpin: bet,
      lines: 5,
      isFreeGame,
    })

    if (!isFreeGame) {
      setBalance(balance - bet)
    }

    setPendingCascades(outcome.cascades ?? [])
    setSpinId(id => id + 1)
    setDebugInfo({
      seed,
      bet,
      win: outcome?.win ?? 0,
      cascadeWins: (outcome.cascades ?? []).map(c => c.win ?? 0),
    })
    setPendingWin(outcome.win ?? 0)

    // // 🎯 SCATTER → FREE SPINS (base game only)
    if (!isFreeGame && outcome.freeSpinsAwarded > 0) {
      setPendingFreeSpins(outcome.freeSpinsAwarded)
    }
  }

  function commitWin(amount: number) {
    setTotalWin(w => w + amount)
  }

  function commitSpin() {
    if (!pendingCascades) return

    setCommittedCascades(pendingCascades)
    setPendingCascades(null)
    setSpinning(false)

    if (!isFreeGame && pendingFreeSpins > 0) {
      setIsFreeGame(true)
      setFreeSpinsLeft(pendingFreeSpins)
      setPendingFreeSpins(0)
      return
    }

    // 🔁 FREE SPIN LOOP
    if (isFreeGame) {
      setFreeSpinsLeft(v => {
        const next = v - 1
        if (next <= 0) {
          setIsFreeGame(false)
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
    balance,
    setBalance,
    bet,
    setBet,
    totalWin,
    pendingWin,
    commitWin,
    debugInfo,

    // 🔑 EXPOSE
    isFreeGame,
    freeSpinsLeft,
  }
}
