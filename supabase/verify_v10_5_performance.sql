-- Read-only production verification for v10.5.
select
  exists (select 1 from public.app_schema_versions where version = 'v10.5.0') as schema_v10_5_recorded,
  to_regprocedure('public.get_manager_dashboard_summary_v103()') is not null as manager_summary_preserved,
  to_regprocedure('public.get_manager_agency_overview_v103(integer,integer,text,text)') is not null as manager_overview_preserved,
  to_regprocedure('public.get_manager_managed_orders_v102(uuid,text,text,text,text,date,date,integer,integer)') is not null as managed_orders_preserved,
  to_regprocedure('public.get_admin_member_contacts_v94()') is not null as admin_contacts_preserved;

select tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and (
    (tablename = 'orders' and cmd = 'SELECT')
    or (tablename = 'profiles' and cmd = 'SELECT')
    or policyname = any(array[
      'payment steps participant read', 'notifications own read', 'notifications own update',
      'notifications own delete', 'settlement quote owner read', 'settlement quote item owner read',
      'settlement batch participant read', 'settlement batch item participant read'
    ])
  )
order by tablename, cmd, policyname;

select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and indexname = any(array[
    'notifications_order_id_idx',
    'settlement_quote_items_payment_step_idx',
    'settlement_batch_items_registrant_idx'
  ])
order by indexname;
