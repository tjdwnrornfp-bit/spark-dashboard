-- SPARK v10.1 read-only preflight. Run before the migration.

select
  current_database() as database_name,
  current_user as database_user,
  current_setting('server_version') as postgres_version,
  now() as checked_at;

select
  to_regclass('public.orders') is not null as orders_ready,
  to_regclass('public.payment_steps') is not null as payment_steps_ready,
  to_regclass('public.audit_logs') is not null as audit_logs_ready,
  to_regclass('public.settlement_batches') is not null as settlement_batches_ready,
  to_regclass('public.settlement_batch_items') is not null as settlement_batch_items_ready,
  to_regclass('public.order_program_transfers') is not null as program_transfers_ready,
  to_regprocedure('public.get_my_settlement_page_v94(integer,integer,text,uuid,uuid,text,text,text,date,date)') is not null as settlement_v94_ready,
  to_regprocedure('public.write_audit_log(text,text,uuid,text,jsonb)') is not null as audit_writer_ready;

select version, description, applied_at
from public.app_schema_versions
order by applied_at desc
limit 8;

select
  count(*) filter (where o.archived_at is null) as active_orders,
  count(*) filter (where o.archived_at is not null) as archived_orders,
  count(*) filter (
    where o.archived_at is null
      and not exists (select 1 from public.payment_steps step where step.order_id = o.id)
  ) as active_orders_without_payment_steps,
  count(*) filter (
    where o.archived_at is null
      and o.status = '입금대기'
      and exists (select 1 from public.payment_steps step where step.order_id = o.id)
      and not exists (select 1 from public.payment_steps step where step.order_id = o.id and step.confirmed_at is null)
  ) as waiting_orders_with_all_steps_confirmed
from public.orders o;

select
  count(*) as payment_step_count,
  count(*) filter (where confirmed_at is null) as waiting_step_count,
  count(*) filter (where confirmed_at is not null) as confirmed_step_count,
  count(*) filter (where program_type = 'spark_s_plus') as spark_s_plus_step_count
from public.payment_steps;

select
  count(*) as settlement_batch_count,
  coalesce(sum(item_count), 0) as settlement_batch_item_total,
  count(*) filter (where status = 'voided') as voided_batch_count
from public.settlement_batches;

-- Consolidated final row for clients that only display the last result set.
select jsonb_build_object(
  'database', current_database(),
  'databaseUser', current_user,
  'postgresVersion', current_setting('server_version'),
  'checkedAt', now(),
  'prerequisites', jsonb_build_object(
    'orders', to_regclass('public.orders') is not null,
    'paymentSteps', to_regclass('public.payment_steps') is not null,
    'auditLogs', to_regclass('public.audit_logs') is not null,
    'settlementBatches', to_regclass('public.settlement_batches') is not null,
    'settlementBatchItems', to_regclass('public.settlement_batch_items') is not null,
    'programTransfers', to_regclass('public.order_program_transfers') is not null,
    'settlementV94', to_regprocedure('public.get_my_settlement_page_v94(integer,integer,text,uuid,uuid,text,text,text,date,date)') is not null,
    'auditWriter', to_regprocedure('public.write_audit_log(text,text,uuid,text,jsonb)') is not null
  ),
  'latestVersions', coalesce((
    select jsonb_agg(jsonb_build_object('version', version, 'appliedAt', applied_at) order by applied_at desc)
    from (select version, applied_at from public.app_schema_versions order by applied_at desc limit 8) versions
  ), '[]'::jsonb),
  'orders', (select jsonb_build_object(
    'active', count(*) filter (where archived_at is null),
    'archived', count(*) filter (where archived_at is not null),
    'activeWithoutPaymentSteps', count(*) filter (
      where archived_at is null and not exists (select 1 from public.payment_steps step where step.order_id = orders.id)
    ),
    'waitingWithAllStepsConfirmed', count(*) filter (
      where archived_at is null
        and status = '입금대기'
        and exists (select 1 from public.payment_steps step where step.order_id = orders.id)
        and not exists (select 1 from public.payment_steps step where step.order_id = orders.id and step.confirmed_at is null)
    )
  ) from public.orders),
  'paymentSteps', (select jsonb_build_object(
    'total', count(*),
    'waiting', count(*) filter (where confirmed_at is null),
    'confirmed', count(*) filter (where confirmed_at is not null),
    'sparkSPlus', count(*) filter (where program_type = 'spark_s_plus')
  ) from public.payment_steps),
  'settlementBatches', (select jsonb_build_object(
    'total', count(*),
    'itemTotal', coalesce(sum(item_count), 0),
    'voided', count(*) filter (where status = 'voided')
  ) from public.settlement_batches),
  'batchItemPaymentStepUniqueConstraint', exists (
    select 1
    from pg_constraint
    where conrelid = 'public.settlement_batch_items'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) ilike 'UNIQUE (payment_step_id)%'
  )
) as preflight;
