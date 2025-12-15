import { useEffect, useState } from 'react'
import type { CascadeStep } from '@ultra-ace/engine'
import type { CascadePhase } from '@components/types'

export function useCascadeTimeline(cascades: CascadeStep[]) {
  const [cascadeIndex, setCascadeIndex] = useState<number | null>(null)
  const [phase, setPhase] = useState<CascadePhase>('idle')

  const activeCascade = cascadeIndex != null ? cascades[cascadeIndex] : undefined

  // start playback
  useEffect(() => {
    if (cascades.length <= 1) {
      setPhase('idle')
      setCascadeIndex(null)
      return
    }

    setCascadeIndex(1) // skip seed
    setPhase('reelSweep') // ⬅️ NEW
  }, [cascades])

  useEffect(() => {
    if (!activeCascade && phase !== 'reelSweep') return

    let t: any

    switch (phase) {
      case 'reelSweep':
        t = setTimeout(() => setPhase('highlight'), 650)
        break

      case 'highlight':
        t = setTimeout(() => setPhase('pop'), 1300)
        break

      case 'pop':
        t = setTimeout(() => setPhase('collapse'), 200)
        break

      case 'collapse':
        t = setTimeout(() => setPhase('refill'), 200)
        break

      case 'refill':
        t = setTimeout(() => {
          if (cascadeIndex! + 1 < cascades.length) {
            setCascadeIndex(i => i! + 1)
            setPhase('highlight')
          } else {
            setPhase('settle')
          }
        }, 600)
        break

      case 'settle':
        t = setTimeout(() => setPhase('idle'), 150)
        break
    }

    return () => clearTimeout(t)
  }, [phase, cascadeIndex, cascades, activeCascade])

  return { phase, cascadeIndex, activeCascade }
}
