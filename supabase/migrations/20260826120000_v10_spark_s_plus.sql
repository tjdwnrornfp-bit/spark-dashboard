-- SPARK v10.0.0: add Spark S Plus as a first-class program.
-- This migration upgrades an existing v9.10 database. It never deletes user data.
begin;

do $$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.orders') is null
     or to_regclass('public.payment_steps') is null
     or to_regclass('public.order_program_transfers') is null
     or to_regclass('public.app_schema_versions') is null
     or to_regprocedure('public.review_member_v93(uuid,public.member_role,boolean,integer,integer,integer,public.approval_status,text,timestamp with time zone)') is null
     or to_regprocedure('public.preview_order_program_transfer_v99(uuid,text,integer)') is null
     or to_regprocedure('public.transfer_order_program_v99(uuid,text,integer,text)') is null
     or to_regprocedure('public.preview_bulk_order_program_transfer_v910(jsonb,text)') is null
     or to_regprocedure('public.transfer_bulk_order_program_v910(jsonb,text,text)') is null then
    raise exception 'SPARK v9.10.0까지 먼저 적용되어 있어야 합니다.';
  end if;
end $$;

-- Adding a NOT NULL column with DEFAULT 40 backfills every existing profile once.
alter table public.profiles
  add column if not exists spark_s_plus_price_per_shot integer not null default 40;
alter table public.profiles
  alter column spark_s_plus_price_per_shot set default 40;
update public.profiles
set spark_s_plus_price_per_shot = 40
where spark_s_plus_price_per_shot is null;
alter table public.profiles
  alter column spark_s_plus_price_per_shot set not null;

alter table public.profiles drop constraint if exists profiles_spark_s_plus_price_per_shot_check;
alter table public.profiles
  add constraint profiles_spark_s_plus_price_per_shot_check
  check (spark_s_plus_price_per_shot >= 0);

alter table public.orders drop constraint if exists orders_program_type_check;
alter table public.orders
  add constraint orders_program_type_check
  check (program_type in ('spark', 'spark_plus', 'spark_s', 'spark_s_plus'));

alter table public.payment_steps drop constraint if exists payment_steps_program_type_check;
alter table public.payment_steps
  add constraint payment_steps_program_type_check
  check (program_type in ('spark', 'spark_plus', 'spark_s', 'spark_s_plus'));

alter table public.order_program_transfers drop constraint if exists order_program_transfers_before_program_check;
alter table public.order_program_transfers
  add constraint order_program_transfers_before_program_check
  check (before_program in ('spark', 'spark_plus', 'spark_s', 'spark_s_plus'));

alter table public.order_program_transfers drop constraint if exists order_program_transfers_after_program_check;
alter table public.order_program_transfers
  add constraint order_program_transfers_after_program_check
  check (after_program in ('spark', 'spark_plus', 'spark_s', 'spark_s_plus'));

-- Keep v9.3 authorization and hierarchy rules, adding the fourth price atomically.
create or replace function public.review_member_v10(
  p_member_id uuid,
  p_role public.member_role,
  p_is_operations_manager boolean,
  p_spark_price_per_shot integer,
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
  v_spark_s_plus integer;
begin
  select * into v_actor from public.profiles where id = auth.uid();
  select * into v_target from public.profiles where id = p_member_id;

  if v_actor.id is null or v_target.id is null then
    raise exception '회원 정보를 찾을 수 없습니다.';
  end if;
  if v_target.updated_at is distinct from p_expected_updated_at then
    raise exception '다른 사용자가 먼저 회원 정보를 변경했습니다. 새로고침 후 다시 시도해 주세요.';
  end if;

  v_actor_is_admin := v_actor.role = 'admin';
  v_actor_is_manager := coalesce(v_actor.is_operations_manager, false);
  v_make_manager := v_actor_is_admin
    and coalesce(p_is_operations_manager, false)
    and v_target.sponsor_id is null
    and v_target.manager_id is null;
  v_spark_s_plus := case when v_make_manager then 40 else p_spark_s_plus_price_per_shot end;

  if p_approval_status = 'approved' and not v_make_manager and v_spark_s_plus < 1 then
    raise exception '네 프로그램 단가를 모두 1원 이상 입력해 주세요.';
  end if;
  if not v_actor_is_admin and not v_actor_is_manager and p_approval_status = 'approved'
     and v_spark_s_plus <= coalesce(v_actor.spark_s_plus_price_per_shot, 0) then
    raise exception '하위 회원의 각 프로그램 단가는 내 단가보다 높아야 합니다.';
  end if;
  if p_approval_status = 'approved' and not v_make_manager and exists (
    select 1
    from public.profiles child
    where child.sponsor_id = v_target.id
      and child.approval_status = 'approved'
      and child.active
      and child.spark_s_plus_price_per_shot <= v_spark_s_plus
  ) then
    raise exception '기존 하위 회원 단가보다 높거나 같은 값으로 변경할 수 없습니다.';
  end if;

  v_result := public.review_member_v93(
    p_member_id,
    p_role,
    p_is_operations_manager,
    p_spark_price_per_shot,
    p_spark_plus_price_per_shot,
    p_spark_s_price_per_shot,
    p_approval_status,
    p_group_name,
    p_expected_updated_at
  );

  update public.profiles
  set spark_s_plus_price_per_shot = case
        when p_approval_status = 'approved' then v_spark_s_plus
        else spark_s_plus_price_per_shot
      end,
      updated_at = now()
  where id = p_member_id
  returning * into v_result;

  if p_approval_status = 'approved' and not v_result.is_operations_manager then
    update public.notifications
    set message = '승인되었습니다. 스파크 ' || p_spark_price_per_shot
      || '원 / 스파크+ ' || p_spark_plus_price_per_shot
      || '원 / 스파크S ' || p_spark_s_price_per_shot
      || '원 / 스파크S+ ' || v_spark_s_plus || '원입니다.'
    where id = (
      select n.id
      from public.notifications n
      where n.user_id = p_member_id and n.title = '회원가입 승인 완료'
      order by n.created_at desc
      limit 1
    );
  end if;

  return v_result;
end;
$$;

revoke all on function public.review_member_v10(uuid, public.member_role, boolean, integer, integer, integer, integer, public.approval_status, text, timestamptz) from public, anon;
grant execute on function public.review_member_v10(uuid, public.member_role, boolean, integer, integer, integer, integer, public.approval_status, text, timestamptz) to authenticated;

-- New intake RPC keeps the registrant and every payer's current program price as snapshots.
create or replace function public.create_order_v10(
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

  if p_program_type not in ('spark', 'spark_plus', 'spark_s', 'spark_s_plus') then
    raise exception '지원하지 않는 프로그램입니다.';
  end if;

  unit_price := case p_program_type
    when 'spark' then coalesce(member.spark_price_per_shot, member.price_per_shot, 0)
    when 'spark_plus' then coalesce(member.spark_plus_price_per_shot, 0)
    when 'spark_s' then coalesce(member.spark_s_price_per_shot, 0)
    when 'spark_s_plus' then coalesce(member.spark_s_plus_price_per_shot, 0)
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
  order_prefix := case p_program_type
    when 'spark' then 'SPK'
    when 'spark_plus' then 'SPP'
    when 'spark_s' then 'SPS'
    when 'spark_s_plus' then 'SPSP'
  end;
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
      when 'spark_s' then coalesce(v_payer.spark_s_price_per_shot, 0)
      when 'spark_s_plus' then coalesce(v_payer.spark_s_plus_price_per_shot, 0)
    end;
    if v_unit_price <= 0 then raise exception '% 회원의 대상 프로그램 단가를 확인해 주세요.', v_payer.username; end if;
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

revoke all on function public.create_order_v10(text, text, text, text, text, integer, integer, date, text) from public, anon;
grant execute on function public.create_order_v10(text, text, text, text, text, integer, integer, date, text) to authenticated;

create or replace function public.create_orders_bulk_v10(p_items jsonb)
returns setof public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  result public.orders;
  item_count integer;
begin
  item_count := jsonb_array_length(coalesce(p_items, '[]'::jsonb));
  if item_count < 1 then raise exception '접수할 작업이 없습니다.'; end if;
  if item_count > 500 then raise exception '한 번에 최대 500건까지 접수할 수 있습니다.'; end if;

  for item in select value from jsonb_array_elements(p_items)
  loop
    select * into result from public.create_order_v10(
      coalesce(item ->> 'program_type', 'spark'),
      item ->> 'place_url',
      item ->> 'mid',
      item ->> 'store_name',
      item ->> 'keyword',
      (item ->> 'daily_shots')::integer,
      (item ->> 'operation_days')::integer,
      (item ->> 'start_date')::date,
      coalesce(item ->> 'memo', '')
    );
    return next result;
  end loop;
end;
$$;

revoke all on function public.create_orders_bulk_v10(jsonb) from public, anon;
grant execute on function public.create_orders_bulk_v10(jsonb) to authenticated;

-- Patch current v9.3-v9.10 RPC bodies in place so all existing clients keep working.
create or replace function pg_temp.patch_function_v100(
  p_signature text,
  p_from text,
  p_to text
)
returns void
language plpgsql
as $$
declare
  v_oid regprocedure;
  v_definition text;
begin
  v_oid := to_regprocedure(p_signature);
  if v_oid is null then raise exception '필수 함수가 없습니다: %', p_signature; end if;
  select pg_get_functiondef(v_oid) into v_definition;
  v_definition := replace(v_definition, E'\r\n', E'\n');
  if position(p_to in v_definition) > 0 then return; end if;
  if position(p_from in v_definition) = 0 then
    raise exception '함수 %의 예상 소스 패턴을 찾지 못했습니다.', p_signature;
  end if;
  execute replace(v_definition, p_from, p_to);
end;
$$;

select pg_temp.patch_function_v100(
  'public.get_approved_program_price_v99(uuid,text)',
  $from$      when 'spark_s' then coalesce(p.spark_s_price_per_shot, 0)$from$,
  $to$      when 'spark_s' then coalesce(p.spark_s_price_per_shot, 0)
      when 'spark_s_plus' then coalesce(p.spark_s_plus_price_per_shot, 0)$to$
);

select pg_temp.patch_function_v100(
  'public.preview_order_program_transfer_v99(uuid,text,integer)',
  $from$p_target_program not in ('spark', 'spark_plus', 'spark_s')$from$,
  $to$p_target_program not in ('spark', 'spark_plus', 'spark_s', 'spark_s_plus')$to$
);

select pg_temp.patch_function_v100(
  'public.transfer_order_program_v99(uuid,text,integer,text)',
  $from$case p_target_program when 'spark' then '스파크' when 'spark_plus' then '스파크 +' else '스파크S' end$from$,
  $to$case p_target_program when 'spark' then '스파크' when 'spark_plus' then '스파크 +' when 'spark_s' then '스파크S' else '스파크S+' end$to$
);

select pg_temp.patch_function_v100(
  'public.preview_bulk_order_program_transfer_v910(jsonb,text)',
  $from$p_target_program not in ('spark', 'spark_plus', 'spark_s')$from$,
  $to$p_target_program not in ('spark', 'spark_plus', 'spark_s', 'spark_s_plus')$to$
);
select pg_temp.patch_function_v100(
  'public.preview_bulk_order_program_transfer_v910(jsonb,text)',
  $from$  v_spark_s_count integer := 0;$from$,
  $to$  v_spark_s_count integer := 0;
  v_spark_s_plus_count integer := 0;$to$
);
select pg_temp.patch_function_v100(
  'public.preview_bulk_order_program_transfer_v910(jsonb,text)',
  $from$    elsif v_order.program_type = 'spark_s' then v_spark_s_count := v_spark_s_count + 1;
    end if;$from$,
  $to$    elsif v_order.program_type = 'spark_s' then v_spark_s_count := v_spark_s_count + 1;
    elsif v_order.program_type = 'spark_s_plus' then v_spark_s_plus_count := v_spark_s_plus_count + 1;
    end if;$to$
);
select pg_temp.patch_function_v100(
  'public.preview_bulk_order_program_transfer_v910(jsonb,text)',
  $from$'programCounts', jsonb_build_object('spark', v_spark_count, 'spark_plus', v_spark_plus_count, 'spark_s', v_spark_s_count)$from$,
  $to$'programCounts', jsonb_build_object('spark', v_spark_count, 'spark_plus', v_spark_plus_count, 'spark_s', v_spark_s_count, 'spark_s_plus', v_spark_s_plus_count)$to$
);

select pg_temp.patch_function_v100(
  'public.transfer_bulk_order_program_v910(jsonb,text,text)',
  $from$p_target_program not in ('spark', 'spark_plus', 'spark_s')$from$,
  $to$p_target_program not in ('spark', 'spark_plus', 'spark_s', 'spark_s_plus')$to$
);

select pg_temp.patch_function_v100(
  'public.audit_profiles_trigger()',
  $from$     or old.spark_s_price_per_shot is distinct from new.spark_s_price_per_shot$from$,
  $to$     or old.spark_s_price_per_shot is distinct from new.spark_s_price_per_shot
     or old.spark_s_plus_price_per_shot is distinct from new.spark_s_plus_price_per_shot$to$
);
select pg_temp.patch_function_v100(
  'public.audit_profiles_trigger()',
  $from$      'spark_s', new.spark_s_price_per_shot$from$,
  $to$      'spark_s', new.spark_s_price_per_shot,
      'spark_s_plus', new.spark_s_plus_price_per_shot$to$
);

select pg_temp.patch_function_v100(
  'public.get_my_settlement_page_v94(integer,integer,text,uuid,uuid,text,text,text,date,date)',
  $from$      count(*) filter (where f.program_type = 'spark_s') over (partition by f.registrant_id)::bigint as registrant_spark_s_count,
      coalesce(sum(f.total_amount) filter (where f.program_type = 'spark_s') over (partition by f.registrant_id), 0)::bigint as registrant_spark_s_amount$from$,
  $to$      count(*) filter (where f.program_type = 'spark_s') over (partition by f.registrant_id)::bigint as registrant_spark_s_count,
      coalesce(sum(f.total_amount) filter (where f.program_type = 'spark_s') over (partition by f.registrant_id), 0)::bigint as registrant_spark_s_amount,
      count(*) filter (where f.program_type = 'spark_s_plus') over (partition by f.registrant_id)::bigint as registrant_spark_s_plus_count,
      coalesce(sum(f.total_amount) filter (where f.program_type = 'spark_s_plus') over (partition by f.registrant_id), 0)::bigint as registrant_spark_s_plus_amount$to$
);
select pg_temp.patch_function_v100(
  'public.get_my_settlement_page_v94(integer,integer,text,uuid,uuid,text,text,text,date,date)',
  $from$        'registrantSparkSAmount', p.registrant_spark_s_amount,$from$,
  $to$        'registrantSparkSAmount', p.registrant_spark_s_amount,
        'registrantSparkSPlusCount', p.registrant_spark_s_plus_count,
        'registrantSparkSPlusAmount', p.registrant_spark_s_plus_amount,$to$
);

select pg_temp.patch_function_v100(
  'public.get_admin_company_overview_v96(integer,integer,text,text)',
  $from$      ), 0)::bigint as spark_s_running_units,
      count(*) filter (where b.program_type = 'spark')::bigint as spark_count,$from$,
  $to$      ), 0)::bigint as spark_s_running_units,
      coalesce(sum(b.daily_shots::bigint) filter (
        where b.order_status = '구동중' and b.program_type = 'spark_s_plus'
      ), 0)::bigint as spark_s_plus_running_units,
      count(*) filter (where b.program_type = 'spark')::bigint as spark_count,$to$
);
select pg_temp.patch_function_v100(
  'public.get_admin_company_overview_v96(integer,integer,text,text)',
  $from$      count(*) filter (where b.program_type = 'spark_s')::bigint as spark_s_count,$from$,
  $to$      count(*) filter (where b.program_type = 'spark_s')::bigint as spark_s_count,
      count(*) filter (where b.program_type = 'spark_s_plus')::bigint as spark_s_plus_count,$to$
);
select pg_temp.patch_function_v100(
  'public.get_admin_company_overview_v96(integer,integer,text,text)',
  $from$      coalesce(sum(spark_s_running_units), 0)::bigint as spark_s_running_units$from$,
  $to$      coalesce(sum(spark_s_running_units), 0)::bigint as spark_s_running_units,
      coalesce(sum(spark_s_plus_running_units), 0)::bigint as spark_s_plus_running_units$to$
);
select pg_temp.patch_function_v100(
  'public.get_admin_company_overview_v96(integer,integer,text,text)',
  $from$    'sparkSRunningUnits', t.spark_s_running_units,$from$,
  $to$    'sparkSRunningUnits', t.spark_s_running_units,
    'sparkSPlusRunningUnits', t.spark_s_plus_running_units,$to$
);
select pg_temp.patch_function_v100(
  'public.get_admin_company_overview_v96(integer,integer,text,text)',
  $from$        'sparkSRunningUnits', p.spark_s_running_units,$from$,
  $to$        'sparkSRunningUnits', p.spark_s_running_units,
        'sparkSPlusRunningUnits', p.spark_s_plus_running_units,$to$
);
select pg_temp.patch_function_v100(
  'public.get_admin_company_overview_v96(integer,integer,text,text)',
  $from$        'sparkSCount', p.spark_s_count,$from$,
  $to$        'sparkSCount', p.spark_s_count,
        'sparkSPlusCount', p.spark_s_plus_count,$to$
);
select pg_temp.patch_function_v100(
  'public.get_admin_company_overview_v96(integer,integer,text,text)',
  $from$    'sparkSRunningUnits', 0,
    'companies'$from$,
  $to$    'sparkSRunningUnits', 0,
    'sparkSPlusRunningUnits', 0,
    'companies'$to$
);

insert into public.app_schema_versions(version, description)
values ('v10.0.0', 'Spark S Plus program, pricing, intake, settlement, exports and transfer support')
on conflict (version) do nothing;

select public.write_audit_log(
  'system.migration', 'system', null, 'SPARK v10.0.0',
  jsonb_build_object('description', 'Spark S Plus first-class program and 40 won profile backfill')
);

commit;
