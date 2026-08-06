-- Diagnose the latest settlement chains without changing data.
-- Replace the optional username filter at the bottom when narrowing the result.

select
  o.order_number,
  o.store_name,
  o.program_type,
  o.status,
  o.archived_at,
  o.creator_username,
  ps.step_order,
  ps.payer_username,
  ps.payee_username,
  ps.unit_price,
  ps.total_amount,
  ps.confirmed_at,
  (
    select count(*)
    from public.payment_steps previous_step
    where previous_step.order_id = ps.order_id
      and previous_step.step_order < ps.step_order
      and previous_step.confirmed_at is null
  ) as previous_pending_count
from public.orders o
join public.payment_steps ps on ps.order_id = o.id
-- where o.creator_username = '4번_아이디'
order by o.created_at desc, ps.step_order
limit 200;
