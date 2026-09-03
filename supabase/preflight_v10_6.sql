-- Read-only. Apply only the new v10.6 migration after these checks pass.
select
  exists(select 1 from public.app_schema_versions where version='v10.5.0') as schema_v105_ready,
  not exists(select 1 from public.app_schema_versions where version='v10.6.0') as v106_not_applied,
  to_regprocedure('public.create_order_v10(text,text,text,text,text,integer,integer,date,text)') is not null as intake_ready,
  to_regprocedure('public.create_orders_bulk_v10(jsonb)') is not null as bulk_ready,
  to_regprocedure('public.write_audit_log(text,text,uuid,text,jsonb)') is not null as audit_ready,
  to_regprocedure('public.get_my_settlement_page_v94(integer,integer,text,uuid,uuid,text,text,text,date,date)') is not null as settlement_ready,
  exists(select 1 from public.profiles where role='admin' and approval_status='approved' and active) as active_admin_ready,
  to_regclass('spark_private.admin_order_assignments_v106') is null as new_ledger_available;

select version, applied_at from public.app_schema_versions order by applied_at desc limit 3;

-- Baseline catalog fingerprint. Unrelated operational routines must not change.
select proname, md5(pg_get_functiondef(oid)) as definition_hash
from pg_proc where pronamespace='public'::regnamespace and proname in (
  'set_order_status_v9','transfer_order_program_v99','transfer_bulk_order_program_v910',
  'archive_order','restore_order','confirm_settlement_quote_v92','admin_reverse_payment_confirmation_v101',
  'get_manager_managed_orders_v102','get_manager_dashboard_summary_v103','get_manager_agency_overview_v103',
  'admin_assign_member_manager_v104','start_paid_orders','expire_finished_orders'
) order by proname;
