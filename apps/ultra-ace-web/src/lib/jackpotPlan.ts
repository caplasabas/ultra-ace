import { supabase } from './supabase'

export async function registerAuthenticJackpotPlan({
  deviceId,
  queueId,
  campaignId,
  expectedAmounts,
  tolerance,
}: {
  deviceId: string
  queueId: number
  campaignId: string
  expectedAmounts: number[]
  tolerance: number
}) {
  const { data, error } = await supabase.rpc('register_authentic_jackpot_plan', {
    p_device_id: deviceId,
    p_queue_id: queueId,
    p_campaign_id: campaignId,
    p_expected_amounts: expectedAmounts,
    p_tolerance: tolerance,
  })

  if (error) throw error
  return data
}
