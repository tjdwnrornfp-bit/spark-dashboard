-- Replace the old v5 cron jobs after update_v6.sql has been applied.
-- Supabase Cron schedules use UTC. This function itself evaluates Asia/Seoul dates.

select cron.unschedule(jobid)
from cron.job
where jobname in ('spark-start-paid-orders', 'spark-expire-finished-orders');

-- Every minute. At 00:00 KST, eligible paid orders start within about one minute.
select cron.schedule(
  'spark-start-paid-orders',
  '* * * * *',
  $$select public.start_paid_orders();$$
);

-- Every five minutes, orders whose end date has passed become expired.
select cron.schedule(
  'spark-expire-finished-orders',
  '*/5 * * * *',
  $$select public.expire_finished_orders();$$
);
