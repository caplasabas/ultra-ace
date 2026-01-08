import { useEffect, useReducer, useRef } from 'react'
import type { CascadeStep, Symbol as EngineSymbol } from '@ultra-ace/engine'
import { PAUSED_INITIAL_ROW_DROP_DELAY } from '../ui/Reel'

/* ----------------------------------------
   CONFIG
---------------------------------------- */
export const INITIAL_REFILL_PAUSE_MS = 1000
export const TOTAL_REELS = 5

/* ----------------------------------------
   TYPES
---------------------------------------- */
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
  initialRefillColumn: number | null
  activePausedColumn: number | null
}

type Action =
  | { type: 'START'; cascades: CascadeStep[] }
  | { type: 'NEXT'; phase: CascadePhase }
  | { type: 'ADVANCE'; cascades: CascadeStep[] }
  | { type: 'ADVANCE_SCATTER'; cascades: CascadeStep[] }
  | { type: 'RESET' }
  | { type: 'SET_REFILL_COLUMN'; column: number | null }
  | { type: 'SET_ACTIVE_PAUSED_COLUMN'; column: number | null }

/* ----------------------------------------
   SCATTER PAUSE DETECTION
---------------------------------------- */
export function detectScatterPauseColumn(window?: EngineSymbol[][]): number | null {
  if (!window) return null

  const cols: number[] = []
  window.forEach((col, i) => {
    if (col.some(s => s.kind === 'SCATTER')) cols.push(i)
  })

  if (cols.length < 2) return null

  // Prefer reel 2 or 3 for buy-tease feel
  return cols.includes(2) ? 2 : cols[1]
}

/* ----------------------------------------
   INITIAL STATE
---------------------------------------- */
const initialState: State = {
  phase: 'idle',
  index: 0,
  previous: undefined,
  isScatterHighlight: false,
  initialRefillColumn: null,
  activePausedColumn: null,
}

/* ----------------------------------------
   REDUCER
---------------------------------------- */
function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'START':
      return {
        phase: 'reelSweepOut',
        index: 0,
        previous: action.cascades[action.cascades.length - 1],
        isScatterHighlight: false,
        initialRefillColumn: null,
        activePausedColumn: null,
      }

    case 'NEXT':
      return { ...state, phase: action.phase }

    case 'SET_REFILL_COLUMN':
      return { ...state, initialRefillColumn: action.column }

    case 'SET_ACTIVE_PAUSED_COLUMN':
      return { ...state, activePausedColumn: action.column }

    case 'ADVANCE':
      return {
        phase: 'highlight',
        index: state.index + 1,
        previous: action.cascades[state.index],
        isScatterHighlight: false,
        initialRefillColumn: null,
        activePausedColumn: null,
      }

    case 'ADVANCE_SCATTER':
      return {
        phase: 'highlight',
        index: state.index + 1,
        previous: action.cascades[state.index],
        isScatterHighlight: true,
        initialRefillColumn: null,
        activePausedColumn: null,
      }

    case 'RESET':
      return {
        phase: 'idle',
        index: state.index,
        previous: undefined,
        isScatterHighlight: false,
        initialRefillColumn: null,
        activePausedColumn: null,
      }

    default:
      return state
  }
}

/* ----------------------------------------
   HOOK
---------------------------------------- */
export function useCascadeTimeline(
  cascades: CascadeStep[],
  spinId: number,
  isFreeGame: boolean,
  turboMultiplier: number,
  scatterTriggerType?: 'natural' | 'buy' | null,

  onCommit?: () => void,
) {
  const [state, dispatch] = useReducer(reducer, initialState)

  const activeCascade = cascades[state.index]
  const nextCascade = cascades[state.index + 1]
  const previousCascade = state.previous
  const isIdle = state.phase === 'idle'

  const pauseColumn = detectScatterPauseColumn(activeCascade?.window)
  const pauseLockedRef = useRef(false)
  const pauseOriginRef = useRef<number | null>(null)

  const lastCompletedSpinRef = useRef<number | null>(null)

  const spinCompleted =
    state.phase === 'idle' && spinId > 0 && lastCompletedSpinRef.current !== spinId

  useEffect(() => {
    if (spinCompleted) {
      lastCompletedSpinRef.current = spinId
    }
  }, [spinCompleted, spinId])

  function scaled(ms: number) {
    const v = ms / (pauseColumn ? 1 : turboMultiplier)
    return scatterTriggerType === 'buy'
      ? Math.max(v, 250) // ⛔ do not fully skip tease
      : v
  }

  /* -----------------------------
     Spin start
  ----------------------------- */
  useEffect(() => {
    if (spinId === 0) return
    pauseLockedRef.current = false
    pauseOriginRef.current = null
    dispatch({ type: 'START', cascades })
  }, [spinId])

  /* -----------------------------
     Detect pause column ONCE
  ----------------------------- */
  useEffect(() => {
    if (state.phase !== 'initialRefill') return
    if (pauseLockedRef.current) return
    if (isFreeGame) return

    // const pauseColumn = 1 // TEMP

    if (pauseColumn !== null) {
      pauseLockedRef.current = true
      pauseOriginRef.current = pauseColumn
      dispatch({ type: 'SET_REFILL_COLUMN', column: pauseColumn })
    }
  }, [state.phase, activeCascade])

  /* -----------------------------
   INITIAL REFILL TIMELINE (SOLE AUTHORITY)
----------------------------- */
  useEffect(() => {
    if (state.phase !== 'initialRefill') return

    const timers: number[] = []

    const pauseOrigin = pauseOriginRef.current
    const hasNextLineWin = Boolean(nextCascade?.lineWins?.length)
    // ---------------------------------
    // 🟢 NO PAUSE COLUMN → NORMAL FLOW
    // ---------------------------------
    if (pauseOrigin === null) {
      const t = window.setTimeout(() => {
        const hasScatterWin =
          cascades[0]?.window?.flat().filter(s => s.kind === 'SCATTER').length >= 3
        const hasLineWin = Boolean(activeCascade?.lineWins.length)

        if (hasNextLineWin) {
          dispatch({ type: 'ADVANCE', cascades })
        } else if (hasLineWin && hasScatterWin) {
          dispatch({ type: 'ADVANCE_SCATTER', cascades })
        } else {
          dispatch({ type: 'NEXT', phase: 'settle' })
        }
      }, scaled(900)) // original initialRefill duration

      return () => clearTimeout(t)
    }

    // ---------------------------------
    // 🔴 PAUSE COLUMN FLOW
    // ---------------------------------
    const cardsPerColumn = activeCascade?.window?.[0]?.length ?? 4
    const columnDuration = cardsPerColumn * PAUSED_INITIAL_ROW_DROP_DELAY

    for (let col = pauseOrigin + 1; col < TOTAL_REELS; col++) {
      const offset = col - (pauseOrigin + 1)

      timers.push(
        window.setTimeout(
          () => {
            dispatch({ type: 'SET_ACTIVE_PAUSED_COLUMN', column: col })
          },
          scaled(INITIAL_REFILL_PAUSE_MS + offset * columnDuration),
        ),
      )
    }
    const hasScatterWin = cascades[0]?.window?.flat().filter(s => s.kind === 'SCATTER').length >= 3
    const hasLineWin = Boolean(activeCascade?.lineWins.length)

    const totalDuration =
      INITIAL_REFILL_PAUSE_MS + (TOTAL_REELS - (pauseOrigin + 1)) * columnDuration

    timers.push(
      window.setTimeout(() => {
        dispatch({ type: 'SET_ACTIVE_PAUSED_COLUMN', column: null })

        if (hasNextLineWin) {
          dispatch({ type: 'ADVANCE', cascades })
        } else if (hasLineWin && hasScatterWin) {
          dispatch({ type: 'ADVANCE_SCATTER', cascades })
        } else {
          dispatch({ type: 'NEXT', phase: 'settle' })
        }
      }, scaled(totalDuration)),
    )

    return () => timers.forEach(clearTimeout)
  }, [state.phase, activeCascade, cascades, nextCascade])

  /* -----------------------------
     Auto-unpause (visual only)
  ----------------------------- */
  useEffect(() => {
    if (state.phase !== 'initialRefill') return
    if (state.initialRefillColumn === null) return

    const t = window.setTimeout(() => {
      dispatch({ type: 'SET_REFILL_COLUMN', column: null })
    }, scaled(INITIAL_REFILL_PAUSE_MS))

    return () => clearTimeout(t)
  }, [state.phase, state.initialRefillColumn])

  /* -----------------------------
     GENERIC TIMELINE (NO initialRefill)
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

    const hasNextLineWin = Boolean(nextCascade?.lineWins?.length)
    const hasRemovals = Boolean(activeCascade?.removedPositions?.length)
    const hasLineWin = Boolean(activeCascade?.lineWins.length)

    const hasNextLineScatter =
      nextCascade && nextCascade.window?.flat().filter(s => s.kind === 'SCATTER').length

    const hasScatterWin =
      activeCascade?.window?.flat().filter(s => s.kind === 'SCATTER').length >= 3

    switch (state.phase) {
      case 'reelSweepOut':
        t = window.setTimeout(() => {
          dispatch({ type: 'NEXT', phase: 'initialRefill' })
          onCommit?.()
        }, scaled(120))
        break

      case 'highlight':
        t = window.setTimeout(() => {
          dispatch({ type: 'NEXT', phase: 'pop' })
        }, scaled(1200))
        break

      case 'pop':
        t = window.setTimeout(() => {
          if (hasRemovals) {
            dispatch({ type: 'NEXT', phase: 'cascadeRefill' })
          } else if (hasLineWin && hasScatterWin) {
            dispatch({ type: 'ADVANCE_SCATTER', cascades })
          } else if (hasNextLineScatter) {
            dispatch({ type: 'NEXT', phase: 'settle' })
          }
        }, scaled(800))
        break

      case 'cascadeRefill':
        t = window.setTimeout(() => {
          if (hasGoldToWild) {
            dispatch({ type: 'NEXT', phase: 'postGoldTransform' })
          } else if (hasLineWin && hasScatterWin) {
            dispatch({ type: 'ADVANCE_SCATTER', cascades })
          } else if (hasNextLineWin) {
            dispatch({ type: 'ADVANCE', cascades })
          } else {
            dispatch({ type: 'NEXT', phase: 'settle' })
          }
        }, scaled(1350))
        break

      case 'postGoldTransform':
        t = window.setTimeout(() => {
          if (hasNextLineWin) {
            dispatch({ type: 'ADVANCE', cascades })
          } else {
            dispatch({ type: 'NEXT', phase: 'settle' })
          }
        }, scaled(900))
        break

      case 'settle':
        t = window.setTimeout(() => dispatch({ type: 'RESET' }), scaled(250))
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
    isScatterHighlight: state.isScatterHighlight,
    initialRefillColumn: state.initialRefillColumn,
    activePausedColumn: state.activePausedColumn,
    spinCompleted,
  }
}
