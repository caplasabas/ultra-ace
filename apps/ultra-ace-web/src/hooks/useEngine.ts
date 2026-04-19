import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CascadeStep,
  composeTargetedFreeSpin,
  createRNG,
  DEFAULT_ENGINE_CONFIG,
  DEFAULT_ENGINE_HAPPY_HOUR,
  hotUpdateEngine,
  spin,
  SpinOutcome,
  startEngine,
} from '@ultra-ace/engine'
import { DebugSpinInfo } from 'src/debug/DebugHud'
import {
  ensureDeviceRegistered,
  fetchPersistedDeviceRuntimeState,
  fetchDeviceLastBetAmount,
  persistDeviceLastBetAmount,
} from '../lib/device'
import type { DeviceBalanceSnapshot } from '../lib/balance'
import { fetchDeviceBalance, subscribeToDeviceBalance } from '../lib/balance'
import {
  fetchCasinoRuntimeLive,
  type JackpotDeliveryMode,
  type JackpotPayoutCurve,
  subscribeCasinoRuntimeLive,
} from '../lib/runtime'
import { commitSpinAccounting } from '../lib/accounting'
import { isShellIframe, requestShellState, subscribeShellState } from '../lib/shellBridge'
import {
  fetchLatestDeviceSessionState,
  endDeviceGameSession,
  startDeviceGameSession,
  updateDeviceGameState,
} from '../lib/deviceGameSession'
import { registerAuthenticJackpotPlan } from '../lib/jackpotPlan'
import {
  type ActiveJackpotQueue,
  fetchActiveJackpotQueue,
  finalizeDeviceJackpotPayouts,
  subscribeActiveJackpotQueue,
} from '../lib/jackpotQueue'

const BUY_FREE_SPIN_MULTIPLIER = 50
const JACKPOT_FREE_SPIN_COUNT = 10
const JACKPOT_COMPOSER_ATTEMPTS_PER_SCALE = Number(
  import.meta.env.VITE_JACKPOT_COMPOSER_ATTEMPTS_PER_SCALE ?? 18,
)
const JACKPOT_COMPOSER_MAX_ATTEMPTS = Number(
  import.meta.env.VITE_JACKPOT_COMPOSER_MAX_ATTEMPTS ?? 180,
)
const JACKPOT_COMPOSER_MIN_TOLERANCE = Number(
  import.meta.env.VITE_JACKPOT_COMPOSER_MIN_TOLERANCE ?? 10,
)
const JACKPOT_COMPOSER_MAX_TOLERANCE = Number(
  import.meta.env.VITE_JACKPOT_COMPOSER_MAX_TOLERANCE ?? 200,
)
const JACKPOT_COMPOSER_TOLERANCE_RATIO = Number(
  import.meta.env.VITE_JACKPOT_COMPOSER_TOLERANCE_RATIO ?? 0.12,
)
const JACKPOT_AUTHENTIC_PLAN_SET_ATTEMPTS = Math.max(
  1,
  Math.floor(Number(import.meta.env.VITE_JACKPOT_AUTH_PLAN_SET_ATTEMPTS ?? 180)),
)
const JACKPOT_AUTHENTIC_PLAN_TOLERANCE_RATIO = Math.max(
  0,
  Number(import.meta.env.VITE_JACKPOT_AUTH_PLAN_TOLERANCE_RATIO ?? 0.01),
)
const JACKPOT_AUTHENTIC_PLAN_MIN_TOLERANCE = Math.max(
  0,
  Number(import.meta.env.VITE_JACKPOT_AUTH_PLAN_MIN_TOLERANCE ?? 100),
)
const JACKPOT_AUTHENTIC_PLAN_MAX_TOLERANCE = Math.max(
  JACKPOT_AUTHENTIC_PLAN_MIN_TOLERANCE,
  Number(import.meta.env.VITE_JACKPOT_AUTH_PLAN_MAX_TOLERANCE ?? 500),
)
const JACKPOT_AUTHENTIC_PLAN_MIN_SCALE = Math.max(
  0.1,
  Number(import.meta.env.VITE_JACKPOT_AUTH_PLAN_MIN_SCALE ?? 0.5),
)
const JACKPOT_AUTHENTIC_PLAN_MAX_SCALE = Math.max(
  JACKPOT_AUTHENTIC_PLAN_MIN_SCALE,
  Number(import.meta.env.VITE_JACKPOT_AUTH_PLAN_MAX_SCALE ?? 1000000),
)
const JACKPOT_AUTHENTIC_POSITIVE_VARIANCE_MIN = Math.max(
  0,
  Number(import.meta.env.VITE_JACKPOT_AUTH_POS_VARIANCE_MIN ?? 0),
)
const JACKPOT_AUTHENTIC_POSITIVE_VARIANCE_MAX = Math.max(
  JACKPOT_AUTHENTIC_POSITIVE_VARIANCE_MIN,
  Number(import.meta.env.VITE_JACKPOT_AUTH_POS_VARIANCE_MAX ?? 200),
)
const JACKPOT_AUTHENTIC_POSITIVE_VARIANCE_STEP = Math.max(
  0.01,
  Number(import.meta.env.VITE_JACKPOT_AUTH_POS_VARIANCE_STEP ?? 0.1),
)
const NORMAL_WIN_CAP_REROLL_ATTEMPTS = Math.max(
  1,
  Math.floor(Number(import.meta.env.VITE_NORMAL_WIN_CAP_REROLL_ATTEMPTS ?? 64)),
)

const SCATTER_BANNER_DURATION = 5000
const FREE_SPIN_SNAPSHOT_PREFIX = 'ultraace.free-spin-state'
const FREE_SPIN_SNAPSHOT_MAX_AGE_MS = 1000 * 60 * 60 * 6
const DEVICE_STATE_HEARTBEAT_MS = 5000
const ENABLE_DEVICE_STATE_SYNC = true
const BALANCE_FALLBACK_SYNC_MS = 15000
const JACKPOT_QUEUE_POLL_FALLBACK_MS = 30000

type FreeSpinSnapshot = {
  updatedAt: number
  isFreeGame: boolean
  freeSpinsLeft: number
  pendingFreeSpins: number
  freeSpinTotal: number
  showFreeSpinIntro: boolean
  scatterTriggerType: 'natural' | 'buy' | null
}

type AuthPlanStep = {
  outcome: SpinOutcome
  expectedAmount: number
}

type AuthComposedPlan = {
  steps: AuthPlanStep[]
  total: number
  tolerance: number
  diff: number
  withinTolerance: boolean
}

type ActiveAuthPlanState = {
  queueId: number
  campaignId: string
  steps: AuthPlanStep[]
  nextIndex: number
  total: number
  tolerance: number
}

type AuthPlanVarianceComposeResult = {
  plan: AuthComposedPlan
  bonus: number
  varianceOk: boolean
}

type RuntimeSpinSnapshot = {
  mode: 'BASE' | 'HAPPY'
  config: typeof DEFAULT_ENGINE_CONFIG
  deliveryMode: JackpotDeliveryMode
  payoutCurve: JackpotPayoutCurve
  prizePoolBalance: number
  happyHourPrizeBalance: number
  baseHousePct: number
  happyHousePct: number
}

function loggableError(err: unknown) {
  if (!err || typeof err !== 'object') {
    return { message: String(err ?? 'unknown error') }
  }

  return {
    message: String((err as any).message ?? 'unknown error'),
    code: (err as any).code ?? null,
    details: (err as any).details ?? null,
    hint: (err as any).hint ?? null,
    status: (err as any).status ?? null,
    name: (err as any).name ?? null,
  }
}

function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(Math.max(0, value) * 10000) / 10000
}

function getCascadeWinTotal(cascades: CascadeStep[] | null | undefined): number {
  return roundMoney(
    (cascades ?? []).reduce((sum, step) => sum + Math.max(0, Number(step.win ?? 0)), 0),
  )
}

function getOutcomeTotalWin(outcome: Pick<SpinOutcome, 'win' | 'cascades'> | null | undefined): number {
  const outcomeWin = roundMoney(Math.max(0, Number(outcome?.win ?? 0)))
  const cascadeWin = getCascadeWinTotal(outcome?.cascades)
  return Math.max(outcomeWin, cascadeWin)
}

function isJackpotTriggerReady(queue: ActiveJackpotQueue | null | undefined): boolean {
  if (!queue) return false
  if (Number(queue.remaining_amount ?? 0) <= 0) return false
  if (Number(queue.payouts_left ?? 0) <= 0) return false
  return Number(queue.spins_until_start ?? 0) <= 0
}

function normalizeJackpotPayoutCurve(curve: string | null | undefined): JackpotPayoutCurve {
  if (curve === 'flat' || curve === 'front' || curve === 'center' || curve === 'back') {
    return curve
  }
  return 'center'
}

function jackpotCurveWeight(
  stepIndex: number,
  totalSteps: number,
  curve: JackpotPayoutCurve,
): number {
  const step = Math.max(1, Math.min(Math.floor(stepIndex), Math.max(1, Math.floor(totalSteps))))
  const total = Math.max(1, Math.floor(totalSteps))
  const center = (total + 1) / 2

  if (curve === 'front') return Math.max(total - step + 1, 0.1)
  if (curve === 'back') return Math.max(step, 0.1)
  if (curve === 'center') {
    return Math.max(((total + 1) / 2) - Math.abs(step - center) + 0.5, 0.1)
  }
  return 1
}

function buildJackpotCurveTargets(
  totalTarget: number,
  spinCount: number,
  curve: JackpotPayoutCurve,
): number[] {
  const total = roundMoney(Math.max(0, Number(totalTarget ?? 0)))
  const steps = Math.max(1, Math.floor(Number(spinCount ?? 0)))
  const weights = Array.from({ length: steps }, (_, index) =>
    jackpotCurveWeight(index + 1, steps, curve),
  )
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0)
  let allocated = 0

  return weights.map((weight, index) => {
    const isLast = index === weights.length - 1
    const amount = isLast
      ? roundMoney(Math.max(0, total - allocated))
      : roundMoney((total * weight) / Math.max(weightTotal, 0.0001))
    allocated = roundMoney(allocated + amount)
    return amount
  })
}

function generateSeed(): string {
  const buf = new Uint32Array(4)
  crypto.getRandomValues(buf)

  return [Date.now(), buf[0], buf[1], buf[2], buf[3]].join('-')
}

function normalizePersistedBetAmount(value: number, balanceCap: number): number {
  const safeValue = Math.max(1, Math.floor(Number(value || 0)))
  const cap = Math.max(0, Math.floor(Number(balanceCap || 0)))
  const limit = cap > 0 ? Math.min(safeValue, cap) : safeValue

  if (limit <= 10) return limit
  if (limit < 50) return Math.max(10, Math.floor(limit / 10) * 10)
  if (limit < 100) return 50
  if (limit < 500) return Math.max(100, Math.floor(limit / 100) * 100)
  return Math.max(500, Math.floor(limit / 500) * 500)
}

function isValidPaidSpinBet(value: number): boolean {
  return Number.isInteger(value) && value >= 1
}

export function useEngine() {
  const sessionIdRef = useRef<number | null>(null)
  const lastOutcomeRef = useRef<SpinOutcome | null>(null)
  const spinCounterRef = useRef(0)

  const rngRef = useRef<ReturnType<typeof createRNG> | null>(null)
  const seedRef = useRef<string | null>(null)

  const [deviceId, setDeviceId] = useState<string | null>(null)
  const deviceIdRef = useRef<string | null>(null)

  const [sessionReady, setSessionReady] = useState(false)
  const [runtimeMode, setRuntimeMode] = useState<'BASE' | 'HAPPY'>('BASE')
  const [activeJackpotQueue, setActiveJackpotQueue] = useState<ActiveJackpotQueue | null>(null)
  const forceJackpotScatterRef = useRef(false)
  const activeJackpotQueueIdRef = useRef<number | null>(null)
  const jackpotModeArmedRef = useRef(false)
  const jackpotFreeSpinModeRef = useRef(false)
  const jackpotDeliveryModeRef = useRef<JackpotDeliveryMode>('TARGET_FIRST')
  const activeAuthPlanRef = useRef<ActiveAuthPlanState | null>(null)

  /* -----------------------------
     Core spin state
  ----------------------------- */
  const [committedCascades, setCommittedCascades] = useState<CascadeStep[]>([])
  const [pendingCascades, setPendingCascades] = useState<CascadeStep[] | null>(null)

  const [spinning, setSpinning] = useState(false)
  const [spinId, setSpinId] = useState(0)

  /* -----------------------------
     Player economy
  ----------------------------- */
  const [bet, setBet] = useState(2)
  const [buySpinBet, setBuySpinBet] = useState(bet)

  const [authoritativeBalance, setAuthoritativeBalance] = useState(0)
  const [balance, setBalance] = useState(0)
  const balanceRef = useRef(0)

  const [totalWin, setTotalWin] = useState(0)
  const [freeSpinTotal, setFreeSpinTotal] = useState(0)

  const [scatterTriggerType, setScatterTriggerType] = useState<'natural' | 'buy' | null>(null)

  /* -----------------------------
     Free spin state
  ----------------------------- */
  const [isFreeGame, setIsFreeGame] = useState(false)
  const [freeSpinsLeft, setFreeSpinsLeft] = useState(0)
  const [pendingFreeSpins, setPendingFreeSpins] = useState(0)

  // Marks that the LAST free spin has been consumed
  const [showFreeSpinIntro, setShowFreeSpinIntro] = useState(false)
  const [showScatterWinBanner, setShowScatterWinBanner] = useState(false)
  const [restoredFreeSpinIntro, setRestoredFreeSpinIntro] = useState(false)

  const [freezeUI, setFreezeUI] = useState(false)

  const [withdrawAmount, setWithdrawAmount] = useState(20)
  const [isWithdrawing, setIsWithdrawing] = useState(false)
  const [showWithdrawModal, setShowWithdrawModal] = useState(false)
  const isOnlineRef = useRef(typeof navigator !== 'undefined' ? navigator.onLine : true)
  const maxWinEnabledRef = useRef(true)
  const currentSpinMaxWinRef = useRef<number | null>(null)
  const spinLockRef = useRef(false)
  const balanceSyncInFlightRef = useRef(false)
  const balanceSyncRequestedRef = useRef(false)
  const lastAuthoritativeUpdatedAtRef = useRef(0)
  const lastAuthoritativeRevisionRef = useRef(0)
  const lastAuthoritativeBalanceRef = useRef(0)
  const displayBalanceFrozenRef = useRef(false)
  const queuedDisplayBalanceRef = useRef<number | null>(null)
  const baseSpinVisualBalanceLockRef = useRef(false)
  const baseSpinQueuedAuthoritativeBalanceRef = useRef<number | null>(null)
  const baseSpinStartingBalanceRef = useRef(0)
  const baseSpinBetAmountRef = useRef(0)
  const baseSpinExternalDeltaRef = useRef(0)
  const baseSpinDeductedRef = useRef(false)
  const baseSpinExpectedFinalBalanceRef = useRef<number | null>(null)
  const suppressBalanceDropUntilRef = useRef(0)
  const spinSafetyTimeoutRef = useRef<number | null>(null)
  const isFreeGameRef = useRef(false)
  const freeSpinsLeftRef = useRef(0)
  const freeSpinTotalRef = useRef(0)
  const pendingFreeSpinsRef = useRef(0)
  const showFreeSpinIntroRef = useRef(false)
  const spinVisualTargetWinRef = useRef<number | null>(null)
  const spinVisualCommittedWinRef = useRef(0)

  const snapshotKeyRef = useRef<string | null>(null)
  const shellBalanceRevisionRef = useRef(0)

  function clearFreeSpinSnapshot() {
    if (typeof window === 'undefined') return
    if (!snapshotKeyRef.current) return
    window.localStorage.removeItem(snapshotKeyRef.current)
  }

  function persistFreeSpinSnapshot(next: FreeSpinSnapshot) {
    if (typeof window === 'undefined') return
    if (!snapshotKeyRef.current) return
    const hasActiveState =
      next.isFreeGame ||
      next.pendingFreeSpins > 0 ||
      next.freeSpinsLeft > 0 ||
      next.showFreeSpinIntro ||
      next.freeSpinTotal > 0

    if (!hasActiveState) {
      clearFreeSpinSnapshot()
      return
    }

    window.localStorage.setItem(snapshotKeyRef.current, JSON.stringify(next))
  }

  const setDisplayedBalance = useCallback((nextBalance: number) => {
    balanceRef.current = nextBalance
    setBalance(current => (current === nextBalance ? current : nextBalance))
  }, [])

  const syncBaseSpinDisplayedBalance = useCallback(() => {
    if (!baseSpinVisualBalanceLockRef.current) return

    const visualBalance =
      baseSpinStartingBalanceRef.current -
      (baseSpinDeductedRef.current ? baseSpinBetAmountRef.current : 0) +
      spinVisualCommittedWinRef.current +
      baseSpinExternalDeltaRef.current

    setDisplayedBalance(roundMoney(Math.max(0, visualBalance)))
  }, [setDisplayedBalance])

  const freezeDisplayedBalance = useCallback(() => {
    displayBalanceFrozenRef.current = true
  }, [])

  const releaseDisplayedBalance = useCallback(() => {
    if (!displayBalanceFrozenRef.current) return
    displayBalanceFrozenRef.current = false
    const latest = queuedDisplayBalanceRef.current ?? lastAuthoritativeBalanceRef.current
    queuedDisplayBalanceRef.current = null
    setDisplayedBalance(latest)
  }, [setDisplayedBalance])

  const applyAuthoritativeBalance = useCallback(
    (snapshot: DeviceBalanceSnapshot) => {
      const nextBalance = Number(snapshot.balance ?? 0)
      if (!Number.isFinite(nextBalance)) return

      const updatedAtMs = snapshot.updatedAt ? Date.parse(snapshot.updatedAt) : NaN
      const nextRevision = Number(snapshot.revision ?? 0)
      const normalizedRevision = Number.isFinite(nextRevision) ? nextRevision : 0

      // Accounting counters are monotonic; treat them as the primary ordering signal.
      // `devices.updated_at` also changes for session heartbeats and other non-balance writes.
      if (normalizedRevision < lastAuthoritativeRevisionRef.current) {
        return
      }
      if (
        normalizedRevision === lastAuthoritativeRevisionRef.current &&
        Number.isFinite(updatedAtMs) &&
        updatedAtMs < lastAuthoritativeUpdatedAtRef.current
      ) {
        return
      }

      if (Number.isFinite(updatedAtMs)) {
        lastAuthoritativeUpdatedAtRef.current = updatedAtMs
      }
      lastAuthoritativeRevisionRef.current = normalizedRevision
      lastAuthoritativeBalanceRef.current = nextBalance
      setAuthoritativeBalance(current => (current === nextBalance ? current : nextBalance))
      if (baseSpinVisualBalanceLockRef.current) {
        baseSpinQueuedAuthoritativeBalanceRef.current = nextBalance
        const expectedFinalBalance = baseSpinExpectedFinalBalanceRef.current
        if (expectedFinalBalance !== null) {
          const externalDelta = Math.max(0, roundMoney(nextBalance - expectedFinalBalance))
          if (externalDelta !== baseSpinExternalDeltaRef.current) {
            baseSpinExternalDeltaRef.current = externalDelta
            syncBaseSpinDisplayedBalance()
          }
        }
        return
      }
      if (displayBalanceFrozenRef.current) {
        queuedDisplayBalanceRef.current = nextBalance
        // Keep external balance additions visible immediately even while free-spin/buy flows
        // are freezing normal spin-related balance transitions.
        if (nextBalance > balanceRef.current) {
          setDisplayedBalance(nextBalance)
        }
        return
      }
      setBalance(current => {
        if (
          Date.now() < suppressBalanceDropUntilRef.current &&
          nextBalance < current &&
          !displayBalanceFrozenRef.current
        ) {
          return current
        }
        balanceRef.current = nextBalance
        return current === nextBalance ? current : nextBalance
      })
    },
    [setDisplayedBalance, syncBaseSpinDisplayedBalance],
  )

  const applyShellBalance = useCallback(
    (nextBalance: number, updatedAt?: string | null) => {
      shellBalanceRevisionRef.current += 1
      applyAuthoritativeBalance({
        balance: Math.max(0, Number(nextBalance ?? 0)),
        updatedAt: updatedAt ?? new Date().toISOString(),
        revision: shellBalanceRevisionRef.current,
      })
    },
    [applyAuthoritativeBalance],
  )

  const syncBalanceFromDb = useCallback(async () => {
    const id = deviceIdRef.current
    if (!id) return
    if (isShellIframe()) {
      return
    }
    if (balanceSyncInFlightRef.current) {
      balanceSyncRequestedRef.current = true
      return
    }

    balanceSyncInFlightRef.current = true
    try {
      const snapshot = await fetchDeviceBalance(id)
      applyAuthoritativeBalance(snapshot)
    } catch (error) {
      console.error('[engine] authoritative balance sync failed', error)
    } finally {
      balanceSyncInFlightRef.current = false
      if (balanceSyncRequestedRef.current) {
        balanceSyncRequestedRef.current = false
        window.setTimeout(() => {
          void syncBalanceFromDb()
        }, 0)
      }
    }
  }, [applyAuthoritativeBalance, applyShellBalance])

  /* -----------------------------
     Debug
  ----------------------------- */
  const [debugInfo, setDebugInfo] = useState<DebugSpinInfo | undefined>()

  useEffect(() => {
    let mounted = true

    let unsubscribe: (() => void) | null = null
    let runtimeChannel: { unsubscribe: () => void } | null = null
    let jackpotQueueChannel: { unsubscribe: () => void } | null = null
    let balancePollTimer: number | null = null
    let jackpotQueuePollTimer: number | null = null

    startEngine({
      config: DEFAULT_ENGINE_CONFIG,
      version: 'ui-local-default',
    })

    const applyRuntimeMode = (runtime: {
      active_mode: 'BASE' | 'HAPPY'
      max_win_enabled?: boolean
      jackpot_delivery_mode?: JackpotDeliveryMode
    }) => {
      const mode = runtime.active_mode === 'HAPPY' ? 'HAPPY' : 'BASE'
      const nextConfig = mode === 'HAPPY' ? DEFAULT_ENGINE_HAPPY_HOUR : DEFAULT_ENGINE_CONFIG
      maxWinEnabledRef.current = runtime.max_win_enabled ?? true
      jackpotDeliveryModeRef.current = runtime.jackpot_delivery_mode ?? 'TARGET_FIRST'

      hotUpdateEngine({
        config: nextConfig,
        version: `runtime-${mode}-${Date.now()}`,
      })
      setRuntimeMode(mode)
    }

    async function init() {
      if (!mounted) return
      const id = await ensureDeviceRegistered()
      setDeviceId(id)
      snapshotKeyRef.current = `${FREE_SPIN_SNAPSHOT_PREFIX}:${id}`

      let restoredDbState:
        | {
            runtimeMode: 'BASE' | 'HAPPY'
            isFreeGame: boolean
            freeSpinsLeft: number
            pendingFreeSpins: number
            showFreeSpinIntro: boolean
            spinId: number
            spinning: boolean
            scatterTriggerType: 'natural' | 'buy' | null
          }
        | null = null

      try {
        const [deviceState, sessionState] = await Promise.all([
          fetchPersistedDeviceRuntimeState(id),
          fetchLatestDeviceSessionState(id),
        ])

        if (deviceState) {
          restoredDbState = {
            runtimeMode:
              sessionState?.runtimeMode === 'HAPPY' || deviceState.runtimeMode === 'HAPPY'
                ? 'HAPPY'
                : 'BASE',
            isFreeGame: deviceState.isFreeGame && deviceState.freeSpinsLeft > 0,
            freeSpinsLeft: deviceState.freeSpinsLeft,
            pendingFreeSpins: deviceState.pendingFreeSpins,
            showFreeSpinIntro: deviceState.showFreeSpinIntro,
            spinId: Math.max(deviceState.spinId, Number(sessionState?.spinId ?? 0)),
            spinning: Boolean(sessionState?.spinning),
            scatterTriggerType: sessionState?.scatterTriggerType ?? null,
          }
        }
      } catch (error) {
        console.error('[engine] persisted DB state load failed', loggableError(error))
      }

      const seed = `${id}:${generateSeed()}`
      seedRef.current = seed
      rngRef.current = createRNG(seed)

      try {
        const sessionId = await startDeviceGameSession({
          deviceId: id,
          gameId: 'ultra-ace',
          gameName: 'Ultra Ace',
          runtimeMode: restoredDbState?.runtimeMode ?? 'BASE',
          state: {
            runtimeMode: restoredDbState?.runtimeMode ?? 'BASE',
            isFreeGame: restoredDbState?.isFreeGame ?? false,
            freeSpinsLeft: restoredDbState?.freeSpinsLeft ?? 0,
            pendingFreeSpins: restoredDbState?.pendingFreeSpins ?? 0,
            showFreeSpinIntro: restoredDbState?.showFreeSpinIntro ?? false,
            spinId: restoredDbState?.spinId ?? 0,
            spinning: false,
            scatterTriggerType: restoredDbState?.scatterTriggerType ?? null,
          },
        })
        sessionIdRef.current = sessionId
      } catch (err) {
        console.error('[device-session] start failed', err)
      }

      const [initialBalance, persistedBet] = await Promise.all([
        isShellIframe()
          ? requestShellState().then(state => {
              return {
                balance: Math.max(0, Number(state?.balance ?? 0)),
                updatedAt: state?.updatedAt ?? new Date().toISOString(),
                revision: ++shellBalanceRevisionRef.current,
              } as DeviceBalanceSnapshot
            })
          : fetchDeviceBalance(id).catch(error => {
              console.error(
                '[engine] initial balance fetch failed, using fallback snapshot',
                loggableError(error),
              )
              return {
                balance: 0,
                updatedAt: null,
                revision: 0,
              } as DeviceBalanceSnapshot
            }),
        fetchDeviceLastBetAmount(id).catch(error => {
          console.error('[engine] last bet fetch failed', loggableError(error))
          return null
        }),
      ])
      applyAuthoritativeBalance(initialBalance)
      if (persistedBet && persistedBet > 0) {
        const normalizedBet = normalizePersistedBetAmount(persistedBet, initialBalance.balance)
        const balanceCap = Math.max(0, Number(initialBalance.balance ?? 0))
        const startupBet = balanceCap > 0 ? Math.min(normalizedBet, balanceCap) : normalizedBet
        setBet(startupBet)
        setBuySpinBet(startupBet)
      }
      const loadActiveJackpotQueue = async () => {
        try {
          const next = await fetchActiveJackpotQueue(id)
          if (mounted) setActiveJackpotQueue(next)
        } catch (error) {
          console.error('[engine] active jackpot queue load failed', loggableError(error))
        }
      }
      await loadActiveJackpotQueue()

      if (typeof window !== 'undefined' && snapshotKeyRef.current) {
        try {
          const raw = window.localStorage.getItem(snapshotKeyRef.current)
          if (raw) {
            const parsed = JSON.parse(raw) as FreeSpinSnapshot
            const age = Date.now() - Number(parsed.updatedAt ?? 0)
            if (age >= 0 && age <= FREE_SPIN_SNAPSHOT_MAX_AGE_MS) {
              const restoredFreeSpinsLeft = Math.max(0, Math.floor(parsed.freeSpinsLeft ?? 0))
              const restoredPendingFreeSpins = Math.max(0, Math.floor(parsed.pendingFreeSpins ?? 0))
              const restoredIsFreeGame = Boolean(parsed.isFreeGame) && restoredFreeSpinsLeft > 0
              const restoredShowIntro =
                !restoredIsFreeGame &&
                restoredPendingFreeSpins > 0 &&
                Boolean(parsed.showFreeSpinIntro)

              // Resume an already-active free-spin session exactly where it left off.
              // Only use the intro flow when the award was still pending and free spins
              // had not actually started yet.
              isFreeGameRef.current = restoredIsFreeGame
              freeSpinsLeftRef.current = restoredFreeSpinsLeft
              pendingFreeSpinsRef.current = restoredPendingFreeSpins
              showFreeSpinIntroRef.current = restoredShowIntro
              freeSpinTotalRef.current = Math.max(0, Number(parsed.freeSpinTotal ?? 0))

              setIsFreeGame(restoredIsFreeGame)
              setFreeSpinsLeft(restoredIsFreeGame ? restoredFreeSpinsLeft : 0)
              setPendingFreeSpins(restoredIsFreeGame ? 0 : restoredPendingFreeSpins)
              setFreeSpinTotal(Math.max(0, Number(parsed.freeSpinTotal ?? 0)))
              setShowFreeSpinIntro(restoredShowIntro)
              setRestoredFreeSpinIntro(restoredShowIntro)
              setScatterTriggerType(parsed.scatterTriggerType ?? null)
            } else {
              window.localStorage.removeItem(snapshotKeyRef.current)
            }
          }
        } catch {
          window.localStorage.removeItem(snapshotKeyRef.current)
        }
      }

      if (restoredDbState) {
        isFreeGameRef.current = restoredDbState.isFreeGame
        freeSpinsLeftRef.current = restoredDbState.isFreeGame ? restoredDbState.freeSpinsLeft : 0
        pendingFreeSpinsRef.current = restoredDbState.isFreeGame ? 0 : restoredDbState.pendingFreeSpins
        showFreeSpinIntroRef.current =
          !restoredDbState.isFreeGame && restoredDbState.showFreeSpinIntro

        setIsFreeGame(restoredDbState.isFreeGame)
        setFreeSpinsLeft(restoredDbState.isFreeGame ? restoredDbState.freeSpinsLeft : 0)
        setPendingFreeSpins(restoredDbState.isFreeGame ? 0 : restoredDbState.pendingFreeSpins)
        setShowFreeSpinIntro(
          !restoredDbState.isFreeGame && restoredDbState.showFreeSpinIntro,
        )
        setRestoredFreeSpinIntro(
          !restoredDbState.isFreeGame && restoredDbState.showFreeSpinIntro,
        )
        setScatterTriggerType(restoredDbState.scatterTriggerType ?? null)
        setSpinId(restoredDbState.spinId)
      }

      unsubscribe = isShellIframe()
        ? subscribeShellState(state => {
            applyShellBalance(state.balance, state.updatedAt ?? null)
          })
        : subscribeToDeviceBalance(id, _snapshot => {
            applyAuthoritativeBalance(_snapshot)
          })
      jackpotQueueChannel = subscribeActiveJackpotQueue(id, next => {
        setActiveJackpotQueue(next)
      })

      balancePollTimer = window.setInterval(() => {
        void syncBalanceFromDb()
      }, BALANCE_FALLBACK_SYNC_MS)
      jackpotQueuePollTimer = window.setInterval(() => {
        void loadActiveJackpotQueue()
      }, JACKPOT_QUEUE_POLL_FALLBACK_MS)

      setSessionReady(true)

      try {
        const runtime = await fetchCasinoRuntimeLive()
        if (mounted) {
          applyRuntimeMode(runtime)
        }
      } catch (err) {
        console.error('[runtime] initial load failed', err)
      }

      runtimeChannel = subscribeCasinoRuntimeLive(next => {
        applyRuntimeMode(next)
      })
    }

    init().catch(err => {
      console.error('Boot failed', loggableError(err))
    })

    return () => {
      mounted = false
      if (unsubscribe) unsubscribe()
      if (runtimeChannel) runtimeChannel.unsubscribe()
      if (jackpotQueueChannel) jackpotQueueChannel.unsubscribe()
      if (balancePollTimer !== null) clearInterval(balancePollTimer)
      if (jackpotQueuePollTimer !== null) clearInterval(jackpotQueuePollTimer)
      if (deviceIdRef.current) {
        void endDeviceGameSession({
          deviceId: deviceIdRef.current,
          sessionId: sessionIdRef.current,
          reason: 'unmount',
        }).catch(err => {
          console.error('[device-session] end on unmount failed', err)
        })
      }
    }
  }, [applyAuthoritativeBalance, applyShellBalance])

  useEffect(() => {
    if (!ENABLE_DEVICE_STATE_SYNC) return
    if (!sessionReady || !deviceId) return

    const heartbeatTimer = window.setInterval(() => {
      const statePayload = {
        runtimeMode,
        isFreeGame,
        freeSpinsLeft,
        pendingFreeSpins,
        showFreeSpinIntro,
        spinId,
        spinning,
        scatterTriggerType,
      } as const

      void updateDeviceGameState({
        deviceId,
        sessionId: sessionIdRef.current,
        state: statePayload,
      }).catch(err => {
        console.error('[device-session] heartbeat failed', err)
      })
    }, DEVICE_STATE_HEARTBEAT_MS)

    return () => clearInterval(heartbeatTimer)
  }, [
    sessionReady,
    deviceId,
    runtimeMode,
    isFreeGame,
    freeSpinsLeft,
    pendingFreeSpins,
    showFreeSpinIntro,
    spinId,
    spinning,
    scatterTriggerType,
  ])

  useEffect(() => {
    if (!deviceId) return

    const end = () => {
      void endDeviceGameSession({
        deviceId,
        sessionId: sessionIdRef.current,
        reason: 'pagehide',
      }).catch(err => {
        console.error('[device-session] end on pagehide failed', err)
      })
    }

    window.addEventListener('pagehide', end)
    window.addEventListener('beforeunload', end)

    return () => {
      window.removeEventListener('pagehide', end)
      window.removeEventListener('beforeunload', end)
    }
  }, [deviceId])

  useEffect(() => {
    if (!ENABLE_DEVICE_STATE_SYNC) return
    if (!sessionReady || !deviceId) return

    const statePayload = {
      runtimeMode,
      isFreeGame,
      freeSpinsLeft,
      pendingFreeSpins,
      showFreeSpinIntro,
      spinId,
      spinning,
      scatterTriggerType,
    } as const

    void updateDeviceGameState({
      deviceId,
      sessionId: sessionIdRef.current,
      state: statePayload,
    }).catch(err => {
      console.error('[device-session] immediate state sync failed', err)
    })
  }, [
    sessionReady,
    deviceId,
    runtimeMode,
    isFreeGame,
    freeSpinsLeft,
    pendingFreeSpins,
    showFreeSpinIntro,
    spinId,
    spinning,
    scatterTriggerType,
  ])

  async function refreshRuntimeMode(): Promise<RuntimeSpinSnapshot> {
    try {
      const runtime = await fetchCasinoRuntimeLive()
      const mode = runtime.active_mode === 'HAPPY' ? 'HAPPY' : 'BASE'
      const nextConfig = mode === 'HAPPY' ? DEFAULT_ENGINE_HAPPY_HOUR : DEFAULT_ENGINE_CONFIG
      maxWinEnabledRef.current = runtime.max_win_enabled ?? true
      const deliveryMode = runtime.jackpot_delivery_mode ?? 'TARGET_FIRST'
      const payoutCurve = normalizeJackpotPayoutCurve(runtime.jackpot_payout_curve)
      jackpotDeliveryModeRef.current = deliveryMode
      hotUpdateEngine({
        config: nextConfig,
        version: `runtime-pre-spin-${mode}-${Date.now()}`,
      })
      setRuntimeMode(mode)
      return {
        mode,
        config: nextConfig,
        deliveryMode,
        payoutCurve,
        prizePoolBalance: Math.max(0, Number(runtime.prize_pool_balance ?? 0)),
        happyHourPrizeBalance: Math.max(0, Number(runtime.happy_hour_prize_balance ?? 0)),
        baseHousePct: Math.min(100, Math.max(0, Number(runtime.base_house_pct ?? 0))),
        happyHousePct: Math.min(100, Math.max(0, Number(runtime.happy_house_pct ?? 0))),
      } satisfies RuntimeSpinSnapshot
    } catch (err) {
      console.error('[runtime] pre-spin refresh failed', err)
      const mode = runtimeMode === 'HAPPY' ? 'HAPPY' : 'BASE'
      const fallbackConfig = mode === 'HAPPY' ? DEFAULT_ENGINE_HAPPY_HOUR : DEFAULT_ENGINE_CONFIG
      return {
        mode,
        config: fallbackConfig,
        deliveryMode: jackpotDeliveryModeRef.current,
        payoutCurve: 'center',
        prizePoolBalance: 0,
        happyHourPrizeBalance: 0,
        baseHousePct: 20,
        happyHousePct: 20,
      }
    }
  }

  function getMaxWinCapForBet(lastBetAmount: number): number | null {
    if (!maxWinEnabledRef.current) return null
    const betAmount = Math.max(0, Number(lastBetAmount || 0))
    if (betAmount <= 0) return null
    let multiplier = 700
    if (betAmount < 20) multiplier = 3000
    else if (betAmount < 100) multiplier = 2500
    else if (betAmount < 200) multiplier = 2000
    else if (betAmount < 300) multiplier = 1500
    else if (betAmount < 500) multiplier = 1000
    return betAmount * multiplier
  }

  function clampToCurrentSpinMax(nextValue: number): number {
    const cap = currentSpinMaxWinRef.current
    if (cap === null) return nextValue
    return Math.min(nextValue, cap)
  }

  function getFundableNormalWinCap(
    runtimeSnapshot: RuntimeSpinSnapshot,
    betAmount: number,
  ): number | null {
    const normalizedBet = roundMoney(Math.max(0, Number(betAmount ?? 0)))
    const reserveBalance =
      runtimeSnapshot.mode === 'HAPPY'
        ? Math.max(0, Number(runtimeSnapshot.happyHourPrizeBalance ?? 0))
        : Math.max(0, Number(runtimeSnapshot.prizePoolBalance ?? 0))
    const housePct =
      runtimeSnapshot.mode === 'HAPPY'
        ? Math.min(100, Math.max(0, Number(runtimeSnapshot.happyHousePct ?? 0)))
        : Math.min(100, Math.max(0, Number(runtimeSnapshot.baseHousePct ?? 0)))
    const postHouseBudget =
      runtimeSnapshot.mode === 'HAPPY'
        ? 0
        : roundMoney(Math.max(0, normalizedBet - normalizedBet * (housePct / 100)))
    return roundMoney(clampToCurrentSpinMax(Math.max(0, reserveBalance + postHouseBudget)))
  }

  function selectNormalOutcomeWithinCap({
    initialOutcome,
    winCap,
    rng,
    spinInput,
  }: {
    initialOutcome: SpinOutcome
    winCap: number | null
    rng: ReturnType<typeof createRNG>
    spinInput: Parameters<typeof spin>[1]
  }): { outcome: SpinOutcome; rerolled: boolean; attemptCount: number } {
    if (winCap === null) {
      return { outcome: initialOutcome, rerolled: false, attemptCount: 1 }
    }

    const cap = roundMoney(Math.max(0, Number(winCap ?? 0)))
    const normalizeWin = (outcome: SpinOutcome) => getOutcomeTotalWin(outcome)
    const isWithinCap = (outcome: SpinOutcome) => normalizeWin(outcome) <= cap + 0.0001
    const scoreOutcome = (outcome: SpinOutcome) =>
      normalizeWin(outcome) * 1000 + getOutcomeExcitement(outcome)

    if (isWithinCap(initialOutcome)) {
      return { outcome: initialOutcome, rerolled: false, attemptCount: 1 }
    }

    let bestOutcome: SpinOutcome | null = null
    let bestScore = Number.NEGATIVE_INFINITY
    let attemptCount = 1

    for (let attempt = 0; attempt < NORMAL_WIN_CAP_REROLL_ATTEMPTS; attempt++) {
      const candidate = spin(rng, spinInput)
      attemptCount += 1

      if (!isWithinCap(candidate)) {
        continue
      }

      const candidateScore = scoreOutcome(candidate)
      if (!bestOutcome || candidateScore > bestScore + 0.0001) {
        bestOutcome = candidate
        bestScore = candidateScore
      }

      if (normalizeWin(candidate) >= cap - 0.0001) {
        break
      }
    }

    if (bestOutcome) {
      return {
        outcome: bestOutcome,
        rerolled: true,
        attemptCount,
      }
    }

    return {
      outcome: zeroOutcome(initialOutcome),
      rerolled: true,
      attemptCount,
    }
  }

  function selectZeroWinOutcome({
    initialOutcome,
    rng,
    spinInput,
  }: {
    initialOutcome: SpinOutcome
    rng: ReturnType<typeof createRNG>
    spinInput: Parameters<typeof spin>[1]
  }): SpinOutcome {
    const normalizeWin = (outcome: SpinOutcome) => getOutcomeTotalWin(outcome)

    if (normalizeWin(initialOutcome) <= 0.0001) {
      return zeroOutcome(initialOutcome)
    }

    for (let attempt = 0; attempt < NORMAL_WIN_CAP_REROLL_ATTEMPTS; attempt++) {
      const candidate = spin(rng, spinInput)
      if (normalizeWin(candidate) <= 0.0001) {
        return zeroOutcome(candidate)
      }
    }

    return zeroOutcome(initialOutcome)
  }

  function selectNormalDisplayOutcomeForTarget({
    initialOutcome,
    targetWin,
    spinInput,
    seed,
  }: {
    initialOutcome: SpinOutcome
    targetWin: number
    spinInput: Parameters<typeof spin>[1]
    seed: string
  }): SpinOutcome {
    const target = roundMoney(Math.max(0, Number(targetWin ?? 0)))
    const normalizeWin = (outcome: SpinOutcome) => getOutcomeTotalWin(outcome)

    if (target <= 0.0001) {
      if (normalizeWin(initialOutcome) <= 0.0001) {
        return zeroOutcome(initialOutcome)
      }

      const zeroRng = createRNG(`${seed}:zero`)
      return selectZeroWinOutcome({
        initialOutcome,
        rng: zeroRng,
        spinInput,
      })
    }

    const tolerance = Math.max(0.1, Math.min(2, target * 0.05))
    const scoringRng = createRNG(`${seed}:display`)
    let bestUnderTarget: SpinOutcome | null = null
    let bestUnderDiff = Number.POSITIVE_INFINITY
    let bestUnderExcitement = Number.NEGATIVE_INFINITY
    let bestAnyOutcome = initialOutcome
    let bestAnyDiff = Math.abs(normalizeWin(initialOutcome) - target)
    let bestAnyExcitement = getOutcomeExcitement(initialOutcome)

    const considerCandidate = (candidate: SpinOutcome) => {
      const candidateWin = normalizeWin(candidate)
      const diff = Math.abs(candidateWin - target)
      const excitement = getOutcomeExcitement(candidate)
      const isUnderTarget = candidateWin <= target + 0.0001

      if (
        diff < bestAnyDiff - 0.0001 ||
        (Math.abs(diff - bestAnyDiff) <= 0.0001 && excitement > bestAnyExcitement + 0.0001)
      ) {
        bestAnyOutcome = candidate
        bestAnyDiff = diff
        bestAnyExcitement = excitement
      }

      if (!isUnderTarget) return

      if (
        diff < bestUnderDiff - 0.0001 ||
        (Math.abs(diff - bestUnderDiff) <= 0.0001 && excitement > bestUnderExcitement + 0.0001)
      ) {
        bestUnderTarget = candidate
        bestUnderDiff = diff
        bestUnderExcitement = excitement
      }
    }

    considerCandidate(initialOutcome)

    for (let attempt = 0; attempt < NORMAL_WIN_CAP_REROLL_ATTEMPTS; attempt++) {
      const candidate = spin(scoringRng, spinInput)
      considerCandidate(candidate)

      if (bestUnderTarget && bestUnderDiff <= tolerance) {
        return bestUnderTarget
      }
    }

    if (bestUnderTarget) {
      return bestUnderTarget
    }

    if (bestAnyDiff <= tolerance && normalizeWin(bestAnyOutcome) <= target + 0.0001) {
      return bestAnyOutcome
    }

    return selectZeroWinOutcome({
      initialOutcome: bestAnyOutcome,
      rng: createRNG(`${seed}:fallback-zero`),
      spinInput,
    })
  }

  function selectAuthenticJackpotDisplayOutcomeForTarget({
    initialOutcome,
    targetWin,
    betPerSpin,
    freeSpinSource,
    seed,
  }: {
    initialOutcome: SpinOutcome
    targetWin: number
    betPerSpin: number
    freeSpinSource: 'natural' | 'buy'
    seed: string
  }): SpinOutcome {
    const target = roundMoney(Math.max(0, Number(targetWin ?? 0)))
    if (target <= 0.0001) {
      return zeroOutcome(initialOutcome)
    }

    const composed = composeTargetedFreeSpin(createRNG(`${seed}:auth-display`), {
      betPerSpin,
      lines: 5,
      targetWin: target,
      tolerance: getJackpotSpinTolerance(target),
      freeSpinSource,
      attemptsPerScale: JACKPOT_COMPOSER_ATTEMPTS_PER_SCALE,
      maxTotalAttempts: JACKPOT_COMPOSER_MAX_ATTEMPTS,
    })

    if (composed.outcome) {
      return composed.outcome
    }

    return initialOutcome
  }

  function getJackpotSpinTolerance(targetWin: number): number {
    const normalized = Math.max(0, Number(targetWin ?? 0))
    if (normalized <= 0) return 0
    const ratioTolerance = normalized * Math.max(0, JACKPOT_COMPOSER_TOLERANCE_RATIO)
    const floor = Math.max(0, JACKPOT_COMPOSER_MIN_TOLERANCE)
    const ceil = Math.max(floor, JACKPOT_COMPOSER_MAX_TOLERANCE)
    return Math.min(ceil, Math.max(floor, ratioTolerance))
  }

  function getJackpotPlanTolerance(targetWin: number): number {
    const normalized = Math.max(0, Number(targetWin ?? 0))
    if (normalized <= 0) return 0
    const ratioTolerance = normalized * JACKPOT_AUTHENTIC_PLAN_TOLERANCE_RATIO
    return Math.min(
      JACKPOT_AUTHENTIC_PLAN_MAX_TOLERANCE,
      Math.max(JACKPOT_AUTHENTIC_PLAN_MIN_TOLERANCE, ratioTolerance),
    )
  }

  function getOutcomeExcitement(outcome: SpinOutcome): number {
    const cascades = outcome.cascades ?? []
    const paidCascades = cascades.filter(step => Number(step.win ?? 0) > 0.0001)
    const paidCascadeDepth = paidCascades.length
    const maxMultiplier = cascades.reduce(
      (max, step) => Math.max(max, Number.isFinite(step.multiplier) ? Number(step.multiplier) : 1),
      1,
    )
    const maxCascadeWin = cascades.reduce((max, step) => Math.max(max, Number(step.win ?? 0)), 0)
    const scatterPresence = (outcome.scatterCount ?? 0) >= 2 ? 1 : 0
    return (
      paidCascadeDepth * 6 +
      Math.max(0, maxMultiplier - 1) * 2.5 +
      Math.log10(Math.max(1, maxCascadeWin) + 1) * 8 +
      scatterPresence * 2
    )
  }

  function composeAuthenticPlanSet({
    seed,
    targetWin,
    spinCount,
    betPerSpin,
    freeSpinSource,
    payoutCurve,
  }: {
    seed: string
    targetWin: number
    spinCount: number
    betPerSpin: number
    freeSpinSource: 'natural' | 'buy'
    payoutCurve: JackpotPayoutCurve
  }): AuthComposedPlan {
    const target = roundMoney(Math.max(0, Number(targetWin ?? 0)))
    const stepsToCompose = Math.max(1, Math.floor(Number(spinCount ?? 0)))
    const tolerance = getJackpotPlanTolerance(target)
    const curveTargets = buildJackpotCurveTargets(target, stepsToCompose, payoutCurve)
    let bestPlan: AuthComposedPlan | null = null
    let bestScore = Number.POSITIVE_INFINITY
    let bestExcitement = Number.NEGATIVE_INFINITY

    for (let attempt = 0; attempt < JACKPOT_AUTHENTIC_PLAN_SET_ATTEMPTS; attempt++) {
      const attemptRng = createRNG(`${seed}:set:${attempt + 1}`)
      const steps: AuthPlanStep[] = []
      let total = 0
      let planExcitement = 0
      let spinsWithMultiCascade = 0

      for (let stepIndex = 0; stepIndex < stepsToCompose; stepIndex++) {
        const targetAmount = curveTargets[stepIndex] ?? 0
        const composed = composeTargetedFreeSpin(attemptRng, {
          betPerSpin: Math.min(
            JACKPOT_AUTHENTIC_PLAN_MAX_SCALE,
            Math.max(JACKPOT_AUTHENTIC_PLAN_MIN_SCALE, Number(betPerSpin ?? 0.01)),
          ),
          lines: 5,
          targetWin: targetAmount,
          tolerance: getJackpotSpinTolerance(targetAmount),
          freeSpinSource,
          attemptsPerScale: JACKPOT_COMPOSER_ATTEMPTS_PER_SCALE,
          maxTotalAttempts: JACKPOT_COMPOSER_MAX_ATTEMPTS,
        })
        const outcome = composed.outcome
        const expectedAmount = roundMoney(getOutcomeTotalWin(outcome))
        const paidCascades = (outcome.cascades ?? []).filter(step => Number(step.win ?? 0) > 0.0001)
        if (paidCascades.length >= 2) {
          spinsWithMultiCascade += 1
        }
        planExcitement += getOutcomeExcitement(outcome)

        steps.push({
          outcome,
          expectedAmount,
        })
        total = roundMoney(total + expectedAmount)
      }

      const diff = roundMoney(Math.abs(target - total))
      const withinTolerance = diff <= tolerance + 0.0001
      const dynamicsTarget = Math.min(3, Math.max(1, Math.floor(stepsToCompose / 3)))
      const hasEnoughDynamics = spinsWithMultiCascade >= dynamicsTarget
      const overshoot = Math.max(0, total - target)
      const score = diff + overshoot * 6
      const candidate: AuthComposedPlan = {
        steps,
        total,
        tolerance,
        diff,
        withinTolerance,
      }

      if (
        !bestPlan ||
        score < bestScore - 0.0001 ||
        (Math.abs(score - bestScore) <= 0.0001 && planExcitement > bestExcitement + 0.0001)
      ) {
        bestPlan = candidate
        bestScore = score
        bestExcitement = planExcitement
      }

      if (withinTolerance && hasEnoughDynamics) {
        return candidate
      }
    }

    if (bestPlan) return bestPlan

    return {
      steps: [],
      total: 0,
      tolerance,
      diff: target,
      withinTolerance: false,
    }
  }

  function roundToStep(value: number, step: number): number {
    if (!Number.isFinite(value)) return 0
    const safeStep = Math.max(0.0001, step)
    return roundMoney(Math.round(value / safeStep) * safeStep)
  }

  function composeAuthenticPlanWithVariance({
    baseTarget,
    composeSeed,
    spinCount,
    betPerSpin,
    freeSpinSource,
    payoutCurve,
  }: {
    baseTarget: number
    composeSeed: string
    spinCount: number
    betPerSpin: number
    freeSpinSource: 'natural' | 'buy'
    payoutCurve: JackpotPayoutCurve
  }): AuthPlanVarianceComposeResult {
    const normalizedBaseTarget = roundMoney(Math.max(0, Number(baseTarget ?? 0)))
    const maxBonus = Math.max(0, JACKPOT_AUTHENTIC_POSITIVE_VARIANCE_MAX)
    const minBonus = Math.min(maxBonus, Math.max(0, JACKPOT_AUTHENTIC_POSITIVE_VARIANCE_MIN))
    const step = Math.max(0.0001, JACKPOT_AUTHENTIC_POSITIVE_VARIANCE_STEP)
    const rng = createRNG(`${composeSeed}:variance`)

    let best: AuthPlanVarianceComposeResult | null = null
    let bestPenalty = Number.POSITIVE_INFINITY

    for (let i = 0; i < 12; i++) {
      const rawBonus = minBonus + (maxBonus - minBonus) * rng()
      const bonus = -roundToStep(rawBonus, step)
      const adjustedTarget = roundMoney(normalizedBaseTarget + bonus)
      const candidate = composeAuthenticPlanSet({
        seed: `${composeSeed}:candidate:${i + 1}`,
        targetWin: adjustedTarget,
        spinCount,
        betPerSpin,
        freeSpinSource,
        payoutCurve,
      })
      const total = roundMoney(candidate.total)
      const varianceOk =
        total >= normalizedBaseTarget - maxBonus - 0.0001 && total <= normalizedBaseTarget + 0.0001
      const penalty = varianceOk
        ? candidate.diff
        : Math.max(0, (normalizedBaseTarget - maxBonus) - total) +
          Math.max(0, total - normalizedBaseTarget) * 5 +
          candidate.diff

      if (!best || penalty < bestPenalty) {
        best = {
          plan: candidate,
          bonus,
          varianceOk,
        }
        bestPenalty = penalty
      }

      if (varianceOk && candidate.withinTolerance) {
        return {
          plan: candidate,
          bonus,
          varianceOk: true,
        }
      }
    }

    if (best) return best

    return {
      plan: composeAuthenticPlanSet({
        seed: `${composeSeed}:fallback`,
        targetWin: normalizedBaseTarget,
        spinCount,
        betPerSpin,
        freeSpinSource,
        payoutCurve,
      }),
      bonus: 0,
      varianceOk: false,
    }
  }

  function zeroOutcome(outcome: SpinOutcome): SpinOutcome {
    return {
      ...outcome,
      win: 0,
      cascades: (outcome.cascades ?? []).map(step => ({
        ...step,
        win: 0,
        lineWins: (step.lineWins ?? []).map(line => ({ ...line, payout: 0 })),
      })),
    }
  }

  function hasScatterWindow(step: CascadeStep | null | undefined): boolean {
    return Boolean(step?.window?.flat().some(symbol => symbol.kind === 'SCATTER'))
  }

  function sanitizePresentedOutcome(outcome: SpinOutcome): SpinOutcome {
    const cascades = (outcome.cascades ?? []).map(step => {
      const hasLineWins = Boolean(step.lineWins?.length)
      const hasScatter = hasScatterWindow(step)

      if (Number(step.win ?? 0) <= 0.0001 || hasLineWins || hasScatter) {
        return {
          ...step,
          lineWins: (step.lineWins ?? []).map(line => ({ ...line })),
        }
      }

      return {
        ...step,
        win: 0,
        lineWins: [],
      }
    })

    return {
      ...outcome,
      win: roundMoney(getCascadeWinTotal(cascades)),
      cascades,
    }
  }

  function inferJackpotPayoutFromQueue(
    before: ActiveJackpotQueue | null,
    after: ActiveJackpotQueue | null,
  ): number {
    if (!before) return 0
    if (before.remaining_amount <= 0 || before.payouts_left <= 0) return 0

    if (!after) {
      // Queue disappeared: only trust full remaining as payout if this was the final payout row.
      if (before.payouts_left <= 1) {
        return Math.max(0, Number(before.remaining_amount ?? 0))
      }
      return 0
    }

    if (after.id !== before.id) {
      // Campaign changed; do not infer payout from a different queue row.
      return 0
    }

    const payoutsDelta = Number(before.payouts_left ?? 0) - Number(after.payouts_left ?? 0)
    if (payoutsDelta !== 1) {
      return 0
    }

    if (Number(after.remaining_amount ?? 0) > Number(before.remaining_amount ?? 0) + 0.0001) {
      return 0
    }

    const paid = Number(before.remaining_amount ?? 0) - Number(after.remaining_amount ?? 0)
    if (!Number.isFinite(paid) || paid <= 0) return 0
    return paid
  }

  useEffect(() => {
    deviceIdRef.current = deviceId
    if (deviceId) {
      lastAuthoritativeUpdatedAtRef.current = 0
      lastAuthoritativeRevisionRef.current = 0
      lastAuthoritativeBalanceRef.current = 0
      queuedDisplayBalanceRef.current = null
      displayBalanceFrozenRef.current = false
      baseSpinVisualBalanceLockRef.current = false
      baseSpinQueuedAuthoritativeBalanceRef.current = null
      baseSpinStartingBalanceRef.current = 0
      baseSpinBetAmountRef.current = 0
      baseSpinExternalDeltaRef.current = 0
      baseSpinDeductedRef.current = false
      baseSpinExpectedFinalBalanceRef.current = null
      suppressBalanceDropUntilRef.current = 0
      activeAuthPlanRef.current = null
    }
  }, [deviceId])

  useEffect(() => {
    balanceRef.current = balance
  }, [balance])

  useEffect(() => {
    const syncOnlineState = () => {
      isOnlineRef.current = typeof navigator !== 'undefined' ? navigator.onLine : true
    }

    window.addEventListener('online', syncOnlineState)
    window.addEventListener('offline', syncOnlineState)
    syncOnlineState()

    return () => {
      window.removeEventListener('online', syncOnlineState)
      window.removeEventListener('offline', syncOnlineState)
    }
  }, [])

  useEffect(() => {
    isFreeGameRef.current = isFreeGame
  }, [isFreeGame])

  useEffect(() => {
    if (!isFreeGame) return
    if (!activeJackpotQueue) return
    if (activeJackpotQueue.remaining_amount <= 0 && activeJackpotQueue.payouts_left <= 0) return
    jackpotFreeSpinModeRef.current = true
  }, [isFreeGame, activeJackpotQueue])

  useEffect(() => {
    if (!activeJackpotQueue) {
      forceJackpotScatterRef.current = false
      activeJackpotQueueIdRef.current = null
      activeAuthPlanRef.current = null
      return
    }

    if (activeJackpotQueueIdRef.current !== activeJackpotQueue.id) {
      activeJackpotQueueIdRef.current = activeJackpotQueue.id
      forceJackpotScatterRef.current = false
      activeAuthPlanRef.current = null
    }

    if (
      activeAuthPlanRef.current &&
      activeAuthPlanRef.current.campaignId !== activeJackpotQueue.campaign_id
    ) {
      activeAuthPlanRef.current = null
    }

    if (
      activeJackpotQueue.remaining_amount <= 0 ||
      activeJackpotQueue.payouts_left <= 0 ||
      isFreeGame ||
      pendingFreeSpins > 0 ||
      showFreeSpinIntro ||
      spinning
    ) {
      return
    }

    if (isJackpotTriggerReady(activeJackpotQueue)) {
      forceJackpotScatterRef.current = true
    }
  }, [activeJackpotQueue, isFreeGame, pendingFreeSpins, showFreeSpinIntro, spinning])

  useEffect(() => {
    freeSpinsLeftRef.current = freeSpinsLeft
  }, [freeSpinsLeft])

  useEffect(() => {
    freeSpinTotalRef.current = freeSpinTotal
  }, [freeSpinTotal])

  useEffect(() => {
    pendingFreeSpinsRef.current = pendingFreeSpins
  }, [pendingFreeSpins])

  useEffect(() => {
    showFreeSpinIntroRef.current = showFreeSpinIntro
  }, [showFreeSpinIntro])

  useEffect(() => {
    const shouldHoldDisplay =
      isFreeGame || pendingFreeSpins > 0 || showFreeSpinIntro || showScatterWinBanner

    if (shouldHoldDisplay) {
      freezeDisplayedBalance()
      return
    }

    releaseDisplayedBalance()
  }, [
    isFreeGame,
    pendingFreeSpins,
    showFreeSpinIntro,
    showScatterWinBanner,
    freezeDisplayedBalance,
    releaseDisplayedBalance,
  ])

  useEffect(() => {
    persistFreeSpinSnapshot({
      updatedAt: Date.now(),
      isFreeGame,
      freeSpinsLeft,
      pendingFreeSpins,
      freeSpinTotal,
      showFreeSpinIntro,
      scatterTriggerType,
    })
  }, [
    isFreeGame,
    freeSpinsLeft,
    pendingFreeSpins,
    freeSpinTotal,
    showFreeSpinIntro,
    scatterTriggerType,
  ])

  function startFreeSpins() {
    if (isFreeGameRef.current) return false
    if (pendingFreeSpins <= 0) return false

    // The trigger spin may have entered free-spin mode before the normal settle path
    // released the internal spin lock. Clear it here so the first free spin can start.
    if (spinSafetyTimeoutRef.current !== null) {
      clearTimeout(spinSafetyTimeoutRef.current)
      spinSafetyTimeoutRef.current = null
    }
    spinLockRef.current = false
    setSpinning(false)

    // Sync refs immediately so first free-spin launch cannot be dropped by stale-ref guards.
    jackpotFreeSpinModeRef.current = jackpotModeArmedRef.current
    isFreeGameRef.current = true
    freeSpinsLeftRef.current = pendingFreeSpins
    setIsFreeGame(true)
    setFreeSpinsLeft(pendingFreeSpins)
    setShowFreeSpinIntro(false)
    setPendingFreeSpins(0)
    spinVisualTargetWinRef.current = null
    spinVisualCommittedWinRef.current = 0
    setRestoredFreeSpinIntro(false)
    return true
  }

  function consumeFreeSpinOnSpinStart() {
    const nextFreeSpinsLeft = Math.max(0, freeSpinsLeftRef.current - 1)
    freeSpinsLeftRef.current = nextFreeSpinsLeft
    setFreeSpinsLeft(nextFreeSpinsLeft)
  }

  /* -----------------------------
     Spin execution
  ----------------------------- */
  async function spinNow() {
    if (!isOnlineRef.current) return
    if (spinning) return
    if (spinLockRef.current) return
    if (!rngRef.current) return

    // Free-spin intro/manual path should explicitly enter free spins first.
    if (!isFreeGame && pendingFreeSpins > 0) return

    if (!isFreeGame && (!isValidPaidSpinBet(bet) || authoritativeBalance < bet)) return
    if (isFreeGame && freeSpinsLeftRef.current <= 0) return

    let queueForBaseSpin = activeJackpotQueue
    if (!isFreeGame && deviceIdRef.current) {
      try {
        const freshQueue = await fetchActiveJackpotQueue(deviceIdRef.current)
        queueForBaseSpin = freshQueue
        setActiveJackpotQueue(freshQueue)
      } catch {
        // no-op: fallback uses the best-known queue snapshot
      }
    }

    const forceJackpotScatter =
      !isFreeGame &&
      (isJackpotTriggerReady(queueForBaseSpin) || forceJackpotScatterRef.current)
    if (forceJackpotScatter) {
      forceJackpotScatterRef.current = false
    }

    spinLockRef.current = true
    setSpinning(true)

    spinSafetyTimeoutRef.current = window.setTimeout(() => {
      if (spinLockRef.current) {
        console.warn('[engine] spin safety timeout - releasing stuck lock')
        spinLockRef.current = false
        setSpinning(false)
      }
      spinSafetyTimeoutRef.current = null
    }, 30000)

    const runtimeSnapshot = await refreshRuntimeMode()

    const spinAmount = isFreeGame && scatterTriggerType === 'buy' ? buySpinBet : bet

    if (!isFreeGame && !isValidPaidSpinBet(spinAmount)) {
      if (spinSafetyTimeoutRef.current !== null) {
        clearTimeout(spinSafetyTimeoutRef.current)
        spinSafetyTimeoutRef.current = null
      }
      spinLockRef.current = false
      setSpinning(false)
      return
    }

    if (!isFreeGame) {
      baseSpinVisualBalanceLockRef.current = true
      baseSpinQueuedAuthoritativeBalanceRef.current = null
      baseSpinStartingBalanceRef.current = balanceRef.current
      baseSpinBetAmountRef.current = spinAmount
      baseSpinExternalDeltaRef.current = 0
      baseSpinDeductedRef.current = false
      baseSpinExpectedFinalBalanceRef.current = null
      setTotalWin(0)
      setFreeSpinTotal(0)
    } else {
      setTotalWin(0)
    }

    setPendingCascades([])

    let queueBeforeSpin = isFreeGame ? activeJackpotQueue : null
    const isJackpotFreeSpin = isFreeGame && jackpotFreeSpinModeRef.current

    if (isJackpotFreeSpin && deviceIdRef.current) {
      try {
        const freshQueue = await fetchActiveJackpotQueue(deviceIdRef.current)
        queueBeforeSpin = freshQueue
        setActiveJackpotQueue(freshQueue)
      } catch {
        // no-op: fallback uses best-known state
      }
    }

    const engineBetPerSpin = spinAmount
    const freeSpinSource = scatterTriggerType === 'buy' ? 'buy' : 'natural'
    const useAuthenticPaytableMode =
      isJackpotFreeSpin && runtimeSnapshot.deliveryMode === 'AUTHENTIC_PAYTABLE'
    const nextSpinId = spinCounterRef.current + 1

    let authPlanState: ActiveAuthPlanState | null = null
    let authPlanStep: AuthPlanStep | null = null

    if (
      useAuthenticPaytableMode &&
      queueBeforeSpin &&
      deviceIdRef.current &&
      queueBeforeSpin.campaign_id
    ) {
      const existingPlan = activeAuthPlanRef.current
      const canReuseExistingPlan =
        existingPlan &&
        existingPlan.queueId === queueBeforeSpin.id &&
        existingPlan.campaignId === queueBeforeSpin.campaign_id &&
        existingPlan.nextIndex < existingPlan.steps.length

      if (canReuseExistingPlan) {
        authPlanState = existingPlan
        authPlanStep = existingPlan.steps[existingPlan.nextIndex] ?? null
      } else {
        const composeSeed = `${seedRef.current ?? 'seed'}:auth-jackpot:${queueBeforeSpin.id}:${queueBeforeSpin.campaign_id}:${nextSpinId}:${Math.round(queueBeforeSpin.remaining_amount * 100)}`
        const targetAmount = Math.max(0, Number(queueBeforeSpin.remaining_amount ?? 0))
        const payoutsLeft = Math.max(1, Math.floor(Number(queueBeforeSpin.payouts_left ?? 1)))
        let forcedHappyRuntime = false
        if (runtimeSnapshot.mode !== 'HAPPY') {
          hotUpdateEngine({
            config: DEFAULT_ENGINE_HAPPY_HOUR,
            version: `runtime-auth-jackpot-compose-HAPPY-${Date.now()}`,
          })
          forcedHappyRuntime = true
        }

        try {
          const composed = composeAuthenticPlanWithVariance({
            baseTarget: targetAmount,
            composeSeed,
            spinCount: payoutsLeft,
            betPerSpin: engineBetPerSpin,
            freeSpinSource,
            payoutCurve: runtimeSnapshot.payoutCurve,
          })
          const composedPlan = composed.plan

          if (
            composedPlan.withinTolerance &&
            composed.varianceOk &&
            composedPlan.steps.length === payoutsLeft
          ) {
            const expectedAmounts = composedPlan.steps.map(step => roundMoney(step.expectedAmount))
            await registerAuthenticJackpotPlan({
              deviceId: deviceIdRef.current,
              queueId: queueBeforeSpin.id,
              campaignId: queueBeforeSpin.campaign_id,
              expectedAmounts,
              tolerance: composedPlan.tolerance,
            })

            const nextPlan: ActiveAuthPlanState = {
              queueId: queueBeforeSpin.id,
              campaignId: queueBeforeSpin.campaign_id,
              steps: composedPlan.steps,
              nextIndex: 0,
              total: composedPlan.total,
              tolerance: composedPlan.tolerance,
            }
            activeAuthPlanRef.current = nextPlan
            authPlanState = nextPlan
            authPlanStep = nextPlan.steps[0] ?? null
          } else {
            activeAuthPlanRef.current = null
            console.warn('[engine] authentic jackpot plan composition fell back to TARGET_FIRST', {
              queueId: queueBeforeSpin.id,
              campaignId: queueBeforeSpin.campaign_id,
              targetAmount,
              bonus: composed.bonus,
              selectedTotal: composedPlan.total,
              diff: composedPlan.diff,
              tolerance: composedPlan.tolerance,
              varianceOk: composed.varianceOk,
              stepsComposed: composedPlan.steps.length,
              payoutsLeft,
            })
          }
        } catch (error) {
          activeAuthPlanRef.current = null
          console.warn(
            '[engine] authentic jackpot plan registration failed; fallback active',
            error,
          )
        } finally {
          if (forcedHappyRuntime) {
            hotUpdateEngine({
              config: runtimeSnapshot.config,
              version: `runtime-auth-jackpot-compose-restore-${runtimeSnapshot.mode}-${Date.now()}`,
            })
          }
        }
      }
    }

    const spinInput = {
      betPerSpin: engineBetPerSpin,
      lines: 5,
      isFreeGame,
      forceScatter: forceJackpotScatter,
      freeSpinSource: isFreeGame ? freeSpinSource : undefined,
    } satisfies Parameters<typeof spin>[1]
    const seededOutcome: SpinOutcome = authPlanStep?.outcome ?? spin(rngRef.current, spinInput)
    currentSpinMaxWinRef.current = isJackpotFreeSpin ? null : getMaxWinCapForBet(spinAmount)
    // Only apply the live-funding reroll cap to paid base spins. Free spins should not be
    // collapsed toward zero by passing a zero bet amount into the funding-budget path.
    const normalWinCap =
      !isJackpotFreeSpin && !isFreeGame
        ? getFundableNormalWinCap(runtimeSnapshot, spinAmount)
        : null
    const selectedNormalSpin =
      !isJackpotFreeSpin && !isFreeGame
        ? selectNormalOutcomeWithinCap({
            initialOutcome: seededOutcome,
            winCap: normalWinCap,
            rng: rngRef.current,
            spinInput,
          })
        : null
    const outcome = selectedNormalSpin?.outcome ?? seededOutcome
    const rawTotalWin = getOutcomeTotalWin(outcome)
    const engineTotalWin = clampToCurrentSpinMax(rawTotalWin)
    spinCounterRef.current = nextSpinId

    if (selectedNormalSpin?.rerolled && normalWinCap !== null) {
      console.info('[engine] normal spin rerolled to stay within funding cap', {
        spinId: nextSpinId,
        cap: normalWinCap,
        selectedWin: engineTotalWin,
        attempts: selectedNormalSpin.attemptCount,
        isFreeGame,
      })
    }

    let jackpotPayoutForSpin = 0
    let acceptedWinForSpin = isJackpotFreeSpin ? 0 : engineTotalWin

    const accountingDeviceId = deviceIdRef.current
    const accountingTask = accountingDeviceId
      ? (async () => {
          let resolvedJackpotPayout = 0

          try {
            const accounting = await commitSpinAccounting({
              deviceId: accountingDeviceId,
              spinId: nextSpinId,
              isFreeGame,
              betAmount: isFreeGame ? 0 : spinAmount,
              totalWin: isJackpotFreeSpin ? 0 : engineTotalWin,
              freeSpinsAwarded: isJackpotFreeSpin ? 0 : (outcome.freeSpinsAwarded ?? 0),
              cascades: isJackpotFreeSpin ? 0 : (outcome.cascades?.length ?? 0),
              triggerType: scatterTriggerType ?? null,
            })
            void syncBalanceFromDb()
            resolvedJackpotPayout = Number(accounting?.jackpotPayout ?? 0)
            const resolvedAcceptedWin = Number(accounting?.acceptedWin ?? 0)

            if (isJackpotFreeSpin && queueBeforeSpin) {
              try {
                const queueAfterSpin = await fetchActiveJackpotQueue(accountingDeviceId)
                if (resolvedJackpotPayout <= 0) {
                  const inferred = inferJackpotPayoutFromQueue(queueBeforeSpin, queueAfterSpin)
                  if (inferred > 0) {
                    resolvedJackpotPayout = inferred
                  }
                }
                setActiveJackpotQueue(queueAfterSpin)
              } catch {
                // no-op
              }
            }

            if (authPlanState && authPlanStep) {
              authPlanState.nextIndex = Math.min(
                authPlanState.nextIndex + 1,
                authPlanState.steps.length,
              )
              if (authPlanState.nextIndex >= authPlanState.steps.length) {
                activeAuthPlanRef.current = null
              }

              if (Math.abs(resolvedJackpotPayout - authPlanStep.expectedAmount) > 0.01) {
                console.warn('[engine] authentic jackpot payout mismatch', {
                  queueId: authPlanState.queueId,
                  campaignId: authPlanState.campaignId,
                  expected: authPlanStep.expectedAmount,
                  actual: resolvedJackpotPayout,
                  planTotal: authPlanState.total,
                  tolerance: authPlanState.tolerance,
                })
              }
            }

            return {
              jackpotPayout: resolvedJackpotPayout,
              acceptedWin: resolvedAcceptedWin,
            }
          } catch (error) {
            if (forceJackpotScatter) {
              forceJackpotScatterRef.current = true
            }
            if (!isFreeGame) {
              baseSpinVisualBalanceLockRef.current = false
              baseSpinQueuedAuthoritativeBalanceRef.current = null
              baseSpinStartingBalanceRef.current = 0
              baseSpinBetAmountRef.current = 0
              baseSpinExternalDeltaRef.current = 0
              baseSpinDeductedRef.current = false
              baseSpinExpectedFinalBalanceRef.current = null
              suppressBalanceDropUntilRef.current = 0
              const fallbackBalance = lastAuthoritativeBalanceRef.current
              if (displayBalanceFrozenRef.current) {
                queuedDisplayBalanceRef.current = fallbackBalance
              } else {
                setDisplayedBalance(fallbackBalance)
              }
              setFreeSpinTotal(0)
            }
            setPendingCascades([]) // trigger reel sweep
            setSpinId(v => v + 1)
            spinLockRef.current = false
            setSpinning(false)
            spinVisualTargetWinRef.current = null
            spinVisualCommittedWinRef.current = 0
            throw error
          }
        })()
      : null

    if (accountingTask) {
      try {
        const accountingResolved = await accountingTask
        jackpotPayoutForSpin = Number(accountingResolved?.jackpotPayout ?? 0)
        if (!isJackpotFreeSpin) {
          acceptedWinForSpin = Math.max(0, Number(accountingResolved?.acceptedWin ?? 0))
        }
      } catch {
        if (spinSafetyTimeoutRef.current !== null) {
          clearTimeout(spinSafetyTimeoutRef.current)
          spinSafetyTimeoutRef.current = null
        }
        spinLockRef.current = false
        setSpinning(false)
        return
      }
    }

    let presentedOutcome = outcome
    if (isJackpotFreeSpin && jackpotPayoutForSpin <= 0) {
      presentedOutcome = selectZeroWinOutcome({
        initialOutcome: authPlanStep?.outcome ?? outcome,
        rng: rngRef.current,
        spinInput,
      })
    } else if (isJackpotFreeSpin) {
      const targetWin = Math.max(0, Number(jackpotPayoutForSpin ?? 0))
      const tolerance = getJackpotSpinTolerance(targetWin)
      const planOutcome = authPlanStep?.outcome ?? outcome
      const planDiff = Math.abs(getOutcomeTotalWin(planOutcome) - targetWin)
      const jackpotDisplaySeed = `${seedRef.current ?? 'seed'}:jackpot-display:${activeJackpotQueueIdRef.current ?? 0}:${nextSpinId}:${Math.round(targetWin * 100)}`

      if (planDiff <= tolerance + 0.0001) {
        presentedOutcome = selectAuthenticJackpotDisplayOutcomeForTarget({
          initialOutcome: planOutcome,
          targetWin,
          betPerSpin: engineBetPerSpin,
          freeSpinSource: scatterTriggerType === 'buy' ? 'buy' : 'natural',
          seed: `${jackpotDisplaySeed}:plan`,
        })
      } else {
        const composeSeed = `${jackpotDisplaySeed}:compose`
        let forcedHappyRuntime = false
        if (runtimeSnapshot.mode !== 'HAPPY') {
          hotUpdateEngine({
            config: DEFAULT_ENGINE_HAPPY_HOUR,
            version: `runtime-jackpot-compose-HAPPY-${Date.now()}`,
          })
          forcedHappyRuntime = true
        }

        const composed = (() => {
          try {
            return composeTargetedFreeSpin(createRNG(composeSeed), {
              betPerSpin: engineBetPerSpin,
              lines: 5,
              targetWin,
              tolerance,
              freeSpinSource: scatterTriggerType === 'buy' ? 'buy' : 'natural',
              attemptsPerScale: JACKPOT_COMPOSER_ATTEMPTS_PER_SCALE,
              maxTotalAttempts: JACKPOT_COMPOSER_MAX_ATTEMPTS,
            })
          } finally {
            if (forcedHappyRuntime) {
              hotUpdateEngine({
                config: runtimeSnapshot.config,
                version: `runtime-jackpot-compose-restore-${runtimeSnapshot.mode}-${Date.now()}`,
              })
            }
          }
        })()
        presentedOutcome = selectAuthenticJackpotDisplayOutcomeForTarget({
          initialOutcome: composed.outcome,
          targetWin,
          betPerSpin: engineBetPerSpin,
          freeSpinSource: scatterTriggerType === 'buy' ? 'buy' : 'natural',
          seed: `${jackpotDisplaySeed}:final`,
        })

        if (!composed.withinTolerance) {
          console.warn('[engine] jackpot composer outside tolerance', {
            spinId: nextSpinId,
            targetWin,
            selectedWin: Number(composed.outcome.win ?? 0),
            diff: composed.diff,
            tolerance: composed.tolerance,
            attemptCount: composed.attemptCount,
          })
        }
      }
    }
    if (!isJackpotFreeSpin) {
      const normalizedAcceptedWin = clampToCurrentSpinMax(Math.max(0, acceptedWinForSpin))
      const displayComposeSeed = `${seedRef.current ?? 'seed'}:display:${nextSpinId}:${Math.round(normalizedAcceptedWin * 100)}`
      presentedOutcome = selectNormalDisplayOutcomeForTarget({
        initialOutcome: presentedOutcome,
        targetWin: normalizedAcceptedWin,
        spinInput,
        seed: displayComposeSeed,
      })
    }
    presentedOutcome = sanitizePresentedOutcome(presentedOutcome)
    const presentedTotalWin = isJackpotFreeSpin
      ? getOutcomeTotalWin(presentedOutcome)
      : clampToCurrentSpinMax(getOutcomeTotalWin(presentedOutcome))
    spinVisualTargetWinRef.current = roundMoney(Math.max(0, presentedTotalWin))
    if (!isFreeGame) {
      baseSpinExpectedFinalBalanceRef.current = roundMoney(
        Math.max(
          0,
          baseSpinStartingBalanceRef.current - baseSpinBetAmountRef.current + presentedTotalWin,
        ),
      )
    }
    spinVisualCommittedWinRef.current = 0

    lastOutcomeRef.current = presentedOutcome
    if (isFreeGame) {
      // Consume on actual spin start so counter drops together with reel sweep.
      consumeFreeSpinOnSpinStart()
    }

    setSpinId(nextSpinId)
    setPendingCascades(presentedOutcome.cascades ?? [])

    setDebugInfo({
      seed: seedRef?.current ?? undefined,
      bet,
      win: presentedTotalWin,
      cascadeWins: (presentedOutcome.cascades ?? []).map(c => c.win ?? 0),
    })

    if (!isFreeGame && forceJackpotScatter) {
      jackpotModeArmedRef.current = true
      setScatterTriggerType('natural')
      freezeDisplayedBalance()
      setPendingFreeSpins(JACKPOT_FREE_SPIN_COUNT)
    } else if (presentedOutcome.freeSpinsAwarded > 0) {
      jackpotModeArmedRef.current = false
      if (!isFreeGame) {
        setScatterTriggerType('natural')
        freezeDisplayedBalance()
        setPendingFreeSpins(presentedOutcome.freeSpinsAwarded)
      } else {
        // setFreeSpinsLeft(v => v + outcome.freeSpinsAwarded)
      }
    }
  }

  /* -----------------------------
     Visual win accumulator
  ----------------------------- */
  function commitSpinVisualDeduction() {
    if (!baseSpinVisualBalanceLockRef.current) return
    if (baseSpinDeductedRef.current) return

    baseSpinDeductedRef.current = true
    syncBaseSpinDisplayedBalance()
  }

  function commitWin(amount: number) {
    const target = spinVisualTargetWinRef.current
    setTotalWin(current => {
      const rawAmount = Math.max(0, Number(amount ?? 0))
      console.log('[commitWin] rawAmount:', rawAmount, 'target:', target, 'current:', current)
      if (rawAmount <= 0) return current
      const remainingBudget =
        target === null
          ? Number.POSITIVE_INFINITY
          : Math.max(0, target - spinVisualCommittedWinRef.current)
      const boundedAmount = roundMoney(Math.min(rawAmount, remainingBudget))
      console.log('[commitWin] remainingBudget:', remainingBudget, 'boundedAmount:', boundedAmount)
      if (boundedAmount <= 0) return current

      const next = clampToCurrentSpinMax(current + boundedAmount)
      const delta = Math.max(0, next - current)
      console.log('[commitWin] next:', next, 'delta:', delta)
      if (delta <= 0) return current
      spinVisualCommittedWinRef.current = roundMoney(spinVisualCommittedWinRef.current + delta)
      if (isFreeGameRef.current) {
        setFreeSpinTotal(v => v + delta)
      } else if (baseSpinVisualBalanceLockRef.current) {
        syncBaseSpinDisplayedBalance()
      }
      return next
    })
  }

  async function buyFreeSpins(betAmount: number) {
    if (!isOnlineRef.current) return
    if (spinning || showFreeSpinIntro || freeSpinsLeft > 0 || pendingFreeSpins > 0) return
    if (spinLockRef.current) return
    if (!rngRef.current || !deviceIdRef.current) return

    const cost = betAmount * BUY_FREE_SPIN_MULTIPLIER
    if (authoritativeBalance < cost) return

    spinLockRef.current = true
    setSpinning(true)
    setTotalWin(0)
    setFreeSpinTotal(0)
    const runtimeSnapshot = await refreshRuntimeMode()
    const spinInput = {
      betPerSpin: betAmount,
      lines: 5,
      isFreeGame: false,
      forceScatter: true,
    } satisfies Parameters<typeof spin>[1]
    const seededOutcome: SpinOutcome = spin(rngRef.current, spinInput)
    currentSpinMaxWinRef.current = getMaxWinCapForBet(cost)
    const totalWinCap = getFundableNormalWinCap(runtimeSnapshot, cost)
    const selectedOutcome = selectNormalOutcomeWithinCap({
      initialOutcome: seededOutcome,
      winCap: totalWinCap,
      rng: rngRef.current,
      spinInput,
    })
    const outcome = selectedOutcome.outcome
    const rawTotalWin = getOutcomeTotalWin(outcome)
    const totalWin = clampToCurrentSpinMax(rawTotalWin)
    const nextSpinId = spinCounterRef.current + 1
    spinCounterRef.current = nextSpinId

    if (selectedOutcome.rerolled && totalWinCap !== null) {
      console.info('[engine] buy spin rerolled to stay within funding cap', {
        spinId: nextSpinId,
        cap: totalWinCap,
        selectedWin: totalWin,
        attempts: selectedOutcome.attemptCount,
      })
    }

    // Buy-bonus flow should visibly deduct the purchase cost before free-spin wins are revealed.
    freezeDisplayedBalance()
    setBalance(current => Math.max(0, current - cost))

    try {
      const accounting = await commitSpinAccounting({
        deviceId: deviceIdRef.current,
        spinId: nextSpinId,
        isFreeGame: false,
        betAmount: cost,
        totalWin,
        freeSpinsAwarded: outcome.freeSpinsAwarded ?? 0,
        cascades: outcome.cascades?.length ?? 0,
        triggerType: 'buy',
      })
      const acceptedBuyWin = clampToCurrentSpinMax(Math.max(0, Number(accounting?.acceptedWin ?? 0)))
      const normalizedOutcome = sanitizePresentedOutcome(
        selectNormalDisplayOutcomeForTarget({
          initialOutcome: outcome,
          targetWin: acceptedBuyWin,
          spinInput,
          seed: `${seedRef.current ?? 'seed'}:buy-display:${nextSpinId}:${Math.round(acceptedBuyWin * 100)}`,
        }),
      )
      lastOutcomeRef.current = normalizedOutcome
      spinVisualTargetWinRef.current = roundMoney(Math.max(0, acceptedBuyWin))
      setPendingCascades(normalizedOutcome.cascades ?? [])
      await persistDeviceLastBetAmount(deviceIdRef.current, betAmount)
    } catch (error) {
      console.error('[engine] buy spin accounting failed, skipping animation start', error)
      releaseDisplayedBalance()
      void syncBalanceFromDb()
      spinLockRef.current = false
      setSpinning(false)
      return
    }

    setScatterTriggerType('buy')
    jackpotModeArmedRef.current = false
    spinVisualCommittedWinRef.current = 0
    setSpinId(v => v + 1)

    if (outcome.freeSpinsAwarded > 0) {
      setPendingFreeSpins(outcome.freeSpinsAwarded)
    }
  }

  /* -----------------------------
     Commit spin visuals
  ----------------------------- */
  async function commitSpin() {
    if (!pendingCascades) {
      console.warn('[engine] commitSpin without pending cascades; releasing spin lock')
      setCommittedCascades([])
      setPendingCascades(null)
      setSpinning(false)
      spinLockRef.current = false
      return
    }

    if (!deviceIdRef.current) {
      console.warn('[engine] commitSpin without device id; finalizing visuals without device context')
    }

    setCommittedCascades(pendingCascades)
    setPendingCascades(null)
    setSpinning(false)
    spinLockRef.current = false

    const outcome = lastOutcomeRef.current
    // const sessionId = sessionIdRef.current

    if (!outcome) return

    // await logSpin({
    //   sessionId,
    //   bet: outcome.bet,
    //   win: outcome.win ?? 0,
    //   baseWin: 0,
    //   freeWin: 0,
    //   cascades: outcome.cascades?.length ?? 0,
    //   hit: (outcome.win ?? 0) > 0,
    //   isFreeGame,
    // })

    // Jackpot contribution
    const loss = outcome.bet - getOutcomeTotalWin(outcome)

    if (loss > 0) {
      // const contribution = Math.floor(loss * 0.05)
    }
  }

  const endFreeSpin = () => {
    const finalizeJackpotQueue = async () => {
      const currentDeviceId = deviceIdRef.current
      if (!currentDeviceId) return

      try {
        await finalizeDeviceJackpotPayouts(currentDeviceId)
        const nextQueue = await fetchActiveJackpotQueue(currentDeviceId)
        setActiveJackpotQueue(nextQueue)
      } catch (error) {
        console.error('[engine] final jackpot queue finalize failed', error)
      }
    }

    setTimeout(() => {
      jackpotModeArmedRef.current = false
      jackpotFreeSpinModeRef.current = false
      activeAuthPlanRef.current = null
      setIsFreeGame(false)
      setFreezeUI(true)
      setShowScatterWinBanner(true)

      setTimeout(() => {
        void finalizeJackpotQueue()
        releaseDisplayedBalance()
        setFreeSpinTotal(0)
        setTotalWin(0)

        setShowScatterWinBanner(false)
        setScatterTriggerType(null)
        setFreezeUI(false)
        clearFreeSpinSnapshot()
      }, SCATTER_BANNER_DURATION)
    }, 600)
  }

  function settleSpinVisuals(isSettling = false) {
    if (spinSafetyTimeoutRef.current !== null) {
      clearTimeout(spinSafetyTimeoutRef.current)
      spinSafetyTimeoutRef.current = null
    }
    spinLockRef.current = false
    spinVisualTargetWinRef.current = null
    spinVisualCommittedWinRef.current = 0

    if (isFreeGameRef.current) {
      if (freeSpinsLeftRef.current === 0 && !isSettling) {
        endFreeSpin()
      }
    }

    if (baseSpinVisualBalanceLockRef.current) {
      baseSpinVisualBalanceLockRef.current = false
      baseSpinDeductedRef.current = false
      baseSpinExternalDeltaRef.current = 0
      baseSpinExpectedFinalBalanceRef.current = null
      baseSpinQueuedAuthoritativeBalanceRef.current = null
      baseSpinStartingBalanceRef.current = 0
      baseSpinBetAmountRef.current = 0
    }

    void syncBalanceFromDb()
  }

  /* -----------------------------
     Public API
  ----------------------------- */
  return {
    cascades: committedCascades,
    spinning,
    spinId,
    spin: spinNow,
    commitSpin,
    commitSpinVisualDeduction,
    commitWin,

    deviceId: deviceIdRef.current,
    balance,
    bet,
    setBet,
    totalWin,

    buySpinBet,
    setBuySpinBet,

    isFreeGame,
    freeSpinsLeft,

    pendingFreeSpins,
    freeSpinTotal,
    setFreeSpinTotal,

    showFreeSpinIntro,
    setShowFreeSpinIntro,
    showScatterWinBanner,
    restoredFreeSpinIntro,
    setRestoredFreeSpinIntro,

    debugInfo,
    buyFreeSpins,
    scatterTriggerType,
    runtimeMode,
    startFreeSpins,
    settleSpinVisuals,

    freezeUI,
    sessionReady,

    withdrawAmount,
    setWithdrawAmount,

    isWithdrawing,
    setIsWithdrawing,

    showWithdrawModal,
    setShowWithdrawModal,
  }
}
