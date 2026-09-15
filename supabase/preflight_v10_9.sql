-- Read-only. Save hashes and version before applying ONLY the new v10.9 migration.
select (select version from public.app_schema_versions order by applied_at desc limit 1) current_schema,
  exists(select 1 from public.app_schema_versions where version='v10.8.0') v108_ready,
  not exists(select 1 from public.app_schema_versions where version='v10.9.0') v109_not_applied,
  to_regprocedure('public.get_manager_managed_orders_v108(uuid,text,text[],text,text,date,date,integer,integer,text)') is not null managed_ready,
  to_regprocedure('public.get_manager_dashboard_summary_v103()') is not null dashboard_ready;
select
  (select md5(string_agg(pg_get_functiondef(p.oid), E'\n' order by p.oid))
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname in ('public','spark_private') and p.prokind='f' and p.proname not like '%v109') existing_function_hash,
  (select md5(string_agg(row_to_json(p)::text,E'\n' order by p.schemaname,p.tablename,p.policyname))
   from pg_policies p where p.schemaname in ('public','spark_private')) rls_policy_hash;
