-- Read-only verification after v10.2 migration.
select version, description, applied_at
from public.app_schema_versions
order by applied_at desc
limit 3;

select
  to_regprocedure('public.get_manager_managed_orders_v102(uuid,text,text,text,text,date,date,integer,integer)') is not null as managed_orders_rpc,
  to_regprocedure('public.get_manager_managed_order_filter_options_v102()') is not null as filter_options_rpc,
  to_regprocedure('public.get_manager_managed_orders_summary_v102()') is not null as summary_rpc,
  to_regprocedure('public.get_my_settlement_page_v101(integer,integer,text,uuid,uuid,text,text,text,date,date)') is not null as admin_settlement_rpc,
  to_regprocedure('public.admin_reverse_payment_confirmation_v101(uuid,timestamptz,integer,text)') is not null as reversal_rpc,
  to_regprocedure('public.transfer_bulk_order_program_v910(jsonb,text,text)') is not null as bulk_transfer_rpc,
  to_regprocedure('public.review_member_v10(uuid,public.member_role,boolean,integer,integer,integer,integer,public.approval_status,text,timestamptz)') is not null as member_review_rpc;

select
  p.proname,
  p.prosecdef as security_definer,
  p.proconfig as function_settings,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'get_manager_managed_orders_v102',
    'get_manager_managed_order_filter_options_v102',
    'get_manager_managed_orders_summary_v102'
  )
order by p.proname;

select pg_get_functiondef('public.get_manager_managed_orders_v102(uuid,text,text,text,text,date,date,integer,integer)'::regprocedure)
  like '%mp.manager_id = auth.uid()%' as manager_scope_guard_present;

select
  count(*) filter (where is_operations_manager and approval_status = 'approved' and active) as callable_manager_count,
  count(*) filter (where manager_id is not null) as manager_linked_profiles
from public.profiles;

-- Expected to fail with 42501 in SQL Editor because auth.uid() is not an authenticated manager.
-- select * from public.get_manager_managed_orders_v102(p_page := 1, p_page_size := 1);
