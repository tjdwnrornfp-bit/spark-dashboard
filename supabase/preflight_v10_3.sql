-- Read-only preflight. Run before 20260828180000_v10_3_manager_dashboard_overview.sql.
select version, description, applied_at
from public.app_schema_versions
order by applied_at desc
limit 5;

select
  to_regprocedure('public.get_manager_managed_orders_v102(uuid,text,text,text,text,date,date,integer,integer)') is not null as managed_orders_v102_exists,
  to_regprocedure('public.get_manager_managed_order_filter_options_v102()') is not null as manager_filters_v102_exists,
  to_regprocedure('public.get_manager_managed_orders_summary_v102()') is not null as manager_summary_v102_exists,
  exists (select 1 from public.app_schema_versions where version = 'v10.2.0') as schema_v102_recorded;

select
  count(*) filter (where is_operations_manager and approval_status = 'approved' and active) as active_approved_managers,
  count(*) filter (where manager_id is not null) as manager_linked_profiles,
  count(*) filter (where manager_id is not null and sponsor_id is not null) as manager_linked_profiles_with_sponsor
from public.profiles;

select
  count(*) as managed_active_orders,
  count(*) filter (where direct_step_count = 0) as managed_orders_without_direct_step,
  count(*) filter (where direct_step_count > 0 and direct_step_total <> order_total) as direct_step_total_mismatch
from (
  select
    o.id,
    o.total_amount as order_total,
    count(ps.id) as direct_step_count,
    coalesce(sum(ps.total_amount), 0) as direct_step_total
  from public.profiles mp
  join public.orders o on o.created_by = mp.id and o.archived_at is null
  left join public.payment_steps ps on ps.order_id = o.id and ps.payer_id = o.created_by
  where mp.manager_id is not null
  group by o.id, o.total_amount
) checked;
