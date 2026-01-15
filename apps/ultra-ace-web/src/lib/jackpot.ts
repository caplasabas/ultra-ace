import { supabase } from './supabase'

export async function contributeToJackpot(sessionId: string, deviceId: string, amount: number) {
  if (amount <= 0) return

  await supabase.from('jackpot_ledger_events').insert({
    session_id: sessionId,
    device_id: deviceId,
    type: 'contribution',
    amount,
  })
}
