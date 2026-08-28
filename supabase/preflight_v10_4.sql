-- Read-only preflight. Run before 20260828220000_v10_4_admin_manager_assignment.sql.

select
  to_regclass('public.profiles') is not null as profiles_ready,
  to_regclass('public.audit_logs') is not null as audit_logs_ready,
  to_regclass('public.app_schema_versions') is not null as schema_versions_ready,
  to_regprocedure('public.write_audit_log(text,text,uuid,text,jsonb)') is not null as audit_writer_ready,
  to_regprocedure('public.get_manager_managed_orders_v102(uuid,text,text,text,text,date,date,integer,integer)') is not null as managed_orders_v102_ready,
  to_regprocedure('public.get_manager_dashboard_summary_v103()') is not null as manager_dashboard_v103_ready,
  to_regprocedure('public.get_manager_agency_overview_v103(integer,integer,text,text)') is not null as manager_overview_v103_ready,
  exists (select 1 from public.app_schema_versions where version = 'v10.3.0') as schema_v103_recorded;

select
  count(*) filter (where role = 'admin' and approval_status = 'approved' and active and not is_operations_manager) as callable_admins,
  count(*) filter (where is_operations_manager and approval_status = 'approved' and active) as eligible_managers,
  count(*) filter (
    where role in ('agency', 'distributor')
      and not is_operations_manager
      and approval_status <> 'rejected'
      and (approval_status <> 'approved' or active)
  ) as eligible_member_targets,
  count(*) filter (where manager_id is not null) as currently_managed_members,
  count(*) filter (where manager_id is not null and sponsor_id is not null) as managed_members_with_preserved_sponsor
from public.profiles;

select version, description, applied_at
from public.app_schema_versions
order by applied_at desc
limit 8;
