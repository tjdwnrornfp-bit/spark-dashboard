-- Read-only verification for SPARK v10.4.0.

select
  to_regprocedure('public.admin_assign_member_manager_v104(uuid,uuid,text,timestamptz)') is not null as individual_rpc_exists,
  to_regprocedure('public.admin_bulk_assign_member_manager_v104(jsonb,uuid,text)') is not null as bulk_rpc_exists,
  exists (select 1 from public.app_schema_versions where version = 'v10.4.0') as schema_v104_recorded;

select
  p.proname,
  p.prosecdef as security_definer,
  p.provolatile,
  p.proconfig,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
  not has_function_privilege('anon', p.oid, 'EXECUTE') as anon_cannot_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('admin_assign_member_manager_v104', 'admin_bulk_assign_member_manager_v104')
order by p.proname;

select
  pg_get_functiondef('public.admin_assign_member_manager_v104(uuid,uuid,text,timestamptz)'::regprocedure)
    like '%v_actor.role is distinct from ''admin''%' as admin_server_guard_present,
  pg_get_functiondef('public.admin_assign_member_manager_v104(uuid,uuid,text,timestamptz)'::regprocedure)
    like '%v_target.updated_at is distinct from p_expected_updated_at%' as optimistic_lock_present,
  pg_get_functiondef('public.admin_assign_member_manager_v104(uuid,uuid,text,timestamptz)'::regprocedure)
    like '%set manager_id = p_manager_id,%manager_username =%' as narrow_manager_update_present,
  pg_get_functiondef('public.admin_assign_member_manager_v104(uuid,uuid,text,timestamptz)'::regprocedure)
    not like '%set sponsor_id =%' as sponsor_update_absent,
  pg_get_functiondef('public.admin_assign_member_manager_v104(uuid,uuid,text,timestamptz)'::regprocedure)
    like '%member.manager_changed%' as dedicated_audit_present;

select
  pg_get_functiondef('public.get_manager_managed_orders_v102(uuid,text,text,text,text,date,date,integer,integer)'::regprocedure)
    like '%mp.manager_id = auth.uid()%' as managed_orders_uses_current_manager,
  pg_get_functiondef('public.get_manager_managed_order_filter_options_v102()'::regprocedure)
    like '%p.manager_id = auth.uid()%' as managed_order_filters_use_current_manager,
  pg_get_functiondef('public.get_manager_dashboard_summary_v103()'::regprocedure)
    like '%mp.manager_id = auth.uid()%' as dashboard_uses_current_manager,
  pg_get_functiondef('public.get_manager_agency_overview_v103(integer,integer,text,text)'::regprocedure)
    like '%mp.manager_id = auth.uid()%' as agency_overview_uses_current_manager;

do $$
declare
  v_non_admin public.profiles;
  v_target public.profiles;
  v_guarded boolean := false;
begin
  select * into v_non_admin
  from public.profiles
  where role <> 'admin' and approval_status = 'approved' and active
  order by requested_at
  limit 1;

  select * into v_target
  from public.profiles
  where role in ('agency', 'distributor') and not is_operations_manager
  order by requested_at
  limit 1;

  if v_non_admin.id is null or v_target.id is null then
    raise notice '비관리자 또는 대상 계정이 없어 서버 권한 거부 호출 검증을 건너뜁니다.';
    return;
  end if;

  perform set_config('request.jwt.claim.sub', v_non_admin.id::text, true);
  begin
    perform public.admin_assign_member_manager_v104(v_target.id, null, '권한 검증', v_target.updated_at);
  exception when sqlstate '42501' then
    v_guarded := true;
  end;
  perform set_config('request.jwt.claim.sub', '', true);

  if not v_guarded then
    raise exception '비관리자 RPC 호출이 서버에서 차단되지 않았습니다.';
  end if;
end $$;

select
  count(*) filter (where is_operations_manager and approval_status = 'approved' and active) as eligible_manager_count,
  count(*) filter (where manager_id is not null) as managed_member_count,
  count(*) filter (where manager_id is not null and sponsor_id is not null) as managed_members_with_preserved_sponsor
from public.profiles;

select count(*) as manager_change_audit_count
from public.audit_logs
where action = 'member.manager_changed';
