import { useEngine } from './hooks/useEngine'
import { Reel } from './ui/Reel'
import { DimOverlay } from './ui/DimOverlay'
import { WinOverlay } from './ui/WinOverlay'
import { adaptWindow } from './game/adaptWindow'
import { detectScatterPauseColumn, useCascadeTimeline } from './hooks/useCascadeTimeline'
import { DebugHud } from './debug/DebugHud'
import { useEffect, useMemo, useRef, useState } from 'react'

import { type CascadeStep, formatPeso } from '@ultra-ace/engine'
import { useBackgroundAudio } from './audio/useBackgroundAudio'
import BGM from './assets/audio/bgm.mp3'
import cardDealSfx from './assets/audio/effects/card_deal.mp3'
import symbolMatchSfx from './assets/audio/effects/symbol_match.wav'
import winBigSfx from './assets/audio/effects/win_big.mp3'
import winSmallSfx from './assets/audio/effects/win_small.mp3'
import doubleVoice from './assets/audio/voice/Double!.mp3'
import fourTimesVoice from './assets/audio/voice/4 times!.mp3'
import fiveTimesVoice from './assets/audio/voice/5 times!.mp3'
import aceVoice from './assets/audio/voice/Ace!.mp3'
import clubVoice from './assets/audio/voice/Club!.mp3'
import diamondVoice from './assets/audio/voice/Diamond!.mp3'
import heartVoice from './assets/audio/voice/Heart!.mp3'
import jackVoice from './assets/audio/voice/Jack!.mp3'
import kingVoice from './assets/audio/voice/King!.mp3'
import queenVoice from './assets/audio/voice/Queen!.mp3'
import spadeVoice from './assets/audio/voice/Spade!.mp3'
import tripleVoice from './assets/audio/voice/Triple!.mp3'

import { FreeSpinIntro } from './ui/FreeSpinIntro'
import { ScatterWinBanner } from './ui/ScatterWinBanner'
import { BuySpinModal } from './ui/BuySpinModal'
import { installAccountingRetryHooks, logLedgerEvent } from './lib/accounting'

import splashStart from './assets/images/splash_start.png'
import WILD_RED from './assets/symbols/WILD_RED.png'

const DEV = import.meta.env.DEV
const GAME_BUILD_VERSION = import.meta.env.VITE_GAME_VERSION || 'dev'
const FREE_SPIN_PRESTART_DELAY_MS = 1500
const BIG_WIN_BET_MULTIPLIER = 10
const BIG_WIN_MIN_AMOUNT = 20

const VOICE_BY_SYMBOL: Record<string, string> = {
  A: aceVoice,
  K: kingVoice,
  Q: queenVoice,
  J: jackVoice,
  SPADE: spadeVoice,
  HEART: heartVoice,
  DIAMOND: diamondVoice,
  CLUB: clubVoice,
}

const VOICE_BY_CARD_COUNT: Record<number, string> = {
  4: doubleVoice,
  5: tripleVoice,
}

const VOICE_BY_MULTIPLIER: Record<number, string> = {
  4: fourTimesVoice,
  5: fiveTimesVoice,
}

type RedWildPropagationPath = {
  id: string
  fromReel: number
  fromRow: number
  toReel: number
  toRow: number
}

const makePlaceholder = (kind: string) => Array.from({ length: 4 }, () => ({ kind }))

function getWinVoiceSequence(cascade: CascadeStep): string[] {
  const clips: string[] = []
  const playedSymbols = new Set<string>()

  for (const lineWin of cascade.lineWins ?? []) {
    const symbolClip = VOICE_BY_SYMBOL[lineWin.symbol]
    if (symbolClip && !playedSymbols.has(lineWin.symbol)) {
      clips.push(symbolClip)
      playedSymbols.add(lineWin.symbol)
    }
  }

  const maxCardCount = (cascade.lineWins ?? []).reduce(
    (max, lineWin) => Math.max(max, Number(lineWin.count ?? 0)),
    0,
  )

  const cardCountClip =
    maxCardCount >= 5 ? VOICE_BY_CARD_COUNT[5] : VOICE_BY_CARD_COUNT[maxCardCount]
  if (cardCountClip) clips.push(cardCountClip)

  const multiplierClip = VOICE_BY_MULTIPLIER[Math.round(Number(cascade.multiplier ?? 1))]
  if (multiplierClip) clips.push(multiplierClip)

  return clips
}

function getSymbolMatchLayerCount(matchCount: number) {
  if (matchCount >= 7) return 5
  if (matchCount >= 4) return 4
  return 3
}

function getWinEffectClip(cascadeWin: number, betAmount: number): string {
  const bigWinThreshold = Math.max(BIG_WIN_MIN_AMOUNT, betAmount * BIG_WIN_BET_MULTIPLIER)
  return cascadeWin >= bigWinThreshold ? winBigSfx : winSmallSfx
}

function getWinOverlayTitle(amount: number, betAmount: number): string {
  const ratio = betAmount > 0 ? amount / betAmount : 0

  if (ratio >= 40) return 'SUPER\nMEGA'
  if (ratio >= 30) return 'SUPER\nWIN'
  if (ratio >= 20) return 'MEGA\nWIN'
  if (ratio >= 10) return 'BIG\nWIN'
  return ''
}

//
// function logWindowKinds(label: string, window: EngineSymbol[][]) {
//   if (!window?.length) return
//
//   const reels = window.length
//   const rows = window[0].length
//
//   console.group(`[BOARD] ${label}`)
//
//   // Print top row first (visual match)
//   for (let row = rows - 1; row >= 0; row--) {
//     const line = []
//     for (let reel = 0; reel < reels; reel++) {
//       const k = window[reel][row]?.kind ?? '???'
//       line.push(k.padEnd(9, ' '))
//     }
//     console.log(line.join(' | '))
//   }
//
//   console.groupEnd()
// }
//
// const EMPTY_SYMBOL: EngineSymbol = {
//   kind: 'EMPTY',
//   isGold: false,
//   goldTTL: undefined,
//   isDecorativeGold: false,
//   wildColor: undefined,
// }

export default function App() {
  const gameStateRef = useRef({
    isReady: true,
    canExitViaMenu: false,
    bootSplashStage: 'start' as 'start' | null,
    spinning: false,
    autoSpin: false,
    isFreeGame: false,
    showFreeSpinIntro: false,
    showScatterWinBanner: false,
    freeSpinsLeft: 0,
    pauseColumn: null as number | null,
    balance: 0,
    bet: 0,
    buySpinBet: 0,
    withdrawAmount: 0,
    isWithdrawing: false,
    showBuySpinModal: false,
    showWithdrawModal: false,
    audioOn: false,
  })

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
  const [internetOnline, setInternetOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  )

  useEffect(() => {
    const scale = Math.min(window.innerWidth / 430, window.innerHeight / 900)

    const el = document.querySelector('.game-scale') as HTMLElement
    if (el) el.style.transform = `scale(${scale})`
  }, [])

  useEffect(() => {
    installAccountingRetryHooks()
  }, [])

  useEffect(() => {
    localStorage.setItem('audioOn', String(audioOn))
  }, [audioOn])

  useEffect(() => {
    const syncOnlineState = () => {
      const nextOnline = typeof navigator !== 'undefined' ? navigator.onLine : true
      setInternetOnline(nextOnline)
    }

    window.addEventListener('online', syncOnlineState)
    window.addEventListener('offline', syncOnlineState)
    syncOnlineState()

    return () => {
      window.removeEventListener('online', syncOnlineState)
      window.removeEventListener('offline', syncOnlineState)
    }
  }, [])

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
    bet,
    setBet,
    freeSpinTotal,
    showFreeSpinIntro,
    setShowFreeSpinIntro,
    pendingFreeSpins,
    buyFreeSpins,
    scatterTriggerType,
    runtimeMode,
    startFreeSpins,
    settleSpinVisuals,
    showScatterWinBanner,
    freezeUI,
    sessionReady,
    deviceId,

    buySpinBet,
    setBuySpinBet,
    withdrawAmount,
    setWithdrawAmount,

    isWithdrawing,
    setIsWithdrawing,

    showWithdrawModal,
    setShowWithdrawModal,
  } = useEngine()

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
    if (!internetOnline) {
      return
    }
    setBet(prev => {
      const normalized = Number.isInteger(prev) ? prev : Math.floor(prev)

      const dec = getBetDecrement(normalized)
      const next = normalized - dec

      return Math.max(1, next)
    })
  }

  const minusBet = () => {
    if (!internetOnline) {
      return
    }
    setBet(prev => {
      const next = prev + getBetIncrement(prev)
      return Math.min(next, balance)
    })
  }

  const addBuySpinBet = () => {
    if (!internetOnline) {
      return
    }
    setBuySpinBet(prev => {
      const inc = getBetIncrement(prev)
      return Math.min(prev + inc, balance)
    })
  }

  const minusBuySpinBet = () => {
    if (!internetOnline) {
      return
    }
    setBuySpinBet(prev => {
      const dec = getBetDecrement(prev)
      return Math.max(1, prev - dec)
    })
  }

  const WITHDRAW_STEP = 20
  const WITHDRAW_MIN = 20
  const getMaxWithdrawSelectable = (balanceValue: number) =>
    Math.floor(balanceValue / WITHDRAW_STEP) * WITHDRAW_STEP

  const addWithdrawAmount = () => {
    if (!internetOnline) {
      return
    }
    const max = getMaxWithdrawSelectable(balance)
    if (max < WITHDRAW_MIN) return
    setWithdrawAmount(prev => {
      return Math.min(prev + WITHDRAW_STEP, max)
    })
  }

  const minusWithdrawAmount = () => {
    if (!internetOnline) {
      return
    }
    const max = getMaxWithdrawSelectable(balance)
    if (max < WITHDRAW_MIN) return
    setWithdrawAmount(prev => {
      return Math.max(WITHDRAW_MIN, prev - WITHDRAW_STEP)
    })
  }

  useEffect(() => {
    if (!showWithdrawModal) return
    const max = getMaxWithdrawSelectable(balance)
    if (max < WITHDRAW_MIN) return
    setWithdrawAmount(prev => {
      const normalized = Math.floor(prev / WITHDRAW_STEP) * WITHDRAW_STEP
      const withMin = Math.max(WITHDRAW_MIN, normalized)
      return Math.min(withMin, max)
    })
  }, [showWithdrawModal, balance, setWithdrawAmount])

  const addBalance = (source = 'coin', amount = 5) => {
    if (!internetOnline) {
      return
    }
    if (!deviceId) return

    logLedgerEvent({
      deviceId,
      type: 'deposit',
      amount,
      source,
    })
      .then(() => {})
      .catch(e => {
        console.log('LEDGER EVENT', e)
      })
  }

  const minusBalance = (source = 'hopper', amount = 20) => {
    if (!internetOnline) {
      return
    }
    if (!deviceId) return

    if (source === 'hopper') {
      return
    }

    logLedgerEvent({
      deviceId,
      type: 'withdrawal',
      amount,
      source,
    })
      .then(() => {})
      .catch(e => {
        console.log('LEDGER EVENT', e)
      })
  }

  const [showBuySpinModal, setShowBuySpinModal] = useState(false)
  const [hasPressedStart, setHasPressedStart] = useState(false)
  const [introCountdown, setIntroCountdown] = useState(10)

  const withdrawRequestedAmountRef = useRef(0)
  const lastLoggedWinKeyRef = useRef<string>('')
  const lastPlayedWinAudioKeyRef = useRef<string>('')
  const lastPlayedPopAudioKeyRef = useRef<string>('')
  const lastPlayedDealAudioKeyRef = useRef<string>('')
  const pendingIntroStartRef = useRef(false)
  const activeForegroundAudioRef = useRef<HTMLAudioElement | null>(null)
  const activeForegroundAudioFinalizeRef = useRef<(() => void) | null>(null)
  const activeOneShotAudioRef = useRef(new Set<HTMLAudioElement>())
  const activeOneShotAudioGroupsRef = useRef(new Map<string, Set<HTMLAudioElement>>())
  const activeOneShotTimersRef = useRef(new Map<string, number[]>())
  const audioSequenceTokenRef = useRef(0)

  const spinRef = useRef(spin)
  const setAutoSpinRef = useRef(setAutoSpin)
  const addBetRef = useRef(addBet)
  const minusBetRef = useRef(minusBet)
  const addWithdrawAmountRef = useRef(addWithdrawAmount)
  const minusWithdrawAmountRef = useRef(minusWithdrawAmount)
  const setTurboStageRef = useRef(setTurboStage)

  const setShowFreeSpinIntroRef = useRef(setShowFreeSpinIntro)

  const setShowWithdrawModalRef = useRef(setShowWithdrawModal)
  const setIsWithdrawingRef = useRef(setIsWithdrawing)

  const setShowBuySpinModalRef = useRef(setShowBuySpinModal)
  const addBuySpinBetRef = useRef(addBuySpinBet)
  const minusBuySpinBetRef = useRef(minusBuySpinBet)
  const buyFreeSpinsRef = useRef(buyFreeSpins)
  const startFreeSpinsRef = useRef(startFreeSpins)
  const addBalanceRef = useRef(addBalance)
  const minusBalanceRef = useRef(minusBalance)
  const setHasPressedStartRef = useRef(setHasPressedStart)

  const setAudioOnRef = useRef(setAudioOn)

  function stopForegroundAudio() {
    audioSequenceTokenRef.current += 1

    const activeAudio = activeForegroundAudioRef.current
    const finalize = activeForegroundAudioFinalizeRef.current

    activeForegroundAudioRef.current = null
    activeForegroundAudioFinalizeRef.current = null
    if (!activeAudio) {
      finalize?.()
      return
    }

    activeAudio.pause()
    activeAudio.currentTime = 0
    finalize?.()
  }

  function stopOneShotAudio(group?: string) {
    if (group) {
      const timers = activeOneShotTimersRef.current.get(group)
      timers?.forEach(window.clearTimeout)
      activeOneShotTimersRef.current.delete(group)

      const groupAudios = activeOneShotAudioGroupsRef.current.get(group)
      if (!groupAudios) return
      activeOneShotAudioGroupsRef.current.delete(group)
      groupAudios.forEach(audio => {
        activeOneShotAudioRef.current.delete(audio)
        audio.pause()
        audio.currentTime = 0
      })
      return
    }

    activeOneShotTimersRef.current.forEach(timers => timers.forEach(window.clearTimeout))
    activeOneShotTimersRef.current.clear()
    activeOneShotAudioGroupsRef.current.clear()

    activeOneShotAudioRef.current.forEach(audio => {
      audio.pause()
      audio.currentTime = 0
    })
    activeOneShotAudioRef.current.clear()
  }

  async function playAudioSequence(clips: string[]) {
    const token = ++audioSequenceTokenRef.current

    for (const clip of clips) {
      if (!gameStateRef.current.audioOn) return
      if (token !== audioSequenceTokenRef.current) return

      await new Promise<void>(resolve => {
        const audio = new Audio(clip)
        activeForegroundAudioRef.current = audio

        const finalize = () => {
          if (activeForegroundAudioRef.current === audio) {
            activeForegroundAudioRef.current = null
          }
          audio.onended = null
          audio.onerror = null
          activeForegroundAudioFinalizeRef.current = null
          resolve()
        }

        activeForegroundAudioFinalizeRef.current = finalize
        audio.onended = finalize
        audio.onerror = finalize
        audio.play().catch(finalize)
      })
    }
  }

  function playOneShotAudio(clip: string, options?: { group?: string; playbackRate?: number }) {
    if (!gameStateRef.current.audioOn) return

    const group = options?.group
    const audio = new Audio(clip)
    audio.playbackRate = options?.playbackRate ?? 1
    audio.preservesPitch = false

    const finalize = () => {
      audio.onended = null
      audio.onerror = null
      activeOneShotAudioRef.current.delete(audio)
      if (group) {
        const groupAudios = activeOneShotAudioGroupsRef.current.get(group)
        groupAudios?.delete(audio)
        if (groupAudios && groupAudios.size === 0) {
          activeOneShotAudioGroupsRef.current.delete(group)
        }
      }
    }

    activeOneShotAudioRef.current.add(audio)
    if (group) {
      const groupAudios =
        activeOneShotAudioGroupsRef.current.get(group) ?? new Set<HTMLAudioElement>()
      groupAudios.add(audio)
      activeOneShotAudioGroupsRef.current.set(group, groupAudios)
    }

    audio.onended = finalize
    audio.onerror = finalize
    audio.play().catch(finalize)
  }

  function playLayeredOneShotAudio(
    clip: string,
    options: { group: string; layers: number; staggerMs: number; volume: number },
  ) {
    if (!gameStateRef.current.audioOn) return

    const { group, layers, staggerMs, volume } = options
    const timers: number[] = []
    activeOneShotTimersRef.current.set(group, timers)

    for (let index = 0; index < layers; index++) {
      const timer = window.setTimeout(() => {
        if (!gameStateRef.current.audioOn) return
        if (!activeOneShotTimersRef.current.has(group)) return

        const audio = new Audio(clip)
        audio.volume = volume

        const finalize = () => {
          audio.onended = null
          audio.onerror = null
          activeOneShotAudioRef.current.delete(audio)
          const groupAudios = activeOneShotAudioGroupsRef.current.get(group)
          groupAudios?.delete(audio)
          if (groupAudios && groupAudios.size === 0) {
            activeOneShotAudioGroupsRef.current.delete(group)
          }
        }

        activeOneShotAudioRef.current.add(audio)
        const groupAudios =
          activeOneShotAudioGroupsRef.current.get(group) ?? new Set<HTMLAudioElement>()
        groupAudios.add(audio)
        activeOneShotAudioGroupsRef.current.set(group, groupAudios)
        audio.onended = finalize
        audio.onerror = finalize
        audio.play().catch(finalize)
      }, index * staggerMs)

      timers.push(timer)
    }
  }

  const {
    phase,
    activeCascade,
    previousCascade,
    cascadeIndex,
    isIdle,
    isScatterHighlight,
    initialRefillColumn,
    activePausedColumn,
    spinCompleted,
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
  ] as never)

  const hasScatterWin =
    activeCascade &&
    activeCascade.window &&
    activeCascade.window.flat().filter(s => s.kind === 'SCATTER').length >= 3

  const isScatterOnlyTerminal =
    Boolean(activeCascade) &&
    activeCascade.lineWins.length === 0 &&
    activeCascade.window.flat().filter(s => s.kind === 'SCATTER').length >= 3

  useEffect(() => {
    if (showBuySpinModal) {
      setBuySpinBet(bet)
    }
  }, [showBuySpinModal, bet])

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

  const pauseColumn = !isIdle ? detectScatterPauseColumn(activeCascade?.window) : null

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

  const redWildPropagationPaths = useMemo<RedWildPropagationPath[]>(() => {
    if (phase !== 'postGoldTransform' || !activeCascade?.window || !previousCascade?.window)
      return []

    const sources: Array<{ reel: number; row: number }> = []
    const targets: Array<{ reel: number; row: number }> = []

    for (let reel = 0; reel < activeCascade.window.length; reel++) {
      for (let row = 0; row < activeCascade.window[reel].length; row++) {
        const next = activeCascade.window[reel][row]
        const prev = previousCascade.window[reel]?.[row]

        if (!next || !prev) continue

        const wasGold =
          prev.isGold === true || prev.goldTTL !== undefined || prev.isDecorativeGold === true

        if (next.kind === 'WILD' && next.wildColor === 'red' && next.fromGold && wasGold) {
          sources.push({ reel, row })
          continue
        }

        if (
          next.kind === 'WILD' &&
          next.wildColor === 'red' &&
          !next.fromGold &&
          !(prev.kind === 'WILD' && prev.wildColor === 'red')
        ) {
          targets.push({ reel, row })
        }
      }
    }

    if (!sources.length || !targets.length) return []

    return targets.map((target, index) => {
      const source = sources.reduce(
        (best, current) => {
          const bestDistance = Math.abs(best.reel - target.reel) + Math.abs(best.row - target.row)
          const currentDistance =
            Math.abs(current.reel - target.reel) + Math.abs(current.row - target.row)
          return currentDistance < bestDistance ? current : best
        },
        sources[index % sources.length],
      )

      return {
        id: `${source.reel}-${source.row}-${target.reel}-${target.row}`,
        fromReel: source.reel,
        fromRow: source.row,
        toReel: target.reel,
        toRow: target.row,
      }
    })
  }, [phase, activeCascade, previousCascade])
  //
  // useEffect(() => {
  //   if (adaptedWindow) {
  //     logWindowKinds('adaptedWindow', adaptedWindow as EngineSymbol[][])
  //   }
  // }, [adaptedWindow])

  const [isFreeSpinPreview, setIsFreeSpinPreview] = useState(false)
  const [heldWindowForIntro, setHeldWindowForIntro] = useState<NonNullable<
    typeof adaptedWindow
  > | null>(null)

  useEffect(() => {
    if (!adaptedWindow) return
    if (phase === 'reelSweepOut') return
    setHeldWindowForIntro(adaptedWindow)
  }, [adaptedWindow, phase])

  const renderedWindow = adaptedWindow ?? heldWindowForIntro
  const allowBootSplashClick = DEV && deviceId?.startsWith('dev-')
  const bootSplashStage: 'start' | null = sessionReady && !hasPressedStart ? 'start' : null

  const isReady =
    bootSplashStage === null && ((isIdle && !spinning) || (showFreeSpinIntro && !freezeUI))
  const canExitViaMenu =
    bootSplashStage !== null ||
    (isReady &&
      !spinning &&
      !autoSpin &&
      !freezeUI &&
      !showFreeSpinIntro &&
      !showScatterWinBanner &&
      !isFreeGame &&
      !isFreeSpinPreview &&
      pendingFreeSpins <= 0 &&
      freeSpinsLeft <= 0 &&
      pauseColumn === null &&
      !showWithdrawModal &&
      !showBuySpinModal)

  const canOpenShellWithdraw =
    internetOnline &&
    isReady &&
    !spinning &&
    !autoSpin &&
    !isFreeGame &&
    !showFreeSpinIntro &&
    !showScatterWinBanner &&
    freeSpinsLeft <= 0 &&
    pauseColumn === null &&
    !showBuySpinModal &&
    !isWithdrawing &&
    getMaxWithdrawSelectable(balance) >= WITHDRAW_MIN

  useEffect(() => {
    if (!internetOnline) return
    if (!isIdle) return
    if (!autoSpin && !isFreeGame) return
    if (showFreeSpinIntro || isFreeSpinPreview || showScatterWinBanner || showBuySpinModal) return
    if (pauseColumn !== null && !isFreeGame && pendingFreeSpins > 0) return

    if (!isFreeGame && balance < bet) {
      setAutoSpin(false)
      setTurboStage(0)
      return
    }

    const t = setTimeout(() => {
      spin()
    }, 300)

    return () => clearTimeout(t)
  }, [
    internetOnline,
    isIdle,
    autoSpin,
    isFreeGame,
    pendingFreeSpins,
    balance,
    bet,
    pauseColumn,
    showFreeSpinIntro,
    isFreeSpinPreview,
    showScatterWinBanner,
    showBuySpinModal,
  ])

  useEffect(() => {
    if (phase !== 'highlight') return
    if (!activeCascade?.win) return

    const winKey = `${spinId}:${cascadeIndex}`
    if (lastLoggedWinKeyRef.current === winKey) return
    lastLoggedWinKeyRef.current = winKey

    commitWin(activeCascade.win)
  }, [phase, activeCascade, spinId, cascadeIndex])

  useEffect(() => {
    if (spinId <= 0) return
    stopForegroundAudio()
    stopOneShotAudio()
  }, [spinId])

  useEffect(() => {
    if (audioOn) return
    stopForegroundAudio()
    stopOneShotAudio()
  }, [audioOn])

  useEffect(() => {
    return () => {
      stopForegroundAudio()
      stopOneShotAudio()
    }
  }, [])

  const BASE_MULTIPLIERS = [1, 2, 3, 5]
  const FREE_MULTIPLIERS = [2, 4, 6, 10]

  const ladder = isFreeGame || isFreeSpinPreview ? FREE_MULTIPLIERS : BASE_MULTIPLIERS

  function getDisplayMultiplierIndex(phase: string, cascadeIndex: number) {
    const isIdleLike = phase === 'idle' || phase === 'reelSweepOut' || phase === 'initialRefill'

    if (isIdleLike) return 0

    return Math.min(Math.max(0, cascadeIndex), ladder.length - 1)
  }

  const activeMultiplierIndex = getDisplayMultiplierIndex(phase, cascadeIndex)
  const freeSpinDisplayCount = isFreeGame ? freeSpinsLeft : pendingFreeSpins
  const showFreeSpinModeUi = isFreeGame || isFreeSpinPreview || showScatterWinBanner || freezeUI
  const showFreeSpinCount =
    (isFreeGame || isFreeSpinPreview || pendingFreeSpins > 0) && freeSpinDisplayCount > 0
  const useFreeSpinWinCounter =
    isFreeGame || pauseColumn !== null || pendingFreeSpins > 0 || freeSpinsLeft > 0
  const overlayAmount = Math.max(
    activeCascade?.win ?? 0,
    useFreeSpinWinCounter ? freeSpinTotal : totalWin,
  )
  const overlayTitle = getWinOverlayTitle(overlayAmount, bet)

  useEffect(() => {
    if (phase !== 'highlight') return
    if (!audioOn) return
    if (!activeCascade?.win) return

    const winKey = `${spinId}:${cascadeIndex}`
    if (lastPlayedWinAudioKeyRef.current === winKey) return
    lastPlayedWinAudioKeyRef.current = winKey

    const matchCount = activeCascade.lineWins.reduce(
      (sum, lineWin) => sum + lineWin.positions.length,
      0,
    )
    const matchLayers = getSymbolMatchLayerCount(matchCount)
    const layerVolume = matchLayers >= 5 ? 0.4 : matchLayers === 4 ? 0.46 : 0.52

    playLayeredOneShotAudio(symbolMatchSfx, {
      group: 'highlight',
      layers: matchLayers,
      staggerMs: 22,
      volume: layerVolume,
    })

    const clips = getWinVoiceSequence(activeCascade)
    if (!clips.length) return

    void playAudioSequence(clips)
  }, [phase, audioOn, activeCascade, spinId, cascadeIndex])

  useEffect(() => {
    if (phase !== 'pop') return
    if (!audioOn) return
    if (!activeCascade?.win) return

    const winKey = `${spinId}:${cascadeIndex}`
    if (lastPlayedPopAudioKeyRef.current === winKey) return
    lastPlayedPopAudioKeyRef.current = winKey

    playOneShotAudio(getWinEffectClip(overlayAmount, bet), { group: 'pop' })
  }, [phase, audioOn, activeCascade, spinId, cascadeIndex, overlayAmount, bet])

  useEffect(() => {
    if (phase !== 'initialRefill' && phase !== 'cascadeRefill') return
    if (!audioOn) return
    if (!activeCascade?.window?.length) return

    const dealKey = `${spinId}:${cascadeIndex}:${phase}`
    if (lastPlayedDealAudioKeyRef.current === dealKey) return
    lastPlayedDealAudioKeyRef.current = dealKey

    playOneShotAudio(cardDealSfx, { group: 'deal' })
  }, [phase, audioOn, activeCascade, spinId, cascadeIndex])

  function triggerFreeSpinStart() {
    if (!gameStateRef.current.showFreeSpinIntro) return
    pendingIntroStartRef.current = true
    const started = startFreeSpinsRef.current()
    if (started) {
      // Show initial free-spin state briefly before first spin starts.
      setIsFreeSpinPreview(true)
    } else {
      pendingIntroStartRef.current = false
    }
  }

  useEffect(() => {
    if (!spinCompleted) return
    settleSpinVisuals()
  }, [spinCompleted, settleSpinVisuals])

  useEffect(() => {
    // Normal flow: only show intro after this spin fully completes timeline.
    if (!isFreeGame && spinCompleted && pendingFreeSpins > 0 && !showFreeSpinIntro) {
      setShowFreeSpinIntro(true)
      setIsFreeSpinPreview(false)
      return
    }

    // Resume flow: restored state after refresh with pending free spins.
    if (!isFreeGame && spinId === 0 && !spinning && pendingFreeSpins > 0 && !showFreeSpinIntro) {
      setShowFreeSpinIntro(true)
      setIsFreeSpinPreview(false)
      return
    }

    if (!isFreeGame && pendingFreeSpins <= 0 && !showFreeSpinIntro) {
      setIsFreeSpinPreview(false)
    }
  }, [
    spinCompleted,
    spinId,
    spinning,
    isFreeGame,
    pendingFreeSpins,
    showFreeSpinIntro,
    setShowFreeSpinIntro,
  ])

  useEffect(() => {
    if (!showFreeSpinIntro) return

    const timer = window.setTimeout(() => {
      triggerFreeSpinStart()
    }, 10_000)

    return () => clearTimeout(timer)
  }, [showFreeSpinIntro])

  useEffect(() => {
    if (!showFreeSpinIntro) return
    setIntroCountdown(10)

    const countdownTimer = window.setInterval(() => {
      setIntroCountdown(prev => Math.max(0, prev - 1))
    }, 1000)

    return () => clearInterval(countdownTimer)
  }, [showFreeSpinIntro])

  useEffect(() => {
    if (!pendingIntroStartRef.current) return
    if (showFreeSpinIntro) return
    if (!isFreeGame || !isIdle || spinning || freeSpinsLeft <= 0) return

    const t = window.setTimeout(() => {
      pendingIntroStartRef.current = false
      setIsFreeSpinPreview(false)
      spinRef.current()
    }, FREE_SPIN_PRESTART_DELAY_MS)

    return () => clearTimeout(t)
  }, [showFreeSpinIntro, isFreeGame, isIdle, spinning, freeSpinsLeft])

  useEffect(() => {
    gameStateRef.current = {
      isReady,
      canExitViaMenu,
      bootSplashStage,
      spinning,
      autoSpin,
      isFreeGame,
      showFreeSpinIntro,
      showScatterWinBanner,
      freeSpinsLeft,
      pauseColumn,
      balance,
      bet,
      buySpinBet,
      showBuySpinModal,
      isWithdrawing,
      withdrawAmount,
      showWithdrawModal,
      audioOn,
    }
  }, [
    isReady,
    canExitViaMenu,
    bootSplashStage,
    spinning,
    autoSpin,
    isFreeGame,
    showFreeSpinIntro,
    showScatterWinBanner,
    freeSpinsLeft,
    pauseColumn,
    balance,
    bet,
    buySpinBet,
    showBuySpinModal,
    isWithdrawing,
    withdrawAmount,
    showWithdrawModal,
    audioOn,
  ])

  useEffect(() => {
    if (window.parent === window) return
    window.parent.postMessage(
      {
        type: 'ULTRAACE_MENU_EXIT_STATE',
        canExit: canExitViaMenu,
      },
      '*',
    )
  }, [canExitViaMenu])

  const requestParentExitConfirm = () => {
    if (window.parent === window) return
    window.parent.postMessage({ type: 'ULTRAACE_REQUEST_EXIT_CONFIRM' }, '*')
  }

  useEffect(() => {
    if (window.parent === window) return
    window.parent.postMessage(
      {
        type: 'ULTRAACE_WITHDRAW_STATE',
        canOpen: canOpenShellWithdraw,
        balance,
        isWithdrawing,
        min: WITHDRAW_MIN,
        step: WITHDRAW_STEP,
      },
      '*',
    )
  }, [balance, canOpenShellWithdraw, isWithdrawing])

  const requestShellWithdrawOpen = () => {
    if (window.parent === window) return
    window.parent.postMessage({ type: 'ULTRAACE_WITHDRAW_REQUEST' }, '*')
  }

  useEffect(() => {
    spinRef.current = spin
  }, [spin])

  useEffect(() => {
    setAutoSpinRef.current = setAutoSpin
    addBetRef.current = addBet
    minusBetRef.current = minusBet
    setTurboStageRef.current = setTurboStage
    setAudioOnRef.current = setAudioOn
    setShowFreeSpinIntroRef.current = setShowFreeSpinIntro
    setShowWithdrawModalRef.current = setShowWithdrawModal
    setIsWithdrawingRef.current = setIsWithdrawing
    addWithdrawAmountRef.current = addWithdrawAmount
    minusWithdrawAmountRef.current = minusWithdrawAmount
    setShowBuySpinModalRef.current = setShowBuySpinModal
    addBuySpinBetRef.current = addBuySpinBet
    minusBuySpinBetRef.current = minusBuySpinBet
    buyFreeSpinsRef.current = buyFreeSpins
    startFreeSpinsRef.current = startFreeSpins
    addBalanceRef.current = addBalance
    minusBalanceRef.current = minusBalance
    setHasPressedStartRef.current = setHasPressedStart
  })

  useEffect(() => {
    window.__ARCADE_INPUT__ = payload => {
      console.log('[ARCADE]', payload)

      if (payload?.type === 'INTERNET_LOST') {
        console.log('[ULTRAACE] INTERNET_LOST')

        setInternetOnline(false)
        return
      }

      if (payload?.type === 'INTERNET_RESTORED' || payload?.type === 'INTERNET_OK') {
        console.log('[ULTRAACE] INTERNET_RESTORED')

        setInternetOnline(true)
        return
      }

      // --- COIN ---
      if (payload.type === 'COIN') {
        addBalanceRef.current('coin', payload.credits)
        return
      }

      if (!internetOnline) {
        const isMenu =
          (payload.type === 'ACTION' && payload.action === 'MENU') ||
          (payload.type === 'PLAYER' &&
            (payload.button === 9 || String(payload.button).toUpperCase() === 'START'))

        if (!isMenu) {
          return
        }
      }

      // --- WITHDRAW COMPLETE ---
      if (payload.type === 'WITHDRAW_DISPENSE') {
        minusBalanceRef.current('hopper', payload.dispensed)

        return
      }

      if (payload.type === 'HOPPER_COIN') {
        const amount = Number(payload.amount ?? 20)
        if (deviceId) {
          logLedgerEvent({
            deviceId,
            type: 'hopper_in',
            amount,
            source: 'hopper',
          }).catch(e => {
            console.log('LEDGER EVENT', e)
          })
        }
        return
      }

      if (payload.type === 'WITHDRAW_COMPLETE') {
        setIsWithdrawingRef.current(false)
        setShowWithdrawModalRef.current(false)
        setWithdrawAmount(withdrawRequestedAmountRef.current || 20)
        withdrawRequestedAmountRef.current = 0

        return
      }

      const isTurboPlayerEvent =
        payload.type === 'PLAYER' && payload.player === 'CASINO' && Number(payload.button) === 7
      const isP1StartPlayerEvent =
        payload.type === 'PLAYER' &&
        payload.player === 'P1' &&
        (Number(payload.button) === 9 || String(payload.button).toUpperCase() === 'START')

      if (payload.type !== 'ACTION' && !isTurboPlayerEvent && !isP1StartPlayerEvent) return

      const action = isTurboPlayerEvent ? 'TURBO' : payload.action

      const s = gameStateRef.current
      if (s.bootSplashStage === 'start') {
        if (action === 'MENU') {
          requestParentExitConfirm()
          return
        } else if (isP1StartPlayerEvent) {
          setHasPressedStartRef.current(true)
          return
        } else if (action === 'SPIN' && (payload.player === undefined || payload.player === 'P1')) {
          // keep compatibility with services that emit ACTION/SPIN for P1 START
          setHasPressedStartRef.current(true)
          return
        } else {
          return
        }
      }

      switch (action) {
        case 'SPIN': {
          if (!internetOnline) return
          if (s.showFreeSpinIntro) {
            triggerFreeSpinStart()
            return
          }

          if (
            s.isReady &&
            !s.spinning &&
            !s.autoSpin &&
            !s.showFreeSpinIntro &&
            !s.showScatterWinBanner &&
            (s.isFreeGame || s.balance >= s.bet) &&
            !s.showWithdrawModal &&
            !s.showBuySpinModal
          ) {
            // if (s.showWithdrawModal) {
            //   setShowWithdrawModalRef.current(false)
            //   return
            // }
            //
            // if (s.showBuySpinModal) {
            //   setShowBuySpinModalRef.current(false)
            //   return
            // }
            //
            // if (s.showFreeSpinIntro) {
            //   setShowFreeSpinIntroRef.current(false)
            //   return
            // }

            spinRef.current()
          }
          break
        }

        case 'MENU': {
          if (!internetOnline) {
            requestParentExitConfirm()
            return
          }
          if (s.showWithdrawModal) {
            setShowWithdrawModalRef.current(false)
            return
          }

          if (s.showBuySpinModal) {
            setShowBuySpinModalRef.current(false)
            return
          }

          if (s.showFreeSpinIntro) {
            setShowFreeSpinIntroRef.current(false)
            return
          }
          break
        }

        case 'BET_UP': {
          if (s.isReady && !s.spinning && !s.autoSpin && s.freeSpinsLeft <= 0) {
            if (s.showWithdrawModal) {
              addWithdrawAmountRef.current()
            } else if (s.showBuySpinModal) {
              minusBuySpinBetRef.current()
            } else {
              addBetRef.current()
            }
          }
          break
        }

        case 'BET_DOWN': {
          if (s.isReady && !s.spinning && !s.autoSpin && s.freeSpinsLeft <= 0) {
            if (s.showWithdrawModal) {
              minusWithdrawAmountRef.current()
            } else if (s.showBuySpinModal) {
              addBuySpinBetRef.current()
            } else {
              minusBetRef.current()
            }
          }
          break
        }

        case 'AUTO': {
          if (!internetOnline) return
          if (
            !s.isFreeGame &&
            s.balance >= s.bet &&
            s.pauseColumn === null &&
            !s.showWithdrawModal
          ) {
            setAutoSpinRef.current(v => !v)
          }
          break
        }

        case 'TURBO': {
          if (!internetOnline) return
          if (s.balance >= s.bet && s.pauseColumn === null && !s.showBuySpinModal) {
            setTurboStageRef.current(prev => ((prev + 1) % 4) as 0 | 1 | 2 | 3)
          }
          break
        }
        case 'BUY': {
          if (!internetOnline) return
          if (
            s.isReady &&
            !s.spinning &&
            !s.autoSpin &&
            s.balance >= s.bet &&
            s.pauseColumn === null
          ) {
            if (s.showBuySpinModal) {
              buyFreeSpinsRef.current(s.buySpinBet)
              setShowBuySpinModalRef.current(false)
              return
            }
            setShowBuySpinModalRef.current(true)
          }
          break
        }

        case 'WITHDRAW': {
          if (!internetOnline) return
          const canOpenFromState =
            s.isReady &&
            !s.spinning &&
            !s.autoSpin &&
            !s.isFreeGame &&
            !s.showFreeSpinIntro &&
            !s.showScatterWinBanner &&
            s.freeSpinsLeft <= 0 &&
            s.pauseColumn === null &&
            !s.showBuySpinModal &&
            !s.isWithdrawing &&
            getMaxWithdrawSelectable(s.balance) >= WITHDRAW_MIN

          if (canOpenFromState) {
            requestShellWithdrawOpen()
          }
          break
        }

        case 'AUDIO': {
          setAudioOnRef.current(!s.audioOn)
          break
        }
      }
    }

    return () => {
      delete window.__ARCADE_INPUT__
    }
  }, [])

  if (!sessionReady) return null

  if (bootSplashStage !== null) {
    return (
      <div className="viewport">
        <div
          className="boot-splash-screen"
          onClick={allowBootSplashClick ? () => setHasPressedStart(true) : undefined}
          onKeyDown={
            allowBootSplashClick
              ? event => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    setHasPressedStart(true)
                  }
                }
              : undefined
          }
          role={allowBootSplashClick ? 'button' : undefined}
          tabIndex={allowBootSplashClick ? 0 : undefined}
          aria-label={allowBootSplashClick ? 'Start game' : undefined}
          style={{
            backgroundImage: `url(${splashStart})`,
            cursor: allowBootSplashClick ? 'pointer' : undefined,
          }}
        />
      </div>
    )
  }

  return (
    <div className="viewport">
      <div className={`game-root mode-${runtimeMode.toLowerCase()}`}>
        <div className="game-frame">
          <div className="frame-bg">
            <div className={`bg-inner ${showFreeSpinModeUi ? 'free-spin' : ''}`}>
              <div className="frame-inner-shadow" />
            </div>
            <div className="bg-frame" />
          </div>

          <div className="game-content">
            <div className={`banner-layer intro ${showFreeSpinIntro ? 'visible' : ''}`}>
              <FreeSpinIntro spins={pendingFreeSpins || 0} countdown={introCountdown} />
            </div>

            <div className={`banner-layer win ${showScatterWinBanner ? 'visible' : ''}`}>
              <ScatterWinBanner amount={showScatterWinBanner ? freeSpinTotal : 0} />
            </div>

            <div className="top-container">
              {DEV && <DebugHud info={debugInfo} />}

              <button
                className="withdrawal-btn"
                disabled={!canOpenShellWithdraw}
                onClick={requestShellWithdrawOpen}
              />

              <button
                className="buy-spin-btn"
                disabled={
                  pauseColumn !== null ||
                  balance === 0 ||
                  balance < bet * 50 ||
                  isFreeGame ||
                  freeSpinsLeft > 0
                }
                onClick={() => setShowBuySpinModal(true)}
              />

              <div className={`free-spin-banner ${showFreeSpinModeUi ? 'free' : ''}`}>
                <div className={`free-spin-text font-plasma ${!showFreeSpinModeUi ? 'base' : ''}`}>
                  <span className="free-spin-base superace-base">
                    {showFreeSpinModeUi ? 'FREE SPINS' : 'UltraAce'}{' '}
                  </span>

                  <span className="free-spin-face superace-face">
                    {showFreeSpinModeUi ? 'FREE SPINS' : 'UltraAce'}{' '}
                  </span>
                </div>

                <span className="free-spin-count">
                  {showFreeSpinCount ? freeSpinDisplayCount : ''}
                </span>
              </div>

              <div className={`multiplier-strip ${showFreeSpinModeUi ? 'free' : ''}`}>
                {ladder.map((m, i) => (
                  <div
                    key={m}
                    className={[
                      'multiplier-chip',
                      i === activeMultiplierIndex && 'current',
                      showFreeSpinModeUi ? 'free' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <span className="multiplier-base">x{m}</span>
                    <span className="multiplier-face">x{m}</span>
                  </div>
                ))}
              </div>
            </div>
            {showBuySpinModal && (
              <BuySpinModal
                bet={buySpinBet}
                balance={balance}
                onAddBet={addBuySpinBet}
                onMinusBet={minusBuySpinBet}
                onCancel={() => setShowBuySpinModal(false)}
                onConfirm={() => {
                  if (!internetOnline) {
                    return
                  }
                  if (isReady) {
                    setShowBuySpinModal(false)
                    buyFreeSpins(buySpinBet)
                  }
                }}
              />
            )}

            <div className="dim-zone">
              <DimOverlay
                active={
                  (phase === 'highlight' && Boolean(activeCascade?.lineWins?.length)) ||
                  (phase === 'initialRefill' && !isFreeGame && activePausedColumn !== null)
                }
              />

              <div className="reels-stage">
                <div className="gpu-prewarm" />{' '}
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

                    {renderedWindow &&
                      [
                        'initialRefill',
                        'cascadeRefill',
                        'postGoldTransform',
                        'highlight',
                        'pop',
                        'settle',
                        'idle',
                      ].includes(phase) &&
                      renderedWindow.map((col, i) => (
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
                    {redWildPropagationPaths.map(path => (
                      <div
                        key={path.id}
                        className="red-wild-propagation"
                        style={
                          {
                            '--from-x': `calc(${path.fromReel} * (var(--reel-width) + var(--reel-gap)))`,
                            '--from-y': `calc(${path.fromRow} * (var(--scaled-card-height) + var(--card-gap)) + var(--scaled-card-height) * 0.18)`,
                            '--travel-x': `calc((${path.toReel} - ${path.fromReel}) * (var(--reel-width) + var(--reel-gap)))`,
                            '--travel-y': `calc((${path.toRow} - ${path.fromRow}) * (var(--scaled-card-height) + var(--card-gap)))`,
                          } as React.CSSProperties
                        }
                      >
                        <img
                          src={WILD_RED}
                          className="red-wild-propagation-img"
                          draggable={false}
                        />
                      </div>
                    ))}
                  </div>
                </div>
                <WinOverlay
                  amount={overlayAmount}
                  title={overlayTitle}
                  phase={phase === 'highlight' || phase === 'pop' ? phase : null}
                />
              </div>

              <div className="bottom-container">
                <div className={`win-display ${showFreeSpinIntro && 'hidden'}`}>
                  WIN:{' '}
                  <span className="win-amount">
                    {formatPeso(useFreeSpinWinCounter ? freeSpinTotal : totalWin)}
                  </span>
                </div>
                <div className="bottom-controls">
                  <div className={`controls-left ${showFreeSpinIntro && 'hidden'}`}>
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
                        {formatPeso(
                          (isFreeGame ||
                            pendingFreeSpins > 0 ||
                            freeSpinsLeft > 0 ||
                            pauseColumn !== null) &&
                            scatterTriggerType === 'buy'
                            ? (buySpinBet ?? 0)
                            : (bet ?? 0),
                          false,
                          true,
                          2,
                          true,
                        )}
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

                  <div className={`controls-center ${showFreeSpinIntro && 'center'}`}></div>

                  <div className={`controls-right ${showFreeSpinIntro && 'hidden'}`}>
                    <button
                      className={`spin-btn turbo spin-turbo-image ${turboMultiplier > 1 ? 'active' : ''} ${turboStage === 1 ? 'turbo-1' : ''} ${turboStage === 2 ? 'turbo-2' : ''}  ${turboStage === 3 ? 'turbo-3' : ''}`}
                      disabled={balance === 0 || balance < bet || pauseColumn !== null}
                      onClick={() => {
                        setTurboStage(prev => {
                          const next = ((prev + 1) % 4) as 0 | 1 | 2 | 3

                          return next
                        })
                      }}
                    />
                    <button
                      className={`spin-btn auto spin-auto-image ${autoSpin ? 'active' : ''}`}
                      disabled={
                        isFreeGame || balance === 0 || balance < bet || pauseColumn !== null
                      }
                      onClick={() => setAutoSpin(!autoSpin)}
                    />
                  </div>
                  <button
                    className={`spin-btn spin ${((isReady && !autoSpin) || (!autoSpin && !isFreeGame) || showFreeSpinIntro) && isReady ? 'spin-image active' : 'stop-image'}`}
                    disabled={
                      !isReady ||
                      (!showFreeSpinIntro && !isFreeGame && (balance === 0 || balance < bet))
                    }
                    onClick={() => {
                      if (!internetOnline) {
                        return
                      }

                      if (showFreeSpinIntro) {
                        triggerFreeSpinStart()
                        return
                      }

                      spin()
                    }}
                    aria-label="Spin"
                  />
                </div>
                <div className={`bottom-info ${showFreeSpinIntro && 'hidden'}`}>
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
                    {/*<button className="add-btn" onClick={() => addBalance('bypass', 2)}>*/}
                    {/*  +{formatPeso(2, true, true, 2)}*/}
                    {/*</button>*/}
                  </div>

                  <div className="bottom-info-right" />
                </div>

                {/*<div className={`device-info ${showFreeSpinIntro && 'hidden'}`}>*/}
                {/*  <label className="device-label">*/}
                {/*    Device: <span>{deviceId}</span>*/}
                {/*  </label>*/}
                {/*</div>*/}
              </div>
            </div>
          </div>

          <div id="frame-light-overlay" />
          <div className="game-version-tag">v{GAME_BUILD_VERSION}</div>
        </div>
      </div>
    </div>
  )
}
