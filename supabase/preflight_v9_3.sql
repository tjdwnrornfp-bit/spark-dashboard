-- SPARK v9.3 적용 전 점검 (읽기 전용)
select 'profiles' as item, count(*)::bigint as value from public.profiles
union all select 'orders', count(*) from public.orders
union all select 'payment_steps', count(*) from public.payment_steps
union all select 'notifications', count(*) from public.notifications
union all select 'active_admins', count(*) from public.profiles where role = 'admin' and approval_status = 'approved' and active;

select
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='is_operations_manager') as operations_manager_column_exists,
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='manager_id') as manager_id_column_exists,
  exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='review_member_v93') as review_v93_exists;

select version, description, applied_at
from public.app_schema_versions
order by applied_at desc
limit 5;
