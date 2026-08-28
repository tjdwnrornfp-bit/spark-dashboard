-- Read-only verification after v10.3 migration.
select version, description, applied_at
from public.app_schema_versions
order by applied_at desc
limit 3;

select
  to_regprocedure('public.get_manager_dashboard_summary_v103()') is not null as manager_dashboard_summary_rpc,
  to_regprocedure('public.get_manager_agency_overview_v103(integer,integer,text,text)') is not null as manager_agency_overview_rpc,
  to_regprocedure('public.get_manager_managed_orders_v102(uuid,text,text,text,text,date,date,integer,integer)') is not null as managed_orders_v102_preserved,
  to_regprocedure('public.admin_reverse_payment_confirmation_v101(uuid,timestamptz,integer,text)') is not null as reversal_v101_preserved,
  to_regprocedure('public.transfer_bulk_order_program_v910(jsonb,text,text)') is not null as bulk_transfer_v910_preserved;

select
  p.proname,
  p.prosecdef as security_definer,
  p.proconfig as function_settings,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('get_manager_dashboard_summary_v103', 'get_manager_agency_overview_v103')
order by p.proname;

select
  pg_get_functiondef('public.get_manager_dashboard_summary_v103()'::regprocedure)
    like '%mp.manager_id = auth.uid()%' as summary_manager_scope_guard,
  pg_get_functiondef('public.get_manager_agency_overview_v103(integer,integer,text,text)'::regprocedure)
    like '%mp.manager_id = auth.uid()%' as overview_manager_scope_guard,
  pg_get_functiondef('public.get_manager_dashboard_summary_v103()'::regprocedure)
    like '%step.payer_id = o.created_by%' as summary_direct_step_guard,
  pg_get_functiondef('public.get_manager_agency_overview_v103(integer,integer,text,text)'::regprocedure)
    like '%step.payer_id = o.created_by%' as overview_direct_step_guard;

do $verify$
declare
  v_manager_id uuid;
  v_summary record;
  v_overview jsonb;
  v_bad_scope bigint;
begin
  select id into v_manager_id
  from public.profiles
  where is_operations_manager and approval_status = 'approved' and active
  order by approved_at nulls last, id
  limit 1;

  if v_manager_id is null then
    raise notice '호출 가능한 승인·활성 중간관리자가 없어 실계정 RPC 호출 검증을 건너뜁니다.';
    return;
  end if;

  perform set_config('request.jwt.claim.sub', v_manager_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  select * into v_summary from public.get_manager_dashboard_summary_v103();
  if v_summary.total_settlement_amount
     <> v_summary.settlement_waiting_amount + v_summary.settlement_completed_amount then
    raise exception '중간관리자 요약 금액 무결성 검증에 실패했습니다.';
  end if;

  v_overview := public.get_manager_agency_overview_v103(1, 12, null, 'settlement_waiting');
  select count(*) into v_bad_scope
  from jsonb_array_elements(v_overview -> 'agencies') item
  left join public.profiles agency on agency.id = (item ->> 'agencyId')::uuid
  where agency.id is null or agency.manager_id is distinct from v_manager_id;
  if v_bad_scope > 0 then
    raise exception '대행사 카드 manager_id 범위 검증에 실패했습니다.';
  end if;

  raise notice 'manager % summary: %', v_manager_id, row_to_json(v_summary);
  raise notice 'manager % overview shape: page=%, agencyCount=%, returned=%',
    v_manager_id,
    v_overview ->> 'page',
    v_overview ->> 'agencyCount',
    jsonb_array_length(v_overview -> 'agencies');
end
$verify$;

-- Expected to fail with 42501 in SQL Editor without the authenticated-manager claim above.
-- select * from public.get_manager_dashboard_summary_v103();
