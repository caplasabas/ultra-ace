import { supabase } from './supabase'

export async function logLedgerEvent({
  sessionId,
  deviceId,
  type,
  amount,
  source,
  metadata,
}: {
  sessionId: string
  deviceId: string
  type: 'deposit' | 'withdrawal' | 'bet' | 'win'
  amount: number
  source?: string
  metadata?: any
}) {
  const delta = type === 'withdrawal' || type === 'bet' ? -amount : amount

  const { error } = await supabase.from('ledger_events').insert({
    session_id: sessionId,
    device_id: deviceId,
    type,
    amount,
    balance_delta: delta,
    source,
    metadata,
  })

  if (error) {
    console.error('[ledger] insert failed', error)
  }
}
