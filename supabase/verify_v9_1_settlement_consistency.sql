-- SPARK v9.1 verification

select version, description, applied_at
from public.app_schema_versions
where version = 'v9.1.0';

select
  to_regprocedure('public.get_my_active_payment_steps_v91()') is not null as settlement_rpc_installed,
  to_regprocedure('public.touch_payment_steps_on_order_archive_v91()') is not null as archive_realtime_trigger_function_installed;

select
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'payment_steps' and column_name = 'updated_at'
  ) as payment_steps_realtime_column_installed,
  exists (
    select 1 from pg_trigger
    where tgname = 'touch_payment_steps_on_order_archive_v91' and not tgisinternal
  ) as archive_realtime_trigger_installed;

-- Run while logged in through the app to validate each account's own results.
-- In SQL Editor, auth.uid() is normally null, so the RPC result itself will be empty.
select
  count(*) filter (where archived_at is null) as active_orders,
  count(*) filter (where archived_at is not null) as archived_orders
from public.orders;

select
  count(*) as active_steps_linked_to_archived_orders
from public.payment_steps ps
join public.orders o on o.id = ps.order_id
where o.archived_at is not null;

-- Data remains stored even when archived. The app/RPC excludes it from operational totals.
select
  o.order_number,
  o.store_name,
  o.archived_at,
  count(ps.id) as stored_payment_steps
from public.orders o
left join public.payment_steps ps on ps.order_id = o.id
where o.archived_at is not null
group by o.id, o.order_number, o.store_name, o.archived_at
order by o.archived_at desc
limit 20;
