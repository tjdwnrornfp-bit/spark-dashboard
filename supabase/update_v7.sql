-- SPARK v7 update
-- Adds selectable start dates, corrects settlement notifications, and keeps existing data.
-- Run once after update_v6.sql. This script is written to be safely re-run.

begin;

-- 1. Order status notifications: administrator-triggered payment confirmation is explicit.
create or replace function public.set_order_status(
  p_order_id uuid,
  p_status public.order_status
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  current_order public.orders;
  result public.orders;
  notice_title text;
  notice_message text;
begin
  if not public.is_admin() then
    raise exception '관리자만 상태를 변경할 수 있습니다.';
  end if;

  select * into current_order from public.orders where id = p_order_id for update;
  if current_order.id is null then raise exception '작업을 찾을 수 없습니다.'; end if;
  if current_order.status = p_status then return current_order; end if;

  update public.orders
  set status = p_status,
      activated_at = case
        when p_status = '구동중' and current_order.status <> '구동중' then now()
        when p_status in ('입금대기', '입금완료') then null
        else current_order.activated_at
      end,
      stopped_at = case when p_status = '정지' then now() else null end,
      payment_notified_at = case when p_status = '입금완료' then coalesce(current_order.payment_notified_at, now()) else current_order.payment_notified_at end
  where id = p_order_id
  returning * into result;

  notice_title := case
    when p_status = '입금완료' then '입금 확인 완료'
    when p_status = '구동중' then '작업 구동 시작'
    when p_status = '정지' then '작업 정지'
    when p_status = '만료' then '작업 기간 만료'
    else '작업 상태 변경'
  end;
  notice_message := case
    when p_status = '입금완료' then '관리자가 ' || result.store_name || ' 작업 입금을 확인했습니다.'
    else result.store_name || ' 작업 상태가 ' || p_status::text || '(으)로 변경되었습니다.'
  end;

  insert into public.notifications (user_id, title, message, order_id)
  values (result.created_by, notice_title, notice_message, result.id);

  return result;
end;
$$;

-- 2. Replace order creation RPCs with a user-selected start date.
-- Drop bulk first because it calls create_order.
drop function if exists public.create_orders_bulk(jsonb);
drop function if exists public.create_order(text, text, text, text, integer, integer, date, text);
drop function if exists public.create_order(text, text, text, text, integer, integer, text);

create function public.create_order(
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
  number text;
  local_today date;
  minimum_start date;
  calculated_end date;
  supply bigint;
  vat bigint;
  v_payer public.profiles;
  v_payee public.profiles;
  v_admin public.profiles;
  v_step integer := 1;
  v_step_supply bigint;
  v_step_vat bigint;
begin
  select * into member from public.profiles where id = auth.uid() for update;
  if member.id is null or member.role not in ('agency', 'distributor') or member.approval_status <> 'approved' or not member.active or member.price_per_shot <= 0 then
    raise exception '승인된 대행사 또는 총판만 접수할 수 있습니다.';
  end if;
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
  supply := p_daily_shots::bigint * p_operation_days::bigint * member.price_per_shot::bigint;
  vat := round(supply * 0.1);
  number := 'SP-' || to_char(local_today, 'YYYYMMDD') || '-' || lpad(nextval('public.order_number_seq')::text, 6, '0');

  insert into public.orders (
    order_number, created_by, creator_username, sponsor_id, sponsor_username, creator_group_name,
    place_url, mid, store_name, keyword, daily_shots, operation_days, price_per_shot,
    supply_amount, vat_amount, total_amount, start_date, end_date, memo
  ) values (
    number, member.id, member.username, member.sponsor_id, member.sponsor_username, member.group_name,
    trim(p_place_url), p_mid, trim(p_store_name), trim(p_keyword), p_daily_shots, p_operation_days, member.price_per_shot,
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

    v_step_supply := p_daily_shots::bigint * p_operation_days::bigint * v_payer.price_per_shot::bigint;
    v_step_vat := round(v_step_supply * 0.1);
    insert into public.payment_steps (
      order_id, order_number, store_name, step_order,
      payer_id, payer_username, payee_id, payee_username,
      unit_price, supply_amount, vat_amount, total_amount
    ) values (
      result.id, result.order_number, result.store_name, v_step,
      v_payer.id, v_payer.username, v_payee.id, v_payee.username,
      v_payer.price_per_shot, v_step_supply, v_step_vat, v_step_supply + v_step_vat
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
    member.username || ' 회원이 ' || trim(p_store_name) || ' 작업을 접수했습니다. 추천인: ' || coalesce(member.sponsor_username, '관리자 직속') || ', 그룹: ' || coalesce(nullif(member.group_name, ''), '-'),
    result.id
  );
  return result;
end;
$$;

create function public.create_orders_bulk(p_items jsonb)
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

revoke all on function public.create_order(text, text, text, text, integer, integer, date, text) from public, anon;
revoke all on function public.create_orders_bulk(jsonb) from public, anon;
grant execute on function public.create_order(text, text, text, text, integer, integer, date, text) to authenticated;
grant execute on function public.create_orders_bulk(jsonb) to authenticated;

-- 3. Payment confirmation notices use neutral, accurate wording for every hierarchy level.
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
  next_step public.payment_steps;
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

  insert into public.notifications (user_id, title, message, order_id)
  values (result.payer_id, '입금 확인 완료', result.store_name || ' 작업 입금이 확인되었습니다.', result.order_id);

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
  else
    select * into next_step
    from public.payment_steps
    where order_id = result.order_id and payer_id = actor.id and confirmed_at is null
    order by step_order
    limit 1;
    if next_step.id is not null then
      insert into public.notifications (user_id, title, message, order_id)
      values (actor.id, '추가 정산 필요', result.store_name || ' 작업의 다음 정산을 진행해 주세요. 정산액: ' || next_step.total_amount || '원', result.order_id);
    end if;
  end if;
  return result;
end;
$$;

revoke all on function public.confirm_payment_step(uuid) from public, anon;
grant execute on function public.confirm_payment_step(uuid) to authenticated;

-- 4. Existing Cron continues calling this function. Manual status changes are handled by set_order_status.
create or replace function public.start_paid_orders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.orders;
  changed integer := 0;
begin
  for target in
    select * from public.orders
    where status = '입금완료'
      and start_date <= (now() at time zone 'Asia/Seoul')::date
      and end_date >= (now() at time zone 'Asia/Seoul')::date
    for update
  loop
    update public.orders
    set status = '구동중', activated_at = coalesce(activated_at, now())
    where id = target.id;
    insert into public.notifications (user_id, title, message, order_id)
    values (target.created_by, '구동 자동 시작', target.store_name || ' 작업이 구동중으로 변경되었습니다.', target.id);
    changed := changed + 1;
  end loop;
  return changed;
end;
$$;

commit;
