-- Allow slight positive jackpot variance in AUTHENTIC_PAYTABLE plans.
-- Window: target .. target + 200 (with decimal support).

create or replace function public.register_authentic_jackpot_plan(
  p_device_id text,
  p_queue_id bigint,
  p_campaign_id uuid,
  p_expected_amounts numeric[],
  p_tolerance numeric default 500
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.jackpot_payout_queue;
  v_expected_count integer := coalesce(array_length(p_expected_amounts, 1), 0);
  v_i integer := 0;
  v_sum numeric := 0;
  v_amount numeric := 0;
  v_target numeric := 0;
  v_tolerance numeric := least(greatest(coalesce(p_tolerance, 500), 0), 5000);
  v_positive_variance_cap numeric := 200;
  v_residual numeric := 0;
begin
  if p_device_id is null or trim(p_device_id) = '' then
    raise exception 'p_device_id is required';
  end if;

  if p_queue_id is null then
    raise exception 'p_queue_id is required';
  end if;

  if p_campaign_id is null then
    raise exception 'p_campaign_id is required';
  end if;

  select * into v_row
  from public.jackpot_payout_queue
  where id = p_queue_id
    and device_id = p_device_id
    and campaign_id = p_campaign_id
    and completed_at is null
  for update;

  if not found then
    raise exception 'Active jackpot queue row not found for device/campaign';
  end if;

  if v_expected_count <= 0 then
    raise exception 'At least one expected payout step is required';
  end if;

  if v_expected_count <> greatest(coalesce(v_row.payouts_left, 0), 0) then
    raise exception 'Expected payout step count (%) must match payouts_left (%)', v_expected_count, v_row.payouts_left;
  end if;

  for v_i in 1..v_expected_count loop
    v_amount := greatest(coalesce(p_expected_amounts[v_i], 0), 0);
    v_sum := v_sum + v_amount;
  end loop;

  v_sum := round(v_sum, 4);
  v_target := round(greatest(coalesce(v_row.remaining_amount, 0), 0), 4);

  if v_sum > v_target + v_positive_variance_cap + 0.0001 then
    raise exception 'Plan sum (%) cannot exceed queue target plus variance cap (%)', v_sum, (v_target + v_positive_variance_cap);
  end if;

  if v_sum < greatest(v_target - v_tolerance, 0) - 0.0001 then
    raise exception 'Plan sum (%) must be within tolerance of queue target (% - %)', v_sum, v_target, v_tolerance;
  end if;

  delete from public.jackpot_payout_plan_steps
  where queue_id = v_row.id;

  for v_i in 1..v_expected_count loop
    insert into public.jackpot_payout_plan_steps (
      queue_id,
      campaign_id,
      device_id,
      step_index,
      expected_amount,
      created_at
    ) values (
      v_row.id,
      v_row.campaign_id,
      v_row.device_id,
      v_i,
      round(greatest(coalesce(p_expected_amounts[v_i], 0), 0), 4),
      now()
    );
  end loop;

  v_residual := round(greatest(v_target - v_sum, 0), 4);

  update public.jackpot_payout_queue
  set
    target_amount = v_sum,
    remaining_amount = v_sum,
    updated_at = now()
  where id = v_row.id;

  if v_residual > 0 and v_row.jackpot_pot_id is not null then
    update public.jackpot_pots
    set
      amount_total = greatest(amount_total - v_residual, 0),
      amount_remaining = greatest(amount_remaining - v_residual, 0)
    where id = v_row.jackpot_pot_id;

    insert into public.jackpot_pots (
      amount_total,
      amount_remaining,
      status,
      goal_mode,
      goal_snapshot,
      created_at
    )
    values (
      v_residual,
      v_residual,
      'queued',
      'amount',
      jsonb_build_object(
        'reason', 'authentic_plan_residual',
        'sourceQueueId', v_row.id,
        'sourceCampaign', v_row.campaign_id,
        'sourceDeviceId', v_row.device_id,
        'createdAt', now()
      ),
      now()
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'queue_id', v_row.id,
    'campaign_id', v_row.campaign_id,
    'steps', v_expected_count,
    'target_amount', v_target,
    'planned_amount', v_sum,
    'over_target_bonus', round(greatest(v_sum - v_target, 0), 4),
    'residual_requeued', v_residual
  );
end;
$$;
