-- Run before update_v9_stability.sql. This query does not modify data.

select current_database() as database_name, now() as checked_at;

select count(*) as active_admins
from public.profiles
where role = 'admin' and approval_status = 'approved' and active;

select
  count(*) as total_orders,
  count(*) filter (where status = '입금대기') as waiting_orders,
  count(*) filter (where status = '입금완료') as paid_orders,
  count(*) filter (where status = '구동중') as running_orders,
  count(*) filter (where status = '정지') as stopped_orders,
  count(*) filter (where status = '만료') as expired_orders
from public.orders;

select count(*) as orders_without_payment_steps
from public.orders o
where not exists (select 1 from public.payment_steps ps where ps.order_id = o.id);

select proname
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('review_member_v8', 'create_order', 'confirm_payment_step', 'start_paid_orders')
order by proname;
