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
        previous: state.previous ?? action.cascades[action.cascades.length - 1],
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
      return {
        phase: 'idle',
        index: state.index,
      }

    default:
      return state
  }
}

export function useCascadeTimeline(cascades: CascadeStep[], spinId: number, onCommit?: () => void) {
  const [state, dispatch] = useReducer(reducer, initialState)

  const activeCascade = cascades[state.index]
  const nextCascade = cascades[state.index + 1]
  const previousCascade = state.previous
  const isIdle = state.phase === 'idle'

  /* ----------------------------------------
     Spin start
  ---------------------------------------- */
  useEffect(() => {
    if (spinId === 0) return
    dispatch({ type: 'START', cascades })
  }, [spinId])

  /* ----------------------------------------
     Timeline controller
  ---------------------------------------- */
  useEffect(() => {
    let t: number | undefined

    switch (state.phase) {
      case 'reelSweepOut':
        dispatch({ type: 'NEXT', phase: 'initialRefill' })
        onCommit?.()
        break

      case 'initialRefill':
        t = window.setTimeout(() => {
          const hasSymbolWin = nextCascade?.lineWins?.length
          const hasScatterWin =
            nextCascade?.window?.flat().filter(s => s.kind === 'SCATTER').length >= 3

          if (hasSymbolWin || hasScatterWin) {
            dispatch({ type: 'ADVANCE', cascades })
          } else {
            dispatch({ type: 'NEXT', phase: 'settle' })
          }
        }, 900)
        break

      case 'highlight': {
        const hasLineWins = activeCascade?.lineWins?.length
        const hasScatterWin =
          activeCascade?.window?.flat().filter(s => s.kind === 'SCATTER').length >= 3

        t = window.setTimeout(() => {
          if (hasScatterWin && !hasLineWins) {
            dispatch({ type: 'NEXT', phase: 'settle' })
          } else {
            dispatch({ type: 'NEXT', phase: 'pop' })
          }
        }, 1200)
        break
      }

      case 'pop':
        t = window.setTimeout(() => dispatch({ type: 'NEXT', phase: 'cascadeRefill' }), 260)
        break

      case 'cascadeRefill':
        t = window.setTimeout(() => {
          if (cascades[state.index + 1]?.lineWins?.length) {
            dispatch({ type: 'ADVANCE', cascades })
          } else {
            dispatch({ type: 'NEXT', phase: 'settle' })
          }
        }, 1100)
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
    activeCascade,
    previousCascade,
    cascadeIndex: state.index,
    isIdle,
  }
}
