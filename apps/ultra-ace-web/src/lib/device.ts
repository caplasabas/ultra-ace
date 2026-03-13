import { supabase } from './supabase'
import { v4 as uuidv4 } from 'uuid'

let cachedDeviceId: string

supabase.channel('debug').subscribe(status => {
  console.log('Realtime status:', status)
})

export async function getDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId

  try {
    console.log('Fetching hardware ID...')
    const res = await fetch('http://localhost:5174/device-id', {
      signal: AbortSignal.timeout(3000),
    }).catch(e => {
      return e
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

  const { error } = await supabase
    .from('devices')
    .upsert({ device_id: deviceId, name: name ?? null }, { onConflict: 'device_id' })

  if (error) throw error

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
