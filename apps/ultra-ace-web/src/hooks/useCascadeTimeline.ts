
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
  index: number
  previous?: CascadeStep
}

type Action =
  | { type: 'START'; cascades: CascadeStep[] }
  | { type: 'NEXT'; phase: CascadePhase }
  | { type: 'ADVANCE'; cascades: CascadeStep[] }
  | { type: 'RESET' }

const initialState: State = {
  phase: 'idle',
  index: 0,
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'START':
      return {
        phase: 'reelSweepOut',
        index: 0,
        previous: action.cascades[0],
      }

    case 'NEXT':
      return { ...state, phase: action.phase }

    case 'ADVANCE':
      return {
        phase: 'highlight',
        index: state.index + 1,
        previous: action.cascades[state.index],
      }

    case 'RESET':
      return initialState

    default:
      return state
  }
}

export function useCascadeTimeline(
  cascades: CascadeStep[],
  spinId: number,
  onCommit?: () => void,
) {
  const [state, dispatch] = useReducer(reducer, initialState)

  const activeCascade = cascades[state.index]
  const previousCascade = state.previous
  const isIdle = state.phase === 'idle'

  // Start ONLY on spin
  useEffect(() => {
    if (spinId === 0) return
    dispatch({ type: 'START', cascades })
  }, [spinId])

  // Timeline driver
  useEffect(() => {
    let t: number | undefined

    switch (state.phase) {
      case 'reelSweepOut':
        t = window.setTimeout(() => {
          onCommit?.()
          dispatch({ type: 'NEXT', phase: 'highlight' })
        }, 450)
        break

      case 'highlight':
        t = window.setTimeout(
          () => dispatch({ type: 'NEXT', phase: 'pop' }),
          1200,
        )
        break

      case 'pop':
        t = window.setTimeout(
          () => dispatch({ type: 'NEXT', phase: 'refill' }),
          180,
        )
        break

      case 'refill':
        t = window.setTimeout(() => {
          if (state.index + 1 < cascades.length) {
            dispatch({ type: 'ADVANCE', cascades })
          } else {
            dispatch({ type: 'NEXT', phase: 'settle' })
          }
        }, 700)
        break

      case 'settle':
        t = window.setTimeout(() => dispatch({ type: 'RESET' }), 200)
        break
    }

    return () => t && clearTimeout(t)
  }, [state.phase, state.index, cascades])

  return {
    phase: state.phase,
    activeCascade,
    previousCascade,
    isIdle,
  }
}
