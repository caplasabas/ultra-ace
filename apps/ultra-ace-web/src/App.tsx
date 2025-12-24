import { useEngine } from './hooks/useEngine'
import { Reel } from './ui/Reel'
import { DimOverlay } from './ui/DimOverlay'
import { adaptWindow } from './game/adaptWindow'
import { useCascadeTimeline } from './hooks/useCascadeTimeline'
import { DebugHud } from './debug/DebugHud'
import { useEffect, useState } from 'react'

const makePlaceholder = (kind: string) => Array.from({ length: 4 }, () => ({ kind }))

export default function App() {
  const [autoSpin, setAutoSpin] = useState(false)

  const { cascades, spinId, spin, commitSpin, commitWin, spinning, debugInfo, totalWin } =
    useEngine()

  const { phase, activeCascade, previousCascade, cascadeIndex, isIdle } = useCascadeTimeline(
    cascades,
    spinId,
    commitSpin,
  )

  const placeholderWindow = adaptWindow([
    makePlaceholder('K'),
    makePlaceholder('Q'),
    makePlaceholder('J'),
    makePlaceholder('SPADE'),
    makePlaceholder('CLUB'),
  ] as any)

  const winningPositions = new Set(
    activeCascade?.lineWins.flatMap(lw => lw.positions.map(p => `${p.reel}-${p.row}`)) ?? [],
  )

  const windowForRender =
    phase === 'highlight' || phase === 'pop' ? previousCascade?.window : activeCascade?.window

  const adaptedWindow =
    windowForRender &&
    adaptWindow(
      windowForRender,
      phase === 'cascadeRefill' ? activeCascade?.removedPositions : undefined,
      previousCascade?.window,
    )

  const isReady = isIdle && !spinning

  useEffect(() => {
    if (!autoSpin) return
    if (!isReady) return

    const t = setTimeout(() => {
      spin()
    }, 300)

    return () => clearTimeout(t)
  }, [autoSpin, isReady, spin])

  useEffect(() => {
    if (phase !== 'highlight') return
    if (!activeCascade?.win) return

    commitWin(activeCascade.win)
  }, [phase])

  const MULTIPLIERS = [1, 2, 3, 5]

  const activeMultiplier = MULTIPLIERS[Math.min(cascadeIndex, MULTIPLIERS.length - 1)]

  return (
    <div className="game-root">
      <div className="game-frame">
        <div className="top-container">
          <DebugHud info={debugInfo} />

          <div className="multiplier-strip">
            {MULTIPLIERS.map(m => (
              <div
                key={m}
                className={[
                  'multiplier-chip',
                  m <= activeMultiplier && 'active',
                  m === activeMultiplier && 'current',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <h1>x{m}</h1>
              </div>
            ))}
          </div>
        </div>
        <div className="dim-zone">
          {/*<DimOverlay active={phase === 'highlight' && Boolean(activeCascade?.lineWins?.length)} />*/}
          <div className="reels-stage">
            <div className="reels-clip">
              <div className="reels-row">
                {placeholderWindow.map((col, i) => (
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
                  ['reelSweepOut', 'initialRefill'].includes(phase) &&
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
                  ['initialRefill', 'cascadeRefill', 'highlight', 'pop', 'settle', 'idle'].includes(
                    phase,
                  ) &&
                  adaptedWindow.map((col, i) => (
                    <Reel
                      key={`new-${cascadeIndex}-${i}`}
                      symbols={col}
                      reelIndex={i}
                      winningPositions={winningPositions}
                      phase={phase}
                      layer="new"
                    />
                  ))}
              </div>
            </div>
          </div>

          <div className="bottom-container">
            <div className="win-display">
              <span className="win-amount">Win: {totalWin.toFixed(2)}</span>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                gap: 15,
                alignItems: 'center',
                paddingTop: 5,
              }}
            >
              <button className={`spin-btn turbo`}>Turbo</button>

              <button
                className={`spin-btn spin-image ${autoSpin ? 'active' : ''}`}
                disabled={!isReady}
                onClick={spin}
                aria-label="Spin"
              />

              <button
                className={`spin-btn auto ${autoSpin ? 'active' : ''}`}
                onClick={() => setAutoSpin(!autoSpin)}
              >
                {autoSpin ? 'STOP' : 'AUTO'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
