import { useState } from 'react'
import { spin, createRNG } from '@ultra-ace/engine'
import type { CascadeStep } from '@ultra-ace/engine'

const rng = createRNG('demo-seed')
export function useEngine() {
  const [committedCascades, setCommittedCascades] = useState<CascadeStep[]>([])
  const [pendingCascades, setPendingCascades] = useState<CascadeStep[] | null>(null)
  const [spinning, setSpinning] = useState(false)
  const [spinId, setSpinId] = useState(0)

  function spinNow() {
    if (spinning) return

    setSpinning(true)

    const result = spin(rng, { betPerSpin: 20, lines: 5 })
    setPendingCascades(result.cascades ?? [])

    // 🔑 trigger reel sweep out
    setSpinId(id => id + 1)
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
  }
}
