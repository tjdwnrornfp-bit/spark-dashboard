-- SPARK v10.4.0: admin assignment/reassignment/removal of existing member managers.
-- Only profiles.manager_id, profiles.manager_username, and profiles.updated_at are changed.
-- Referral, hierarchy, order, payment, and settlement data are intentionally untouched.

begin;

do $$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.audit_logs') is null
     or to_regclass('public.app_schema_versions') is null
     or to_regprocedure('public.write_audit_log(text,text,uuid,text,jsonb)') is null
     or to_regprocedure('public.get_manager_managed_orders_v102(uuid,text,text,text,text,date,date,integer,integer)') is null
     or to_regprocedure('public.get_manager_dashboard_summary_v103()') is null
     or to_regprocedure('public.get_manager_agency_overview_v103(integer,integer,text,text)') is null then
    raise exception 'SPARK v10.3.0까지 먼저 적용되어 있어야 합니다.';
  end if;
  if not exists (select 1 from public.app_schema_versions where version = 'v10.3.0') then
    raise exception 'app_schema_versions에서 v10.3.0을 확인할 수 없습니다.';
  end if;
end $$;

create or replace function public.admin_assign_member_manager_v104(
  p_member_id uuid,
  p_manager_id uuid,
  p_reason text,
  p_expected_updated_at timestamptz
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles;
  v_target public.profiles;
  v_manager public.profiles;
  v_result public.profiles;
  v_reason text := trim(coalesce(p_reason, ''));
  v_changed_at timestamptz := clock_timestamp();
begin
  select * into v_actor
  from public.profiles
  where id = auth.uid();

  if v_actor.id is null
     or v_actor.role is distinct from 'admin'
     or v_actor.approval_status is distinct from 'approved'
     or not coalesce(v_actor.active, false)
     or coalesce(v_actor.is_operations_manager, false) then
    raise exception using errcode = '42501', message = '승인된 활성 관리자만 관리 담당을 변경할 수 있습니다.';
  end if;

  if char_length(v_reason) < 2 or char_length(v_reason) > 300 then
    raise exception '변경 사유를 2자 이상 300자 이하로 입력해 주세요.';
  end if;
  if p_member_id is null then
    raise exception '대상 회원을 선택해 주세요.';
  end if;

  select * into v_target
  from public.profiles
  where id = p_member_id
  for update;

  if v_target.id is null then
    raise exception '대상 회원을 찾을 수 없습니다.';
  end if;
  if v_target.id = v_actor.id
     or v_target.role not in ('agency'::public.member_role, 'distributor'::public.member_role)
     or coalesce(v_target.is_operations_manager, false)
     or v_target.approval_status = 'rejected'
     or (v_target.approval_status = 'approved' and not coalesce(v_target.active, false)) then
    raise exception '승인·활성 대행사/총판 또는 승인대기 대행사만 관리 대상으로 배정할 수 있습니다.';
  end if;
  if v_target.updated_at is distinct from p_expected_updated_at then
    raise exception '다른 사용자가 먼저 회원 정보를 변경했습니다. 새로고침 후 다시 시도해 주세요.';
  end if;
  if v_target.manager_id is not distinct from p_manager_id then
    raise exception using message = case when p_manager_id is null
      then '이미 관리자 직속 회원입니다.'
      else '이미 선택한 중간관리자가 담당하고 있습니다.'
    end;
  end if;

  if p_manager_id is not null then
    if p_manager_id = v_target.id then
      raise exception '자기 자신을 관리 담당으로 배정할 수 없습니다.';
    end if;

    select * into v_manager
    from public.profiles
    where id = p_manager_id
    for share;

    if v_manager.id is null
       or not coalesce(v_manager.is_operations_manager, false)
       or v_manager.approval_status is distinct from 'approved'
       or not coalesce(v_manager.active, false) then
      raise exception '승인 완료된 활성 중간관리자만 선택할 수 있습니다.';
    end if;
  end if;

  update public.profiles
  set manager_id = p_manager_id,
      manager_username = case when p_manager_id is null then null else v_manager.username end,
      updated_at = v_changed_at
  where id = v_target.id
  returning * into v_result;

  -- These assertions make the intentionally narrow mutation contract executable.
  if v_result.sponsor_id is distinct from v_target.sponsor_id
     or v_result.sponsor_username is distinct from v_target.sponsor_username
     or v_result.hierarchy_depth is distinct from v_target.hierarchy_depth then
    raise exception '추천/정산 관계 보존 검증에 실패했습니다.';
  end if;

  perform public.write_audit_log(
    'member.manager_changed',
    'member',
    v_result.id,
    v_result.username,
    jsonb_build_object(
      'member_id', v_result.id,
      'username', v_result.username,
      'before_manager_id', v_target.manager_id,
      'before_manager_username', v_target.manager_username,
      'after_manager_id', v_result.manager_id,
      'after_manager_username', v_result.manager_username,
      'sponsor_id', v_target.sponsor_id,
      'sponsor_username', v_target.sponsor_username,
      'actor_id', v_actor.id,
      'actor_username', v_actor.username,
      'actor_role', v_actor.role,
      'reason', v_reason,
      'changed_at', v_changed_at
    )
  );

  return v_result;
end;
$$;

revoke all on function public.admin_assign_member_manager_v104(uuid,uuid,text,timestamptz) from public, anon, authenticated;
grant execute on function public.admin_assign_member_manager_v104(uuid,uuid,text,timestamptz) to authenticated;

create or replace function public.admin_bulk_assign_member_manager_v104(
  p_items jsonb,
  p_manager_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles;
  v_manager public.profiles;
  v_item jsonb;
  v_profile public.profiles;
  v_member_id uuid;
  v_expected_updated_at timestamptz;
  v_username text;
  v_reason text := trim(coalesce(p_reason, ''));
  v_items jsonb := '[]'::jsonb;
  v_selected integer;
  v_succeeded integer := 0;
  v_failed integer := 0;
begin
  select * into v_actor
  from public.profiles
  where id = auth.uid();

  if v_actor.id is null
     or v_actor.role is distinct from 'admin'
     or v_actor.approval_status is distinct from 'approved'
     or not coalesce(v_actor.active, false)
     or coalesce(v_actor.is_operations_manager, false) then
    raise exception using errcode = '42501', message = '승인된 활성 관리자만 관리 담당을 일괄 변경할 수 있습니다.';
  end if;
  if char_length(v_reason) < 2 or char_length(v_reason) > 300 then
    raise exception '변경 사유를 2자 이상 300자 이하로 입력해 주세요.';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception '일괄 변경 항목 형식이 올바르지 않습니다.';
  end if;

  v_selected := jsonb_array_length(p_items);
  if v_selected < 1 or v_selected > 200 then
    raise exception '한 번에 1명 이상 200명 이하로 선택해 주세요.';
  end if;

  if p_manager_id is not null then
    select * into v_manager
    from public.profiles
    where id = p_manager_id
    for share;
    if v_manager.id is null
       or not coalesce(v_manager.is_operations_manager, false)
       or v_manager.approval_status is distinct from 'approved'
       or not coalesce(v_manager.active, false) then
      raise exception '승인 완료된 활성 중간관리자만 선택할 수 있습니다.';
    end if;
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_member_id := null;
    v_expected_updated_at := null;
    v_username := '';
    begin
      v_member_id := (v_item ->> 'member_id')::uuid;
      v_expected_updated_at := (v_item ->> 'expected_updated_at')::timestamptz;

      select * into v_profile
      from public.admin_assign_member_manager_v104(
        v_member_id,
        p_manager_id,
        v_reason,
        v_expected_updated_at
      );

      v_succeeded := v_succeeded + 1;
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'memberId', v_profile.id,
        'username', v_profile.username,
        'status', 'succeeded',
        'message', '관리 담당이 변경되었습니다.',
        'profile', to_jsonb(v_profile)
      ));
    exception when others then
      v_failed := v_failed + 1;
      if v_member_id is not null then
        select username into v_username from public.profiles where id = v_member_id;
      end if;
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'memberId', coalesce(v_member_id::text, v_item ->> 'member_id', ''),
        'username', coalesce(v_username, ''),
        'status', 'failed',
        'message', sqlerrm,
        'code', sqlstate,
        'profile', null
      ));
    end;
  end loop;

  return jsonb_build_object(
    'selectedCount', v_selected,
    'succeededCount', v_succeeded,
    'failedCount', v_failed,
    'managerId', p_manager_id,
    'managerUsername', case when p_manager_id is null then null else v_manager.username end,
    'items', v_items
  );
end;
$$;

revoke all on function public.admin_bulk_assign_member_manager_v104(jsonb,uuid,text) from public, anon, authenticated;
grant execute on function public.admin_bulk_assign_member_manager_v104(jsonb,uuid,text) to authenticated;

insert into public.app_schema_versions(version, description)
values ('v10.4.0', 'Admin assignment, reassignment, and removal of existing member managers')
on conflict (version) do nothing;

select public.write_audit_log(
  'system.migration',
  'system',
  null,
  'SPARK v10.4.0',
  jsonb_build_object('description', 'admin-only manager assignment for existing members with per-member audit evidence')
);

commit;
