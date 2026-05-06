import { useEngine } from './hooks/useEngine'
import { Reel } from './ui/Reel'
import { DimOverlay } from './ui/DimOverlay'
import { WinOverlay } from './ui/WinOverlay'
import { adaptWindow } from './game/adaptWindow'
import { detectScatterPauseColumn, useCascadeTimeline } from './hooks/useCascadeTimeline'
import { DebugHud } from './debug/DebugHud'
import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react'

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
import { fetchLiveConfig, subscribeLiveConfig } from './lib/config'

import splashStart from './assets/images/splash_start.png'
import WILD_RED from './assets/symbols/WILD_RED.png'

const DEV = import.meta.env.DEV
const DEBUG_ULTRAACE = import.meta.env.VITE_ULTRAACE_DEBUG === '1'
const GAME_BUILD_VERSION = import.meta.env.VITE_GAME_VERSION || 'dev'
const FREE_SPIN_PRESTART_DELAY_MS = 1500
const BIG_WIN_BET_MULTIPLIER = 10
const BIG_WIN_MIN_AMOUNT = 20
const BOOT_SPLASH_GAMEPLAY_GUARD_MS = 1200
const WITHDRAW_INPUT_DEBOUNCE_MS = 300
const WITHDRAW_STALL_RESET_MS = 15000
const MARQUEE_HIDE_ANIMATION_MS = 280

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

type MarqueeRepeatMode = 'none' | 'daily' | 'weekly'

type MarqueeConfig = {
  enabled: boolean
  message: string
  repeat: MarqueeRepeatMode
  startsAt: string | null
  endsAt: string | null
  startTime: string | null
  endTime: string | null
  daysOfWeek: number[] | null
}

type SideAdsConfig = {
  enabled: boolean
  leftImageUrl: string | null
  rightImageUrl: string | null
  leftAlt: string
  rightAlt: string
}

const DEFAULT_MARQUEE: MarqueeConfig = {
  enabled: false,
  message: '',
  repeat: 'none',
  startsAt: null,
  endsAt: null,
  startTime: null,
  endTime: null,
  daysOfWeek: null,
}

const DISABLED_MARQUEE: MarqueeConfig = {
  ...DEFAULT_MARQUEE,
  enabled: false,
}

const DISABLED_SIDE_ADS: SideAdsConfig = {
  enabled: false,
  leftImageUrl: null,
  rightImageUrl: null,
  leftAlt: 'Promotion',
  rightAlt: 'Promotion',
}

function normalizeMarqueeConfig(raw: unknown): MarqueeConfig {
  if (typeof raw === 'string') {
    const message = raw.trim()
    return message ? { ...DEFAULT_MARQUEE, enabled: true, message } : DISABLED_MARQUEE
  }

  if (!raw || typeof raw !== 'object') return DISABLED_MARQUEE

  const value = raw as Record<string, unknown>
  const message = String(value.message ?? value.text ?? '').trim()
  const repeat = String(value.repeat ?? value.scheduleMode ?? value.schedule_mode ?? 'none')
    .trim()
    .toLowerCase()
  const rawDays = value.daysOfWeek ?? value.days_of_week
  const days = Array.isArray(rawDays)
    ? rawDays
        .map((day: unknown) => Number(day))
        .filter((day: number) => Number.isInteger(day) && day >= 0 && day <= 6)
    : null

  return {
    enabled: value.enabled !== false && Boolean(message),
    message,
    repeat: repeat === 'daily' || repeat === 'weekly' ? repeat : 'none',
    startsAt: value.startsAt || value.starts_at ? String(value.startsAt ?? value.starts_at) : null,
    endsAt: value.endsAt || value.ends_at ? String(value.endsAt ?? value.ends_at) : null,
    startTime:
      value.startTime || value.start_time ? String(value.startTime ?? value.start_time) : null,
    endTime: value.endTime || value.end_time ? String(value.endTime ?? value.end_time) : null,
    daysOfWeek: days && days.length ? days : null,
  }
}

function normalizeSideAdsConfig(raw: unknown): SideAdsConfig {
  if (!raw || typeof raw !== 'object') return DISABLED_SIDE_ADS

  const value = raw as Record<string, unknown>
  const leftImageUrl = String(
    value.leftImageUrl ?? value.left_image_url ?? value.leftUrl ?? value.left_url ?? '',
  ).trim()
  const rightImageUrl = String(
    value.rightImageUrl ?? value.right_image_url ?? value.rightUrl ?? value.right_url ?? '',
  ).trim()

  return {
    enabled: value.enabled !== false && Boolean(leftImageUrl || rightImageUrl),
    leftImageUrl: leftImageUrl || null,
    rightImageUrl: rightImageUrl || null,
    leftAlt: String(value.leftAlt ?? value.left_alt ?? 'Promotion').trim() || 'Promotion',
    rightAlt: String(value.rightAlt ?? value.right_alt ?? 'Promotion').trim() || 'Promotion',
  }
}

function sideAdStyle(imageUrl: string): CSSProperties {
  const safeImageUrl = imageUrl.replace(/["\\\n\r]/g, '')
  return { '--side-ad-image': `url("${safeImageUrl}")` } as CSSProperties
}

function isSvgUrl(imageUrl: string): boolean {
  return /\.svg(?:[?#].*)?$/i.test(imageUrl)
}

function minutesFromTime(value: string | null) {
  if (!value) return null
  const match = value.trim().match(/^(\d{1,2}):(\d{2})/)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null
  return hours * 60 + minutes
}

function isMarqueeActive(config: MarqueeConfig, now = new Date()) {
  if (!config.enabled || !config.message.trim()) return false

  const startsAt = config.startsAt ? new Date(config.startsAt).getTime() : null
  const endsAt = config.endsAt ? new Date(config.endsAt).getTime() : null
  const nowMs = now.getTime()
  if (startsAt && Number.isFinite(startsAt) && nowMs < startsAt) return false
  if (endsAt && Number.isFinite(endsAt) && nowMs > endsAt) return false

  if (config.repeat === 'weekly' && config.daysOfWeek && !config.daysOfWeek.includes(now.getDay())) {
    return false
  }

  if (config.repeat === 'daily' || config.repeat === 'weekly') {
    const startMinutes = minutesFromTime(config.startTime)
    const endMinutes = minutesFromTime(config.endTime)
    if (startMinutes === null && endMinutes === null) return true

    const currentMinutes = now.getHours() * 60 + now.getMinutes()
    if (startMinutes !== null && endMinutes !== null && startMinutes > endMinutes) {
      return currentMinutes >= startMinutes || currentMinutes <= endMinutes
    }
    if (startMinutes !== null && currentMinutes < startMinutes) return false
    if (endMinutes !== null && currentMinutes > endMinutes) return false
  }

  return true
}

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

function normalizePlayableBet(value: number, balanceCap?: number): number {
  const normalizedValue = Math.max(1, Math.floor(Number(value || 0)))

  if (typeof balanceCap !== 'number' || !Number.isFinite(balanceCap)) {
    return normalizedValue
  }

  const normalizedCap = Math.max(0, Math.floor(balanceCap))
  if (normalizedCap < 1) return 1
  return Math.min(normalizedValue, normalizedCap)
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
  const [turboStage, setTurboStage] = useState<0 | 1>(0)

  const turboMultiplier = useMemo(() => {
    switch (turboStage) {
      case 1:
        return 5
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
  const [marqueeConfig, setMarqueeConfig] = useState<MarqueeConfig>(DISABLED_MARQUEE)
  const [sideAdsConfig, setSideAdsConfig] = useState<SideAdsConfig>(DISABLED_SIDE_ADS)
  const [marqueeClock, setMarqueeClock] = useState(() => Date.now())
  const [renderedMarqueeConfig, setRenderedMarqueeConfig] = useState<MarqueeConfig | null>(null)
  const [marqueeVisible, setMarqueeVisible] = useState(false)
  const marqueeTransitionTimerRef = useRef<number | null>(null)
  const lastMarqueeConfigKeyRef = useRef('')
  const lastSideAdsConfigKeyRef = useRef('')

  useEffect(() => {
    const scale = Math.min(window.innerWidth / 430, window.innerHeight / 900)

    const el = document.querySelector('.game-scale') as HTMLElement
    if (el) el.style.transform = `scale(${scale})`
  }, [])

  useEffect(() => {
    installAccountingRetryHooks()
  }, [])

  useEffect(() => {
    let mounted = true
    const applyConfig = (cfg: any) => {
      const rawMarquee = cfg?.marquee ?? cfg?.ultraace_marquee ?? cfg?.promo_marquee
      const rawSideAds = cfg?.side_ads ?? cfg?.sideAds ?? cfg?.ultraace_side_ads
      const nextConfig = normalizeMarqueeConfig(rawMarquee)
      const nextKey = JSON.stringify(nextConfig)
      if (mounted && nextKey !== lastMarqueeConfigKeyRef.current) {
        lastMarqueeConfigKeyRef.current = nextKey
        setMarqueeConfig(nextConfig)
      }

      const nextSideAdsConfig = normalizeSideAdsConfig(rawSideAds)
      const nextSideAdsKey = JSON.stringify(nextSideAdsConfig)
      if (mounted && nextSideAdsKey !== lastSideAdsConfigKeyRef.current) {
        lastSideAdsConfigKeyRef.current = nextSideAdsKey
        setSideAdsConfig(nextSideAdsConfig)
      }
    }

    const refreshConfig = () => {
      fetchLiveConfig()
        .then(applyConfig)
        .catch(error => {
          if (DEBUG_ULTRAACE) console.warn('[MARQUEE] config load failed', error)
        })
    }

    refreshConfig()
    const pollTimer = window.setInterval(refreshConfig, 3000)

    const channel = subscribeLiveConfig(applyConfig)

    return () => {
      mounted = false
      window.clearInterval(pollTimer)
      void channel.unsubscribe()
    }
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setMarqueeClock(Date.now()), 30000)
    return () => window.clearInterval(timer)
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

  useBackgroundAudio(BGM, audioOn, 1)

  const {
    cascades,
    spinId,
    spin,
    commitSpin,
    commitSpinVisualDeduction,
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
    restoredFreeSpinIntro,
    setRestoredFreeSpinIntro,
    buyFreeSpins,
    previewExternalBalanceChange,
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
    if (bet <= 50) return 10
    if (bet <= 100) return 50
    if (bet <= 500) return 100
    return 500
  }

  const addBet = () => {
    if (!internetOnline) {
      return
    }
    setBet(prev => {
      const next = prev + getBetIncrement(prev)
      return normalizePlayableBet(next, balance)
    })
  }

  const minusBet = () => {
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

  const addBuySpinBet = () => {
    if (!internetOnline) {
      return
    }
    setBuySpinBet(prev => {
      const inc = getBetIncrement(prev)
      return normalizePlayableBet(prev + inc, balance)
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

    previewExternalBalanceChange(amount)

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
  const [displayedCascadeWinTotal, setDisplayedCascadeWinTotal] = useState(0)

  const withdrawRequestedAmountRef = useRef(0)
  const withdrawInputLockedUntilRef = useRef(0)
  const withdrawLastActivityAtRef = useRef(0)
  const lastLoggedWinKeyRef = useRef<string>('')
  const lastPlayedWinAudioKeyRef = useRef<string>('')
  const lastPlayedPopAudioKeyRef = useRef<string>('')
  const lastPlayedDealAudioKeyRef = useRef<string>('')
  const pendingIntroStartRef = useRef(false)
  const bootSplashDismissedAtRef = useRef(0)
  const activeForegroundAudioRef = useRef<HTMLAudioElement | null>(null)
  const activeForegroundAudioFinalizeRef = useRef<(() => void) | null>(null)
  const activeOneShotAudioRef = useRef(new Set<HTMLAudioElement>())
  const activeOneShotAudioGroupsRef = useRef(new Map<string, Set<HTMLAudioElement>>())
  const activeOneShotTimersRef = useRef(new Map<string, number[]>())
  const audioSequenceTokenRef = useRef(0)

  // Reset win tracking when new spin starts
  useEffect(() => {
    if (spinId > 0) {
      lastLoggedWinKeyRef.current = ''
      setDisplayedCascadeWinTotal(0)
    }
  }, [spinId])

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

  function dismissBootSplash() {
    bootSplashDismissedAtRef.current = Date.now()
    setHasPressedStartRef.current(true)
  }

  function isBootSplashGameplayGuardActive() {
    return Date.now() - bootSplashDismissedAtRef.current < BOOT_SPLASH_GAMEPLAY_GUARD_MS
  }

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
    spinning,
    isFreeGame,
    turboMultiplier,
    scatterTriggerType,
    commitSpin,
  )

  useEffect(() => {
    if (!DEBUG_ULTRAACE) return
    console.log('[CASCADE STATE]', {
      phase,
      cascadeIndex,
      activeCascadeWin: activeCascade?.win,
      spinId,
    })
  }, [phase, cascadeIndex, activeCascade?.win, spinId])

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

  const adaptedWindow = useMemo(
    () =>
      windowForRender
        ? adaptWindow(
            windowForRender,
            phase === 'cascadeRefill' ? activeCascade?.removedPositions : undefined,
            shouldUsePrevious ? previousCascade?.window : undefined,
            phase,
          )
        : undefined,
    [
      windowForRender,
      phase,
      activeCascade?.removedPositions,
      shouldUsePrevious,
      previousCascade?.window,
    ],
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
  const hasTimelineWindow =
    Boolean(activeCascade?.window?.length) ||
    Boolean(previousCascade?.window?.length) ||
    Boolean(renderedWindow?.length) ||
    spinning
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
    if (bootSplashStage !== null) return
    if (isBootSplashGameplayGuardActive()) return
    if (!isReady) return
    if (spinning) return
    if (!autoSpin && !isFreeGame) return
    if (showFreeSpinIntro || isFreeSpinPreview || showScatterWinBanner || showBuySpinModal) return
    if (pauseColumn !== null && !isFreeGame && pendingFreeSpins > 0) return

    if (!isFreeGame && (balance < bet || bet < 1 || !Number.isInteger(bet))) {
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
    isReady,
    spinning,
    autoSpin,
    isFreeGame,
    pendingFreeSpins,
    balance,
    bet,
    bootSplashStage,
    pauseColumn,
    showFreeSpinIntro,
    isFreeSpinPreview,
    showScatterWinBanner,
    showBuySpinModal,
  ])

  useEffect(() => {
    if (phase !== 'reelSweepOut') return
    if (spinId <= 0) return
    if (isFreeGame) return

    commitSpinVisualDeduction()
  }, [phase, spinId, isFreeGame, commitSpinVisualDeduction])

  useEffect(() => {
    if (DEBUG_ULTRAACE) {
      console.log('[WIN] effect running:', {
        phase,
        activeCascadeWin: activeCascade?.win,
        spinId,
        cascadeIndex,
      })
    }
    if (phase !== 'highlight') return
    if (!activeCascade?.win) return

    const winKey = `${spinId}:${cascadeIndex}`
    if (lastLoggedWinKeyRef.current === winKey) return
    lastLoggedWinKeyRef.current = winKey

    if (DEBUG_ULTRAACE) {
      console.log('[WIN] commitWin called:', { winKey, win: activeCascade.win, cascadeIndex })
    }
    setDisplayedCascadeWinTotal(current =>
      Math.max(0, Math.round((current + Number(activeCascade.win ?? 0)) * 10000) / 10000),
    )
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
  const marqueeActive = useMemo(
    () => isMarqueeActive(marqueeConfig, new Date(marqueeClock)),
    [marqueeConfig, marqueeClock],
  )
  const marqueeMessage = marqueeConfig.message.trim()

  useEffect(() => {
    if (marqueeTransitionTimerRef.current !== null) {
      window.clearTimeout(marqueeTransitionTimerRef.current)
      marqueeTransitionTimerRef.current = null
    }

    if (marqueeActive && marqueeMessage) {
      const renderedMessage = renderedMarqueeConfig?.message.trim() ?? ''

      if (!renderedMarqueeConfig) {
        setRenderedMarqueeConfig(marqueeConfig)
        window.requestAnimationFrame(() => setMarqueeVisible(true))
        return
      }

      if (renderedMessage !== marqueeMessage) {
        setMarqueeVisible(false)
        marqueeTransitionTimerRef.current = window.setTimeout(() => {
          setRenderedMarqueeConfig(marqueeConfig)
          window.requestAnimationFrame(() => setMarqueeVisible(true))
          marqueeTransitionTimerRef.current = null
        }, MARQUEE_HIDE_ANIMATION_MS)
        return () => {
          if (marqueeTransitionTimerRef.current !== null) {
            window.clearTimeout(marqueeTransitionTimerRef.current)
            marqueeTransitionTimerRef.current = null
          }
        }
      }

      setRenderedMarqueeConfig(marqueeConfig)
      window.requestAnimationFrame(() => setMarqueeVisible(true))
      return
    }

    setMarqueeVisible(false)
    marqueeTransitionTimerRef.current = window.setTimeout(() => {
      setRenderedMarqueeConfig(null)
      marqueeTransitionTimerRef.current = null
    }, MARQUEE_HIDE_ANIMATION_MS)

    return () => {
      if (marqueeTransitionTimerRef.current !== null) {
        window.clearTimeout(marqueeTransitionTimerRef.current)
        marqueeTransitionTimerRef.current = null
      }
    }
  }, [marqueeActive, marqueeConfig, marqueeMessage, renderedMarqueeConfig])
  const freeSpinDisplayCount = isFreeGame ? freeSpinsLeft : pendingFreeSpins
  const showFreeSpinModeUi = isFreeGame || isFreeSpinPreview || showScatterWinBanner || freezeUI
  const showFreeSpinCount = (isFreeGame || isFreeSpinPreview) && freeSpinDisplayCount > 0
  const useFreeSpinWinCounter =
    isFreeGame ||
    pendingFreeSpins > 0 ||
    showFreeSpinIntro ||
    isFreeSpinPreview ||
    showScatterWinBanner ||
    freezeUI
  const displayedWinAmount = useFreeSpinWinCounter ? freeSpinTotal : displayedCascadeWinTotal
  const overlayAmount = activeCascade?.win ?? 0
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
    setRestoredFreeSpinIntro(false)
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
    settleSpinVisuals(phase === 'settle')
  }, [spinCompleted, settleSpinVisuals, phase])

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

    // Fallback: if a trigger spin awarded free spins but the timeline already settled back
    // to idle without tripping `spinCompleted`, still enter the intro instead of hanging on
    // the scatter board.
    if (!isFreeGame && isIdle && !spinning && pendingFreeSpins > 0 && !showFreeSpinIntro) {
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
    isIdle,
    spinning,
    isFreeGame,
    pendingFreeSpins,
    showFreeSpinIntro,
    setShowFreeSpinIntro,
  ])

  useEffect(() => {
    if (!showFreeSpinIntro) return
    if (restoredFreeSpinIntro) return

    const timer = window.setTimeout(() => {
      triggerFreeSpinStart()
    }, 10_000)

    return () => clearTimeout(timer)
  }, [restoredFreeSpinIntro, showFreeSpinIntro])

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
    if (!isFreeGame || spinning || freeSpinsLeft <= 0) return

    const t = window.setTimeout(() => {
      pendingIntroStartRef.current = false
      setIsFreeSpinPreview(false)
      spinRef.current()
    }, FREE_SPIN_PRESTART_DELAY_MS)

    return () => clearTimeout(t)
  }, [showFreeSpinIntro, isFreeGame, spinning, freeSpinsLeft])

  useEffect(() => {
    if (pendingIntroStartRef.current) return
    if (showFreeSpinIntro) return
    if (!isIdle) return
    if (!isFreeGame || spinning || freeSpinsLeft <= 0) return

    const t = window.setTimeout(() => {
      setIsFreeSpinPreview(false)
      spinRef.current()
    }, FREE_SPIN_PRESTART_DELAY_MS)

    return () => clearTimeout(t)
  }, [showFreeSpinIntro, isIdle, isFreeGame, spinning, freeSpinsLeft])

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

  useEffect(() => {
    if (window.parent === window) return

    const sendActivityHeartbeat = () => {
      window.parent.postMessage({ type: 'ULTRAACE_ACTIVITY' }, '*')
    }

    const interval = window.setInterval(sendActivityHeartbeat, 30000)

    sendActivityHeartbeat()

    return () => {
      window.clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    if (window.parent === window) return
    if (!spinning && !autoSpin && !isFreeGame) return

    const sendActivityHeartbeat = () => {
      window.parent.postMessage({ type: 'ULTRAACE_ACTIVITY' }, '*')
    }

    const interval = window.setInterval(sendActivityHeartbeat, 10000)

    sendActivityHeartbeat()

    return () => {
      window.clearInterval(interval)
    }
  }, [spinning, autoSpin, isFreeGame])

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
    if (Date.now() < withdrawInputLockedUntilRef.current) return
    withdrawInputLockedUntilRef.current = Date.now() + WITHDRAW_INPUT_DEBOUNCE_MS
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
      if (DEBUG_ULTRAACE) {
        console.log('[ARCADE]', payload)
      }

      if (payload?.type === 'INTERNET_LOST') {
        if (DEBUG_ULTRAACE) {
          console.log('[ULTRAACE] INTERNET_LOST')
        }

        setInternetOnline(false)
        return
      }

      if (payload?.type === 'INTERNET_RESTORED' || payload?.type === 'INTERNET_OK') {
        if (DEBUG_ULTRAACE) {
          console.log('[ULTRAACE] INTERNET_RESTORED')
        }

        setInternetOnline(true)
        return
      }

      // --- COIN ---
      // Device (arcade-shell) handles coin recording via recordCoinDeposit().
      // Balance updates are propagated to UI via Supabase Realtime subscription.
      // UI should NOT record coins independently to avoid duplicate entries.
      if (payload.type === 'COIN') {
        previewExternalBalanceChange(Number(payload.credits ?? payload.amount ?? 0))
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
      if (payload.type === 'WITHDRAW_STARTED') {
        withdrawRequestedAmountRef.current = Number(payload.requested ?? 20) || 20
        withdrawLastActivityAtRef.current = Date.now()
        setIsWithdrawingRef.current(true)
        return
      }

      if (payload.type === 'WITHDRAW_DISPENSE') {
        withdrawLastActivityAtRef.current = Date.now()
        previewExternalBalanceChange(-Number(payload.dispensed ?? 0))
        minusBalanceRef.current('hopper', payload.dispensed)

        return
      }

      if (payload.type === 'HOPPER_COIN') {
        const amount = Number(payload.amount ?? 20)
        previewExternalBalanceChange(amount)
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
        withdrawInputLockedUntilRef.current = Date.now() + WITHDRAW_INPUT_DEBOUNCE_MS
        withdrawLastActivityAtRef.current = 0
        setIsWithdrawingRef.current(false)
        setShowWithdrawModalRef.current(false)
        setWithdrawAmount(withdrawRequestedAmountRef.current || 20)
        withdrawRequestedAmountRef.current = 0

        return
      }

      if (payload.type === 'WITHDRAW_ABORTED') {
        withdrawInputLockedUntilRef.current = Date.now() + WITHDRAW_INPUT_DEBOUNCE_MS
        withdrawLastActivityAtRef.current = 0
        setIsWithdrawingRef.current(false)
        setShowWithdrawModalRef.current(false)
        setWithdrawAmount(
          Number(payload.requested ?? withdrawRequestedAmountRef.current ?? 20) || 20,
        )
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
          dismissBootSplash()
          return
        } else if (action === 'SPIN' && (payload.player === undefined || payload.player === 'P1')) {
          // keep compatibility with services that emit ACTION/SPIN for P1 START
          dismissBootSplash()
          return
        } else {
          return
        }
      }

      if (
        isBootSplashGameplayGuardActive() &&
        (action === 'SPIN' ||
          action === 'AUTO' ||
          action === 'TURBO' ||
          action === 'BET_UP' ||
          action === 'BET_DOWN' ||
          action === 'BUY' ||
          action === 'WITHDRAW')
      ) {
        return
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
            (s.isFreeGame || (s.balance >= s.bet && s.bet >= 1 && Number.isInteger(s.bet))) &&
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
            withdrawInputLockedUntilRef.current = Date.now() + WITHDRAW_INPUT_DEBOUNCE_MS
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
            s.bet >= 1 &&
            Number.isInteger(s.bet) &&
            s.pauseColumn === null &&
            !s.showWithdrawModal
          ) {
            setAutoSpinRef.current(v => !v)
          }
          break
        }

        case 'TURBO': {
          if (!internetOnline) return
          if (
            s.balance >= s.bet &&
            s.bet >= 1 &&
            Number.isInteger(s.bet) &&
            s.pauseColumn === null &&
            !s.showBuySpinModal
          ) {
            setTurboStageRef.current(prev => (prev === 0 ? 1 : 0))
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
            s.bet >= 1 &&
            Number.isInteger(s.bet) &&
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

  useEffect(() => {
    if (!isWithdrawing) {
      withdrawLastActivityAtRef.current = 0
      return
    }

    const timer = window.setInterval(() => {
      const lastActivityAt = withdrawLastActivityAtRef.current
      if (!lastActivityAt) return
      if (Date.now() - lastActivityAt < WITHDRAW_STALL_RESET_MS) return

      console.warn('[ULTRAACE] watchdog cleared stalled withdraw state', {
        requestedAmount: withdrawRequestedAmountRef.current,
      })
      setIsWithdrawing(false)
      setShowWithdrawModal(false)
      setWithdrawAmount(withdrawRequestedAmountRef.current || 20)
      withdrawRequestedAmountRef.current = 0
      withdrawLastActivityAtRef.current = 0
    }, 1000)

    return () => {
      window.clearInterval(timer)
    }
  }, [isWithdrawing, setIsWithdrawing, setShowWithdrawModal, setWithdrawAmount])

  if (!sessionReady) return null

  if (bootSplashStage !== null) {
    return (
      <div className="viewport">
        <div
          className="boot-splash-screen"
          onClick={allowBootSplashClick ? () => dismissBootSplash() : undefined}
          onKeyDown={
            allowBootSplashClick
              ? event => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    dismissBootSplash()
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
      <div className="game-root">
        {sideAdsConfig.enabled && sideAdsConfig.leftImageUrl && (
          <aside
            className="desktop-side-ad left"
            aria-label={sideAdsConfig.leftAlt}
            style={sideAdStyle(sideAdsConfig.leftImageUrl)}
          >
            {isSvgUrl(sideAdsConfig.leftImageUrl) && (
              <object
                className="desktop-side-ad-object"
                data={sideAdsConfig.leftImageUrl}
                type="image/svg+xml"
                aria-hidden="true"
                tabIndex={-1}
              />
            )}
            <span className="desktop-side-ad-alt">{sideAdsConfig.leftAlt}</span>
          </aside>
        )}
        {sideAdsConfig.enabled && sideAdsConfig.rightImageUrl && (
          <aside
            className="desktop-side-ad right"
            aria-label={sideAdsConfig.rightAlt}
            style={sideAdStyle(sideAdsConfig.rightImageUrl)}
          >
            {isSvgUrl(sideAdsConfig.rightImageUrl) && (
              <object
                className="desktop-side-ad-object"
                data={sideAdsConfig.rightImageUrl}
                type="image/svg+xml"
                aria-hidden="true"
                tabIndex={-1}
              />
            )}
            <span className="desktop-side-ad-alt">{sideAdsConfig.rightAlt}</span>
          </aside>
        )}
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

            <div className={`top-container ${renderedMarqueeConfig ? 'has-marquee' : ''}`}>
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

              {renderedMarqueeConfig && (
                <div
                  className={`promo-marquee ${marqueeVisible ? 'visible' : 'hiding'}`}
                  aria-live="polite"
                >
                  <div className="promo-marquee-cap left" />
                  <div className="promo-marquee-track">
                    <span className="promo-marquee-text">{renderedMarqueeConfig.message}</span>
                    <span className="promo-marquee-text duplicate" aria-hidden="true">
                      {renderedMarqueeConfig.message}
                    </span>
                  </div>
                  <div className="promo-marquee-cap right" />
                </div>
              )}
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
                        phase={spinId > 0 && hasTimelineWindow ? 'reelSweepOut' : 'idle'}
                        layer={spinId > 0 && hasTimelineWindow ? 'old' : 'new'}
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
                  WIN: <span className="win-amount">{formatPeso(displayedWinAmount)}</span>
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
                      className={`spin-btn turbo spin-turbo-image ${turboMultiplier > 1 ? 'active' : ''} ${turboStage === 1 ? 'turbo-1' : ''}`}
                      disabled={
                        balance === 0 ||
                        balance < bet ||
                        bet < 1 ||
                        !Number.isInteger(bet) ||
                        pauseColumn !== null
                      }
                      onClick={() => {
                        setTurboStage(prev => (prev === 0 ? 1 : 0))
                      }}
                    />
                    <button
                      className={`spin-btn auto spin-auto-image ${autoSpin ? 'active' : ''}`}
                      disabled={
                        isFreeGame ||
                        balance === 0 ||
                        balance < bet ||
                        bet < 1 ||
                        !Number.isInteger(bet) ||
                        pauseColumn !== null
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
