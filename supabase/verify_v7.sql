-- SPARK v7 verification
select p.proname, pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('create_order', 'create_orders_bulk', 'confirm_payment_step', 'start_paid_orders', 'set_order_status')
order by p.proname, arguments;

select jobid, jobname, schedule, active
from cron.job
where jobname in ('spark-start-paid-orders', 'spark-expire-finished-orders')
order by jobname;
