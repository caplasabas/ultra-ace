import { useEngine } from './hooks/useEngine'
import { Reel } from './ui/Reel'
import { DimOverlay } from './ui/DimOverlay'
import { adaptWindow } from './game/adaptWindow'
import { useCascadeTimeline } from './hooks/useCascadeTimeline'
import type { CascadeStep } from '@ultra-ace/engine'

export default function App() {
  const { cascades, spinId, spin, commitSpin, spinning } = useEngine()

  const { phase, activeCascade, previousCascade } = useCascadeTimeline(cascades, spinId, commitSpin)

  // 🔑 Decide which window to render
  const engineWindow = phase === 'reelSweepOut' ? previousCascade?.window : activeCascade?.window

  const uiWindow = engineWindow ? adaptWindow(engineWindow, previousCascade?.window) : []

  const winningPositions = new Set(
    activeCascade?.lineWins.flatMap(lw => lw.positions.map(p => `${p.reel}-${p.row}`)) ?? [],
  )

  return (
    <div className="game-root">
      <div className="reels-row">
        {/*<DebugHUD />*/}

        {uiWindow.map((col, i) => (
          <Reel
            key={i}
            symbols={col}
            reelIndex={i}
            winningPositions={winningPositions}
            phase={phase}
          />
        ))}

        <DimOverlay active={phase === 'highlight'} />
      </div>

      <button className="spin-btn" disabled={spinning || phase !== 'idle'} onClick={spin}>
        SPIN
      </button>
    </div>
  )
}
