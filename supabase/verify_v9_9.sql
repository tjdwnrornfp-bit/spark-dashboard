-- SPARK v9.9 적용 확인
select
  exists(select 1 from public.app_schema_versions where version = 'v9.9.0') as version_v9_9,
  to_regprocedure('public.preview_order_program_transfer_v99(uuid,text,integer)') is not null as preview_rpc_installed,
  to_regprocedure('public.transfer_order_program_v99(uuid,text,integer,text)') is not null as transfer_rpc_installed,
  to_regprocedure('public.get_approved_program_price_v99(uuid,text)') is not null as approved_price_helper_installed,
  to_regprocedure('public.complete_program_transfer_settlement_v99()') is not null as settlement_completion_trigger_function_installed;

select
  exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'program_transfer_state') as order_transfer_state_installed,
  exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'program_transfer_difference') as order_transfer_difference_installed,
  exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'payment_steps' and column_name = 'program_type') as payment_program_snapshot_installed,
  exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'payment_steps' and column_name = 'step_kind') as payment_step_kind_installed,
  to_regclass('public.order_program_transfers') is not null as transfer_history_table_installed;

select
  count(*) filter (where ps.program_type is null or ps.program_type not in ('spark', 'spark_plus', 'spark_s')) as invalid_payment_program_snapshots,
  count(*) filter (where ps.step_kind not in ('standard', 'program_adjustment')) as invalid_payment_step_kinds
from public.payment_steps ps;

select
  count(*) filter (where o.program_transfer_state = 'none' and o.program_transfer_difference <> 0) as invalid_cleared_transfer_amounts,
  count(*) filter (where o.program_transfer_state = 'payment_pending' and not exists (
    select 1 from public.payment_steps ps where ps.order_id = o.id and ps.confirmed_at is null
  )) as pending_markers_without_payment_steps
from public.orders o;

select tgname, tgenabled
from pg_trigger
where tgname in ('set_payment_step_program_snapshot_v99', 'complete_program_transfer_settlement_v99')
  and not tgisinternal
order by tgname;

select version, description, applied_at
from public.app_schema_versions
where version = 'v9.9.0';

-- 관리자 로그인 세션에서 앱의 미입금/부분입금/입금완료/구동중/만료 시나리오를 검증합니다.
