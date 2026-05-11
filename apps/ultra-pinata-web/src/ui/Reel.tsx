import './reel.css'
import type { CascadePhase } from '../hooks/useCascadeTimeline'
import { SYMBOL_MAP } from './symbolMap'
import { CSSProperties, memo, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import kamehamewave from '../assets/images/kamehamewave.png'
/* ----------------------------------------
   CONFIG
---------------------------------------- */
const COLUMN_DEAL_DELAY = 55

const INITIAL_ROW_DROP_DELAY = 65
const CASCADE_ROW_DROP_DELAY = 60
const CASCADE_COLUMN_EXTRA_DELAY = 45
const SPIN_FILLER_ROWS = 26
const SPIN_FILLER_KINDS = [
  'SKULL',
  'SOMBRERO',
  'MARACAS',
  'TACO',
  'CHILLI',
  'ACE',
  'KING',
  'QUEEN',
  'JACK',
  'SCATTER',
]

export const PAUSED_INITIAL_ROW_DROP_DELAY = 1000

export interface UISymbol {
  id: string
  kind: string

  isNew?: boolean
  isPersisted?: boolean
  isSettledWild?: boolean
  redWildIncoming?: boolean

  isGold?: boolean
  goldTTL?: number
  goldMultiplier?: number

  isDecorativeGold?: boolean

  goldToWild?: boolean
  wildColor?: 'red' | 'blue'

  prevKind?: string
  wasGold?: boolean
  refillSourceRow?: number
}

interface Props {
  symbols: UISymbol[]
  topPreviewSymbols?: UISymbol[]
  reelIndex: number
  winningPositions: Set<string>
  phase: CascadePhase
  layer: 'old' | 'new'
  initialRefillColumn: number | null
  activePausedColumn: number | null
  turboMultiplier: number
  isScatterHighlight: boolean
}

type CSSVars = CSSProperties & {
  '--hx'?: string
  '--hy'?: string
  '--cascade-start-y'?: string
  '--initial-spin-distance'?: string
  '--initial-spin-duration'?: string
  '--initial-spin-delay'?: string
}

/* ----------------------------------------
   SYMBOL IMAGE
---------------------------------------- */
function resolveSymbolImage(symbol: UISymbol): string | undefined {
  if (symbol.kind === 'EMPTY') return undefined
  if (symbol.kind === 'BACK') return SYMBOL_MAP.BACK.normal

  if (symbol.isGold === true || symbol.goldTTL !== undefined || symbol.isDecorativeGold === true) {
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

function getSymbolFallbackLabel(symbol: UISymbol): string {
  const labels: Record<string, string> = {
    SKULL: 'SK',
    SOMBRERO: 'SO',
    MARACAS: 'MA',
    TACO: 'TA',
    CHILLI: 'CH',
    ACE: 'A',
    KING: 'K',
    QUEEN: 'Q',
    JACK: 'J',
    WILD: 'W',
    SCATTER: 'SC',
  }

  return labels[symbol.kind] ?? symbol.kind.slice(0, 2)
}

function ReelComponent({
  symbols,
  topPreviewSymbols,
  reelIndex,
  winningPositions,
  phase,
  layer,
  initialRefillColumn,
  activePausedColumn,
  turboMultiplier,
  isScatterHighlight,
}: Props) {
  const speed = turboMultiplier

  const columnDealDelay = speed === 10 ? 0 : COLUMN_DEAL_DELAY / speed
  const initialRowDelay = speed === 10 ? 0 : INITIAL_ROW_DROP_DELAY / speed
  const cascadeRowDelay = speed === 10 ? 0 : CASCADE_ROW_DROP_DELAY / speed
  const cascadeColumnExtraDelay = speed === 10 ? 0 : CASCADE_COLUMN_EXTRA_DELAY / speed
  const pausedTurboSpeed = speed && speed > 1 ? speed / 2 : speed
  const pausedInitialRowDelay = PAUSED_INITIAL_ROW_DROP_DELAY / pausedTurboSpeed
  const initialDealDuration = Math.max(70, 185 / pausedTurboSpeed)
  const cascadeDealDuration = Math.max(180, 320 / Math.max(speed, 1))
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

  const staggerDelay = hasPauseOccurred ? staggerIndex * pausedColumnDuration * 0.6 : 0

  const isCascadeRefill = phase === 'cascadeRefill' && layer === 'new'

  const isActivePausedColumn = isInitialRefill && reelIndex === activePausedColumn
  const columnDelayPattern = [0, 90, 205, 330, 470]
  const columnDurationPattern = [0, 70, -35, 110, 35]
  const initialSpinDuration =
    Math.max(2920, 3380 / Math.max(speed, 1)) + (columnDurationPattern[reelIndex] ?? 0)
  const initialSpinDelay = columnDelayPattern[reelIndex] ?? reelIndex * 120
  const initialSpinStyle = isInitialRefill
    ? ({
        '--initial-spin-distance': `calc(${SPIN_FILLER_ROWS} * (var(--scaled-card-height) + var(--card-gap)))`,
        '--initial-spin-duration': `${initialSpinDuration}ms`,
        '--initial-spin-delay': `${initialSpinDelay}ms`,
      } as CSSVars)
    : undefined

  const spinFillerSymbols: UISymbol[] = isInitialRefill
    ? Array.from({ length: SPIN_FILLER_ROWS }, (_, index) => {
        const source = symbols[(index + reelIndex) % Math.max(symbols.length, 1)]
        const kind = SPIN_FILLER_KINDS[(index * 3 + reelIndex * 2) % SPIN_FILLER_KINDS.length]
        return {
          id: `spin-filler-${reelIndex}-${index}-${kind}`,
          kind,
          isNew: true,
          isPersisted: false,
          isGold: false,
          goldTTL: undefined,
          goldMultiplier: undefined,
          isDecorativeGold: false,
          goldToWild: false,
          wildColor: source?.kind === 'WILD' ? source.wildColor : undefined,
          isSettledWild: false,
          prevKind: undefined,
          wasGold: false,
        }
      })
    : []

  function renderSymbol(symbol: UISymbol, row: number, isTopPreview = false) {
    const isWin = !isTopPreview && winningPositions.has(`${reelIndex}-${row}`)
    const isScatter = symbol.kind === 'SCATTER'
    const isBack = symbol.kind === 'BACK'
    const isWild = symbol.kind === 'WILD'

    const wildHighlight = isWild && isWin && phase === 'highlight'

    const isCascadeDeal =
      !isTopPreview && isCascadeRefill && symbol.isNew && !symbol.isPersisted && !symbol.isSettledWild

    const isGoldLocked =
      symbol.isGold === true || symbol.goldTTL !== undefined || symbol.wasGold
    const goldMultiplier = Number(symbol.goldMultiplier ?? 0)
    const showGoldMultiplier = isGoldLocked && goldMultiplier > 1 && !isBack

    const isGoldWin = isGoldLocked && isWin && phase === 'pop' && symbol.kind !== 'SCATTER'

    const isNormalPop = isWin && phase === 'pop' && !isGoldLocked && symbol.kind !== 'SCATTER'

    const isScatterIdle =
      isScatter &&
      !symbol.isNew &&
      !isCascadeDeal &&
      (phase === 'highlight' || phase === 'idle' || phase === 'settle')

    const shouldFlip = symbol.goldToWild === true

    const isScatterHover =
      symbol.kind === 'SCATTER' &&
      isScatterHighlight &&
      (phase === 'highlight' || phase === 'settle')

    const rowDelay =
      isTopPreview
        ? 0
        : (symbols.length - 1 - row) *
          (isStaggeredInitialDrop
            ? pausedInitialRowDelay * 0.4
            : isCascadeRefill
              ? cascadeRowDelay
              : initialRowDelay)

    const baseColumnDelay = isActivePausedColumn
      ? 0
      : isImmediateInitialDrop
        ? reelIndex * columnDealDelay
        : isCascadeDeal
          ? reelIndex * (columnDealDelay + cascadeColumnExtraDelay)
          : 0

    const totalDelay =
      !isTopPreview && (isImmediateInitialDrop || isCascadeDeal || isStaggeredInitialDrop)
        ? baseColumnDelay + rowDelay + staggerDelay
        : 0

    const imgSrc = resolveSymbolImage(symbol)
    const cascadeStartY =
      isCascadeDeal && typeof symbol.refillSourceRow === 'number'
        ? `calc(${symbol.refillSourceRow - row} * (var(--scaled-card-height) + var(--card-gap)))`
        : undefined

    return (
      <div
        key={symbol.id}
        className={['card-shell', isTopPreview && 'top-preview-card-shell']
          .filter(Boolean)
          .join(' ')}
        style={{
          top: `calc(${row} * (var(--scaled-card-height) + var(--card-gap)))`,
          zIndex:
            isTopPreview ||
            (isWin && phase === 'highlight') ||
            (phase === 'initialRefill' && (isActivePausedColumn || isScatter))
              ? 30
              : 1,
        }}
      >
        {!isTopPreview && isWin && phase === 'pop' && (
          <div className="scorch-pop delayed">
            <div className="scorch-atlas pop" />
          </div>
        )}

        <div
          className={[
            'card',
            isTopPreview && 'top-preview-card',
            isBack && 'back',
            symbol.kind === 'WILD' && symbol.wasGold && 'wild',
            symbol.kind === 'WILD' && symbol.wasGold && symbol.wildColor === 'red' && 'wild-red',
            isGoldLocked && 'gold',
            isScatter && 'scatter',
            !isInitialRefill &&
              !isTopPreview &&
              (isImmediateInitialDrop || isStaggeredInitialDrop) &&
              'deal-initial',
            isCascadeDeal && 'deal',
            isNormalPop && 'pop',
            isGoldWin && 'gold-pop-lock',
            isScatterHover && 'scatter-hover',
            shouldFlip && 'flip-to-wild',
            symbol.isSettledWild && 'settled',
          ]
            .filter(Boolean)
            .join(' ')}
          style={{
            animationDelay: `${totalDelay}ms`,
            animationDuration:
              !isTopPreview && (isImmediateInitialDrop || isStaggeredInitialDrop)
                ? `${initialDealDuration}ms`
                : isCascadeDeal
                  ? `${cascadeDealDuration}ms`
                  : undefined,
            ...(cascadeStartY ? ({ '--cascade-start-y': cascadeStartY } as CSSVars) : undefined),
          }}
        >
          <div
            className={[
              'card-inner',
              isBack && isCascadeRefill && 'highlight-back',
              !isTopPreview &&
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
              !isTopPreview && isWin && phase === 'highlight'
                ? ({
                    '--hx': `${(reelIndex % 2 ? 1 : -1) * 6}px`,
                    '--hy': `${(row % 2 ? 1 : -1) * 6}px`,
                  } as CSSVars)
                : undefined
            }
          >
            {imgSrc && (
              <img
                src={imgSrc}
                className={['symbol-img', wildHighlight && 'wild-highlight']
                  .filter(Boolean)
                  .join(' ')}
                draggable={false}
              />
            )}
            {!imgSrc && symbol.kind !== 'EMPTY' && (
              <div className="symbol-text-fallback">
                <span>{getSymbolFallbackLabel(symbol)}</span>
                {symbol.goldTTL !== undefined && <em>G</em>}
              </div>
            )}
            {!isTopPreview && symbol.redWildIncoming && phase === 'postGoldTransform' && (
              <img
                src={SYMBOL_MAP.WILD_RED.normal}
                className="symbol-img incoming-red-wild"
                draggable={false}
              />
            )}
            {showGoldMultiplier && <div className="symbol-multiplier-badge">x{goldMultiplier}</div>}
          </div>
        </div>

        {!isTopPreview && (
          <div
            className={['scorch-under', isWin && phase === 'highlight' && 'active delayed']
              .filter(Boolean)
              .join(' ')}
          >
            <div className="scorch-atlas core" />
            <div className="scorch-atlas rays" />
          </div>
        )}

        {!isTopPreview && isScatterIdle && (
          <div className="scorch-under scatter-idle">
            <div className="scorch-atlas core" />
            <div className="scorch-atlas rays" />
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      <div id="reel-light-overlay" style={{ display: isActivePausedColumn ? 'block' : 'none' }}>
        <img
          src={kamehamewave}
          className="frame-paused-column-light-ray"
          style={{
            left: `calc(${reelIndex} * (var(--reel-width) + var(--reel-gap)) + var(--reel-width) /1.55)`,
          }}
          draggable={false}
        />
      </div>
      {isActivePausedColumn &&
        createPortal(
          <img
            src={kamehamewave}
            className="frame-paused-column-frame"
            style={{
              left: `calc(${reelIndex} * (var(--reel-width) + var(--reel-gap)) + var(--reel-width) /1.55)`,
            }}
            draggable={false}
          />,
          document.getElementById('frame-light-overlay')!,
        )}

      <div
        className={[
          'reel',
          layer === 'old' && phase === 'reelSweepOut' && 'sweep-out-old',
          isInitialRefill && 'initial-spin-reel',
        ]
          .filter(Boolean)
          .join(' ')}
        style={{
          left: `calc(${reelIndex} * (var(--reel-width) + var(--reel-gap)))`,
          ...initialSpinStyle,
        }}
      >
        {isActivePausedColumn && (
          <div className="paused-column-border-glow">
            <div className="paused-column-inner-ember" />
            <div className="paused-column-energy-pulse" />

            <div className="ray" />
          </div>
        )}

        {!isInitialRefill &&
          !isCascadeRefill &&
          topPreviewSymbols?.map(symbol =>
          renderSymbol(symbol, symbol.refillSourceRow ?? -1, true),
        )}
        {spinFillerSymbols.map((symbol, index) =>
          renderSymbol(symbol, index - SPIN_FILLER_ROWS + symbols.length, true),
        )}
        {isInitialRefill &&
          topPreviewSymbols?.map(symbol => renderSymbol(symbol, -SPIN_FILLER_ROWS - 1, true))}
        {symbols.map((symbol, row) =>
          renderSymbol(symbol, isInitialRefill ? row - SPIN_FILLER_ROWS : row),
        )}
      </div>
    </>
  )
}

/* ----------------------------------------
   MEMO
---------------------------------------- */
export const Reel = memo(
  ReelComponent,
  (a, b) =>
    a.symbols === b.symbols &&
    a.topPreviewSymbols === b.topPreviewSymbols &&
    a.phase === b.phase &&
    a.layer === b.layer &&
    a.winningPositions === b.winningPositions &&
    a.initialRefillColumn === b.initialRefillColumn &&
    a.activePausedColumn === b.activePausedColumn &&
    a.turboMultiplier === b.turboMultiplier &&
    a.isScatterHighlight === b.isScatterHighlight,
)
