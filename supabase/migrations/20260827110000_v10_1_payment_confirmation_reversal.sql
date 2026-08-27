-- SPARK v10.1 settlement identification and payment confirmation reversal
-- Preserves all existing confirmations, settlement batches/items and order operation history.

begin;

do $$
begin
  if to_regclass('public.orders') is null
     or to_regclass('public.payment_steps') is null
     or to_regclass('public.audit_logs') is null
     or to_regclass('public.settlement_batches') is null
     or to_regclass('public.settlement_batch_items') is null
     or to_regclass('public.order_program_transfers') is null
     or to_regclass('public.app_schema_versions') is null
     or to_regprocedure('public.get_my_settlement_page_v94(integer,integer,text,uuid,uuid,text,text,text,date,date)') is null
     or to_regprocedure('public.write_audit_log(text,text,uuid,text,jsonb)') is null then
    raise exception 'SPARK v10.0.0까지 먼저 적용되어 있어야 합니다.';
  end if;
  if not exists (select 1 from public.app_schema_versions where version = 'v10.0.0') then
    raise exception 'SPARK v10.0.0 스키마 버전을 확인할 수 없습니다.';
  end if;
end $$;

-- Running/expired orders may intentionally retain their operation status after a
-- settlement confirmation is reversed. This flag distinguishes that safe state
-- from an accidental payment/order mismatch in operations health checks.
alter table public.orders
  add column if not exists settlement_reversal_pending boolean not null default false;

create index if not exists orders_settlement_reversal_pending_v101_idx
  on public.orders(settlement_reversal_pending, updated_at desc)
  where settlement_reversal_pending;

-- A reversed batch item can be confirmed again in a new immutable batch. The old
-- batch/item row remains untouched; only the cross-batch uniqueness is relaxed.
alter table public.settlement_batch_items
  drop constraint if exists settlement_batch_items_payment_step_id_key;

create index if not exists settlement_batch_items_payment_step_v101_idx
  on public.settlement_batch_items(payment_step_id, created_at desc);

-- Enrich the existing v9.4/v10 settlement result without duplicating its filter,
-- grouping or Spark S+ logic. Optimistic-lock data is needed by the reversal RPC.
create or replace function public.get_my_settlement_page_v101(
  p_page integer default 1,
  p_page_size integer default 50,
  p_status text default 'waiting',
  p_payer_id uuid default null,
  p_registrant_id uuid default null,
  p_group_name text default null,
  p_query text default null,
  p_program_type text default null,
  p_start_date_from date default null,
  p_start_date_to date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_rows jsonb;
begin
  v_result := public.get_my_settlement_page_v94(
    p_page,
    p_page_size,
    p_status,
    p_payer_id,
    p_registrant_id,
    p_group_name,
    p_query,
    p_program_type,
    p_start_date_from,
    p_start_date_to
  );

  select coalesce(
    jsonb_agg(
      entry.row_data || jsonb_build_object(
        'orderStatus', o.status,
        'orderLockVersion', o.lock_version,
        'settlementReversalPending', o.settlement_reversal_pending
      )
      order by entry.ordinality
    ),
    '[]'::jsonb
  )
  into v_rows
  from jsonb_array_elements(coalesce(v_result -> 'rows', '[]'::jsonb))
    with ordinality as entry(row_data, ordinality)
  join public.orders o on o.id = (entry.row_data ->> 'orderDbId')::uuid;

  return jsonb_set(coalesce(v_result, '{}'::jsonb), '{rows}', v_rows, true);
end;
$$;

revoke all on function public.get_my_settlement_page_v101(integer, integer, text, uuid, uuid, text, text, text, date, date) from public, anon;
grant execute on function public.get_my_settlement_page_v101(integer, integer, text, uuid, uuid, text, text, text, date, date) to authenticated;

create or replace function public.admin_reverse_payment_confirmation_v101(
  p_step_id uuid,
  p_expected_confirmed_at timestamptz,
  p_expected_order_version integer,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles;
  v_step public.payment_steps;
  v_order public.orders;
  v_result_order public.orders;
  v_transfer public.order_program_transfers;
  v_confirmed_at timestamptz;
  v_now timestamptz := now();
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_next_status public.order_status;
  v_next_transfer_state text;
  v_next_transfer_difference bigint;
  v_operation_status_preserved boolean := false;
  v_restored_to_waiting boolean := false;
  v_batch_history jsonb := '[]'::jsonb;
begin
  select * into v_actor
  from public.profiles
  where id = auth.uid();

  if v_actor.id is null
     or v_actor.role::text <> 'admin'
     or v_actor.approval_status is distinct from 'approved'
     or not v_actor.active
     or coalesce(v_actor.is_operations_manager, false) then
    raise exception '활성 승인 관리자만 입금확인을 취소할 수 있습니다.';
  end if;

  if p_step_id is null then
    raise exception '취소할 입금확인 내역을 선택해 주세요.';
  end if;
  if char_length(trim(coalesce(p_reason, ''))) not between 2 and 500 then
    raise exception '취소 사유를 2자 이상 500자 이하로 입력해 주세요.';
  end if;
  if p_expected_confirmed_at is null or coalesce(p_expected_order_version, 0) < 1 then
    raise exception '화면의 정산 정보가 불완전합니다. 새로고침 후 다시 시도해 주세요.';
  end if;

  select * into v_step
  from public.payment_steps
  where id = p_step_id
  for update;

  if v_step.id is null then
    raise exception '입금확인 내역을 찾을 수 없습니다.';
  end if;
  if v_step.payee_id <> v_actor.id then
    raise exception '현재 관리자에게 귀속된 입금확인만 취소할 수 있습니다.';
  end if;
  if v_step.confirmed_at is null then
    raise exception '이미 입금대기 상태이거나 다른 관리자가 먼저 취소했습니다.';
  end if;
  if v_step.confirmed_at is distinct from p_expected_confirmed_at then
    raise exception '입금확인 시각이 변경되었습니다. 새로고침 후 다시 시도해 주세요.';
  end if;

  select * into v_order
  from public.orders
  where id = v_step.order_id
  for update;

  if v_order.id is null then
    raise exception '연결된 작업을 찾을 수 없습니다.';
  end if;
  if v_order.archived_at is not null then
    raise exception '보관된 작업의 입금확인은 취소할 수 없습니다.';
  end if;
  if v_order.lock_version <> p_expected_order_version then
    raise exception '주문 또는 정산 정보가 다른 처리로 변경되었습니다. 새로고침 후 다시 시도해 주세요.';
  end if;

  if exists (
    select 1
    from public.payment_steps later_step
    where later_step.order_id = v_step.order_id
      and later_step.step_order > v_step.step_order
      and later_step.confirmed_at is not null
  ) then
    raise exception '이 확인 이후의 정산 단계가 이미 진행되어 단독으로 취소할 수 없습니다.';
  end if;

  -- A later program transfer calculated its preserved/adjustment amounts from this
  -- confirmation, so reversing it alone would invalidate that immutable history.
  if exists (
    select 1
    from public.order_program_transfers transfer
    where transfer.order_id = v_step.order_id
      and transfer.created_at > v_step.confirmed_at
  ) then
    raise exception '이 입금확인 이후 프로그램 변경 정산이 진행되어 단독으로 취소할 수 없습니다.';
  end if;

  v_next_status := v_order.status;
  if v_order.status = '입금완료' then
    if v_order.activated_at is null and v_order.start_date > v_today then
      v_next_status := '입금대기';
      v_restored_to_waiting := true;
    else
      raise exception '시작일이 이미 도래했거나 운영 이력이 있는 입금완료 주문은 안전하게 입금대기로 복구할 수 없어 취소할 수 없습니다.';
    end if;
  elsif v_order.status in ('구동중', '정지', '만료') then
    v_operation_status_preserved := true;
  elsif v_order.status <> '입금대기' then
    raise exception '현재 주문 상태에서는 입금확인을 안전하게 취소할 수 없습니다.';
  end if;

  v_next_transfer_state := v_order.program_transfer_state;
  v_next_transfer_difference := v_order.program_transfer_difference;
  if v_step.step_kind = 'program_adjustment'
     and v_step.program_transfer_id is not null
     and v_order.program_transfer_state = 'none' then
    select * into v_transfer
    from public.order_program_transfers
    where id = v_step.program_transfer_id;
    if v_transfer.id is null then
      raise exception '프로그램 변경 정산 원본을 찾을 수 없어 취소할 수 없습니다.';
    end if;
    v_next_transfer_state := 'payment_pending';
    v_next_transfer_difference := v_transfer.difference;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'batch_id', history.batch_id,
    'batch_number', history.batch_number,
    'confirmed_at', history.confirmed_at
  ) order by history.confirmed_at, history.batch_id), '[]'::jsonb)
  into v_batch_history
  from (
    select distinct b.id as batch_id, b.batch_number, b.confirmed_at
    from public.settlement_batch_items item
    join public.settlement_batches b on b.id = item.batch_id
    where item.payment_step_id = v_step.id
  ) history;

  -- Any still-pending quote for a downstream step is no longer chain-ready.
  update public.settlement_quotes quote
  set status = 'expired'
  where quote.status = 'pending'
    and exists (
      select 1
      from public.settlement_quote_items quote_item
      join public.payment_steps quoted_step on quoted_step.id = quote_item.payment_step_id
      where quote_item.quote_id = quote.id
        and quoted_step.order_id = v_step.order_id
        and quoted_step.step_order > v_step.step_order
    );

  v_confirmed_at := v_step.confirmed_at;
  update public.payment_steps
  set confirmed_at = null,
      confirmed_by = null,
      updated_at = v_now
  where id = v_step.id;

  perform set_config('spark.change_reason', trim(p_reason), true);
  update public.orders
  set status = v_next_status,
      activated_at = case when v_restored_to_waiting then null else activated_at end,
      payment_notified_at = case when v_restored_to_waiting then null else payment_notified_at end,
      program_transfer_state = v_next_transfer_state,
      program_transfer_difference = v_next_transfer_difference,
      settlement_reversal_pending = true,
      lock_version = lock_version + 1,
      updated_at = v_now
  where id = v_order.id
  returning * into v_result_order;

  -- Insert directly rather than through the warning-swallowing helper: reversal
  -- must roll back if its mandatory audit evidence cannot be stored.
  insert into public.audit_logs (
    actor_id,
    actor_username,
    actor_role,
    action,
    entity_type,
    entity_id,
    entity_label,
    metadata,
    created_at
  ) values (
    v_actor.id,
    v_actor.username,
    v_actor.role,
    'PAYMENT_CONFIRM_REVERSED',
    'payment',
    v_step.id,
    v_step.order_number || ' ' || v_step.store_name,
    jsonb_build_object(
      'payment_step_id', v_step.id,
      'order_id', v_step.order_id,
      'payer_id', v_step.payer_id,
      'payer_username', v_step.payer_username,
      'payee_id', v_step.payee_id,
      'payee_username', v_step.payee_username,
      'confirmed_at', v_confirmed_at,
      'confirmed_by', v_step.confirmed_by,
      'actor_id', v_actor.id,
      'actor_username', v_actor.username,
      'reason', trim(p_reason),
      'reversed_at', v_now,
      'program_type', v_step.program_type,
      'step_kind', v_step.step_kind,
      'program_transfer_id', v_step.program_transfer_id,
      'settlement_batches', v_batch_history,
      'order_status_before', v_order.status,
      'order_status_after', v_result_order.status,
      'order_version_before', v_order.lock_version,
      'order_version_after', v_result_order.lock_version,
      'operation_status_preserved', v_operation_status_preserved
    ),
    v_now
  );

  return jsonb_build_object(
    'paymentStepId', v_step.id,
    'orderId', v_result_order.id,
    'orderStatus', v_result_order.status,
    'orderLockVersion', v_result_order.lock_version,
    'operationStatusPreserved', v_operation_status_preserved,
    'restoredToWaiting', v_restored_to_waiting,
    'settlementReversalPending', v_result_order.settlement_reversal_pending,
    'reversedAt', v_now
  );
end;
$$;

revoke all on function public.admin_reverse_payment_confirmation_v101(uuid, timestamptz, integer, text) from public, anon;
grant execute on function public.admin_reverse_payment_confirmation_v101(uuid, timestamptz, integer, text) to authenticated;

-- Both individual and batch confirmation paths update payment_steps, so this
-- trigger clears the explicit reversal marker without rewriting either RPC.
create or replace function public.clear_settlement_reversal_pending_v101()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.confirmed_at is null
     and new.confirmed_at is not null
     and not exists (
       select 1
       from public.payment_steps pending
       where pending.order_id = new.order_id
         and pending.confirmed_at is null
     ) then
    update public.orders
    set settlement_reversal_pending = false
    where id = new.order_id
      and settlement_reversal_pending;
  end if;
  return new;
end;
$$;

drop trigger if exists clear_settlement_reversal_pending_v101 on public.payment_steps;
create trigger clear_settlement_reversal_pending_v101
after update of confirmed_at on public.payment_steps
for each row execute function public.clear_settlement_reversal_pending_v101();

revoke all on function public.clear_settlement_reversal_pending_v101() from public, anon, authenticated;

-- A pending confirmation on an operating order is valid only when it belongs to
-- a program adjustment or an audited confirmation reversal.
create or replace function public.get_operations_health()
returns table (
  schema_version text,
  active_admins bigint,
  active_orders bigint,
  archived_orders bigint,
  orders_without_payment_steps bigint,
  invalid_payment_states bigint,
  inactive_cron_jobs bigint,
  checked_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inactive_cron bigint := 2;
begin
  if not public.is_admin() then raise exception '관리자만 운영 상태를 확인할 수 있습니다.'; end if;

  if to_regclass('cron.job') is not null then
    execute $query$
      select count(*) from (values ('spark-start-paid-orders'), ('spark-expire-finished-orders')) expected(jobname)
      where not exists (
        select 1 from cron.job job where job.jobname = expected.jobname and job.active = true
      )
    $query$ into v_inactive_cron;
  end if;

  return query
  select
    coalesce((select version from public.app_schema_versions order by applied_at desc limit 1), 'unknown'),
    (select count(*) from public.profiles where role = 'admin' and approval_status = 'approved' and active),
    (select count(*) from public.orders where archived_at is null),
    (select count(*) from public.orders where archived_at is not null),
    (select count(*) from public.orders o where o.archived_at is null and not exists (select 1 from public.payment_steps ps where ps.order_id = o.id)),
    (select count(*) from public.orders o where o.archived_at is null and (
      (o.status = '입금대기' and exists (select 1 from public.payment_steps ps where ps.order_id = o.id) and not exists (select 1 from public.payment_steps ps where ps.order_id = o.id and ps.confirmed_at is null))
      or (
        o.status <> '입금대기'
        and o.program_transfer_state <> 'payment_pending'
        and not o.settlement_reversal_pending
        and exists (select 1 from public.payment_steps ps where ps.order_id = o.id and ps.confirmed_at is null)
      )
    )),
    v_inactive_cron,
    now();
end;
$$;

revoke all on function public.get_operations_health() from public, anon;
grant execute on function public.get_operations_health() to authenticated;

insert into public.app_schema_versions(version, description)
values ('v10.1.0', 'Admin settlement identifiers and auditable payment confirmation reversal')
on conflict (version) do nothing;

select public.write_audit_log(
  'system.migration',
  'system',
  null,
  'SPARK v10.1.0',
  jsonb_build_object('description', 'settlement identifiers, guarded confirmation reversal and immutable batch re-confirmation history')
);

commit;
