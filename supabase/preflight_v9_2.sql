-- SPARK v9.2 preflight: read-only

select
  coalesce((select max(applied_at) from public.app_schema_versions), now()) as checked_at,
  exists(select 1 from public.app_schema_versions where version = 'v9.1.0') as v9_1_installed,
  to_regprocedure('public.get_my_active_payment_steps_v91()') is not null as v9_1_settlement_rpc_installed,
  to_regprocedure('public.confirm_payment_step(uuid)') is not null as single_confirm_rpc_installed;

select
  (select count(*) from public.profiles) as profiles,
  (select count(*) from public.orders) as orders,
  (select count(*) from public.payment_steps) as payment_steps,
  (select count(*) from public.payment_steps where confirmed_at is not null) as confirmed_payment_steps,
  (select count(*) from public.orders where archived_at is not null) as archived_orders;

select status, count(*) as orders
from public.orders
where archived_at is null
group by status
order by status;
