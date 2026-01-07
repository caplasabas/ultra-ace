import './reel.css'
import type { CascadePhase } from '../hooks/useCascadeTimeline'
import { SYMBOL_MAP } from './symbolMap'
import { CSSProperties, memo, useEffect, useRef } from 'react'

/* ----------------------------------------
   CONFIG
---------------------------------------- */
const COLUMN_DEAL_DELAY = 110

const INITIAL_ROW_DROP_DELAY = 65
const CASCADE_ROW_DROP_DELAY = 120
const CASCADE_COLUMN_EXTRA_DELAY = 90

export const PAUSED_INITIAL_ROW_DROP_DELAY = 450

export interface UISymbol {
  id: string
  kind: string

  isNew?: boolean
  isPersisted?: boolean
  isSettledWild?: boolean

  isGold?: boolean
  goldTTL?: number

  isDecorativeGold?: boolean

  goldToWild?: boolean
  wildColor?: 'red' | 'blue'

  prevKind?: string
  wasGold?: boolean
}

interface Props {
  symbols: UISymbol[]
  reelIndex: number
  winningPositions: Set<string>
  phase: CascadePhase
  layer: 'old' | 'new'
  initialRefillColumn: number | null
  activePausedColumn: number | null
  turboMultiplier: number
}

type CSSVars = CSSProperties & {
  '--hx'?: string
  '--hy'?: string
}

/* ----------------------------------------
   SYMBOL IMAGE
---------------------------------------- */
function resolveSymbolImage(symbol: UISymbol): string {
  if (symbol.kind === 'EMPTY') return ''
  if (symbol.kind === 'BACK') return SYMBOL_MAP.BACK.normal

  if (symbol.isGold === true) {
    const gold = SYMBOL_MAP[symbol.kind]?.gold
    if (gold) return gold
  }

  if (symbol.kind === 'WILD') {
    if (symbol.wildColor === 'blue') return SYMBOL_MAP.WILD.normal

    if (symbol.wildColor === 'red') {
      return symbol.wasGold || symbol.isSettledWild || !symbol.prevKind
        ? SYMBOL_MAP.WILD_RED.normal
        : SYMBOL_MAP[symbol.prevKind!]?.normal
    }
  }

  return SYMBOL_MAP[symbol.kind]?.normal
}

function ReelComponent({
  symbols,
  reelIndex,
  winningPositions,
  phase,
  layer,
  initialRefillColumn,
  activePausedColumn,
  turboMultiplier,
}: Props) {
  const speed = turboMultiplier

  const columnDealDelay = speed === 10 ? 0 : COLUMN_DEAL_DELAY / speed
  const initialRowDelay = speed === 10 ? 0 : INITIAL_ROW_DROP_DELAY / speed
  const cascadeRowDelay = speed === 10 ? 0 : CASCADE_ROW_DROP_DELAY / speed
  const cascadeColumnExtraDelay = speed === 10 ? 0 : CASCADE_COLUMN_EXTRA_DELAY / speed
  const pausedInitialRowDelay = PAUSED_INITIAL_ROW_DROP_DELAY / speed
  /* ----------------------------------------
     INITIAL REFILL CONTROL
  ---------------------------------------- */
  const isInitialRefill = phase === 'initialRefill' && layer === 'new'

  // 🔒 Persist pause origin even after unpause
  const pauseOriginRef = useRef<number | null>(null)

  useEffect(() => {
    if (isInitialRefill && initialRefillColumn !== null) {
      pauseOriginRef.current = initialRefillColumn
    }
  }, [isInitialRefill, initialRefillColumn])

  const pauseOrigin = pauseOriginRef.current
  const hasPauseOccurred = pauseOrigin !== null

  // ⛔ hide columns ONLY while paused
  const isPausedColumn =
    isInitialRefill && initialRefillColumn !== null && reelIndex > initialRefillColumn

  if (isPausedColumn) return null

  const isImmediateInitialDrop = isInitialRefill && (!hasPauseOccurred || reelIndex <= pauseOrigin!)

  const isStaggeredInitialDrop = isInitialRefill && hasPauseOccurred && reelIndex > pauseOrigin!

  const staggerIndex = hasPauseOccurred ? Math.max(0, reelIndex - (pauseOrigin! + 1)) : 0

  const CARDS_PER_COLUMN = symbols.length

  const pausedColumnDuration = CARDS_PER_COLUMN * pausedInitialRowDelay

  const staggerDelay = hasPauseOccurred ? staggerIndex * pausedColumnDuration : 0

  const isCascadeRefill = phase === 'cascadeRefill' && layer === 'new'

  const isActivePausedColumn = isInitialRefill && reelIndex === activePausedColumn

  return (
    <div
      className={['reel', layer === 'old' && phase === 'reelSweepOut' && 'sweep-out-old']
        .filter(Boolean)
        .join(' ')}
      style={{
        left: `calc(${reelIndex} * (var(--reel-width) + var(--reel-gap)))`,
      }}
    >
      {isActivePausedColumn && (
        <div className="paused-column-border-glow">
          <div className="paused-column-inner-ember" />
          <div className="paused-column-energy-pulse" />
          <div className="ray" />
        </div>
      )}

      {symbols.map((symbol, row) => {
        const isWin = winningPositions.has(`${reelIndex}-${row}`)
        const isScatter = symbol.kind === 'SCATTER'
        const isBack = symbol.kind === 'BACK'
        const isWild = symbol.kind === 'WILD'

        if (isCascadeRefill) {
          console.log(symbol)
        }

        const wildHighlight = isWild && isWin && phase === 'highlight'

        const isCascadeDeal =
          isCascadeRefill && symbol.isNew && !symbol.isPersisted && !symbol.isSettledWild

        const isGoldLocked =
          symbol.isGold === true || symbol.goldTTL !== undefined || symbol.wasGold

        const isGoldWin = isGoldLocked && isWin && phase === 'pop'
        const isNormalPop = isWin && phase === 'pop' && !isGoldLocked

        const isScatterIdle =
          isScatter &&
          !symbol.isNew &&
          !isCascadeDeal &&
          (phase === 'highlight' || phase === 'idle' || phase === 'settle')

        const shouldFlip = symbol.goldToWild === true

        /* ----------------------------------------
           DEAL TIMING
        ---------------------------------------- */
        const rowDelay =
          (symbols.length - 1 - row) *
          (isStaggeredInitialDrop
            ? pausedInitialRowDelay
            : isCascadeRefill
              ? cascadeRowDelay
              : initialRowDelay)

        const baseColumnDelay = isImmediateInitialDrop
          ? reelIndex * columnDealDelay
          : isCascadeDeal
            ? reelIndex * (columnDealDelay + cascadeColumnExtraDelay)
            : 0

        const totalDelay =
          isImmediateInitialDrop || isCascadeDeal || isStaggeredInitialDrop
            ? baseColumnDelay + rowDelay + staggerDelay
            : 0

        const imgSrc = resolveSymbolImage(symbol)

        return (
          <div
            key={symbol.id}
            className="card-shell"
            style={{
              top: `calc(${row} * (var(--scaled-card-height) + var(--card-gap)))`,
              zIndex: isWin && phase === 'highlight' ? 20 : 1,
            }}
          >
            {isWin && phase === 'pop' && (
              <div className="scorch-pop delayed">
                <div className="scorch-atlas pop" />
              </div>
            )}

            <div
              className={[
                'card',
                isBack && 'back',
                symbol.kind === 'WILD' && symbol.wasGold && 'wild',
                symbol.kind === 'WILD' &&
                  symbol.wasGold &&
                  symbol.wildColor === 'red' &&
                  'wild-red',
                isGoldLocked && 'gold',
                isScatter && 'scatter',
                (isImmediateInitialDrop || isStaggeredInitialDrop) && 'deal-initial',
                isCascadeDeal && 'deal',
                isNormalPop && 'pop',
                isGoldWin && 'gold-pop-lock',
                shouldFlip && 'flip-to-wild',
                symbol.isSettledWild && 'settled',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{
                animationDelay: `${totalDelay}ms`,
              }}
            >
              <div
                className={[
                  'card-inner',
                  isBack && isCascadeRefill && 'highlight-back',
                  isWin &&
                    phase === 'highlight' &&
                    !isWild &&
                    !isBack &&
                    !symbol.goldToWild &&
                    'highlight',
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={
                  isWin && phase === 'highlight'
                    ? ({
                        '--hx': `${(reelIndex % 2 ? 1 : -1) * 6}px`,
                        '--hy': `${(row % 2 ? 1 : -1) * 6}px`,
                      } as CSSVars)
                    : undefined
                }
              >
                <img
                  src={imgSrc}
                  className={['symbol-img', wildHighlight && 'wild-highlight']
                    .filter(Boolean)
                    .join(' ')}
                  style={{ backgroundImage: `url(${imgSrc})` }}
                  draggable={false}
                />
              </div>
            </div>

            <div
              className={['scorch-under', isWin && phase === 'highlight' && 'active delayed']
                .filter(Boolean)
                .join(' ')}
            >
              <div className="scorch-atlas core" />
              <div className="scorch-atlas rays" />
            </div>

            {isScatterIdle && (
              <div className="scorch-under scatter-idle">
                <div className="scorch-atlas core" />
                <div className="scorch-atlas rays" />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/* ----------------------------------------
   MEMO
---------------------------------------- */
export const Reel = memo(
  ReelComponent,
  (a, b) =>
    a.symbols === b.symbols &&
    a.phase === b.phase &&
    a.layer === b.layer &&
    a.winningPositions === b.winningPositions &&
    a.initialRefillColumn === b.initialRefillColumn,
)
