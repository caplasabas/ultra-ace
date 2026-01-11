import { useEngine } from './hooks/useEngine'
import { PAUSED_INITIAL_ROW_DROP_DELAY, Reel } from './ui/Reel'
import { DimOverlay } from './ui/DimOverlay'
import { WinOverlay } from './ui/WinOverlay'
import { adaptWindow } from './game/adaptWindow'
import type { CascadeStep, Symbol as EngineSymbol } from '@ultra-ace/engine'

import {
  detectScatterPauseColumn,
  INITIAL_REFILL_PAUSE_MS,
  TOTAL_REELS,
  useCascadeTimeline,
} from './hooks/useCascadeTimeline'
import { DebugHud } from './debug/DebugHud'
import { useEffect, useMemo, useState } from 'react'
import { formatPeso } from '@ultra-ace/engine'
import { useBackgroundAudio } from './audio/useBackgroundAudio'
import BGM from './assets/audio/bgm.mp3'

import { FreeSpinIntro } from './ui/FreeSpinIntro'
import { ScatterWinBanner } from './ui/ScatterWinBanner'
const DEV = import.meta.env.DEV

const makePlaceholder = (kind: string) => Array.from({ length: 4 }, () => ({ kind }))

function logWindowKinds(label: string, window: EngineSymbol[][]) {
  if (!window?.length) return

  const reels = window.length
  const rows = window[0].length

  console.group(`[BOARD] ${label}`)

  // Print top row first (visual match)
  for (let row = rows - 1; row >= 0; row--) {
    const line = []
    for (let reel = 0; reel < reels; reel++) {
      const k = window[reel][row]?.kind ?? '???'
      line.push(k.padEnd(9, ' '))
    }
    console.log(line.join(' | '))
  }

  console.groupEnd()
}

const EMPTY_SYMBOL: EngineSymbol = {
  kind: 'EMPTY',
  isGold: false,
  goldTTL: undefined,
  isDecorativeGold: false,
  wildColor: undefined,
}

export default function App() {
  const [autoSpin, setAutoSpin] = useState(false)
  const [turboStage, setTurboStage] = useState<0 | 1 | 2 | 3>(0)

  const turboMultiplier = useMemo(() => {
    switch (turboStage) {
      case 1:
        return 5
      case 2:
        return 7.5
      case 3:
        return 10
      default:
        return 1
    }
  }, [turboStage])

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
    freeSpinTotal,
    setFreeSpinTotal,
    showFreeSpinIntro,
    setShowFreeSpinIntro,
    pendingFreeSpins,
    buyFreeSpins,
    scatterTriggerType,
    consumeFreeSpin,
    showScatterWinBanner,
    freezeUI,
  } = useEngine()

  const {
    phase,
    activeCascade,
    previousCascade,
    cascadeIndex,
    isIdle,
    isScatterHighlight,
    initialRefillColumn,
    activePausedColumn,
  } = useCascadeTimeline(
    cascades,
    spinId,
    isFreeGame,
    turboMultiplier,
    scatterTriggerType,
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

  const isScatterOnlyTerminal =
    Boolean(activeCascade) &&
    activeCascade.lineWins.length === 0 &&
    activeCascade.window.flat().filter(s => s.kind === 'SCATTER').length >= 3

  const EMPTY_WIN_SET = new Set<string>()

  const winningPositions = useMemo(() => {
    const set = new Set<string>()

    if (!isScatterHighlight) {
      activeCascade?.lineWins?.forEach(lw => {
        lw.positions.forEach(p => set.add(`${p.reel}-${p.row}`))
      })
    }

    if (isScatterHighlight && activeCascade?.window) {
      activeCascade.window.forEach((col, r) => {
        col.forEach((s, row) => {
          if (s.kind === 'SCATTER') {
            set.add(`${r}-${row}`)
          }
        })
      })
    }

    return set
  }, [activeCascade, isScatterHighlight])

  const hasWin = Boolean(activeCascade?.lineWins?.length) || hasScatterWin

  const pauseColumn = detectScatterPauseColumn(activeCascade?.window)

  const windowForRender =
    hasWin && ['highlight', 'pop'].includes(phase)
      ? isScatterHighlight
        ? activeCascade?.window
        : previousCascade?.window
      : (activeCascade?.window ?? previousCascade?.window)

  const shouldUsePrevious =
    phase === 'highlight' ||
    phase === 'pop' ||
    phase === 'cascadeRefill' ||
    (phase === 'postGoldTransform' && !isScatterOnlyTerminal)

  const adaptedWindow =
    windowForRender &&
    adaptWindow(
      windowForRender,
      phase === 'cascadeRefill' ? activeCascade?.removedPositions : undefined,
      shouldUsePrevious ? previousCascade?.window : undefined,
      phase,
    )
  //
  // useEffect(() => {
  //   if (adaptedWindow) {
  //     logWindowKinds('adaptedWindow', adaptedWindow as EngineSymbol[][])
  //   }
  // }, [adaptedWindow])

  const [isFreeSpinPreview, setIsFreeSpinPreview] = useState(false)

  const isReady = (isIdle && !spinning) || (showFreeSpinIntro && !freezeUI)

  useEffect(() => {
    if (!autoSpin) return
    if (!isReady) return
    if (balance < bet || balance === 0) {
      setAutoSpin(false)
      setTurboStage(0)
      return
    }

    const t = setTimeout(() => {
      spin()
    }, 300)

    return () => clearTimeout(t)
  }, [autoSpin, isReady, balance, bet, spin])

  useEffect(() => {
    if (!isFreeGame) return
    if (!isIdle) return
    if (freeSpinsLeft <= -1) return

    const t = setTimeout(() => {
      consumeFreeSpin()
      if (freeSpinsLeft > 0) {
        spin()
      }
    }, 300)

    return () => clearTimeout(t)
  }, [isFreeGame, isIdle, freeSpinsLeft, spin])

  useEffect(() => {
    if (phase !== 'highlight') return
    if (!activeCascade?.win) return

    commitWin(activeCascade.win)

    if (isFreeGame) {
      setFreeSpinTotal(v => v + activeCascade.win)
    } else {
      setBalance(v => v + activeCascade.win)
    }
  }, [phase])

  const BASE_MULTIPLIERS = [1, 2, 3, 5]
  const FREE_MULTIPLIERS = [2, 4, 6, 10]

  const ladder = isFreeGame || isFreeSpinPreview ? FREE_MULTIPLIERS : BASE_MULTIPLIERS

  function getMultiplierIndex(cascadeIndex: number) {
    if (cascadeIndex < 2) return 0
    return Math.min(cascadeIndex - 1, ladder.length - 1)
  }

  const activeMultiplierIndex = getMultiplierIndex(cascadeIndex)
  const [introShown, setIntroShown] = useState(false)

  function computeScatterDelay(pauseColumn: number | null) {
    if (pauseColumn == null) return 900

    const cardsPerColumn = activeCascade?.window?.[0]?.length ?? 4

    const BUFFER_MS = 200

    const pausedColumns = TOTAL_REELS - pauseColumn - 1
    const columnDuration = cardsPerColumn * PAUSED_INITIAL_ROW_DROP_DELAY

    return INITIAL_REFILL_PAUSE_MS + pausedColumns * columnDuration + BUFFER_MS
  }

  useEffect(() => {
    if (pauseColumn) {
      setTurboStage(0)
      setAutoSpin(false)
    }

    if (pendingFreeSpins <= 0 && freeSpinsLeft <= 0) return
    if (introShown) return
    if (isFreeGame) return
    if (!isScatterHighlight) return
    const show = onShowFreeSpinIntro(300)
    return () => clearTimeout(show)
  }, [
    pendingFreeSpins,
    scatterTriggerType,
    introShown,
    activeCascade,
    isFreeGame,
    freeSpinsLeft,
    pauseColumn,
  ])

  const onShowFreeSpinIntro = (delayMs: number) => {
    return setTimeout(() => {
      setAutoSpin(false)
      setIntroShown(true)
      setShowFreeSpinIntro(true)

      const hide = setTimeout(() => {
        setIsFreeSpinPreview(true)
        setShowFreeSpinIntro(false)
      }, 10_000)

      return () => clearTimeout(hide)
    }, delayMs)
  }

  useEffect(() => {
    if (phase === 'idle') {
      setIntroShown(false)
      setIsFreeSpinPreview(false)
    }
  }, [phase])

  function getBetIncrement(bet: number): number {
    if (bet < 10) return 1
    if (bet < 50) return 10
    if (bet >= 50 && bet < 100) return 50
    if (bet < 500 && bet >= 100) return 100
    if (bet >= 500) return 500
    return 500
  }

  function getBetDecrement(bet: number): number {
    if (bet <= 10) return 1
    if (bet <= 100) return 10
    if (bet <= 50 && bet > 100) return 50
    if (bet <= 500) return 100
    return 500
  }

  const addBet = () => {
    setBet(prev => {
      const normalized = Number.isInteger(prev) ? prev : Math.floor(prev)

      const dec = getBetDecrement(normalized)
      const next = normalized - dec

      return Math.max(1, next)
    })
  }

  const minusBet = () => {
    setBet(prev => {
      const next = prev + getBetIncrement(prev)
      return Math.min(next, balance)
    })
  }

  const addBalance = () => {
    setBalance(b => b + 5000)
  }

  const minusBalance = () => {
    setBalance(b => b - 5000)
  }

  useEffect(() => {
    window.__ARCADE_INPUT__ = (action: string) => {
      if (!isReady) return

      switch (action) {
        case 'SPIN':
          if (
            isReady &&
            !spinning &&
            !autoSpin &&
            !isFreeGame &&
            !showFreeSpinIntro &&
            !showScatterWinBanner &&
            freeSpinsLeft <= 0
          ) {
            spin()
          }

          break
        case 'BET_UP':
          if (
            isReady &&
            !spinning &&
            !autoSpin &&
            !isFreeGame &&
            !showFreeSpinIntro &&
            !showScatterWinBanner &&
            freeSpinsLeft <= 0
          ) {
            addBet()
          }
          break
        case 'BET_DOWN':
          if (
            isReady &&
            !spinning &&
            !autoSpin &&
            !isFreeGame &&
            !showFreeSpinIntro &&
            !showScatterWinBanner &&
            freeSpinsLeft <= 0
          ) {
            minusBet()
          }
          break
        case 'AUTO':
          if (!isFreeGame && balance > 0 && balance >= bet && pauseColumn === null) {
            setAutoSpin(!autoSpin)
          }
          break
        case 'COIN':
          addBalance()
          break
        case 'WITHDRAW':
          if (
            isReady &&
            !spinning &&
            !autoSpin &&
            !isFreeGame &&
            !showFreeSpinIntro &&
            !showScatterWinBanner &&
            freeSpinsLeft <= 0
          ) {
            minusBalance()
          }
          break
        case 'TURBO':
          if (balance > 0 && balance >= bet && pauseColumn === null) {
            setTurboStage(prev => {
              const next = ((prev + 1) % 4) as 0 | 1 | 2 | 3
              if (next === 0) setAutoSpin(false)
              return next
            })
          }
          break
      }
    }

    return () => {
      delete window.__ARCADE_INPUT__
    }
  }, [])

  return (
    <div className="viewport">
      <div className="game-root">
        <div className="game-frame">
          <div className="frame-bg">
            <div className={`bg-inner ${isFreeGame || isFreeSpinPreview ? 'free-spin' : ''}`}>
              <div className="frame-inner-shadow" />
            </div>
            <div className="bg-frame" />
          </div>

          <div className="game-content">
            <div className={`banner-layer intro ${showFreeSpinIntro ? 'visible' : ''}`}>
              <FreeSpinIntro spins={pendingFreeSpins || 0} />
            </div>

            <div className={`banner-layer win ${showScatterWinBanner ? 'visible' : ''}`}>
              <ScatterWinBanner amount={showScatterWinBanner ? freeSpinTotal : 0} />
            </div>

            <div className="top-container">
              {DEV && <DebugHud info={debugInfo} />}

              <button
                className="buy-spin-btn"
                disabled={
                  !isReady ||
                  pauseColumn !== null ||
                  balance === 0 ||
                  balance < bet * 50 ||
                  isFreeGame ||
                  freeSpinsLeft > 0
                }
                onClick={buyFreeSpins}
              />

              <div className="free-spin-banner">
                <div
                  className={`free-spin-text font-plasma ${
                    !(isFreeGame || isFreeSpinPreview) || freeSpinsLeft < 0 ? 'base' : ''
                  }`}
                >
                  <span className="free-spin-base superace-base">
                    {(isFreeGame || isFreeSpinPreview) && freeSpinsLeft >= 0
                      ? 'FREE SPINS'
                      : 'UltraAce'}{' '}
                  </span>

                  <span className="free-spin-face superace-face">
                    {(isFreeGame || isFreeSpinPreview) && freeSpinsLeft >= 0
                      ? 'FREE SPINS'
                      : 'UltraAce'}{' '}
                  </span>
                </div>

                <span className="free-spin-count">
                  {(isFreeGame || isFreeSpinPreview) &&
                    freeSpinsLeft >= 0 &&
                    (isFreeGame ? freeSpinsLeft : pendingFreeSpins)}
                </span>
              </div>

              <div
                className={`multiplier-strip ${(isFreeGame || isFreeSpinPreview) && freeSpinsLeft >= 0 ? 'free' : ''}`}
              >
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
                active={
                  phase === 'highlight' &&
                  Boolean(activeCascade?.lineWins?.length) &&
                  !isScatterHighlight
                }
              />

              <div className="reels-stage">
                <div className="gpu-prewarm" />{' '}
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
                      initialRefillColumn={initialRefillColumn}
                      activePausedColumn={activePausedColumn}
                      turboMultiplier={turboMultiplier}
                      isScatterHighlight={isScatterHighlight}
                    />
                  ))}
                <div className="reels-clip">
                  <div className="reels-row">
                    {placeholderWindow.map((col, i) => (
                      <Reel
                        key={`ph-${i}`}
                        symbols={col}
                        reelIndex={i}
                        winningPositions={EMPTY_WIN_SET}
                        phase={spinId > 0 ? 'reelSweepOut' : 'idle'}
                        layer={spinId > 0 ? 'old' : 'new'}
                        initialRefillColumn={initialRefillColumn}
                        activePausedColumn={activePausedColumn}
                        turboMultiplier={turboMultiplier}
                        isScatterHighlight={isScatterHighlight}
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
                          initialRefillColumn={initialRefillColumn}
                          activePausedColumn={activePausedColumn}
                          turboMultiplier={turboMultiplier}
                          isScatterHighlight={isScatterHighlight}
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
                  WIN:{' '}
                  <span className="win-amount">
                    {formatPeso(isFreeGame || freeSpinsLeft > 0 ? freeSpinTotal : totalWin)}
                  </span>
                </div>
                <div className="bottom-controls">
                  <div className="controls-left">
                    <div className="bet-control">
                      <button
                        disabled={
                          !isReady ||
                          pauseColumn !== null ||
                          isFreeGame ||
                          freeSpinsLeft > 0 ||
                          pendingFreeSpins > 0
                        }
                        onClick={addBet}
                        className="bet-btn minus"
                      />
                      <span className="bet-amount">
                        {formatPeso(bet ?? 0, true, true, 2, true)}
                      </span>
                      <button
                        disabled={
                          !isReady ||
                          pauseColumn !== null ||
                          isFreeGame ||
                          freeSpinsLeft > 0 ||
                          pendingFreeSpins > 0
                        }
                        onClick={minusBet}
                        className="bet-btn plus"
                      />
                    </div>
                  </div>

                  <div className="controls-center">
                    <button
                      className={`spin-btn spin ${isReady || (!autoSpin && !showFreeSpinIntro && !isFreeGame) ? 'spin-image active' : 'stop-image'}`}
                      disabled={
                        !isReady ||
                        balance === 0 ||
                        balance < bet ||
                        (isFreeGame &&
                          freeSpinsLeft < 10 &&
                          !showFreeSpinIntro &&
                          !showScatterWinBanner)
                      }
                      onClick={spin}
                      aria-label="Spin"
                    />
                  </div>

                  <div className="controls-right">
                    <button
                      className={`spin-btn auto spin-auto-image ${autoSpin ? 'active' : ''}`}
                      disabled={
                        isFreeGame || balance === 0 || balance < bet || pauseColumn !== null
                      }
                      onClick={() => setAutoSpin(!autoSpin)}
                    />

                    <button
                      className={`spin-btn turbo spin-turbo-image ${turboMultiplier > 1 ? 'active' : ''} ${turboStage === 1 ? 'turbo-1' : ''} ${turboStage === 2 ? 'turbo-2' : ''}  ${turboStage === 3 ? 'turbo-3' : ''}`}
                      disabled={balance === 0 || balance < bet || pauseColumn !== null}
                      onClick={() => {
                        setTurboStage(prev => {
                          const next = ((prev + 1) % 4) as 0 | 1 | 2 | 3
                          if (next === 0) setAutoSpin(false)
                          return next
                        })
                      }}
                    />

                    <button className={`spin-btn settings`} />
                  </div>
                </div>
                <div className="bottom-info">
                  <div className="bottom-info-left">
                    <button
                      className={`spin-btn audio ${audioOn ? 'active' : ''}`}
                      onClick={() => setAudioOn(v => !v)}
                    >
                      {audioOn ? '🔊' : '🔇'}
                    </button>
                  </div>

                  <div className="balance-display">
                    Balance <span className="balance-amount">{formatPeso(balance ?? 0)}</span>
                    <button className="add-btn" onClick={addBalance}>
                      +{formatPeso(5000, true, true, 2)}
                    </button>
                  </div>

                  <div className="bottom-info-right" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
