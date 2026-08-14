-- SPARK v9.4 - 회원 연락처 + 관리자 업체별 정산 확인
-- 기존 회원/작업/정산/게이지/알림 데이터는 삭제하지 않습니다.

begin;

-- 1. 전화번호는 일반 프로필과 분리하여 관리자 전용 연락처 테이블에 보관합니다.
create table if not exists public.member_contacts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  phone_number text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint member_contacts_phone_format check (phone_number ~ '^[0-9]{8,15}$')
);

alter table public.member_contacts enable row level security;
revoke all on public.member_contacts from anon, authenticated;

create or replace function public.get_admin_member_contacts_v94()
returns table(user_id uuid, phone_number text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles;
begin
  select * into v_actor from public.profiles where id = auth.uid();
  if v_actor.id is null
     or v_actor.role::text <> 'admin'
     or v_actor.approval_status::text <> 'approved'
     or not v_actor.active then
    raise exception '관리자만 회원 연락처를 조회할 수 있습니다.';
  end if;

  return query
  select c.user_id, c.phone_number
  from public.member_contacts c
  order by c.created_at desc;
end;
$$;

revoke all on function public.get_admin_member_contacts_v94() from public, anon;
grant execute on function public.get_admin_member_contacts_v94() to authenticated;

-- 2. 신규 회원가입 시 전화번호를 필수 검증하고 관리자 전용 연락처로 저장합니다.
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
  v_phone_number text;
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
  v_phone_number := regexp_replace(coalesce(new.raw_user_meta_data ->> 'phone_number', ''), '[^0-9]', '', 'g');

  if char_length(v_username) < 4
     or char_length(v_username) > 40
     or v_username ~ '[[:cntrl:]]' then
    raise exception '아이디는 종류와 관계없이 4~40자로 입력해야 합니다.';
  end if;

  if char_length(v_username_key) < 4 or char_length(v_username_key) > 120 then
    raise exception '아이디 형식이 올바르지 않습니다.';
  end if;


  if char_length(v_phone_number) < 8 or char_length(v_phone_number) > 15 then
    raise exception '전화번호는 숫자 8~15자리로 입력해 주세요.';
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

  insert into public.member_contacts (user_id, phone_number)
  values (new.id, v_phone_number)
  on conflict (user_id) do update
  set phone_number = excluded.phone_number,
      updated_at = now();

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


-- 3. 정산 페이지에서 등록 업체별 전체 건수/금액/프로그램 합계를 함께 반환합니다.
create or replace function public.get_my_settlement_page_v94(
  p_page integer default 1,
  p_page_size integer default 50,
  p_status text default 'waiting',
  p_payer_id uuid default null,
  p_registrant_id uuid default null,
  p_group_name text default null,
  p_query text default null,
  p_program_type text default null,
  p_start_date_from date default null,
  p_start_date_to date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles;
  v_page integer := greatest(1, coalesce(p_page, 1));
  v_page_size integer := least(100, greatest(10, coalesce(p_page_size, 50)));
  v_result jsonb;
begin
  select * into v_actor from public.profiles where id = auth.uid();
  if v_actor.id is null or v_actor.approval_status is distinct from 'approved' or not v_actor.active or v_actor.role is null then
    raise exception '활성 승인 회원만 정산 내역을 조회할 수 있습니다.';
  end if;
  if coalesce(p_status, 'waiting') not in ('waiting', 'confirmed', 'all') then
    raise exception '정산 상태 필터가 올바르지 않습니다.';
  end if;

  with base as (
    select
      ps.id,
      ps.order_id,
      ps.order_number,
      ps.store_name,
      o.mid,
      o.program_type,
      o.created_by as registrant_id,
      o.creator_username as registrant_username,
      case when v_actor.role::text = 'admin' then o.creator_group_name else '' end as registrant_group_name,
      o.start_date,
      ps.step_order,
      ps.payer_id,
      ps.payer_username,
      ps.payee_id,
      ps.payee_username,
      ps.unit_price,
      ps.supply_amount,
      ps.vat_amount,
      ps.total_amount,
      ps.confirmed_at,
      ps.created_at,
      not exists (
        select 1
        from public.payment_steps previous_step
        where previous_step.order_id = ps.order_id
          and previous_step.step_order < ps.step_order
          and previous_step.confirmed_at is null
      ) as chain_ready,
      (
        select count(*)
        from public.payment_steps previous_step
        where previous_step.order_id = ps.order_id
          and previous_step.step_order < ps.step_order
          and previous_step.confirmed_at is null
      ) as previous_pending_count
    from public.payment_steps ps
    join public.orders o on o.id = ps.order_id
    where ps.payee_id = v_actor.id
      and o.archived_at is null
  ), filtered as (
    select *
    from base b
    where (
        p_status = 'all'
        or (p_status = 'waiting' and b.confirmed_at is null)
        or (p_status = 'confirmed' and b.confirmed_at is not null)
      )
      and (p_payer_id is null or b.payer_id = p_payer_id)
      and (p_registrant_id is null or b.registrant_id = p_registrant_id)
      and (nullif(trim(coalesce(p_group_name, '')), '') is null or b.registrant_group_name = trim(p_group_name))
      and (nullif(trim(coalesce(p_program_type, '')), '') is null or b.program_type = p_program_type)
      and (p_start_date_from is null or b.start_date >= p_start_date_from)
      and (p_start_date_to is null or b.start_date <= p_start_date_to)
      and (
        nullif(trim(coalesce(p_query, '')), '') is null
        or lower(b.store_name) like '%' || lower(trim(p_query)) || '%'
        or lower(b.mid) like '%' || lower(trim(p_query)) || '%'
        or lower(b.order_number) like '%' || lower(trim(p_query)) || '%'
        or lower(b.payer_username) like '%' || lower(trim(p_query)) || '%'
        or lower(b.registrant_username) like '%' || lower(trim(p_query)) || '%'
        or lower(b.registrant_group_name) like '%' || lower(trim(p_query)) || '%'
      )
  ), enriched as (
    select
      f.*,
      count(*) over (partition by f.registrant_id)::bigint as registrant_item_count,
      coalesce(sum(f.total_amount) over (partition by f.registrant_id), 0)::bigint as registrant_total_amount,
      count(*) filter (where f.confirmed_at is null and f.chain_ready) over (partition by f.registrant_id)::bigint as registrant_ready_count,
      coalesce(sum(f.total_amount) filter (where f.confirmed_at is null and f.chain_ready) over (partition by f.registrant_id), 0)::bigint as registrant_ready_amount,
      count(*) filter (where f.program_type = 'spark') over (partition by f.registrant_id)::bigint as registrant_spark_count,
      coalesce(sum(f.total_amount) filter (where f.program_type = 'spark') over (partition by f.registrant_id), 0)::bigint as registrant_spark_amount,
      count(*) filter (where f.program_type = 'spark_plus') over (partition by f.registrant_id)::bigint as registrant_spark_plus_count,
      coalesce(sum(f.total_amount) filter (where f.program_type = 'spark_plus') over (partition by f.registrant_id), 0)::bigint as registrant_spark_plus_amount,
      count(*) filter (where f.program_type = 'spark_s') over (partition by f.registrant_id)::bigint as registrant_spark_s_count,
      coalesce(sum(f.total_amount) filter (where f.program_type = 'spark_s') over (partition by f.registrant_id), 0)::bigint as registrant_spark_s_amount
    from filtered f
  ), totals as (
    select
      count(*)::bigint as total_count,
      coalesce(sum(total_amount), 0)::bigint as total_amount,
      count(*) filter (where confirmed_at is null and chain_ready)::bigint as ready_count,
      coalesce(sum(total_amount) filter (where confirmed_at is null and chain_ready), 0)::bigint as ready_amount
    from filtered
  ), paged as (
    select *
    from enriched
    order by created_at desc, id
    limit v_page_size
    offset (v_page - 1) * v_page_size
  )
  select jsonb_build_object(
    'page', v_page,
    'pageSize', v_page_size,
    'totalPages', greatest(1, ceil(t.total_count::numeric / v_page_size)::integer),
    'totalCount', t.total_count,
    'totalAmount', t.total_amount,
    'readyCount', t.ready_count,
    'readyAmount', t.ready_amount,
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'orderDbId', p.order_id,
        'orderNumber', p.order_number,
        'storeName', p.store_name,
        'mid', p.mid,
        'programType', p.program_type,
        'registrantId', p.registrant_id,
        'registrantUsername', p.registrant_username,
        'registrantGroupName', p.registrant_group_name,
        'startDate', p.start_date,
        'registrantItemCount', p.registrant_item_count,
        'registrantTotalAmount', p.registrant_total_amount,
        'registrantReadyCount', p.registrant_ready_count,
        'registrantReadyAmount', p.registrant_ready_amount,
        'registrantSparkCount', p.registrant_spark_count,
        'registrantSparkAmount', p.registrant_spark_amount,
        'registrantSparkPlusCount', p.registrant_spark_plus_count,
        'registrantSparkPlusAmount', p.registrant_spark_plus_amount,
        'registrantSparkSCount', p.registrant_spark_s_count,
        'registrantSparkSAmount', p.registrant_spark_s_amount,
        'stepOrder', p.step_order,
        'payerId', p.payer_id,
        'payerUsername', p.payer_username,
        'payeeId', p.payee_id,
        'payeeUsername', p.payee_username,
        'unitPrice', p.unit_price,
        'supplyAmount', p.supply_amount,
        'vatAmount', p.vat_amount,
        'totalAmount', p.total_amount,
        'confirmedAt', p.confirmed_at,
        'canConfirm', (p.confirmed_at is null and p.chain_ready),
        'previousPendingCount', p.previous_pending_count,
        'createdAt', p.created_at
      ) order by p.created_at desc, p.id)
      from paged p
    ), '[]'::jsonb)
  ) into v_result
  from totals t;

  return coalesce(v_result, jsonb_build_object(
    'page', v_page, 'pageSize', v_page_size, 'totalPages', 1,
    'totalCount', 0, 'totalAmount', 0, 'readyCount', 0, 'readyAmount', 0,
    'rows', '[]'::jsonb
  ));
end;
$$;

revoke all on function public.get_my_settlement_page_v94(integer, integer, text, uuid, uuid, text, text, text, date, date) from public, anon;
grant execute on function public.get_my_settlement_page_v94(integer, integer, text, uuid, uuid, text, text, text, date, date) to authenticated;


-- 4. 버전 기록
insert into public.app_schema_versions(version, description)
values ('v9.4.0', 'Signup phone contact and admin company-grouped settlement confirmation')
on conflict (version) do update
set description = excluded.description,
    applied_at = now();

select public.write_audit_log(
  'system.migration',
  'system',
  null,
  'SPARK v9.4.0',
  jsonb_build_object('description', 'signup phone contact and company-grouped admin settlement')
);

commit;
