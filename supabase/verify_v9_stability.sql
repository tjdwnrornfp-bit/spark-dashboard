-- SPARK v9 stability verification

select version, description, applied_at
from public.app_schema_versions
where version = 'v9.0.0';

select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'orders'
  and column_name in ('archived_at', 'archived_by', 'archive_reason', 'lock_version')
order by column_name;

select table_name, row_security
from information_schema.tables
where table_schema = 'public' and table_name = 'audit_logs';

select proname, pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in (
    'set_order_status_v9', 'archive_order', 'restore_order', 'review_member_v9',
    'confirm_payment_step', 'start_paid_orders', 'expire_finished_orders',
    'get_operations_health', 'write_audit_log'
  )
order by proname;

select tgname, tgenabled, c.relname as table_name
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where not t.tgisinternal
  and n.nspname = 'public'
  and tgname in ('audit_orders_changes', 'audit_profiles_changes', 'audit_payment_steps_changes')
order by tgname;

select to_regclass('cron.job') as cron_job_table;

-- inactive_cron_jobs is 0 only when both required jobs exist and are active.
select * from public.get_operations_health();
