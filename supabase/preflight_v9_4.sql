-- SPARK v9.4 적용 전 점검 (읽기 전용)
select
  (select count(*) from public.profiles) as members,
  (select count(*) from public.orders) as orders,
  (select count(*) from public.payment_steps) as payment_steps,
  (select count(*) from public.settlement_batches) as settlement_batches;

select version, applied_at
from public.app_schema_versions
order by applied_at desc
limit 5;

select
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='handle_new_auth_user'
  ) as signup_trigger_function,
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='create_settlement_quote_v92'
  ) as settlement_quote_function;
