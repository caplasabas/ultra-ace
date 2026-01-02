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

const DEV = import.meta.env.DEV

const makePlaceholder = (kind: string) => Array.from({ length: 4 }, () => ({ kind }))

export default function App() {
  const [autoSpin, setAutoSpin] = useState(false)

  const [audioOn, setAudioOn] = useState(() => {
    const saved = localStorage.getItem('audioOn')
    return saved ? saved === 'true' : true
  })

  useEffect(() => {
    const scale = Math.min(window.innerWidth / 430, window.innerHeight / 900)

    const el = document.querySelector('.game-scale') as HTMLElement
    if (el) el.style.transform = `scale(${scale})`
  }, [])

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
    balance,
    setBalance,
    bet,
    setBet,
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

  const hasScatterWin =
    activeCascade &&
    activeCascade.window &&
    activeCascade.window.flat().filter(s => s.kind === 'SCATTER').length >= 3

  const winningPositions = new Set<string>()

  // normal symbol wins
  activeCascade?.lineWins?.forEach(lw => {
    lw.positions.forEach(p => winningPositions.add(`${p.reel}-${p.row}`))
  })

  // scatter win (no lineWins)
  if (hasScatterWin && activeCascade?.window) {
    activeCascade.window.forEach((col, reel) => {
      col.forEach((s, row) => {
        if (s.kind === 'SCATTER') {
          winningPositions.add(`${reel}-${row}`)
        }
      })
    })
  }

  if (activeCascade?.window) {
    activeCascade.window.forEach((col, reel) => {
      if (reel !== 4) return

      col.forEach((s, row) => {
        if (s.kind !== 'WILD') return

        // highlight only if same row has a real win earlier
        if (winningPositions.has(`3-${row}`) || winningPositions.has(`2-${row}`)) {
          winningPositions.add(`4-${row}`) // UI-only
        }
      })
    })
  }

  const windowForRender =
    phase === 'highlight' || phase === 'pop' ? previousCascade?.window : activeCascade?.window

  const adaptedWindow =
    windowForRender &&
    adaptWindow(
      windowForRender,
      phase === 'cascadeRefill' ? activeCascade?.removedPositions : undefined,
      previousCascade?.window,
      phase,
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

    if (freeSpinsLeft > 9) {
      setAutoSpin(false)
    } else {
      const t = setTimeout(() => {
        spin()
      }, 300)
    }
  }, [isFreeGame, isIdle, freeSpinsLeft, spin])

  useEffect(() => {
    if (phase !== 'highlight') return
    if (!activeCascade?.win) return

    commitWin(activeCascade.win)

    setBalance(balance + (activeCascade?.win ?? 0))
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
    <div className="viewport">
      <div className="game-root">
        <div className="game-frame">
          <div className="top-container">
            {DEV && <DebugHud info={debugInfo} />}

            <div className="free-spin-banner">
              <div className={`free-spin-text font-plasma ${!isFreeGame ? 'base' : ''}`}>
                <span className="free-spin-base superace-base">
                  {isFreeGame ? 'FREE SPINS' : 'UltraAce'}
                </span>

                <span className="free-spin-face superace-face">
                  {isFreeGame ? 'FREE SPINS' : 'UltraAce'}
                </span>
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
            <DimOverlay
              active={phase === 'highlight' && Boolean(activeCascade?.lineWins?.length)}
            />
            <div className="reels-stage">
              <div className="gpu-prewarm" />
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
                    [
                      'initialRefill',
                      'cascadeRefill',
                      'postGoldTransform',
                      'highlight',
                      'pop',
                      'settle',
                      'idle',
                    ].includes(phase) &&
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
                WIN: <span className="win-amount"> {formatPeso(totalWin ?? 0)}</span>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'center',
                  gap: 15,
                  alignItems: 'center',
                  paddingTop: 10,
                  marginTop: -10,
                }}
              >
                <button className="spin-btn audio" onClick={() => setAudioOn(v => !v)}>
                  {audioOn ? '🔊' : '🔇'}
                </button>

                <div className="bet-display">
                  Bet: <span className="bet-amount">{formatPeso(bet ?? 0, true, false)}</span>
                </div>

                <button
                  className={`spin-btn spin-image ${autoSpin ? 'active' : ''}`}
                  disabled={
                    !isReady || balance === 0 || balance < bet || (isFreeGame && freeSpinsLeft < 10)
                  }
                  onClick={spin}
                  aria-label="Spin"
                />

                <button
                  className={`spin-btn auto ${autoSpin ? 'active' : ''}`}
                  disabled={isFreeGame || balance === 0 || balance < bet}
                  onClick={() => setAutoSpin(!autoSpin)}
                >
                  {autoSpin ? 'STOP' : 'AUTO'}
                </button>

                <button className={`spin-btn turbo`} disabled={true}>
                  Turbo
                </button>
              </div>
              <div className="balance-display">
                Balance <span className="balance-amount">{formatPeso(balance ?? 0)}</span>
                <button className="add-btn" onClick={() => setBalance(balance + 20)}>
                  +{formatPeso(20, true, false)}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
