-- SPARK v9.5 member account cleanup
-- Adds safe admin-only eligibility checks for permanent account deletion.
-- Actual Auth hard-delete is performed by the delete-member Edge Function.
-- Existing orders, settlements, members and audit records are never deleted by this migration.

begin;

do $$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.orders') is null
     or to_regclass('public.payment_steps') is null
     or to_regclass('public.audit_logs') is null
     or to_regclass('public.app_schema_versions') is null
     or to_regclass('public.settlement_quotes') is null
     or to_regclass('public.settlement_batches') is null then
    raise exception 'SPARK v9.4.0까지 먼저 적용되어 있어야 합니다.';
  end if;
end $$;

-- Internal eligibility calculation. Only service_role may execute this function directly.
create or replace function public.member_deletion_check_core_v95(p_member_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target public.profiles%rowtype;
  v_order_count integer := 0;
  v_sponsored_order_count integer := 0;
  v_payment_step_count integer := 0;
  v_child_count integer := 0;
  v_notice_count integer := 0;
  v_quote_count integer := 0;
  v_batch_count integer := 0;
  v_is_admin boolean := false;
  v_can_delete boolean := false;
  v_reasons text[] := array[]::text[];
begin
  select * into v_target
  from public.profiles
  where id = p_member_id;

  if not found then
    raise exception '삭제할 회원을 찾을 수 없습니다.';
  end if;

  v_is_admin := v_target.role = 'admin';

  select count(*)::integer into v_order_count
  from public.orders
  where created_by = p_member_id;

  select count(*)::integer into v_sponsored_order_count
  from public.orders
  where sponsor_id = p_member_id;

  select count(*)::integer into v_payment_step_count
  from public.payment_steps
  where payer_id = p_member_id
     or payee_id = p_member_id
     or confirmed_by = p_member_id;

  select count(*)::integer into v_child_count
  from public.profiles
  where sponsor_id = p_member_id
     or manager_id = p_member_id;

  select count(*)::integer into v_notice_count
  from public.notices
  where created_by = p_member_id;

  select (
    (select count(*) from public.settlement_quotes where requested_by = p_member_id)
    + (select count(*) from public.settlement_quote_items where payer_id = p_member_id)
  )::integer into v_quote_count;

  select (
    (select count(*) from public.settlement_batches
      where payer_id = p_member_id
         or payee_id = p_member_id
         or confirmed_by = p_member_id
         or voided_by = p_member_id)
    + (select count(*) from public.settlement_batch_items where registrant_id = p_member_id)
  )::integer into v_batch_count;

  if v_is_admin then
    v_reasons := array_append(v_reasons, '관리자 계정');
  end if;
  if v_order_count > 0 then
    v_reasons := array_append(v_reasons, format('직접 접수한 작업 %s건', v_order_count));
  end if;
  if v_sponsored_order_count > 0 then
    v_reasons := array_append(v_reasons, format('추천 관계로 연결된 작업 %s건', v_sponsored_order_count));
  end if;
  if v_payment_step_count > 0 then
    v_reasons := array_append(v_reasons, format('정산 참여 이력 %s건', v_payment_step_count));
  end if;
  if v_child_count > 0 then
    v_reasons := array_append(v_reasons, format('연결된 하위 회원 %s명', v_child_count));
  end if;
  if v_notice_count > 0 then
    v_reasons := array_append(v_reasons, format('작성한 공지 %s건', v_notice_count));
  end if;
  if v_quote_count > 0 then
    v_reasons := array_append(v_reasons, format('정산 견적 이력 %s건', v_quote_count));
  end if;
  if v_batch_count > 0 then
    v_reasons := array_append(v_reasons, format('정산 묶음 이력 %s건', v_batch_count));
  end if;

  v_can_delete := not v_is_admin
    and v_order_count = 0
    and v_sponsored_order_count = 0
    and v_payment_step_count = 0
    and v_child_count = 0
    and v_notice_count = 0
    and v_quote_count = 0
    and v_batch_count = 0;

  return jsonb_build_object(
    'member_id', v_target.id,
    'username', v_target.username,
    'can_delete', v_can_delete,
    'is_admin_account', v_is_admin,
    'is_current_user', false,
    'order_count', v_order_count,
    'sponsored_order_count', v_sponsored_order_count,
    'payment_step_count', v_payment_step_count,
    'child_count', v_child_count,
    'notice_count', v_notice_count,
    'settlement_quote_count', v_quote_count,
    'settlement_batch_count', v_batch_count,
    'reasons', to_jsonb(v_reasons)
  );
end;
$$;

revoke all on function public.member_deletion_check_core_v95(uuid) from public, anon, authenticated;
grant execute on function public.member_deletion_check_core_v95(uuid) to service_role;

-- Browser-safe admin wrapper used by the member management UI.
create or replace function public.get_member_deletion_check_v95(p_member_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_is_self boolean := p_member_id = auth.uid();
begin
  if not public.is_admin() then
    raise exception '관리자만 계정 삭제 여부를 확인할 수 있습니다.';
  end if;

  v_result := public.member_deletion_check_core_v95(p_member_id);

  if v_is_self then
    v_result := jsonb_set(v_result, '{can_delete}', 'false'::jsonb, true);
    v_result := jsonb_set(v_result, '{is_current_user}', 'true'::jsonb, true);
    v_result := jsonb_set(
      v_result,
      '{reasons}',
      coalesce(v_result -> 'reasons', '[]'::jsonb) || jsonb_build_array('현재 로그인한 계정'),
      true
    );
  end if;

  return v_result;
end;
$$;

revoke all on function public.get_member_deletion_check_v95(uuid) from public, anon;
grant execute on function public.get_member_deletion_check_v95(uuid) to authenticated;

insert into public.app_schema_versions(version, description)
values ('v9.5.0', 'Safe admin-only permanent cleanup for unused member accounts')
on conflict (version) do update
set description = excluded.description,
    applied_at = now();

select public.write_audit_log(
  'system.migration',
  'system',
  null,
  'SPARK v9.5.0',
  jsonb_build_object('description', 'safe unused member account cleanup')
);

commit;
