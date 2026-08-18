-- SPARK v9.5 preflight: read-only checks
select version, description, applied_at
from public.app_schema_versions
order by applied_at desc
limit 5;

select
  count(*) as members,
  count(*) filter (where role = 'admin' and approval_status = 'approved' and active) as active_admins,
  count(*) filter (where role <> 'admin' or role is null) as non_admin_members
from public.profiles;

select
  count(*) as orders,
  (select count(*) from public.payment_steps) as payment_steps,
  (select count(*) from public.settlement_batches) as settlement_batches,
  (select count(*) from public.audit_logs) as audit_logs
from public.orders;
