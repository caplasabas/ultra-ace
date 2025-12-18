import { useEngine } from './hooks/useEngine'
import { Reel } from './ui/Reel'
import { DimOverlay } from './ui/DimOverlay'
import { adaptWindow } from './game/adaptWindow'
import { useCascadeTimeline } from './hooks/useCascadeTimeline'

const makePlaceholder = (kind: string) =>
  Array.from({ length: 4 }, () => ({ kind }))

export default function App() {
  const { cascades, spinId, spin, commitSpin, spinning } = useEngine()

  const {
    phase,
    activeCascade,
    previousCascade,
    isIdle,
  } = useCascadeTimeline(cascades, spinId, commitSpin)

  const placeholderWindow = adaptWindow([
    makePlaceholder('K'),
    makePlaceholder('Q'),
    makePlaceholder('J'),
    makePlaceholder('SPADE'),
    makePlaceholder('CLUB'),
  ] as any)

  const showPlaceholder = cascades.length === 0 && isIdle

  const winningPositions = new Set(
    activeCascade?.lineWins.flatMap(lw =>
      lw.positions.map(p => `${p.reel}-${p.row}`),
    ) ?? [],
  )

  return (
    <div className="game-root">
      <div className="reels-row">

        {/* PLACEHOLDER */}
        {showPlaceholder &&
          placeholderWindow.map((col, i) => (
            <Reel
              key={`ph-${i}`}
              symbols={col}
              reelIndex={i}
              winningPositions={new Set()}
              phase="idle"
              layer="new"
            />
          ))}

        {/* OLD reels — sweep OUT */}
        {previousCascade &&
          phase === 'reelSweepOut' &&
          adaptWindow(previousCascade.window).map((col, i) => (
            <Reel
              key={`old-${i}`}
              symbols={col}
              reelIndex={i}
              winningPositions={winningPositions}
              phase="reelSweepOut"
              layer="old"
            />
          ))}

        {/* NEW reels — MUST exist during sweep-out */}
        {activeCascade &&
          ['refill', 'settle', 'idle'].includes(phase) &&
          adaptWindow(activeCascade.window, previousCascade?.window).map((col, i) => (
            <Reel
              key={`new-${i}`}
              symbols={col}
              reelIndex={i}
              winningPositions={winningPositions}
              phase={phase}
              layer="new"
            />
          ))}

        <DimOverlay
          active={
            phase === 'highlight' &&
            Boolean(activeCascade?.lineWins?.length)
          }
        />
      </div>

      <button
        className="spin-btn"
        disabled={spinning || !isIdle}
        onClick={spin}
      >
        SPIN
      </button>
    </div>
  )
}
