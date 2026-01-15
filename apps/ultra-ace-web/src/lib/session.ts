import { getDeviceId } from './device'
import { supabase } from './supabase'

export async function startSession(isFreeGame: boolean) {
  const deviceId = getDeviceId()

  const { data } = await supabase
    .from('sessions')
    .insert({
      device_id: deviceId,
      is_free_game: isFreeGame,
      started_at: new Date().toISOString(),
    })
    .select()
    .single()

  return data?.id as string
}

export async function endSession(sessionId: string) {
  await supabase
    .from('sessions')
    .update({
      ended_at: new Date().toISOString(),
    })
    .eq('id', sessionId)
}

export async function logSpin({
  sessionId,
  bet,
  win,
  baseWin,
  freeWin,
  cascades,
  hit,
  isFreeGame,
}: {
  sessionId: string
  bet: number
  win: number
  baseWin: number
  freeWin: number
  cascades: number
  hit: boolean
  isFreeGame: boolean
}) {
  const deviceId = getDeviceId()

  await supabase.from('spins').insert({
    session_id: sessionId,
    device_id: deviceId,
    bet,
    win,
    base_win: baseWin,
    free_win: freeWin,
    cascades,
    hit,
    is_free_game: isFreeGame,
    created_at: new Date().toISOString(),
  })
}
