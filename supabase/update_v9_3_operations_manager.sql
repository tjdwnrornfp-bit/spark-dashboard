-- SPARK v9.3 - 중간관리자 권한 분리
-- 기존 회원/주문/정산/게이지/알림 데이터는 삭제하지 않습니다.
-- 중간관리자는 회원 승인/단가 지정만 담당하며 정산 계층에는 포함되지 않습니다.

begin;

-- 1. 관리 관계를 정산 추천 관계와 분리
alter table public.profiles add column if not exists is_operations_manager boolean not null default false;
alter table public.profiles add column if not exists manager_id uuid references public.profiles(id) on delete set null;
alter table public.profiles add column if not exists manager_username text;

create index if not exists profiles_manager_idx
  on public.profiles(manager_id, approval_status, requested_at desc);
create index if not exists profiles_operations_manager_idx
  on public.profiles(is_operations_manager, approval_status, active)
  where is_operations_manager = true;

-- 2. 프로필 조회 권한: 중간관리자는 자신이 관리하는 대행사만 추가 조회
create or replace function public.can_read_profile(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_profile_id = auth.uid()
    or public.is_admin()
    or exists (
      select 1 from public.profiles child
      where child.id = p_profile_id and child.sponsor_id = auth.uid()
    )
    or exists (
      select 1 from public.profiles child
      where child.id = p_profile_id and child.manager_id = auth.uid()
        and exists (
          select 1 from public.profiles manager
          where manager.id = auth.uid()
            and manager.is_operations_manager
            and manager.approval_status = 'approved'
            and manager.active
        )
    )
    or exists (
      select 1 from public.profiles me
      where me.id = auth.uid() and me.sponsor_id = p_profile_id
    );
$$;

revoke all on function public.can_read_profile(uuid) from public, anon;
grant execute on function public.can_read_profile(uuid) to authenticated;

-- 3. 중간관리자는 정산 계좌를 등록하지 않음
create or replace function public.save_my_settlement_account(
  p_bank text,
  p_account_number text,
  p_account_holder text
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.profiles;
begin
  if char_length(trim(coalesce(p_bank, ''))) < 1
    or char_length(trim(coalesce(p_account_number, ''))) < 1
    or char_length(trim(coalesce(p_account_holder, ''))) < 1 then
    raise exception '은행, 계좌번호, 예금주를 모두 입력해 주세요.';
  end if;

  update public.profiles
  set bank = trim(p_bank),
      account_number = trim(p_account_number),
      account_holder = trim(p_account_holder)
  where id = auth.uid()
    and role in ('agency', 'distributor')
    and not coalesce(is_operations_manager, false)
  returning * into result;

  if result.id is null then
    raise exception '이 계정은 별도 정산 계좌를 사용할 수 없습니다.';
  end if;
  return result;
end;
$$;

revoke all on function public.save_my_settlement_account(text, text, text) from public, anon;
grant execute on function public.save_my_settlement_account(text, text, text) to authenticated;

-- 4. 회원가입: 일반 추천관계와 중간관리자 관리관계를 분리
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username text;
  v_username_key text;
  v_referral_input text;
  v_referral_code text;
  v_owner_id uuid;
  v_owner_username text;
  v_owner_role public.member_role;
  v_owner_group text;
  v_owner_depth integer;
  v_owner_is_manager boolean := false;
  v_sponsor_id uuid;
  v_sponsor_username text;
  v_manager_id uuid;
  v_manager_username text;
begin
  v_username := trim(coalesce(new.raw_user_meta_data ->> 'username', ''));
  v_username_key := lower(trim(coalesce(new.raw_user_meta_data ->> 'username_key', v_username)));
  v_referral_input := lower(trim(coalesce(new.raw_user_meta_data ->> 'referral_code', '')));

  if char_length(v_username) < 4
     or char_length(v_username) > 40
     or v_username ~ '[[:cntrl:]]' then
    raise exception '아이디는 종류와 관계없이 4~40자로 입력해야 합니다.';
  end if;

  if char_length(v_username_key) < 4 or char_length(v_username_key) > 120 then
    raise exception '아이디 형식이 올바르지 않습니다.';
  end if;

  if v_referral_input <> '' then
    select p.id, p.username, p.role, p.group_name, p.hierarchy_depth, coalesce(p.is_operations_manager, false)
      into v_owner_id, v_owner_username, v_owner_role, v_owner_group, v_owner_depth, v_owner_is_manager
    from public.profiles p
    where p.approval_status = 'approved'::public.approval_status
      and p.active = true
      and p.role in ('agency'::public.member_role, 'distributor'::public.member_role)
      and (
        p.username_key = v_referral_input
        or lower(p.referral_code) = v_referral_input
      )
    limit 1;

    if v_owner_id is null then
      raise exception '유효한 추천 또는 관리 코드를 찾을 수 없습니다.';
    end if;

    if v_owner_is_manager then
      v_manager_id := v_owner_id;
      v_manager_username := v_owner_username;
    else
      if coalesce(v_owner_depth, 0) >= 24 then
        raise exception '추천 계층의 최대 깊이를 초과했습니다.';
      end if;
      v_sponsor_id := v_owner_id;
      v_sponsor_username := v_owner_username;
    end if;
  end if;

  v_referral_code := 'SP' || upper(substr(replace(new.id::text, '-', ''), 1, 12));

  insert into public.profiles (
    id,
    username,
    username_key,
    role,
    approval_status,
    price_per_shot,
    spark_price_per_shot,
    spark_plus_price_per_shot,
    spark_s_price_per_shot,
    active,
    sponsor_id,
    sponsor_username,
    is_operations_manager,
    manager_id,
    manager_username,
    referral_code,
    group_name,
    hierarchy_depth
  ) values (
    new.id,
    v_username,
    v_username_key,
    case when v_owner_id is null then null else 'agency'::public.member_role end,
    'pending'::public.approval_status,
    0,
    0,
    0,
    0,
    false,
    v_sponsor_id,
    v_sponsor_username,
    false,
    v_manager_id,
    v_manager_username,
    v_referral_code,
    coalesce(v_owner_group, ''),
    case when v_sponsor_id is null then 0 else coalesce(v_owner_depth, 0) + 1 end
  );

  -- 알림 오류가 회원가입 자체를 막지 않도록 분리
  begin
    if v_manager_id is not null then
      insert into public.notifications (user_id, target_role, title, message)
      values (
        v_manager_id,
        v_owner_role,
        '관리 대행사 승인 요청',
        v_username || ' 회원의 가입 승인이 필요합니다.'
      );

      perform public.notify_admins(
        '중간관리자 배정 가입',
        v_username || ' 회원이 ' || v_manager_username || ' 중간관리자 코드로 가입했습니다.',
        null
      );
    elsif v_sponsor_id is not null then
      insert into public.notifications (user_id, target_role, title, message)
      values (
        v_sponsor_id,
        v_owner_role,
        '하위 대행사 승인 요청',
        v_username || ' 회원의 가입 승인이 필요합니다.'
      );

      perform public.notify_admins(
        '추천 회원가입 신청',
        v_username || ' 회원이 추천 코드를 사용해 가입했습니다.',
        null
      );
    else
      perform public.notify_admins(
        '회원가입 승인 요청',
        v_username || ' 회원의 가입 승인이 필요합니다.',
        null
      );
    end if;
  exception when others then
    raise warning '회원가입 알림 생성 실패: %', sqlerrm;
  end;

  return new;
exception
  when unique_violation then
    raise exception '이미 사용 중이거나 가입 신청된 아이디입니다.';
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_auth_user();

-- 5. 관리자/일반 추천인/중간관리자의 회원 검토를 분리
create or replace function public.review_member_v93(
  p_member_id uuid,
  p_role public.member_role,
  p_is_operations_manager boolean,
  p_spark_price_per_shot integer,
  p_spark_plus_price_per_shot integer,
  p_spark_s_price_per_shot integer,
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
begin
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
    v_spark := 1;
    v_spark_plus := 1;
    v_spark_s := 1;
  else
    v_spark := p_spark_price_per_shot;
    v_spark_plus := p_spark_plus_price_per_shot;
    v_spark_s := p_spark_s_price_per_shot;
  end if;

  if p_approval_status = 'approved' and not v_make_manager and (
    v_spark < 1 or v_spark_plus < 1 or v_spark_s < 1
  ) then
    raise exception '세 프로그램 단가를 모두 1원 이상 입력해 주세요.';
  end if;

  if not v_actor_is_admin and not v_actor_is_manager and p_approval_status = 'approved' and (
    v_spark <= coalesce(v_actor.spark_price_per_shot, v_actor.price_per_shot, 0)
    or v_spark_plus <= coalesce(v_actor.spark_plus_price_per_shot, 0)
    or v_spark_s <= coalesce(v_actor.spark_s_price_per_shot, 0)
  ) then
    raise exception '하위 회원의 각 프로그램 단가는 내 단가보다 높아야 합니다.';
  end if;

  -- 대상 회원에게 이미 일반 추천 하위 회원이 있다면 단가 역전을 방지
  if p_approval_status = 'approved' and not v_make_manager and exists (
    select 1 from public.profiles c
    where c.sponsor_id = v_target.id and c.approval_status = 'approved' and c.active
      and (
        c.spark_price_per_shot <= v_spark
        or c.spark_plus_price_per_shot <= v_spark_plus
        or c.spark_s_price_per_shot <= v_spark_s
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
      price_per_shot = case when p_approval_status = 'approved' then v_spark else price_per_shot end,
      spark_price_per_shot = case when p_approval_status = 'approved' then v_spark else spark_price_per_shot end,
      spark_plus_price_per_shot = case when p_approval_status = 'approved' then v_spark_plus else spark_plus_price_per_shot end,
      spark_s_price_per_shot = case when p_approval_status = 'approved' then v_spark_s else spark_s_price_per_shot end,
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
      else '승인되었습니다. 스파크 ' || v_spark || '원 / 스파크+ ' || v_spark_plus || '원 / 스파크S ' || v_spark_s || '원입니다.'
    end
  );

  return v_result;
end;
$$;

revoke all on function public.review_member_v93(uuid, public.member_role, boolean, integer, integer, integer, public.approval_status, text, timestamptz) from public, anon;
grant execute on function public.review_member_v93(uuid, public.member_role, boolean, integer, integer, integer, public.approval_status, text, timestamptz) to authenticated;

-- 6. 작업 접수는 중간관리자에게 허용하지 않으며, 관리 대행사는 sponsor_id가 null이므로 관리자 직결 정산
create or replace function public.create_order(
  p_program_type text,
  p_place_url text,
  p_mid text,
  p_store_name text,
  p_keyword text,
  p_daily_shots integer,
  p_operation_days integer,
  p_start_date date,
  p_memo text default ''
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  member public.profiles;
  result public.orders;
  order_prefix text;
  order_number text;
  local_today date;
  minimum_start date;
  calculated_end date;
  unit_price integer;
  supply bigint;
  vat bigint;
  v_payer public.profiles;
  v_payee public.profiles;
  v_admin public.profiles;
  v_step integer := 1;
  v_unit_price integer;
  v_step_supply bigint;
  v_step_vat bigint;
begin
  select * into member from public.profiles where id = auth.uid() for update;
  if member.id is null
     or member.role not in ('agency', 'distributor')
     or member.approval_status <> 'approved'
     or not member.active
     or coalesce(member.is_operations_manager, false) then
    raise exception '승인된 대행사 또는 총판만 접수할 수 있습니다.';
  end if;

  if p_program_type not in ('spark', 'spark_plus', 'spark_s') then
    raise exception '지원하지 않는 프로그램입니다.';
  end if;

  unit_price := case p_program_type
    when 'spark' then coalesce(member.spark_price_per_shot, member.price_per_shot, 0)
    when 'spark_plus' then coalesce(member.spark_plus_price_per_shot, 0)
    when 'spark_s' then coalesce(member.spark_s_price_per_shot, 0)
  end;
  if unit_price <= 0 then raise exception '해당 프로그램 단가가 설정된 회원만 접수할 수 있습니다.'; end if;
  if p_daily_shots <= 0 or p_operation_days <= 0 then raise exception '수량과 구동일수는 1 이상의 정수여야 합니다.'; end if;
  if p_mid !~ '^[0-9]+$' then raise exception 'MID 형식이 올바르지 않습니다.'; end if;
  if char_length(trim(p_store_name)) < 1 or char_length(trim(p_keyword)) < 1 then raise exception '상호명과 대표 키워드를 입력해야 합니다.'; end if;
  if char_length(coalesce(p_memo, '')) > 300 then raise exception '메모는 300자 이하로 입력해야 합니다.'; end if;

  local_today := (now() at time zone 'Asia/Seoul')::date;
  minimum_start := local_today + 1;
  if p_start_date is null then raise exception '시작일을 선택해 주세요.'; end if;
  if p_start_date < minimum_start then raise exception '시작일은 익일부터 선택할 수 있습니다.'; end if;

  select * into v_admin from public.profiles
  where role = 'admin' and approval_status = 'approved' and active
  order by approved_at nulls last limit 1;
  if v_admin.id is null then raise exception '승인된 관리자 계정을 찾을 수 없습니다.'; end if;

  calculated_end := p_start_date + (p_operation_days - 1);
  supply := p_daily_shots::bigint * p_operation_days::bigint * unit_price::bigint;
  vat := round(supply * 0.1);
  order_prefix := case p_program_type when 'spark' then 'SPK' when 'spark_plus' then 'SPP' else 'SPS' end;
  order_number := order_prefix || '-' || to_char(local_today, 'YYYYMMDD') || '-' || lpad(nextval('public.order_number_seq')::text, 6, '0');

  insert into public.orders (
    order_number, created_by, creator_username, sponsor_id, sponsor_username, creator_group_name,
    program_type, place_url, mid, store_name, keyword, daily_shots, operation_days, price_per_shot,
    supply_amount, vat_amount, total_amount, start_date, end_date, memo
  ) values (
    order_number, member.id, member.username, member.sponsor_id, member.sponsor_username, member.group_name,
    p_program_type, trim(p_place_url), p_mid, trim(p_store_name), trim(p_keyword), p_daily_shots, p_operation_days, unit_price,
    supply, vat, supply + vat, p_start_date, calculated_end, coalesce(p_memo, '')
  ) returning * into result;

  v_payer := member;
  loop
    if v_payer.sponsor_id is null then
      v_payee := v_admin;
    else
      select * into v_payee from public.profiles where id = v_payer.sponsor_id;
      if v_payee.id is null or v_payee.approval_status <> 'approved' or not v_payee.active then
        raise exception '정산 계정 정보를 확인할 수 없습니다.';
      end if;
    end if;

    v_unit_price := case p_program_type
      when 'spark' then coalesce(v_payer.spark_price_per_shot, v_payer.price_per_shot, 0)
      when 'spark_plus' then coalesce(v_payer.spark_plus_price_per_shot, 0)
      else coalesce(v_payer.spark_s_price_per_shot, 0)
    end;
    v_step_supply := p_daily_shots::bigint * p_operation_days::bigint * v_unit_price::bigint;
    v_step_vat := round(v_step_supply * 0.1);

    insert into public.payment_steps (
      order_id, order_number, store_name, step_order,
      payer_id, payer_username, payee_id, payee_username,
      unit_price, supply_amount, vat_amount, total_amount
    ) values (
      result.id, result.order_number, result.store_name, v_step,
      v_payer.id, v_payer.username, v_payee.id, v_payee.username,
      v_unit_price, v_step_supply, v_step_vat, v_step_supply + v_step_vat
    );

    exit when v_payee.role = 'admin';
    v_payer := v_payee;
    v_step := v_step + 1;
    if v_step > 25 then raise exception '정산 계층이 너무 깊습니다.'; end if;
  end loop;

  insert into public.notifications (user_id, title, message, order_id)
  values (member.id, '작업 접수 완료', trim(p_store_name) || ' 작업이 입금대기 상태로 접수되었습니다.', result.id);

  if member.sponsor_id is not null then
    insert into public.notifications (user_id, title, message, order_id)
    values (member.sponsor_id, '하위 대행사 작업 접수', member.username || ' 회원이 ' || trim(p_store_name) || ' 작업을 접수했습니다.', result.id);
  end if;

  perform public.notify_admins(
    '새 작업 접수',
    member.username || ' 회원이 ' || trim(p_store_name) || ' 작업을 접수했습니다. 프로그램: ' || p_program_type
      || ', 정산: ' || case when member.sponsor_id is null then '관리자 직결' else coalesce(member.sponsor_username, '-') end
      || ', 관리담당: ' || coalesce(member.manager_username, '-')
      || ', 그룹: ' || coalesce(nullif(member.group_name, ''), '-'),
    result.id
  );

  return result;
end;
$$;

revoke all on function public.create_order(text, text, text, text, text, integer, integer, date, text) from public, anon;
grant execute on function public.create_order(text, text, text, text, text, integer, integer, date, text) to authenticated;

-- 7. 감사기록에 중간관리자 지정/관리관계 변경 포함
create or replace function public.audit_profiles_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text;
  v_metadata jsonb;
begin
  if tg_op = 'INSERT' then
    v_action := 'member.created';
    v_metadata := jsonb_build_object(
      'approval', new.approval_status,
      'sponsor', coalesce(new.sponsor_username, '관리자 직속'),
      'manager', coalesce(new.manager_username, ''),
      'operations_manager', coalesce(new.is_operations_manager, false)
    );
  elsif old.approval_status is distinct from new.approval_status
     or old.role is distinct from new.role
     or old.active is distinct from new.active
     or old.spark_price_per_shot is distinct from new.spark_price_per_shot
     or old.spark_plus_price_per_shot is distinct from new.spark_plus_price_per_shot
     or old.spark_s_price_per_shot is distinct from new.spark_s_price_per_shot
     or old.group_name is distinct from new.group_name
     or old.is_operations_manager is distinct from new.is_operations_manager
     or old.manager_id is distinct from new.manager_id then
    v_action := 'member.updated';
    v_metadata := jsonb_build_object(
      'approval', new.approval_status,
      'role', new.role,
      'active', new.active,
      'operations_manager', coalesce(new.is_operations_manager, false),
      'manager', coalesce(new.manager_username, ''),
      'spark', new.spark_price_per_shot,
      'spark_plus', new.spark_plus_price_per_shot,
      'spark_s', new.spark_s_price_per_shot
    );
  elsif old.bank is distinct from new.bank
     or old.account_number is distinct from new.account_number
     or old.account_holder is distinct from new.account_holder then
    v_action := 'member.account_updated';
    v_metadata := jsonb_build_object('bank', new.bank, 'holder', new.account_holder);
  else
    return new;
  end if;

  perform public.write_audit_log(v_action, 'member', new.id, new.username, v_metadata);
  return new;
end;
$$;

-- 8. 버전 기록
insert into public.app_schema_versions(version, description)
values ('v9.3.0', 'Operations manager role with separated management relation and direct-admin settlement')
on conflict (version) do update
set description = excluded.description,
    applied_at = now();

select public.write_audit_log(
  'system.migration',
  'system',
  null,
  'SPARK v9.3.0',
  jsonb_build_object('description', 'operations manager and direct admin settlement')
);

commit;
