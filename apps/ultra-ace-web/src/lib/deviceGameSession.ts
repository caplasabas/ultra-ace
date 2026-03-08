import { supabase } from './supabase'

type DeviceStatePayload = {
  runtimeMode?: 'BASE' | 'HAPPY' | null
  isFreeGame?: boolean
  freeSpinsLeft?: number
  pendingFreeSpins?: number
  showFreeSpinIntro?: boolean
  spinId?: number
  spinning?: boolean
  scatterTriggerType?: 'natural' | 'buy' | null
}

export async function startDeviceGameSession({
  deviceId,
  gameId,
  gameName,
  runtimeMode,
  state,
}: {
  deviceId: string
  gameId: string
  gameName: string
  runtimeMode?: 'BASE' | 'HAPPY'
  state?: DeviceStatePayload
}) {
  const { data, error } = await supabase.rpc('start_device_game_session', {
    p_device_id: deviceId,
    p_game_id: gameId,
    p_game_name: gameName,
    p_runtime_mode: runtimeMode ?? null,
    p_state: state ?? {},
  })

  if (error) throw error
  return Number(data)
}

export async function updateDeviceGameState({
  deviceId,
  sessionId,
  state,
}: {
  deviceId: string
  sessionId?: number | null
  state: DeviceStatePayload
}) {
  const { error } = await supabase.rpc('update_device_game_state', {
    p_device_id: deviceId,
    p_session_id: sessionId ?? null,
    p_state: state,
  })

  if (error) throw error
}

export async function endDeviceGameSession({
  deviceId,
  sessionId,
  reason,
}: {
  deviceId: string
  sessionId?: number | null
  reason?: string
}) {
  const { error } = await supabase.rpc('end_device_game_session', {
    p_device_id: deviceId,
    p_session_id: sessionId ?? null,
    p_reason: reason ?? null,
  })

  if (error) throw error
}
