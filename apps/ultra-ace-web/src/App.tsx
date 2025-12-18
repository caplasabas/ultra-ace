import { useEngine } from './hooks/useEngine'
import { Reel } from './ui/Reel'
import { DimOverlay } from './ui/DimOverlay'
import { adaptWindow } from './game/adaptWindow'
import { useCascadeTimeline } from './hooks/useCascadeTimeline'
import { DebugHud } from './debug/DebugHud'

const makePlaceholder = (kind: string) =>
  Array.from({ length: 4 }, () => ({ kind }))

export default function App() {
  const { cascades, spinId, spin, commitSpin, spinning,debugInfo } = useEngine()

  const {
    phase,
    activeCascade,
    previousCascade,
    cascadeIndex,
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
      <DebugHud info={debugInfo} />
      <div className="reels-row">

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

        {previousCascade &&
          phase === 'reelSweepOut' &&
          adaptWindow(previousCascade.window).map((col, i) => (
            <Reel
              key={`old-${cascadeIndex}-${i}`}
              symbols={col}
              reelIndex={i}
              winningPositions={winningPositions}
              phase="reelSweepOut"
              layer="old"
            />
          ))}

        {activeCascade &&
          [
            'initialRefill',
            'cascadeRefill',
            'highlight',
            'pop',
            'settle',
            'idle',
          ].includes(phase) &&
          adaptWindow(
            activeCascade.window,
            previousCascade?.window,
          ).map((col, i) => (
            <Reel
              key={`new-${cascadeIndex}-${i}`} // ✅ STABLE
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
