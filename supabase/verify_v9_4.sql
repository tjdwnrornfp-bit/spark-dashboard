-- SPARK v9.4 적용 검증 (읽기 전용)
select version, description, applied_at
from public.app_schema_versions
where version = 'v9.4.0';

select
  to_regclass('public.member_contacts') is not null as member_contacts_table,
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'get_admin_member_contacts_v94'
  ) as admin_contacts_rpc,
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'get_my_settlement_page_v94'
  ) as settlement_company_rpc,
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'handle_new_auth_user'
  ) as signup_trigger_function;

select tgname as trigger_name, tgenabled
from pg_trigger
where tgrelid = 'auth.users'::regclass
  and tgname = 'on_auth_user_created';

select
  count(*) as saved_phone_numbers,
  count(*) filter (where phone_number !~ '^[0-9]{8,15}$') as invalid_phone_numbers
from public.member_contacts;
