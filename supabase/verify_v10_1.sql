-- SPARK v10.1 read-only verification. Run after the migration.

do $$
declare
  v_reverse regprocedure := to_regprocedure('public.admin_reverse_payment_confirmation_v101(uuid,timestamptz,integer,text)');
  v_page regprocedure := to_regprocedure('public.get_my_settlement_page_v101(integer,integer,text,uuid,uuid,text,text,text,date,date)');
begin
  if not exists (select 1 from public.app_schema_versions where version = 'v10.1.0') then
    raise exception 'v10.1.0 schema version is missing';
  end if;
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'orders'
      and column_name = 'settlement_reversal_pending'
      and data_type = 'boolean'
  ) then
    raise exception 'orders.settlement_reversal_pending is missing';
  end if;
  if v_reverse is null or v_page is null then
    raise exception 'v10.1 RPC is missing';
  end if;
  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.payment_steps'::regclass
      and tgname = 'clear_settlement_reversal_pending_v101'
      and not tgisinternal
  ) then
    raise exception 'reversal marker clear trigger is missing';
  end if;
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.settlement_batch_items'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) ilike 'UNIQUE (payment_step_id)%'
  ) then
    raise exception 'cross-batch payment_step uniqueness still blocks re-confirmation';
  end if;
  if not has_function_privilege('authenticated', v_reverse, 'EXECUTE')
     or has_function_privilege('anon', v_reverse, 'EXECUTE') then
    raise exception 'reversal RPC grants are invalid';
  end if;
  if not exists (
    select 1
    from pg_proc
    where oid = v_reverse
      and prosecdef
      and coalesce(proconfig, '{}'::text[]) @> array['search_path=""']::text[]
  ) then
    raise exception 'reversal RPC SECURITY DEFINER/search_path guard is invalid';
  end if;
end $$;

select
  version,
  description,
  applied_at
from public.app_schema_versions
where version in ('v10.0.0', 'v10.1.0')
order by applied_at;

select
  to_regprocedure('public.get_my_settlement_page_v101(integer,integer,text,uuid,uuid,text,text,text,date,date)') is not null as settlement_page_v101,
  to_regprocedure('public.admin_reverse_payment_confirmation_v101(uuid,timestamptz,integer,text)') is not null as reversal_rpc_v101,
  to_regprocedure('public.clear_settlement_reversal_pending_v101()') is not null as reversal_clear_trigger_function,
  to_regprocedure('public.get_operations_health()') is not null as operations_health;

select
  count(*) filter (where confirmed_at is not null and confirmed_by is null) as confirmed_without_actor,
  count(*) filter (where confirmed_at is null and confirmed_by is not null) as waiting_with_actor,
  count(*) filter (where program_type = 'spark_s_plus') as spark_s_plus_steps
from public.payment_steps;

select
  count(*) filter (where settlement_reversal_pending) as orders_pending_reconfirmation,
  count(*) filter (
    where settlement_reversal_pending
      and not exists (
        select 1 from public.payment_steps step
        where step.order_id = orders.id and step.confirmed_at is null
      )
  ) as stale_reversal_markers
from public.orders;

select
  count(*) as payment_confirmation_reversal_audits,
  max(created_at) as latest_reversal_at
from public.audit_logs
where action = 'PAYMENT_CONFIRM_REVERSED';

select
  count(*) as batch_items,
  count(distinct payment_step_id) as distinct_payment_steps,
  count(*) - count(distinct payment_step_id) as reconfirmation_history_rows
from public.settlement_batch_items;

-- Consolidated final row for clients that only display the last result set.
select jsonb_build_object(
  'checkedAt', now(),
  'version', (select jsonb_build_object(
    'present', count(*) = 1,
    'appliedAt', max(applied_at)
  ) from public.app_schema_versions where version = 'v10.1.0'),
  'databaseObjects', jsonb_build_object(
    'settlementPageV101', to_regprocedure('public.get_my_settlement_page_v101(integer,integer,text,uuid,uuid,text,text,text,date,date)') is not null,
    'reversalRpcV101', to_regprocedure('public.admin_reverse_payment_confirmation_v101(uuid,timestamptz,integer,text)') is not null,
    'reversalClearTriggerFunction', to_regprocedure('public.clear_settlement_reversal_pending_v101()') is not null,
    'operationsHealth', to_regprocedure('public.get_operations_health()') is not null,
    'reversalClearTrigger', exists (
      select 1 from pg_trigger
      where tgrelid = 'public.payment_steps'::regclass
        and tgname = 'clear_settlement_reversal_pending_v101'
        and not tgisinternal
    ),
    'batchItemPaymentStepUniqueConstraintRemoved', not exists (
      select 1 from pg_constraint
      where conrelid = 'public.settlement_batch_items'::regclass
        and contype = 'u'
        and pg_get_constraintdef(oid) ilike 'UNIQUE (payment_step_id)%'
    )
  ),
  'paymentStepIntegrity', (select jsonb_build_object(
    'confirmedWithoutActor', count(*) filter (where confirmed_at is not null and confirmed_by is null),
    'waitingWithActor', count(*) filter (where confirmed_at is null and confirmed_by is not null),
    'sparkSPlus', count(*) filter (where program_type = 'spark_s_plus')
  ) from public.payment_steps),
  'reversalState', (select jsonb_build_object(
    'pendingReconfirmation', count(*) filter (where settlement_reversal_pending),
    'staleMarkers', count(*) filter (
      where settlement_reversal_pending
        and not exists (
          select 1 from public.payment_steps step
          where step.order_id = orders.id and step.confirmed_at is null
        )
    )
  ) from public.orders),
  'reversalAudits', (select jsonb_build_object(
    'total', count(*),
    'latestAt', max(created_at)
  ) from public.audit_logs where action = 'PAYMENT_CONFIRM_REVERSED'),
  'batchHistory', (select jsonb_build_object(
    'items', count(*),
    'distinctPaymentSteps', count(distinct payment_step_id),
    'reconfirmationRows', count(*) - count(distinct payment_step_id)
  ) from public.settlement_batch_items)
) as verification;
