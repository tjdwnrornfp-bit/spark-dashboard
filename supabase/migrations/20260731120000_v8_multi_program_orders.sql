-- SPARK v8 update
-- 1) 프로그램별 단가/접수(스파크, 스파크 +, 스파크S)
-- 2) 엑셀 접수 시작일 직접 반영(프론트 수정과 함께 사용)
-- 3) 입금 확인 알림은 최종 관리자 확인 완료 시 1회만 발송
-- 4) 만료/정지/입금대기 작업 삭제 RPC 추가

begin;

alter table public.profiles add column if not exists spark_price_per_shot integer not null default 0;
alter table public.profiles add column if not exists spark_plus_price_per_shot integer not null default 0;
alter table public.profiles add column if not exists spark_s_price_per_shot integer not null default 0;

update public.profiles
set spark_price_per_shot = case when coalesce(spark_price_per_shot, 0) = 0 then coalesce(price_per_shot, 0) else spark_price_per_shot end,
    spark_plus_price_per_shot = case when coalesce(spark_plus_price_per_shot, 0) = 0 then coalesce(price_per_shot, 0) else spark_plus_price_per_shot end,
    spark_s_price_per_shot = case when coalesce(spark_s_price_per_shot, 0) = 0 then coalesce(price_per_shot, 0) else spark_s_price_per_shot end;

alter table public.orders add column if not exists program_type text not null default 'spark';
update public.orders set program_type = 'spark' where program_type is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_program_type_check'
  ) then
    alter table public.orders
      add constraint orders_program_type_check
      check (program_type in ('spark', 'spark_plus', 'spark_s'));
  end if;
end $$;

create or replace function public.review_member_v8(
  p_member_id uuid,
  p_role public.user_role,
  p_spark_price_per_shot integer,
  p_spark_plus_price_per_shot integer,
  p_spark_s_price_per_shot integer,
  p_approval_status public.approval_status,
  p_group_name text default ''
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles;
  target public.profiles;
  actor_spark integer;
  actor_spark_plus integer;
  actor_spark_s integer;
  result public.profiles;
begin
  select * into actor from public.profiles where id = auth.uid();
  select * into target from public.profiles where id = p_member_id for update;
  if actor.id is null or target.id is null then raise exception '회원 정보를 찾을 수 없습니다.'; end if;

  actor_spark := coalesce(actor.spark_price_per_shot, actor.price_per_shot, 0);
  actor_spark_plus := coalesce(actor.spark_plus_price_per_shot, 0);
  actor_spark_s := coalesce(actor.spark_s_price_per_shot, 0);

  if actor.role <> 'admin' and target.sponsor_id <> actor.id then
    raise exception '직접 추천한 회원만 관리할 수 있습니다.';
  end if;

  if actor.role <> 'admin' and p_approval_status = 'approved' then
    if p_spark_price_per_shot <= actor_spark
       or p_spark_plus_price_per_shot <= actor_spark_plus
       or p_spark_s_price_per_shot <= actor_spark_s then
      raise exception '하위 회원의 각 프로그램 단가는 내 단가보다 높아야 합니다.';
    end if;
  end if;

  if p_approval_status = 'approved' and (
    p_spark_price_per_shot < 1 or p_spark_plus_price_per_shot < 1 or p_spark_s_price_per_shot < 1
  ) then
    raise exception '세 프로그램 단가를 모두 1원 이상 입력해 주세요.';
  end if;

  update public.profiles
  set role = case when target.sponsor_id is not null then 'agency'::public.user_role else p_role end,
      approval_status = p_approval_status,
      active = (p_approval_status = 'approved'),
      approved_at = case when p_approval_status = 'approved' then coalesce(target.approved_at, now()) else target.approved_at end,
      group_name = case when target.sponsor_id is not null then coalesce((select group_name from public.profiles where id = target.sponsor_id), target.group_name) else coalesce(nullif(trim(p_group_name), ''), target.group_name) end,
      price_per_shot = case when p_approval_status = 'approved' then p_spark_price_per_shot else price_per_shot end,
      spark_price_per_shot = case when p_approval_status = 'approved' then p_spark_price_per_shot else spark_price_per_shot end,
      spark_plus_price_per_shot = case when p_approval_status = 'approved' then p_spark_plus_price_per_shot else spark_plus_price_per_shot end,
      spark_s_price_per_shot = case when p_approval_status = 'approved' then p_spark_s_price_per_shot else spark_s_price_per_shot end,
      updated_at = now()
  where id = p_member_id
  returning * into result;

  insert into public.notifications (user_id, title, message)
  values (
    result.id,
    case when p_approval_status = 'approved' then '회원가입 승인 완료' else '회원가입 반려' end,
    case when p_approval_status = 'approved'
      then '승인되었습니다. 스파크 ' || p_spark_price_per_shot || '원 / 스파크+ ' || p_spark_plus_price_per_shot || '원 / 스파크S ' || p_spark_s_price_per_shot || '원입니다.'
      else '회원가입 신청이 반려되었습니다.' end
  );

  return result;
end;
$$;

revoke all on function public.review_member_v8(uuid, public.user_role, integer, integer, integer, public.approval_status, text) from public, anon;
grant execute on function public.review_member_v8(uuid, public.user_role, integer, integer, integer, public.approval_status, text) to authenticated;

drop function if exists public.create_orders_bulk(jsonb);
drop function if exists public.create_order(text, text, text, text, integer, integer, date, text);

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
  if member.id is null or member.role not in ('agency', 'distributor') or member.approval_status <> 'approved' or not member.active then
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
    member.username || ' 회원이 ' || trim(p_store_name) || ' 작업을 접수했습니다. 프로그램: ' || p_program_type || ', 추천인: ' || coalesce(member.sponsor_username, '관리자 직속') || ', 그룹: ' || coalesce(nullif(member.group_name, ''), '-'),
    result.id
  );

  return result;
end;
$$;

create or replace function public.create_orders_bulk(p_items jsonb)
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
    select * into result from public.create_order(
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

revoke all on function public.create_order(text, text, text, text, text, integer, integer, date, text) from public, anon;
revoke all on function public.create_orders_bulk(jsonb) from public, anon;
grant execute on function public.create_order(text, text, text, text, text, integer, integer, date, text) to authenticated;
grant execute on function public.create_orders_bulk(jsonb) to authenticated;

create or replace function public.confirm_payment_step(p_step_id uuid)
returns public.payment_steps
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles;
  step public.payment_steps;
  result public.payment_steps;
  target_order public.orders;
  pending_count integer;
begin
  select * into actor from public.profiles where id = auth.uid();
  select * into step from public.payment_steps where id = p_step_id for update;
  if actor.id is null or step.id is null then raise exception '정산 내역을 찾을 수 없습니다.'; end if;
  if step.payee_id <> actor.id then raise exception '입금 확인 권한이 없습니다.'; end if;
  if step.confirmed_at is not null then return step; end if;

  update public.payment_steps
  set confirmed_at = now(), confirmed_by = actor.id
  where id = p_step_id
  returning * into result;

  select count(*) into pending_count
  from public.payment_steps
  where order_id = result.order_id and confirmed_at is null;

  if pending_count = 0 then
    update public.orders
    set status = case when status = '입금대기' then '입금완료'::public.order_status else status end,
        payment_notified_at = coalesce(payment_notified_at, now())
    where id = result.order_id
    returning * into target_order;

    insert into public.notifications (user_id, title, message, order_id)
    values (target_order.created_by, '전체 입금 확인 완료', target_order.store_name || ' 작업의 입금 확인이 완료되었습니다.', target_order.id);

    perform public.notify_admins('작업 입금완료', target_order.creator_username || ' 회원의 ' || target_order.store_name || ' 작업이 입금완료 처리되었습니다.', target_order.id);
  end if;

  return result;
end;
$$;

create or replace function public.delete_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles;
  target public.orders;
begin
  select * into actor from public.profiles where id = auth.uid();
  select * into target from public.orders where id = p_order_id for update;
  if actor.id is null or target.id is null then raise exception '작업을 찾을 수 없습니다.'; end if;

  if actor.role <> 'admin' then
    if target.created_by <> actor.id then raise exception '삭제 권한이 없습니다.'; end if;
    if target.status not in ('입금대기', '정지', '만료') then raise exception '입금대기, 정지, 만료 상태에서만 삭제할 수 있습니다.'; end if;
  end if;

  delete from public.notifications where order_id = p_order_id;
  delete from public.payment_steps where order_id = p_order_id;
  delete from public.orders where id = p_order_id;
end;
$$;

revoke all on function public.delete_order(uuid) from public, anon;
grant execute on function public.delete_order(uuid) to authenticated;

commit;
