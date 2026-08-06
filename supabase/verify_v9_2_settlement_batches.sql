-- SPARK v9.2 settlement operations verification

select version, description, applied_at
from public.app_schema_versions
where version = 'v9.2.0';

select
  to_regclass('public.settlement_quotes') is not null as settlement_quotes_installed,
  to_regclass('public.settlement_quote_items') is not null as settlement_quote_items_installed,
  to_regclass('public.settlement_batches') is not null as settlement_batches_installed,
  to_regclass('public.settlement_batch_items') is not null as settlement_batch_items_installed;

select
  to_regprocedure('public.get_my_settlement_page_v92(integer,integer,text,uuid,uuid,text,text,text,date,date)') is not null as settlement_page_rpc_installed,
  to_regprocedure('public.get_my_settlement_summary_v92()') is not null as settlement_summary_rpc_installed,
  to_regprocedure('public.get_my_settlement_filter_options_v92()') is not null as settlement_filters_rpc_installed,
  to_regprocedure('public.create_settlement_quote_v92(text,uuid[],uuid[],text,uuid,uuid,text,text,text,date,date)') is not null as settlement_quote_rpc_installed,
  to_regprocedure('public.confirm_settlement_quote_v92(uuid,jsonb,text)') is not null as settlement_confirm_rpc_installed,
  to_regprocedure('public.get_my_settlement_batches_v92(integer)') is not null as settlement_history_rpc_installed,
  to_regprocedure('public.get_settlement_batch_items_v92(uuid)') is not null as settlement_batch_items_rpc_installed;

select
  relname as table_name,
  relrowsecurity as rls_enabled
from pg_class
where oid in (
  'public.settlement_quotes'::regclass,
  'public.settlement_quote_items'::regclass,
  'public.settlement_batches'::regclass,
  'public.settlement_batch_items'::regclass
)
order by relname;

select
  schemaname,
  tablename,
  indexname
from pg_indexes
where schemaname = 'public'
  and indexname in (
    'payment_steps_payee_waiting_v92_idx',
    'orders_settlement_filter_v92_idx',
    'settlement_batches_payee_idx',
    'settlement_batches_payer_idx',
    'settlement_batch_items_order_idx'
  )
order by indexname;

select
  count(*) as existing_profiles,
  (select count(*) from public.orders) as existing_orders,
  (select count(*) from public.payment_steps) as existing_payment_steps,
  (select count(*) from public.payment_steps where confirmed_at is not null) as existing_confirmed_steps;

select
  count(*) filter (where o.archived_at is null and ps.confirmed_at is null) as active_waiting_steps,
  count(*) filter (where o.archived_at is null and ps.confirmed_at is not null) as active_confirmed_steps,
  count(*) filter (where o.archived_at is not null) as archived_order_steps
from public.payment_steps ps
join public.orders o on o.id = ps.order_id;
