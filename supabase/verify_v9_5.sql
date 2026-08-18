-- SPARK v9.5 verification
select version, description, applied_at
from public.app_schema_versions
where version = 'v9.5.0';

select
  to_regprocedure('public.get_member_deletion_check_v95(uuid)') is not null as browser_check_rpc_installed,
  to_regprocedure('public.member_deletion_check_core_v95(uuid)') is not null as service_check_rpc_installed;

select
  p.username,
  p.approval_status,
  p.role,
  p.is_operations_manager,
  not exists (select 1 from public.orders o where o.created_by = p.id or o.sponsor_id = p.id) as no_order_history,
  not exists (select 1 from public.payment_steps ps where ps.payer_id = p.id or ps.payee_id = p.id or ps.confirmed_by = p.id) as no_payment_history,
  not exists (select 1 from public.profiles c where c.sponsor_id = p.id or c.manager_id = p.id) as no_children
from public.profiles p
where p.role is distinct from 'admin'
order by p.requested_at desc
limit 20;
