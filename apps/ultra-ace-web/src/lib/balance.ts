import { supabase } from './supabase'
import { getDeviceId } from './device'

export async function fetchSessionBalance(sessionId: string) {
  const deviceId = getDeviceId()

  const { data, error } = await supabase
    .from('v_session_balances')
    .select('balance')
    .eq('device_id', deviceId)
    .eq('session_id', sessionId)
    .maybeSingle()

  if (error) throw error

  return data?.balance ?? null
}

export async function fetchDeviceBalance() {
  const deviceId = getDeviceId()

  const { data, error } = await supabase
    .from('v_device_balances')
    .select('balance')
    .eq('device_id', deviceId)
    .maybeSingle()

  if (error) throw error

  return data?.balance ?? 0
}
