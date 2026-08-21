-- SPARK v9.9 적용 전 확인 - 데이터 변경 없음
select
  (select count(*) from public.profiles) as members,
  (select count(*) from public.orders) as orders,
  (select count(*) from public.payment_steps) as payment_steps,
  (select count(*) from public.payment_steps where confirmed_at is not null) as confirmed_payment_steps,
  (select count(*) from public.orders o where not exists (select 1 from public.payment_steps ps where ps.order_id = o.id)) as orders_without_payment_steps,
  (select count(*) from public.settlement_quotes where status = 'pending' and expires_at >= now()) as active_settlement_quotes;

select
  count(*) filter (where spark_price_per_shot <= 0) as members_without_spark_price,
  count(*) filter (where spark_plus_price_per_shot <= 0) as members_without_spark_plus_price,
  count(*) filter (where spark_s_price_per_shot <= 0) as members_without_spark_s_price
from public.profiles
where approval_status = 'approved' and active and role is not null and role::text <> 'admin';

select version, description, applied_at
from public.app_schema_versions
order by applied_at desc
limit 10;
