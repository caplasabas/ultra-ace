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

  const overallScatterCount = window.reduce(
    (a, b) => a + b.filter(s => s.kind === 'SCATTER').length,
    0,
  )

  if (overallScatterCount >= 2) {
    let totalScatters = 0

    for (let i = 0; i < window.length; i++) {
      const scattersInColumn = window[i].filter(s => s.kind === 'SCATTER').length

      if (scattersInColumn > 0) {
        totalScatters += scattersInColumn

        if (totalScatters >= 2) {
          return i
        }
      }
    }
  }

  return null
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

  const pauseColumn = !isIdle ? detectScatterPauseColumn(activeCascade?.window) : null

  const pauseLockedRef = useRef(false)
  const pauseOriginRef = useRef<number | null>(null)

  const lastCompletedSpinRef = useRef<number | null>(null)
  const activeSpinRef = useRef<number | null>(null)

  const spinCompleted =
    state.phase === 'idle' &&
    spinId > 0 &&
    activeSpinRef.current === spinId &&
    lastCompletedSpinRef.current !== spinId

  useEffect(() => {
    if (spinCompleted) {
      lastCompletedSpinRef.current = spinId
      activeSpinRef.current = null
    }
  }, [spinCompleted, spinId])

  function getPauseTurboSpeed() {
    const raw = turboMultiplier > 1 ? turboMultiplier / 2 : turboMultiplier
    return Math.max(1, raw)
  }

  function getPauseTiming() {
    const speed = getPauseTurboSpeed()
    return {
      pauseLeadMs: INITIAL_REFILL_PAUSE_MS / speed,
      pausedInitialRowDelayMs: PAUSED_INITIAL_ROW_DROP_DELAY / speed,
      initialDealDurationMs: Math.max(70, 185 / speed),
    }
  }

  function scaled(ms: number) {
    return (
      ms /
      (pauseColumn !== null
        ? (turboMultiplier > 1 ? turboMultiplier / 2 : turboMultiplier) * 1.7
        : turboMultiplier)
    )
  }

  function scaledWithFloor(ms: number, floorMs: number) {
    const turboFloor = turboMultiplier > 1 ? Math.max(20, floorMs / turboMultiplier) : floorMs
    return Math.max(scaled(ms), turboFloor)
  }

  /* -----------------------------
     Spin start
  ----------------------------- */
  useEffect(() => {
    if (spinId === 0) return
    activeSpinRef.current = spinId
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

    if (pauseColumn !== null) {
      pauseLockedRef.current = true
      pauseOriginRef.current = pauseColumn
      dispatch({ type: 'SET_REFILL_COLUMN', column: pauseColumn })
    }
  }, [state.phase, activeCascade, isFreeGame, pauseColumn])

  /* -----------------------------
   INITIAL REFILL TIMELINE (SOLE AUTHORITY)
----------------------------- */
  useEffect(() => {
    if (state.phase !== 'initialRefill') return

    const timers: number[] = []

    const pauseOrigin = pauseOriginRef.current
    const hasNextLineWin =
      Boolean(nextCascade?.lineWins?.length) || Number(nextCascade?.win ?? 0) > 0.0001
    // ---------------------------------
    // 🟢 NO PAUSE COLUMN → NORMAL FLOW
    // ---------------------------------
    if (pauseOrigin === null) {
      const t = window.setTimeout(() => {
        const hasScatterWin =
          activeCascade?.window?.flat().filter(s => s.kind === 'SCATTER').length >= 3
        // const hasLineWin = Boolean(activeCascade?.lineWins.length)

        if (hasNextLineWin) {
          dispatch({ type: 'ADVANCE', cascades })
        } else if (hasScatterWin) {
          dispatch({ type: 'ADVANCE_SCATTER', cascades })
        } else {
          dispatch({ type: 'NEXT', phase: 'settle' })
        }
      }, scaledWithFloor(900, 220)) // keep turbo from outrunning visual deal-initial

      return () => clearTimeout(t)
    }

    // ---------------------------------
    // 🔴 PAUSE COLUMN FLOW
    // ---------------------------------
    const cardsPerColumn = activeCascade?.window?.[0]?.length ?? 4
    const { pauseLeadMs, pausedInitialRowDelayMs, initialDealDurationMs } = getPauseTiming()
    const pausedRowStep = pausedInitialRowDelayMs * 0.4
    const maxRowDelay = Math.max(0, cardsPerColumn - 1) * pausedRowStep
    const columnStep = cardsPerColumn * pausedInitialRowDelayMs * 0.6

    for (let col = pauseOrigin + 1; col < TOTAL_REELS; col++) {
      const offset = col - (pauseOrigin + 1)

      timers.push(
        window.setTimeout(
          () => {
            dispatch({ type: 'SET_ACTIVE_PAUSED_COLUMN', column: col })
          },
          pauseLeadMs + offset * columnStep,
        ),
      )
    }
    const hasScatterWin =
      activeCascade?.window?.flat().filter(s => s.kind === 'SCATTER').length >= 3

    const pausedColumns = TOTAL_REELS - (pauseOrigin + 1)
    const totalDuration =
      pauseLeadMs +
      Math.max(0, pausedColumns - 1) * columnStep +
      maxRowDelay +
      initialDealDurationMs +
      40

    timers.push(
      window.setTimeout(() => {
        dispatch({ type: 'SET_ACTIVE_PAUSED_COLUMN', column: null })

        if (hasNextLineWin) {
          dispatch({ type: 'ADVANCE', cascades })
        } else if (hasScatterWin) {
          dispatch({ type: 'ADVANCE_SCATTER', cascades })
        } else {
          dispatch({ type: 'NEXT', phase: 'settle' })
        }
      }, totalDuration),
    )

    return () => timers.forEach(clearTimeout)
  }, [state.phase, activeCascade, cascades, nextCascade, turboMultiplier])

  /* -----------------------------
     Auto-unpause (visual only)
  ----------------------------- */
  useEffect(() => {
    if (state.phase !== 'initialRefill') return
    if (state.initialRefillColumn === null) return

    const { pauseLeadMs } = getPauseTiming()
    const t = window.setTimeout(() => {
      dispatch({ type: 'SET_REFILL_COLUMN', column: null })
    }, pauseLeadMs)

    return () => clearTimeout(t)
  }, [state.phase, state.initialRefillColumn, turboMultiplier])

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
    const hasRedWildPropagation =
      activeCascade?.window?.some((col, reel) =>
        col.some((s, row) => {
          const prev = previousCascade?.window?.[reel]?.[row]
          return (
            s.kind === 'WILD' &&
            s.wildColor === 'red' &&
            !s.fromGold &&
            prev !== undefined &&
            !(prev.kind === 'WILD' && prev.wildColor === 'red')
          )
        }),
      ) ?? false

    const hasNextLineWin =
      Boolean(nextCascade?.lineWins?.length) || Number(nextCascade?.win ?? 0) > 0.0001
    const hasRemovals = Boolean(activeCascade?.removedPositions?.length)

    const nextScatterCount = nextCascade?.window?.flat().filter(s => s.kind === 'SCATTER').length ?? 0
    const hasNextLineScatter = nextScatterCount >= 3

    const hasScatterWin =
      activeCascade?.window?.flat().filter(s => s.kind === 'SCATTER').length >= 3

    switch (state.phase) {
      case 'reelSweepOut':
        t = window.setTimeout(() => {
          onCommit?.()
          dispatch({ type: 'NEXT', phase: 'initialRefill' })
        }, scaledWithFloor(120, 380))
        break

      case 'highlight':
        t = window.setTimeout(() => {
          dispatch({ type: 'NEXT', phase: 'pop' })
        }, scaledWithFloor(820, 420))
        break

      case 'pop':
        t = window.setTimeout(() => {
          if (hasRemovals) {
            dispatch({ type: 'NEXT', phase: 'cascadeRefill' })
          } else if (hasNextLineWin) {
            dispatch({ type: 'ADVANCE', cascades })
          } else if (hasNextLineScatter) {
            dispatch({ type: 'ADVANCE_SCATTER', cascades })
          } else {
            dispatch({ type: 'NEXT', phase: 'settle' })
          }
        }, scaledWithFloor(520, 240))
        break

      case 'cascadeRefill':
        t = window.setTimeout(() => {
          if (hasGoldToWild) {
            dispatch({ type: 'NEXT', phase: 'postGoldTransform' })
          } else if (hasNextLineWin) {
            dispatch({ type: 'ADVANCE', cascades })
          } else {
            dispatch({ type: 'NEXT', phase: 'settle' })
          }
        }, scaledWithFloor(760, 180))
        break

      case 'postGoldTransform':
        t = window.setTimeout(() => {
          if (hasNextLineWin) {
            dispatch({ type: 'ADVANCE', cascades })
          } else {
            dispatch({ type: 'NEXT', phase: 'settle' })
          }
        }, hasRedWildPropagation ? scaledWithFloor(2150, 1500) : scaledWithFloor(620, 180))
        break

      case 'settle':
        t = window.setTimeout(
          () => {
            if (!hasNextLineWin && hasScatterWin && !state.isScatterHighlight) {
              dispatch({ type: 'ADVANCE_SCATTER', cascades })
            } else {
              dispatch({ type: 'RESET' })
            }
          },
          scaledWithFloor(!hasNextLineWin && hasScatterWin ? 300 * turboMultiplier : 80, 80),
        )
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
