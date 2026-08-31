-- Read-only production preflight for v10.5.
select
  to_regclass('public.profiles') is not null as profiles_ready,
  to_regclass('public.orders') is not null as orders_ready,
  to_regclass('public.payment_steps') is not null as payment_steps_ready,
  exists (select 1 from public.app_schema_versions where version = 'v10.4.0') as schema_v10_4_ready,
  to_regprocedure('public.is_admin()') is not null as is_admin_ready,
  to_regprocedure('public.can_read_profile(uuid)') is not null as profile_hierarchy_ready,
  to_regprocedure('public.get_my_active_payment_steps_v91()') is not null as active_steps_rpc_ready,
  to_regprocedure('public.get_manager_dashboard_summary_v103()') is not null as manager_summary_ready,
  to_regprocedure('public.get_manager_agency_overview_v103(integer,integer,text,text)') is not null as manager_overview_ready;

select tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename = any(array[
    'payment_steps', 'profiles', 'orders', 'notifications', 'settlement_quotes',
    'settlement_quote_items', 'settlement_batches', 'settlement_batch_items'
  ])
order by tablename, cmd, policyname;

select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = any(array[
    'payment_steps', 'profiles', 'orders', 'notifications', 'settlement_quotes',
    'settlement_quote_items', 'settlement_batches', 'settlement_batch_items'
  ])
order by tablename, indexname;
