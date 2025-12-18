import { useState } from 'react'
import { spin, createRNG } from '@ultra-ace/engine'
import type { CascadeStep } from '@ultra-ace/engine'
import { DebugSpinInfo } from 'src/debug/DebugHud'

export function useEngine() {
  const [committedCascades, setCommittedCascades] = useState<CascadeStep[]>([])
  const [pendingCascades, setPendingCascades] =
    useState<CascadeStep[] | null>(null)

  const [spinning, setSpinning] = useState(false)
  const [spinId, setSpinId] = useState(0)
  const [debugInfo, setDebugInfo] = useState<DebugSpinInfo | undefined>(
    undefined,
  )

  function spinNow() {
    if (spinning) return
    setSpinning(true)

    const seed = new Date().toISOString()
    const rng = createRNG(seed)

    const bet = 20

    const result = spin(rng, {
      betPerSpin: bet,
      lines: 5,
    })

    setPendingCascades(result.cascades ?? [])
    setSpinId(id => id + 1)

    setDebugInfo({
      seed,
      reelStops: result.reelStops ?? [],
      bet,
      win: result?.win ?? 0,
    })
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

    // ✅ Debug
    debugInfo,
  }
}
