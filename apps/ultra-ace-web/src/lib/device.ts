import { v4 as uuidv4 } from 'uuid'
import { supabase } from './supabase'

const KEY = 'ultraace_device_id'

const DEVICE_NAME_KEY = 'ultra_ace_device_name'

export function getDeviceId(): string {
  let id = localStorage.getItem(KEY)

  if (!id) {
    id = uuidv4()
    localStorage.setItem(KEY, id)
  }

  return id
}

export async function registerDevice(name?: string) {
  const deviceId = getDeviceId()

  await supabase.from('devices').upsert(
    {
      device_id: deviceId,
      name: name ?? null,
    },
    {
      onConflict: 'device_id',
    },
  )

  return deviceId
}

export function getDeviceName(): string {
  return localStorage.getItem(DEVICE_NAME_KEY) ?? 'Unnamed Device'
}

export function setDeviceName(name: string) {
  localStorage.setItem(DEVICE_NAME_KEY, name.trim())
}
