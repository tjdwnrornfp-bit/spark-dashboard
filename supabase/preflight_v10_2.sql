-- Read-only preflight. Run before 20260828120000_v10_2_manager_managed_orders.sql.
select version, description, applied_at
from public.app_schema_versions
order by applied_at desc
limit 5;

select
  to_regclass('public.profiles') is not null as profiles_exists,
  to_regclass('public.orders') is not null as orders_exists,
  to_regclass('public.payment_steps') is not null as payment_steps_exists,
  to_regprocedure('public.admin_reverse_payment_confirmation_v101(uuid,timestamptz,integer,text)') is not null as reversal_v101_exists,
  exists (select 1 from public.app_schema_versions where version = 'v10.1.0') as schema_v101_recorded;

select
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'manager_id') as manager_id_exists,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'is_operations_manager') as manager_flag_exists,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'program_transfer_state') as transfer_state_exists,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'settlement_reversal_pending') as reversal_pending_exists;

select
  count(*) filter (where is_operations_manager and approval_status = 'approved' and active) as active_approved_managers,
  count(*) filter (where manager_id is not null) as manager_linked_profiles
from public.profiles;
