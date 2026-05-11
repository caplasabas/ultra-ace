import { supabase } from './supabase'

let liveConfigChannelSeq = 0

export async function fetchLiveConfig() {
  const { data } = await supabase.from('live_config').select('*').eq('id', true).maybeSingle()

  return data
}

export function subscribeLiveConfig(onUpdate: (cfg: any) => void) {
  const channelName = `live-config-${Date.now()}-${liveConfigChannelSeq++}`

  return supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'live_config',
      },
      payload => {
        onUpdate(payload.new)
      },
    )
    .subscribe()
}
