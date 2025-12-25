import { useState } from 'react'
import { spin, createRNG } from '@ultra-ace/engine'
import type { CascadeStep } from '@ultra-ace/engine'
import { DebugSpinInfo } from 'src/debug/DebugHud'

export function useEngine() {
  const [committedCascades, setCommittedCascades] = useState<CascadeStep[]>([])
  const [pendingCascades, setPendingCascades] = useState<CascadeStep[] | null>(null)

  const [totalWin, setTotalWin] = useState(0)
  const [pendingWin, setPendingWin] = useState(0)

  const [spinning, setSpinning] = useState(false)
  const [spinId, setSpinId] = useState(0)
  const [debugInfo, setDebugInfo] = useState<DebugSpinInfo | undefined>(undefined)

  function spinNow() {
    if (spinning) return
    setSpinning(true)

    const seed = new Date().toISOString()
    const rng = createRNG(seed)

    const bet = 5

    const result = spin(rng, {
      betPerSpin: bet,
      lines: 5,
    })

    setPendingCascades(result.cascades ?? [])
    setSpinId(id => id + 1)

    setDebugInfo({
      seed,
      bet,
      win: result?.win ?? 0,
      cascadeWins: (result.cascades ?? []).map(c => c.win ?? 0),
    })

    setPendingWin(result.win ?? 0)
  }

  function commitWin(amount: number) {
    setTotalWin(w => w + amount)
  }

  function commitSpin() {
    if (!pendingCascades) return

    setCommittedCascades(pendingCascades)
    setPendingCascades(null)
    setSpinning(false)
  }

  return {
    cascades: committedCascades,
    spinning,
    spinId,
    spin: spinNow,
    commitSpin,
    debugInfo,
    totalWin,
    pendingWin,
    commitWin,
  }
}
