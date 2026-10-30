-- Retire only new Spark intake. Existing orders, payment snapshots and history remain intact.
create function spark_private.reject_retired_spark_v1017()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.program_type = 'spark' and (tg_op = 'INSERT' or old.program_type is distinct from new.program_type) then
    raise exception '스파크는 접수가 종료되었습니다. 스파크+, 스파크S, 스파크S+를 선택해 주세요.' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function spark_private.reject_retired_spark_v1017() from public,anon,authenticated,service_role;
create trigger reject_retired_spark_v1017 before insert or update of program_type on public.orders
for each row execute function spark_private.reject_retired_spark_v1017();

-- One-time adjustment, including internal account values as requested. A rate of 35 is already correct.
-- Not a permanent minimum-price policy. No other program or existing order price is recalculated.
with before_prices as materialized (
  select id,username,spark_plus_price_per_shot as old_price from public.profiles where spark_plus_price_per_shot < 35 for update
), changed as (
  update public.profiles p set spark_plus_price_per_shot=35,updated_at=now()
  from before_prices b where p.id=b.id returning p.id,p.username,b.old_price
)
insert into public.audit_logs(actor_username,action,entity_type,entity_id,entity_label,metadata)
select 'system','member.spark_plus_price_adjusted','member',id,username,
  jsonb_build_object('program','spark_plus','before',old_price,'after',35,'reason','운영 변경: 35원 이하 단가를 35원으로 조정','version','10.17.0')
from changed;

-- Authorization, manager boundaries, optimistic locking and settlement hierarchy follow v9.3/v10.
-- Retired Spark rates stay private, and existing 35/35 ties can be kept during unrelated edits.
create or replace function spark_private.review_member_v1017(
  p_member_id uuid,
  p_role public.member_role,
  p_is_operations_manager boolean,
  p_spark_plus_price_per_shot integer,
  p_spark_s_price_per_shot integer,
  p_spark_s_plus_price_per_shot integer,
  p_approval_status public.approval_status,
  p_group_name text,
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
  v_result public.profiles;
  v_actor_is_admin boolean;
  v_actor_is_manager boolean;
  v_make_manager boolean;
  v_final_role public.member_role;
  v_final_group text;
  v_spark integer;
  v_spark_plus integer;
  v_spark_s integer;
  v_spark_s_plus integer;
  v_keep_equal_plus boolean;
begin
  if p_approval_status is null or p_approval_status not in ('approved','rejected') or p_role is null then raise exception '회원 유형과 승인 상태를 확인해 주세요.'; end if;
  select * into v_actor from public.profiles where id = auth.uid();
  select * into v_target from public.profiles where id = p_member_id for update;

  if v_actor.id is null or v_target.id is null then
    raise exception '회원 정보를 찾을 수 없습니다.';
  end if;
  if v_actor.approval_status is distinct from 'approved' or not v_actor.active or v_actor.role is null then
    raise exception '회원 관리 권한이 없습니다.';
  end if;
  if v_target.role = 'admin' then
    raise exception '관리자 계정은 수정할 수 없습니다.';
  end if;
  if v_target.updated_at is distinct from p_expected_updated_at then
    raise exception '다른 사용자가 먼저 회원 정보를 변경했습니다. 새로고침 후 다시 시도해 주세요.';
  end if;

  v_actor_is_admin := v_actor.role = 'admin';
  v_actor_is_manager := coalesce(v_actor.is_operations_manager, false);

  if not v_actor_is_admin then
    if v_actor_is_manager then
      if v_target.manager_id is distinct from v_actor.id then
        raise exception '내 관리 코드로 가입한 대행사만 관리할 수 있습니다.';
      end if;
      if v_target.sponsor_id is not null then
        raise exception '추천 정산 관계가 있는 회원은 중간관리자가 관리할 수 없습니다.';
      end if;
    else
      if v_target.sponsor_id is distinct from v_actor.id then
        raise exception '직접 추천한 회원만 관리할 수 있습니다.';
      end if;
    end if;
  end if;

  v_make_manager := v_actor_is_admin
    and coalesce(p_is_operations_manager, false)
    and v_target.sponsor_id is null
    and v_target.manager_id is null;

  if coalesce(p_is_operations_manager, false) and not v_actor_is_admin then
    raise exception '중간관리자 지정은 관리자만 할 수 있습니다.';
  end if;
  if coalesce(p_is_operations_manager, false) and (v_target.sponsor_id is not null or v_target.manager_id is not null) then
    raise exception '다른 회원에 연결된 계정은 중간관리자로 지정할 수 없습니다.';
  end if;

  if v_make_manager and not coalesce(v_target.is_operations_manager, false) and (
    exists (select 1 from public.orders o where o.created_by = v_target.id)
    or exists (select 1 from public.profiles c where c.sponsor_id = v_target.id)
    or exists (select 1 from public.payment_steps ps where ps.payer_id = v_target.id or ps.payee_id = v_target.id)
  ) then
    raise exception '중간관리자는 작업·정산 이력이 없는 별도 계정으로 지정해 주세요.';
  end if;

  if coalesce(v_target.is_operations_manager, false)
     and not coalesce(p_is_operations_manager, false)
     and exists (select 1 from public.profiles c where c.manager_id = v_target.id) then
    raise exception '관리 중인 대행사가 있어 중간관리자 권한을 해제할 수 없습니다.';
  end if;

  if v_target.sponsor_id is not null or v_target.manager_id is not null then
    v_final_role := 'agency'::public.member_role;
  elsif v_make_manager then
    v_final_role := 'agency'::public.member_role;
  else
    if p_role not in ('agency'::public.member_role, 'distributor'::public.member_role) then
      raise exception '회원 유형을 확인해 주세요.';
    end if;
    v_final_role := p_role;
  end if;

  if v_make_manager then
    -- 기존 profiles 승인 체크와 호환되는 내부값. 중간관리자 화면/정산에는 사용되지 않음.
    v_spark := greatest(v_target.spark_price_per_shot, 1);
    v_spark_plus := greatest(v_target.spark_plus_price_per_shot, 1);
    v_spark_s := 1;
    v_spark_s_plus := 40;
  else
    v_spark := greatest(v_target.spark_price_per_shot, 1);
    v_spark_plus := p_spark_plus_price_per_shot;
    v_spark_s := p_spark_s_price_per_shot;
    v_spark_s_plus := p_spark_s_plus_price_per_shot;
  end if;

  v_keep_equal_plus := v_target.approval_status = 'approved' and v_target.active
    and v_target.spark_plus_price_per_shot = 35 and v_spark_plus = 35;

  if p_approval_status = 'approved' and not v_make_manager and (
    v_spark_plus is null or v_spark_s is null or v_spark_s_plus is null
    or v_spark_plus < 1 or v_spark_s < 1 or v_spark_s_plus < 1
  ) then
    raise exception '세 프로그램 단가를 모두 1원 이상 입력해 주세요.';
  end if;

  if not v_actor_is_admin and not v_actor_is_manager and p_approval_status = 'approved' and (
    (v_spark_plus <= v_actor.spark_plus_price_per_shot and not (v_keep_equal_plus and v_actor.spark_plus_price_per_shot = 35))
    or v_spark_s <= v_actor.spark_s_price_per_shot
    or v_spark_s_plus <= v_actor.spark_s_plus_price_per_shot
  ) then
    raise exception '하위 회원의 각 프로그램 단가는 내 단가보다 높아야 합니다.';
  end if;

  -- 대상 회원에게 이미 일반 추천 하위 회원이 있다면 단가 역전을 방지
  if p_approval_status = 'approved' and not v_make_manager and exists (
    select 1 from public.profiles c
    where c.sponsor_id = v_target.id and c.approval_status = 'approved' and c.active
      and (
        (c.spark_plus_price_per_shot <= v_spark_plus and not (v_keep_equal_plus and c.spark_plus_price_per_shot = 35))
        or c.spark_s_price_per_shot <= v_spark_s
        or c.spark_s_plus_price_per_shot <= v_spark_s_plus
      )
  ) then
    raise exception '기존 하위 회원 단가보다 높거나 같은 값으로 변경할 수 없습니다.';
  end if;

  if v_actor_is_manager then
    v_final_group := v_target.group_name;
  elsif v_target.sponsor_id is not null then
    select p.group_name into v_final_group from public.profiles p where p.id = v_target.sponsor_id;
    v_final_group := coalesce(v_final_group, v_target.group_name);
  else
    v_final_group := coalesce(nullif(trim(p_group_name), ''), v_target.group_name);
  end if;

  if v_actor_is_admin and v_target.sponsor_id is null and v_target.manager_id is null
     and p_approval_status = 'approved' and coalesce(trim(v_final_group), '') = '' then
    raise exception '관리자용 그룹명을 입력해 주세요.';
  end if;

  update public.profiles
  set role = v_final_role,
      is_operations_manager = case
        when v_actor_is_admin and v_target.sponsor_id is null and v_target.manager_id is null
          then coalesce(p_is_operations_manager, false)
        else false
      end,
      approval_status = p_approval_status,
      active = (p_approval_status = 'approved'),
      approved_at = case when p_approval_status = 'approved' then coalesce(v_target.approved_at, now()) else v_target.approved_at end,
      group_name = coalesce(v_final_group, ''),
      price_per_shot = case when p_approval_status = 'approved' then greatest(price_per_shot, 1) else price_per_shot end,
      spark_price_per_shot = case when p_approval_status = 'approved' then v_spark else spark_price_per_shot end,
      spark_plus_price_per_shot = case when p_approval_status = 'approved' then v_spark_plus else spark_plus_price_per_shot end,
      spark_s_price_per_shot = case when p_approval_status = 'approved' then v_spark_s else spark_s_price_per_shot end,
      spark_s_plus_price_per_shot = case when p_approval_status = 'approved' then v_spark_s_plus else spark_s_plus_price_per_shot end,
      bank = case when v_make_manager then '' else bank end,
      account_number = case when v_make_manager then '' else account_number end,
      account_holder = case when v_make_manager then '' else account_holder end,
      updated_at = now()
  where id = p_member_id
  returning * into v_result;

  insert into public.notifications (user_id, title, message)
  values (
    v_result.id,
    case when p_approval_status = 'approved' then '회원가입 승인 완료' else '회원가입 반려' end,
    case
      when p_approval_status <> 'approved' then '회원가입 신청이 반려되었습니다.'
      when v_result.is_operations_manager then '중간관리자 계정으로 승인되었습니다. 관리 코드로 가입한 대행사를 승인하고 단가를 지정할 수 있습니다.'
      else '승인되었습니다. 스파크+ ' || v_spark_plus || '원 / 스파크S ' || v_spark_s || '원 / 스파크S+ ' || v_spark_s_plus || '원입니다.'
    end
  );

  insert into public.audit_logs(actor_id,actor_username,actor_role,action,entity_type,entity_id,entity_label,metadata)
    values(v_actor.id,v_actor.username,v_actor.role,'member.active_programs_reviewed','member',v_result.id,v_result.username,
      jsonb_build_object('approvalStatus',p_approval_status,'sparkPlusBefore',v_target.spark_plus_price_per_shot,'sparkPlusAfter',v_result.spark_plus_price_per_shot));
  return v_result;
end;
$$;

create function public.review_member_v1017(
  p_member_id uuid,p_role public.member_role,p_is_operations_manager boolean,
  p_spark_plus_price_per_shot integer,p_spark_s_price_per_shot integer,p_spark_s_plus_price_per_shot integer,
  p_approval_status public.approval_status,p_group_name text,p_expected_updated_at timestamptz
) returns public.profiles language sql security invoker set search_path='' as $$
  select spark_private.review_member_v1017(p_member_id,p_role,p_is_operations_manager,p_spark_plus_price_per_shot,p_spark_s_price_per_shot,p_spark_s_plus_price_per_shot,p_approval_status,p_group_name,p_expected_updated_at)
$$;
revoke all on function spark_private.review_member_v1017(uuid,public.member_role,boolean,integer,integer,integer,public.approval_status,text,timestamptz),public.review_member_v1017(uuid,public.member_role,boolean,integer,integer,integer,public.approval_status,text,timestamptz) from public,anon,authenticated,service_role;
grant usage on schema spark_private to authenticated;
grant execute on function spark_private.review_member_v1017(uuid,public.member_role,boolean,integer,integer,integer,public.approval_status,text,timestamptz),public.review_member_v1017(uuid,public.member_role,boolean,integer,integer,integer,public.approval_status,text,timestamptz) to authenticated;
insert into public.app_schema_versions(version,description) values('10.17.0','스파크 신규 접수 종료 및 스파크+ 단가 일괄 조정');
notify pgrst,'reload schema';
