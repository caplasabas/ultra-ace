grant all on function public.finalize_device_jackpot_payouts(
  p_device_id text,
  p_event_ts timestamptz
) to anon;

grant all on function public.finalize_device_jackpot_payouts(
  p_device_id text,
  p_event_ts timestamptz
) to authenticated;

grant all on function public.finalize_device_jackpot_payouts(
  p_device_id text,
  p_event_ts timestamptz
) to service_role;
