import { useEffect, useReducer } from 'react'
import type { CascadeStep } from '@ultra-ace/engine'

export type CascadePhase =
  | 'idle'
  | 'reelSweepOut'
  | 'initialRefill'
  | 'highlight'
  | 'pop'
  | 'cascadeRefill'
  | 'postGoldTransform'
  | 'settle'

interface State {
  phase: CascadePhase
  index: number
  previous?: CascadeStep
  isScatterHighlight: boolean
}

type Action =
  | { type: 'START'; cascades: CascadeStep[] }
  | { type: 'NEXT'; phase: CascadePhase }
  | { type: 'ADVANCE'; cascades: CascadeStep[] }
  | { type: 'ADVANCE_SCATTER' }
  | { type: 'RESET' }

const initialState: State = {
  phase: 'idle',
  index: 0,
  previous: undefined,
  isScatterHighlight: false,
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'START':
      return {
        phase: 'reelSweepOut',
        index: 0,
        previous: action.cascades[action.cascades.length - 1],
        isScatterHighlight: false,
      }

    case 'NEXT':
      return { ...state, phase: action.phase }

    // Line win → advance to next cascade
    case 'ADVANCE':
      return {
        phase: 'highlight',
        index: state.index + 1,
        previous: action.cascades[state.index],
        isScatterHighlight: false,
      }

    // Scatter-only win → highlight current window
    case 'ADVANCE_SCATTER':
      return {
        phase: 'highlight',
        index: 0,
        previous: undefined, // 🔒 use activeCascade directly
        isScatterHighlight: true,
      }

    case 'RESET':
      return {
        phase: 'idle',
        index: state.index,
        previous: undefined,
        isScatterHighlight: false,
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

  /* -----------------------------
     Spin start
  ----------------------------- */
  useEffect(() => {
    if (spinId === 0) return
    dispatch({ type: 'START', cascades })
  }, [spinId])

  /* -----------------------------
     Timeline controller
  ----------------------------- */
  useEffect(() => {
    let t: number | undefined

    const hasGoldToWild =
      activeCascade?.window?.some((col, r) =>
        col.some((s, c) => {
          const prev = previousCascade?.window?.[r]?.[c]
          return prev?.isGold === true && s.kind === 'WILD'
        }),
      ) ?? false
    const hasNextWin = Boolean(nextCascade?.lineWins?.length)

    const hasNextLineWin = Boolean(nextCascade?.lineWins?.length)

    const scatterSource = cascades[0]
    const hasScatterWin =
      scatterSource?.window?.flat().filter(s => s.kind === 'SCATTER').length >= 3

    const hasRemovals = Boolean(activeCascade?.removedPositions?.length)

    const isMobile = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches

    const HIGHLIGHT_MS = isMobile ? 700 : 1200

    switch (state.phase) {
      case 'reelSweepOut':
        t = window.setTimeout(() => {
          dispatch({ type: 'NEXT', phase: 'initialRefill' })
          onCommit?.()
        }, 120)
        break

      case 'initialRefill':
        t = window.setTimeout(() => {
          if (hasNextLineWin) {
            dispatch({ type: 'ADVANCE', cascades })
          } else if (hasScatterWin) {
            dispatch({ type: 'ADVANCE_SCATTER' })
          } else {
            dispatch({ type: 'NEXT', phase: 'settle' })
          }
        }, 900)
        break

      case 'highlight':
        t = window.setTimeout(() => {
          dispatch({ type: 'NEXT', phase: 'pop' })
        }, HIGHLIGHT_MS)
        break

      case 'pop':
        t = window.setTimeout(() => {
          if (state.isScatterHighlight) {
            // scatter-only → no refill
            dispatch({ type: 'NEXT', phase: 'settle' })
          } else if (hasRemovals) {
            // line win → refill
            dispatch({ type: 'NEXT', phase: 'cascadeRefill' })
          } else {
            // no removals → settle
            dispatch({ type: 'NEXT', phase: 'settle' })
          }
        }, 800)
        break

      case 'cascadeRefill':
        const cascadeRefillDelay = hasGoldToWild || hasNextWin ? 1150 : 820
        t = window.setTimeout(() => {
          if (hasGoldToWild) {
            dispatch({ type: 'NEXT', phase: 'postGoldTransform' })
          } else if (nextCascade?.lineWins?.length) {
            dispatch({ type: 'ADVANCE', cascades })
          } else {
            dispatch({ type: 'NEXT', phase: 'settle' })
          }
        }, cascadeRefillDelay)
        break

      case 'postGoldTransform':
        t = window.setTimeout(() => {
          if (nextCascade?.lineWins?.length) {
            dispatch({ type: 'ADVANCE', cascades })
          } else {
            dispatch({ type: 'NEXT', phase: 'settle' })
          }
        }, 900)
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
    isScatterHighlight: state.isScatterHighlight, // ✅ expose flag
  }
}
