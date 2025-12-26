import { useEngine } from './hooks/useEngine'
import { Reel } from './ui/Reel'
import { DimOverlay } from './ui/DimOverlay'
import { WinOverlay } from './ui/WinOverlay'
import { adaptWindow } from './game/adaptWindow'
import { useCascadeTimeline } from './hooks/useCascadeTimeline'
import { DebugHud } from './debug/DebugHud'
import { useEffect, useState } from 'react'
import { formatPeso } from '@ultra-ace/engine'
import { useBackgroundAudio } from './audio/useBackgroundAudio'
import BGM from './assets/audio/bgm.mp3'

const makePlaceholder = (kind: string) => Array.from({ length: 4 }, () => ({ kind }))

export default function App() {
  const [autoSpin, setAutoSpin] = useState(false)

  const [audioOn, setAudioOn] = useState(() => {
    const saved = localStorage.getItem('audioOn')
    return saved ? saved === 'true' : true
  })

  useEffect(() => {
    localStorage.setItem('audioOn', String(audioOn))
  }, [audioOn])

  useBackgroundAudio(BGM, audioOn, 0.4)

  const {
    cascades,
    spinId,
    spin,
    commitSpin,
    commitWin,
    spinning,
    isFreeGame,
    freeSpinsLeft,
    debugInfo,
    totalWin,
  } = useEngine()

  const { phase, activeCascade, previousCascade, cascadeIndex, isIdle } = useCascadeTimeline(
    cascades,
    spinId,
    commitSpin,
  )

  const placeholderWindow = adaptWindow([
    makePlaceholder('A'),
    makePlaceholder('K'),
    makePlaceholder('Q'),
    makePlaceholder('J'),
    makePlaceholder('SPADE'),
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
    if (!isFreeGame) return
    if (!isIdle) return
    if (freeSpinsLeft <= 0) return

    spin()
  }, [isFreeGame, isIdle, freeSpinsLeft, spin])

  useEffect(() => {
    if (phase !== 'highlight') return
    if (!activeCascade?.win) return

    commitWin(activeCascade.win)
  }, [phase])

  const BASE_MULTIPLIERS = [1, 2, 3, 5]
  const FREE_MULTIPLIERS = [2, 4, 6, 10]

  const ladder = isFreeGame ? FREE_MULTIPLIERS : BASE_MULTIPLIERS

  function getMultiplierIndex(cascadeIndex: number) {
    if (cascadeIndex < 2) return 0
    return Math.min(cascadeIndex - 1, ladder.length - 1)
  }

  const activeMultiplierIndex = getMultiplierIndex(cascadeIndex)

  return (
    <div className="game-root">
      <div className="game-frame">
        <div className="top-container">
          <DebugHud info={debugInfo} />

          <div className="free-spin-banner">
            <div className={`free-spin-text ${!isFreeGame ? 'base' : ''}`}>
              <span className="free-spin-base">{isFreeGame ? 'FREE SPINS' : 'SuperAce'}</span>
              <span className="free-spin-face">{isFreeGame ? 'FREE SPINS' : 'SuperAce'}</span>
            </div>

            <span className="free-spin-count">{isFreeGame && freeSpinsLeft}</span>
          </div>

          <div className={`multiplier-strip ${isFreeGame ? 'free' : ''}`}>
            {ladder.map((m, i) => (
              <div
                key={m}
                className={['multiplier-chip', i === activeMultiplierIndex && 'current']
                  .filter(Boolean)
                  .join(' ')}
              >
                <span className="multiplier-base">x{m}</span>
                <span className="multiplier-face">x{m}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="dim-zone">
          <DimOverlay active={phase === 'highlight' && Boolean(activeCascade?.lineWins?.length)} />
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
            <WinOverlay
              amount={activeCascade?.win ?? 0}
              phase={phase === 'highlight' || phase === 'pop' ? phase : null}
            />
          </div>

          <div className="bottom-container">
            <div className="win-display">
              <span className="win-amount">Win: {formatPeso(totalWin ?? 0)}</span>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                gap: 15,
                alignItems: 'center',
                paddingTop: 10,
              }}
            >
              <button className="spin-btn audio" onClick={() => setAudioOn(v => !v)}>
                {audioOn ? '🔊' : '🔇'}
              </button>
              <button className={`spin-btn turbo`}>Turbo</button>

              <button
                className={`spin-btn spin-image ${autoSpin ? 'active' : ''}`}
                disabled={!isReady || isFreeGame}
                onClick={spin}
                aria-label="Spin"
              />

              <button
                className={`spin-btn auto ${autoSpin ? 'active' : ''}`}
                disabled={isFreeGame}
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
