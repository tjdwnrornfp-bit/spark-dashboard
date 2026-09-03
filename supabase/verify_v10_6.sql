-- Read-only catalog and data verification; creates no production orders.
select exists(select 1 from public.app_schema_versions where version='v10.6.0') as version_ready;

select p.proname, p.prosecdef as security_definer, p.proconfig,
  has_function_privilege('authenticated',p.oid,'execute') as authenticated_can_invoke,
  has_function_privilege('anon',p.oid,'execute') as anon_can_invoke
from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in (
  'admin_create_order_for_member_v106','admin_bulk_create_orders_for_members_v106'
);

select not has_schema_privilege('authenticated','spark_private','usage') as private_schema_blocked,
  not has_table_privilege('authenticated','spark_private.admin_order_assignments_v106','select,insert,update,delete') as private_ledger_blocked;

select
  position('v_actor.role is distinct from ''admin''' in p.prosrc)>0 as admin_role_guard,
  position('v_actor.approval_status is distinct from ''approved''' in p.prosrc)>0 as admin_approval_guard,
  position('v_actor.active is not true' in p.prosrc)>0 as admin_active_guard,
  position('v_member.active is not true' in p.prosrc)>0 as target_active_guard,
  position('v_member.is_operations_manager' in p.prosrc)>0 as manager_target_guard,
  position('order.admin_assigned' in p.prosrc)>0 as assignment_audit,
  position('exception when others' in p.prosrc)>0 as row_isolation
from pg_proc p where p.oid='spark_private.admin_assign_orders_v106(jsonb,uuid,text)'::regprocedure;

select
  position('order_number, member.id, member.username' in p.prosrc)>0 as target_owns_order,
  position('v_payer := member' in p.prosrc)>0 as target_starts_payment_chain,
  position('if unit_price <= 0' in p.prosrc)>0 as positive_target_price_guard
from pg_proc p where p.pronamespace='spark_private'::regnamespace and p.proname='create_order_for_profile_v106';

select proname, position('current_creator.group_name' in prosrc)>0 as uses_current_group
from pg_proc where pronamespace='public'::regnamespace and proname in (
  'get_my_settlement_filter_options_v92','get_my_settlement_page_v92','get_my_settlement_page_v94','create_settlement_quote_v92'
);

select count(*) as assignment_count from spark_private.admin_order_assignments_v106;
