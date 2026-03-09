import { supabase } from './supabase'

export type DeviceBalanceSnapshot = {
  balance: number
  updatedAt: string | null
}

export async function fetchDeviceBalance(deviceId: string) {
  const { data, error } = await supabase
    .from('devices')
    .select('balance, updated_at')
    .eq('device_id', deviceId)
    .single()

  if (error) throw error

  return {
    balance: Number(data.balance ?? 0),
    updatedAt: data.updated_at ?? null,
  } as DeviceBalanceSnapshot
}

export function subscribeToDeviceBalance(
  deviceId: string,
  onChange: (snapshot: DeviceBalanceSnapshot) => void,
) {
  const channel = supabase
    .channel(`device-balance-${deviceId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'devices',
        filter: `device_id=eq.${deviceId}`,
      },
      payload => {
        onChange({
          balance: Number(payload.new.balance ?? 0),
          updatedAt: (payload.new.updated_at as string | null) ?? null,
        })
      },
    )
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}
