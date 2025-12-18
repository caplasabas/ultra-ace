import { useEngine } from './hooks/useEngine'
import { Reel } from './ui/Reel'
import { DimOverlay } from './ui/DimOverlay'
import { adaptWindow } from './game/adaptWindow'
import { useCascadeTimeline } from './hooks/useCascadeTimeline'
import { DebugHud } from './debug/DebugHud'
import { useEffect } from 'react'

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

  const winningPositions = new Set(
    activeCascade?.lineWins.flatMap(lw =>
      lw.positions.map(p => `${p.reel}-${p.row}`),
    ) ?? [],
  )

  const windowForRender = (() => {
    switch (phase) {
      case 'highlight':
      case 'pop':
        return previousCascade?.window

      case 'cascadeRefill':
      case 'settle':
      case 'idle':
      case 'initialRefill':
        return activeCascade?.window

      default:
        return activeCascade?.window
    }
  })()

  const adaptedWindow =
    windowForRender &&
    adaptWindow(
      windowForRender,
      phase === 'cascadeRefill'
        ? activeCascade?.removedPositions
        : undefined,
    )


  return (
    <div className="game-root">
      <DebugHud info={debugInfo} />
      <div className="reels-row">
        <DimOverlay
          active={
            phase === 'highlight' &&
            Boolean(activeCascade?.lineWins?.length)
          }
        />
        {placeholderWindow &&
          placeholderWindow.map((col, i) => (
            <Reel
              key={`ph-${i}`}
              symbols={col}
              reelIndex={i}
              winningPositions={new Set()}
              phase={spinId > 0 ? 'reelSweepOut' : 'idle'}
              layer={spinId > 0 ? 'old' : 'new'}
            />
          ))}

        {previousCascade &&
          [
            'reelSweepOut',
            'initialRefill'
          ].includes(phase) &&
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

        {adaptedWindow &&
          [
            'initialRefill',
            'cascadeRefill',
            'highlight',
            'pop',
            'settle',
            'idle',
          ].includes(phase) &&
         adaptedWindow.map((col, i) => (
            <Reel
              key={`new-${cascadeIndex}-${i}`} // ✅ STABLE
              symbols={col}
              reelIndex={i}
              winningPositions={winningPositions}
              phase={phase}
              layer="new"
            />
          ))}


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




