import { supabase } from './supabase'
import { v4 as uuidv4 } from 'uuid'

let cachedDeviceId: string

function normalizeError(err: unknown) {
  if (!err || typeof err !== 'object') {
    return { message: String(err ?? 'unknown error') }
  }

  return {
    message: String((err as any).message ?? 'unknown error'),
    code: (err as any).code ?? null,
    details: (err as any).details ?? null,
    hint: (err as any).hint ?? null,
    status: (err as any).status ?? null,
  }
}

supabase.channel('debug').subscribe(status => {
  console.log('Realtime status:', status)
})

export async function getDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId

  try {
    console.log('Fetching hardware ID...')
    const res = await fetch('http://localhost:5174/device-id', {
      signal: AbortSignal.timeout(3000),
    })
    console.log('Response status:', res.status)

    if (!res.ok) throw new Error('No input service')

    const data = await res.json()

    if (!data.deviceId) throw new Error('No Hardware Device ID')

    console.log('Hardware ID received:', data.deviceId)

    cachedDeviceId = data.deviceId

    return cachedDeviceId
  } catch (err) {
    // Dev fallback

    console.error('Falling back to dev ID because:', err)

    let devId = localStorage.getItem('arcade_device_id')

    if (!devId) {
      devId = `dev-${uuidv4()}`
      localStorage.setItem('arcade_device_id', devId)
    }
    cachedDeviceId = devId
    return devId
  }
}

export async function ensureDeviceRegistered(name?: string) {
  const deviceId = await getDeviceId()

  const nextName = String(name ?? '').trim()
  const { data: existing, error: lookupError } = await supabase
    .from('devices')
    .select('device_id,name')
    .eq('device_id', deviceId)
    .maybeSingle()

  if (lookupError) {
    console.error('[DEVICE] browser lookup failed, trying local register fallback', normalizeError(lookupError))

    const response = await fetch('http://localhost:5174/device-register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId,
        name: nextName || null,
      }),
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`local device register failed (${response.status})${text ? `: ${text}` : ''}`)
    }

    return deviceId
  }

  const payload =
    existing && existing.device_id
      ? { device_id: deviceId }
      : nextName
        ? { device_id: deviceId, name: nextName }
        : { device_id: deviceId }

  const { error } = await supabase.from('devices').upsert(payload, { onConflict: 'device_id' })

  if (error) {
    console.error('[DEVICE] browser upsert failed, trying local register fallback', normalizeError(error))

    const response = await fetch('http://localhost:5174/device-register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId,
        name: nextName || null,
      }),
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`local device register failed (${response.status})${text ? `: ${text}` : ''}`)
    }
  }

  return deviceId
}

export async function fetchDeviceLastBetAmount(deviceId: string): Promise<number | null> {
  const { data, error } = await supabase
    .from('devices')
    .select('last_bet_amount')
    .eq('device_id', deviceId)
    .maybeSingle()

  if (error) throw error

  const value = Number(data?.last_bet_amount ?? 0)
  if (!Number.isFinite(value) || value <= 0) return null
  return value
}

export async function persistDeviceLastBetAmount(deviceId: string, amount: number) {
  const normalizedAmount = Number(amount ?? 0)
  if (!deviceId || !Number.isFinite(normalizedAmount) || normalizedAmount <= 0) return

  const { error } = await supabase
    .from('devices')
    .update({
      last_bet_amount: normalizedAmount,
      updated_at: new Date().toISOString(),
    })
    .eq('device_id', deviceId)

  if (error) throw error
}
