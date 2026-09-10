-- Read-only; do not run old migrations.
select
  (select version from public.app_schema_versions order by applied_at desc limit 1) as current_schema,
  exists(select 1 from public.app_schema_versions where version='v10.7.0') as v107_ready,
  not exists(select 1 from public.app_schema_versions where version='v10.8.0') as v108_not_applied,
  to_regprocedure('spark_private.assignment_mid_v106(text)') is not null as mid_ready,
  to_regprocedure('public.admin_preview_order_correction_v107(uuid,integer,jsonb,text)') is not null as correction_ready,
  to_regprocedure('public.get_manager_managed_orders_v102(uuid,text,text,text,text,date,date,integer,integer)') is not null as managed_ready,
  to_regclass('public.settlement_quote_items') is not null as quotes_ready;

-- Record this result before and after application: existing routines and RLS must match.
select
  (select md5(string_agg(pg_get_functiondef(p.oid), E'\n' order by p.oid))
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname in ('public','spark_private') and p.prokind='f' and p.proname not like '%v108') as existing_function_hash,
  (select md5(string_agg(row_to_json(p)::text,E'\n' order by p.schemaname,p.tablename,p.policyname))
   from pg_policies p where p.schemaname in ('public','spark_private')) as rls_policy_hash;
