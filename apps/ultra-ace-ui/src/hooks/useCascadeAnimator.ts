import { useEffect, useRef, useState } from 'react'
import { CascadeStep } from '@ultra-ace/engine'

export type CascadePhase = 'idle' | 'highlight' | 'remove' | 'refill' | 'multiplier' | 'done'

interface State {
  cascadeIndex: number
  phase: CascadePhase
  activeCascade?: CascadeStep
}

interface Options {
  skipAnimations?: boolean
  onComplete?: () => void
}

export function useCascadeAnimator(cascades: CascadeStep[] | undefined, options: Options = {}) {
  const { skipAnimations = false, onComplete } = options

  const [state, setState] = useState<State>({
    cascadeIndex: 0,
    phase: 'idle',
  })

  const timer = useRef<number | null>(null)

  useEffect(() => {
    if (!cascades || cascades.length === 0) return

    setState({
      cascadeIndex: 0,
      phase: 'highlight',
      activeCascade: cascades[0],
    })
  }, [cascades])

  useEffect(() => {
    if (!state.activeCascade) return

    if (skipAnimations) {
      advance()
      return
    }

    const duration = phaseDuration(state.phase)
    timer.current = window.setTimeout(advance, duration)

    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [state.phase])

  function advance() {
    setState(prev => {
      const nextPhase = nextPhaseFor(prev.phase)

      if (nextPhase === 'done') {
        const nextIndex = prev.cascadeIndex + 1
        if (!cascades || nextIndex >= cascades.length) {
          onComplete?.()
          return { ...prev, phase: 'done' }
        }

        return {
          cascadeIndex: nextIndex,
          phase: 'highlight',
          activeCascade: cascades[nextIndex],
        }
      }

      return { ...prev, phase: nextPhase }
    })
  }

  return {
    ...state,
    skip: advance,
  }
}

function nextPhaseFor(phase: CascadePhase): CascadePhase {
  switch (phase) {
    case 'highlight':
      return 'remove'
    case 'remove':
      return 'refill'
    case 'refill':
      return 'multiplier'
    case 'multiplier':
      return 'done'
    default:
      return 'done'
  }
}

function phaseDuration(phase: CascadePhase) {
  switch (phase) {
    case 'highlight':
      return 450
    case 'remove':
      return 300
    case 'refill':
      return 350
    case 'multiplier':
      return 300
    default:
      return 0
  }
}
