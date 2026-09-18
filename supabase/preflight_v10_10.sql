-- Run before the single new migration. Read only; never replay historical files.
select (select version from public.app_schema_versions order by applied_at desc limit 1) current_schema,
  exists(select 1 from public.app_schema_versions where version='v10.9.0') v109_ready,
  not exists(select 1 from public.app_schema_versions where version='v10.10.0') v1010_not_applied,
  to_regprocedure('public.get_manager_agency_folders_v109(integer,integer,text,text,uuid,text,text[],text,date,date)') is not null folders_ready,
  to_regprocedure('public.get_manager_managed_orders_v108(uuid,text,text[],text,text,date,date,integer,integer,text)') is not null filters_sort_ready,
  exists(select 1 from pg_proc where proname='member_apply_own_order_edit_v108') own_edit_ready;

-- Save before/after and compare to prove existing functions, grants and policies unchanged.
select jsonb_build_object(
  'routines',(select jsonb_object_agg(p.oid::regprocedure::text,md5(pg_get_functiondef(p.oid)||coalesce(p.proacl::text,''))) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname not like '%v1010'),
  'policies',(select jsonb_agg(to_jsonb(x)) from (select tablename,policyname,cmd,qual,with_check from pg_policies where schemaname='public' order by tablename,policyname)x)
) baseline;
