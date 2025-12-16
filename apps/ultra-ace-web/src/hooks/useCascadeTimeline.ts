import { useEffect, useReducer } from 'react'
import type { CascadeStep } from '@ultra-ace/engine'

export type CascadePhase =
  | 'idle'
  | 'reelSweepOut'
  | 'reelSweepIn'
  | 'highlight'
  | 'pop'
  | 'refill'
  | 'settle'

interface State {
  phase: CascadePhase
  index: number | null
  previous?: CascadeStep
}

type Action =
  | { type: 'RESET'; cascades: CascadeStep[] }
  | { type: 'NEXT_PHASE'; phase: CascadePhase }
  | { type: 'ADVANCE'; cascades: CascadeStep[] }
  | { type: 'SETTLE' }

function getInitialState(cascades: CascadeStep[]): State {
  if (!cascades || cascades.length === 0) {
    return { phase: 'reelSweepOut', index: 0 }
  }

  if (cascades.length === 1) {
    return { phase: 'reelSweepOut', index: 0 }
  }

  return { phase: 'reelSweepOut', index: 1 }
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'RESET':
      return getInitialState(action.cascades)

    case 'NEXT_PHASE':
      return { ...state, phase: action.phase }

    case 'ADVANCE': {
      const nextIndex = state.index! + 1
      return {
        phase: 'highlight',
        index: nextIndex,
        previous: action.cascades[state.index!],
      }
    }

    case 'SETTLE':
      return { ...state, phase: 'settle' }

    default:
      return state
  }
}

export function useCascadeTimeline(cascades: CascadeStep[], spinId: number, onReelIn?: () => void) {
  const [state, dispatch] = useReducer(
    reducer,
    cascades,
    getInitialState, // ✅ lazy init, no effect
  )

  const activeCascade = state.index !== null ? cascades[state.index] : undefined

  // ✅ Proper external system: time
  useEffect(() => {
    if (state.index === null) return

    let t: number

    switch (state.phase) {
      case 'reelSweepOut':
        t = window.setTimeout(() => {
          onReelIn?.()
          dispatch({ type: 'NEXT_PHASE', phase: 'reelSweepIn' })
        }, 450)
        break
      case 'reelSweepIn':
        t = window.setTimeout(() => dispatch({ type: 'NEXT_PHASE', phase: 'highlight' }), 300)
        break

      case 'highlight':
        t = window.setTimeout(() => dispatch({ type: 'NEXT_PHASE', phase: 'pop' }), 1300) // ⬅️ longer
        break

      case 'pop':
        t = window.setTimeout(() => dispatch({ type: 'NEXT_PHASE', phase: 'refill' }), 180)
        break

      case 'refill':
        t = window.setTimeout(() => {
          if (state.index! + 1 < cascades.length) {
            dispatch({ type: 'ADVANCE', cascades })
          } else {
            dispatch({ type: 'SETTLE' })
          }
        }, 600)
        break

      case 'settle':
        t = window.setTimeout(() => dispatch({ type: 'NEXT_PHASE', phase: 'idle' }), 150)
        break
    }

    return () => clearTimeout(t)
  }, [state.phase, state.index, cascades])

  useEffect(() => {
    dispatch({ type: 'RESET', cascades })
  }, [spinId])

  return {
    phase: state.phase,
    activeCascade,
    previousCascade: state.previous,
  }
}
