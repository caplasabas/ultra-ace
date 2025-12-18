import { useEffect, useReducer } from 'react'
import type { CascadeStep } from '@ultra-ace/engine'

export type CascadePhase =
  | 'idle'
  | 'reelSweepOut'
  | 'initialRefill'
  | 'highlight'
  | 'pop'
  | 'cascadeRefill'
  | 'settle'

interface State {
  phase: CascadePhase
  index: number // 👈 index into cascades, starting at 0 (base)
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
  const nextCascade = cascades[state.index + 1] // 🔥 THIS IS THE KEY
  const previousCascade = state.previous
  const isIdle = state.phase === 'idle'

  useEffect(() => {
    if (spinId === 0) return
    dispatch({ type: 'START', cascades })
  }, [spinId])

  useEffect(() => {
    let t: number | undefined

    switch (state.phase) {
      case 'reelSweepOut':
        t = window.setTimeout(() => {
          onCommit?.()
          dispatch({ type: 'NEXT', phase: 'initialRefill' })
        }, 450)
        break

      case 'initialRefill':
        // 🔑 after base window, CHECK FIRST WIN CASCADE
        t = window.setTimeout(() => {
          if (nextCascade?.lineWins?.length) {
            dispatch({ type: 'ADVANCE', cascades }) // go to index 1
          } else {
            dispatch({ type: 'NEXT', phase: 'settle' })
          }
        }, 700)
        break

      case 'highlight':
        t = window.setTimeout(
          () => dispatch({ type: 'NEXT', phase: 'pop' }),
          1000,
        )
        break

      case 'pop':
        t = window.setTimeout(
          () => dispatch({ type: 'NEXT', phase: 'cascadeRefill' }),
          220,
        )
        break

      case 'cascadeRefill':
        t = window.setTimeout(() => {
          if (cascades[state.index + 1]?.lineWins?.length) {
            dispatch({ type: 'ADVANCE' , cascades})
          } else {
            dispatch({ type: 'NEXT', phase: 'settle' })
          }
        }, 700)
        break

      case 'settle':
        t = window.setTimeout(() => dispatch({ type: 'RESET' }), 250)
        break
    }

    return () => {
      if (t !== undefined) clearTimeout(t)
    }
  }, [state.phase, state.index, cascades])

  return {
    phase: state.phase,
    activeCascade, // always correct window for rendering
    previousCascade,
    cascadeIndex: state.index,
    isIdle,
  }
}
