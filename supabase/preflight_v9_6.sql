-- SPARK v9.6 적용 전 확인 - 데이터 변경 없음
select
  (select count(*) from public.profiles) as members,
  (select count(*) from public.orders) as orders,
  (select count(*) from public.payment_steps) as payment_steps,
  (select count(*) from public.orders where archived_at is null) as active_orders,
  (select count(*) from public.orders where archived_at is null and status::text = '구동중') as running_orders,
  (select count(*) from public.orders where archived_at is null and status::text = '만료') as expired_orders;

select version, description, applied_at
from public.app_schema_versions
order by applied_at desc
limit 5;
