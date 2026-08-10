-- SPARK v9.3 적용 검증 (읽기 전용)
select version, description, applied_at
from public.app_schema_versions
where version = 'v9.3.0';

select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'profiles'
  and column_name in ('is_operations_manager', 'manager_id', 'manager_username')
order by column_name;

select
  exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='review_member_v93') as review_member_v93,
  exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='handle_new_auth_user') as signup_trigger_function,
  exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='can_read_profile') as profile_permission_function,
  exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='create_order') as create_order_function;

select tgname as trigger_name, tgenabled
from pg_trigger
where tgrelid = 'auth.users'::regclass
  and tgname = 'on_auth_user_created';

select
  count(*) filter (where is_operations_manager) as operations_managers,
  count(*) filter (where manager_id is not null) as manager_linked_agencies,
  count(*) filter (where manager_id is not null and sponsor_id is not null) as invalid_dual_links
from public.profiles;

-- 중간관리자 연결 대행사는 sponsor_id가 null이어야 관리자 직결 정산입니다.
select id, username, manager_username, sponsor_username, approval_status
from public.profiles
where manager_id is not null and sponsor_id is not null;
