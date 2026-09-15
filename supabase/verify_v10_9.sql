-- Read-only catalog checks, no application data mutations.
select version,applied_at from public.app_schema_versions where version='v10.9.0';
select proname,prosecdef,provolatile,proconfig,
  has_function_privilege('anon',oid,'execute') anon_execute,
  has_function_privilege('authenticated',oid,'execute') authenticated_execute
from pg_proc where pronamespace='public'::regnamespace and proname in ('get_manager_agency_folders_v109','get_manager_agency_orders_v109');
select
  (select md5(string_agg(pg_get_functiondef(p.oid), E'\n' order by p.oid))
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname in ('public','spark_private') and p.prokind='f' and p.proname not like '%v109') existing_function_hash,
  (select md5(string_agg(row_to_json(p)::text,E'\n' order by p.schemaname,p.tablename,p.policyname))
   from pg_policies p where p.schemaname in ('public','spark_private')) rls_policy_hash;
