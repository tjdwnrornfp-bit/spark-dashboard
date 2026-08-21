-- SPARK v9.10 적용 확인
select
  exists(select 1 from public.app_schema_versions where version = 'v9.10.0') as version_v9_10,
  to_regprocedure('public.preview_bulk_order_program_transfer_v910(jsonb,text)') is not null as bulk_preview_rpc_installed,
  to_regprocedure('public.transfer_bulk_order_program_v910(jsonb,text,text)') is not null as bulk_transfer_rpc_installed,
  to_regprocedure('public.preview_order_program_transfer_v99(uuid,text,integer)') is not null as single_preview_rpc_preserved,
  to_regprocedure('public.transfer_order_program_v99(uuid,text,integer,text)') is not null as single_transfer_rpc_preserved;

select
  has_function_privilege('authenticated', 'public.preview_bulk_order_program_transfer_v910(jsonb,text)', 'EXECUTE') as authenticated_can_preview,
  has_function_privilege('authenticated', 'public.transfer_bulk_order_program_v910(jsonb,text,text)', 'EXECUTE') as authenticated_can_transfer,
  not has_function_privilege('anon', 'public.preview_bulk_order_program_transfer_v910(jsonb,text)', 'EXECUTE') as anon_cannot_preview,
  not has_function_privilege('anon', 'public.transfer_bulk_order_program_v910(jsonb,text,text)', 'EXECUTE') as anon_cannot_transfer;

select
  count(*) filter (where o.program_transfer_state = 'none' and o.program_transfer_difference <> 0) as invalid_cleared_transfer_amounts,
  count(*) filter (where o.program_transfer_state = 'payment_pending' and not exists (
    select 1 from public.payment_steps ps where ps.order_id = o.id and ps.confirmed_at is null
  )) as pending_markers_without_payment_steps
from public.orders o;

select count(*) as incomplete_program_transfer_audit_logs
from public.audit_logs a
where a.action = 'order.program_transferred'
  and (
    not a.metadata ? 'actor'
    or not a.metadata ? 'reason'
    or not a.metadata ? 'before_program'
    or not a.metadata ? 'after_program'
    or not a.metadata ? 'before_unit_price'
    or not a.metadata ? 'after_unit_price'
    or not a.metadata ? 'before_total'
    or not a.metadata ? 'after_total'
    or not a.metadata ? 'difference'
  );

select version, description, applied_at
from public.app_schema_versions
where version in ('v9.9.0', 'v9.10.0')
order by applied_at;

-- 관리자 로그인 세션에서 혼합 프로그램/등록자 선택, 동일 프로그램 자동 제외,
-- 단가 미설정, 환불 차단, 동시 수정, 부분 성공 시나리오를 앱으로 검증합니다.
