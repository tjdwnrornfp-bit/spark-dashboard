-- SPARK v6 installation verification
-- Run after update_v6.sql and cron_v6.sql.

-- 1. Required v6 profile columns
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'profiles'
  and column_name in (
    'sponsor_id', 'sponsor_username', 'referral_code', 'group_name',
    'hierarchy_depth', 'bank', 'account_number', 'account_holder'
  )
order by column_name;

-- 2. Required v6 order snapshot columns
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'orders'
  and column_name in ('sponsor_id', 'sponsor_username', 'creator_group_name')
order by column_name;

-- 3. Payment table and RLS
select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'payment_steps';

-- 4. Core v6 functions
select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
    'review_member_v6', 'save_my_settlement_account', 'get_my_payment_account',
    'create_orders_bulk', 'confirm_payment_step', 'start_paid_orders',
    'expire_finished_orders', 'notify_admins', 'can_read_profile'
  )
order by routine_name;

-- 5. Realtime publication
select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
  and schemaname = 'public'
  and tablename in ('profiles', 'orders', 'payment_steps', 'notifications', 'notices', 'app_settings')
order by tablename;

-- 6. Midnight configuration
select cutoff_hour, auto_start_hour
from public.app_settings
where id = true;

-- 7. Cron jobs (run this section after enabling Supabase Cron and running cron_v6.sql)
select jobid, jobname, schedule, active
from cron.job
where jobname in ('spark-start-paid-orders', 'spark-expire-finished-orders')
order by jobname;
