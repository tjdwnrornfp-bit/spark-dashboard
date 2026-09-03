-- v10.6: additive admin assignment API; existing intake shares the same creation engine.
-- Preserve existing orders, snapshots, hierarchy, settlement and realtime behavior.
begin;
do $preflight$
begin
  if not exists (select 1 from public.app_schema_versions where version = 'v10.5.0') then
    raise exception 'v10.5.0 must be applied first';
  end if;
end;
$preflight$;

create schema if not exists spark_private;
revoke all on schema spark_private from public, anon, authenticated;
create table spark_private.admin_order_assignments_v106 (
  actor_id uuid not null,
  request_id uuid not null,
  row_number integer not null,
  payload jsonb not null,
  order_id uuid not null references public.orders(id),
  created_at timestamptz not null default now(),
  primary key (actor_id, request_id, row_number)
);
alter table spark_private.admin_order_assignments_v106 enable row level security;
revoke all on spark_private.admin_order_assignments_v106 from public, anon, authenticated;

CREATE OR REPLACE FUNCTION spark_private.create_order_for_profile_v106(p_member public.profiles, p_profiles jsonb, p_program_type text, p_place_url text, p_mid text, p_store_name text, p_keyword text, p_daily_shots integer, p_operation_days integer, p_start_date date, p_memo text DEFAULT ''::text)
 RETURNS public.orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  member := p_member;
  if member.id is null
     or member.role not in ('agency', 'distributor')
     or member.approval_status <> 'approved'
     or not member.active
     or coalesce(member.is_operations_manager, false) then
    raise exception '승인된 대행사 또는 총판만 접수할 수 있습니다.';
  end if;

  if p_program_type is null or p_program_type not in ('spark', 'spark_plus', 'spark_s', 'spark_s_plus') then
    raise exception '지원하지 않는 프로그램입니다.';
  end if;

  unit_price := case p_program_type
    when 'spark' then coalesce(member.spark_price_per_shot, member.price_per_shot, 0)
    when 'spark_plus' then coalesce(member.spark_plus_price_per_shot, 0)
    when 'spark_s' then coalesce(member.spark_s_price_per_shot, 0)
    when 'spark_s_plus' then coalesce(member.spark_s_plus_price_per_shot, 0)
  end;
  if unit_price <= 0 then raise exception '해당 프로그램 단가가 설정된 회원만 접수할 수 있습니다.'; end if;
  if p_daily_shots is null or p_operation_days is null or p_daily_shots <= 0 or p_operation_days <= 0 then raise exception '수량과 구동일수는 1 이상의 정수여야 합니다.'; end if;
  if p_mid is null or p_mid !~ '^[0-9]+$' then raise exception 'MID 형식이 올바르지 않습니다.'; end if;
  if coalesce(char_length(trim(p_store_name)), 0) not between 1 and 50 or coalesce(char_length(trim(p_keyword)), 0) not between 1 and 50 then raise exception '상호명과 대표 키워드는 1~50자로 입력해야 합니다.'; end if;
  if char_length(coalesce(p_memo, '')) > 300 then raise exception '메모는 300자 이하로 입력해야 합니다.'; end if;

  local_today := (now() at time zone 'Asia/Seoul')::date;
  minimum_start := local_today + 1;
  if p_start_date is null then raise exception '시작일을 선택해 주세요.'; end if;
  if p_start_date < minimum_start then raise exception '시작일은 익일부터 선택할 수 있습니다.'; end if;

  if p_profiles is null then
    select * into v_admin from public.profiles
    where role = 'admin' and approval_status = 'approved' and active
    order by approved_at nulls last limit 1;
  else
    v_admin := jsonb_populate_record(null::public.profiles, p_profiles -> '_admin');
  end if;
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
      if p_profiles is null then
        select * into v_payee from public.profiles where id = v_payer.sponsor_id;
      else
        v_payee := jsonb_populate_record(null::public.profiles, p_profiles -> v_payer.sponsor_id::text);
      end if;
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
$function$
;
CREATE OR REPLACE FUNCTION public.create_order_v10(p_program_type text, p_place_url text, p_mid text, p_store_name text, p_keyword text, p_daily_shots integer, p_operation_days integer, p_start_date date, p_memo text DEFAULT ''::text)
 RETURNS public.orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_member public.profiles;
begin
  select * into v_member from public.profiles where id = auth.uid() for update;
  return spark_private.create_order_for_profile_v106(v_member, null,
    p_program_type, p_place_url, p_mid, p_store_name, p_keyword,
    p_daily_shots, p_operation_days, p_start_date, p_memo);
end;
$function$;


-- URL/MID extraction matches the client intake rule.
create function spark_private.assignment_mid_v106(p_url text) returns text
language sql immutable set search_path = '' as $$
  select coalesce(
    (regexp_match(trim(p_url), '(?:m\.)?place\.naver\.com/(?:place|restaurant|hairshop|hospital|cafe|accommodation)/([0-9]+)', 'i'))[1],
    (regexp_match(trim(p_url), 'place\.naver\.com/[^/]+/([0-9]+)', 'i'))[1],
    (regexp_match(trim(p_url), '[?&](?:id|placePath)=([0-9]+)', 'i'))[1], ''
  );
$$;

create function spark_private.admin_assign_orders_v106(p_items jsonb, p_request_id uuid, p_method text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor public.profiles;
  v_profile public.profiles;
  v_member public.profiles;
  v_profiles jsonb := '{}'::jsonb;
  v_usernames jsonb := '{}'::jsonb;
  v_admin public.profiles;
  v_row record;
  v_item jsonb;
  v_result public.orders;
  v_previous spark_private.admin_order_assignments_v106;
  v_results jsonb := '[]'::jsonb;
  v_row_number integer;
  v_target_id uuid;
  v_mid text;
begin
  select * into v_actor from public.profiles where id = auth.uid() for share;
  if v_actor.id is null or v_actor.role is distinct from 'admin'
    or v_actor.approval_status is distinct from 'approved' or v_actor.active is not true
    or coalesce(v_actor.is_operations_manager, false) then
    raise exception '승인된 활성 관리자만 작업을 부여할 수 있습니다.' using errcode = '42501';
  end if;
  if p_request_id is null then raise exception '요청 식별자가 필요합니다.'; end if;
  if p_method is null or p_method not in ('manual', 'excel') then raise exception '잘못된 부여 방식입니다.'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception '작업 배열이 필요합니다.'; end if;
  if jsonb_array_length(p_items) not between 1 and 500 then raise exception '한 번에 1~500건까지 부여할 수 있습니다.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_actor.id::text || p_request_id::text, 106));

  -- Fetch and lock distinct targets and their sponsor ancestors once per request.
  -- UNION prevents cycles; the shared engine still enforces the existing depth limit.
  for v_profile in
    with recursive requested as (
      select distinct p.id, p.sponsor_id from public.profiles p
      join jsonb_array_elements(p_items) i on
        p.id::text = i->>'target_user_id'
        or p.username = lower(trim(i->>'target_username'))
      union
      select p.id, p.sponsor_id from public.profiles p join requested r on p.id = r.sponsor_id
    )
    select p.* from public.profiles p
    where p.id in (select id from requested)
       or (p.role = 'admin' and p.approval_status = 'approved' and p.active)
    order by p.id for share of p
  loop
    v_profiles := v_profiles || jsonb_build_object(v_profile.id::text, to_jsonb(v_profile));
    v_usernames := v_usernames || jsonb_build_object(v_profile.username, v_profile.id::text);
    if v_profile.role = 'admin' and v_profile.approval_status = 'approved' and v_profile.active
      and (v_admin.id is null or (v_profile.approved_at is not null and
        (v_admin.approved_at is null or v_profile.approved_at < v_admin.approved_at))) then
      v_admin := v_profile;
    end if;
  end loop;
  v_profiles := v_profiles || jsonb_build_object('_admin', to_jsonb(v_admin));

  for v_row in select value, ordinality from jsonb_array_elements(p_items) with ordinality
  loop
    v_item := v_row.value;
    v_row_number := v_row.ordinality;
    begin
      if jsonb_typeof(v_item) is distinct from 'object' then raise exception '작업 형식이 올바르지 않습니다.'; end if;
      v_row_number := coalesce((v_item->>'row_number')::integer, v_row.ordinality::integer);
      if v_row_number not between 1 and 1048576 then raise exception '행 번호가 올바르지 않습니다.'; end if;
      select * into v_previous from spark_private.admin_order_assignments_v106
      where actor_id = v_actor.id and request_id = p_request_id and row_number = v_row_number;
      if found then
        if v_previous.payload is distinct from v_item then raise exception '같은 요청의 행 내용이 변경되었습니다. 새 요청으로 실행해 주세요.'; end if;
        select * into v_result from public.orders where id = v_previous.order_id;
      else
        v_target_id := coalesce(nullif(v_item->>'target_user_id', '')::uuid,
          (v_usernames ->> lower(trim(v_item->>'target_username')))::uuid);
        v_member := jsonb_populate_record(null::public.profiles, v_profiles -> v_target_id::text);
        if v_member.id is null then raise exception '회원을 찾을 수 없습니다.'; end if;
        if v_member.role not in ('agency', 'distributor') or v_member.role is null
          or v_member.approval_status is distinct from 'approved' or v_member.active is not true
          or coalesce(v_member.is_operations_manager, false) then
          raise exception '승인된 활성 대행사 또는 총판만 부여 대상이 될 수 있습니다.';
        end if;
        v_mid := spark_private.assignment_mid_v106(v_item->>'place_url');
        if v_mid = '' or v_mid is distinct from v_item->>'mid' then raise exception '플레이스 URL과 MID를 확인해 주세요.'; end if;
        if coalesce(v_item->>'daily_shots', '') !~ '^[0-9]+$' or coalesce(v_item->>'operation_days', '') !~ '^[0-9]+$' then
          raise exception '수량과 구동일수는 1 이상의 정수여야 합니다.';
        end if;
        if coalesce(v_item->>'start_date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception '시작일을 YYYY-MM-DD로 입력해 주세요.'; end if;
        v_result := spark_private.create_order_for_profile_v106(v_member, v_profiles,
          v_item->>'program_type', v_item->>'place_url', v_mid, v_item->>'store_name', v_item->>'keyword',
          (v_item->>'daily_shots')::integer, (v_item->>'operation_days')::integer,
          (v_item->>'start_date')::date, coalesce(v_item->>'memo', ''));
        -- Assignment audit must commit atomically with the order (do not swallow audit failures).
        insert into public.audit_logs(actor_id, actor_username, actor_role, action, entity_type, entity_id, entity_label, metadata)
        values (v_actor.id, v_actor.username, v_actor.role, 'order.admin_assigned', 'order', v_result.id, v_result.order_number,
          jsonb_build_object('order_id', v_result.id, 'order_number', v_result.order_number,
            'target_user_id', v_member.id, 'target_username', v_member.username,
            'target_group_name_at_assignment', v_member.group_name, 'program_type', v_result.program_type,
            'price_per_shot', v_result.price_per_shot, 'actor_admin_id', v_actor.id,
            'actor_admin_username', v_actor.username, 'assignment_method', p_method,
            'created_at', v_result.created_at, 'request_id', p_request_id, 'row_number', v_row_number));
        insert into spark_private.admin_order_assignments_v106(actor_id, request_id, row_number, payload, order_id)
        values (v_actor.id, p_request_id, v_row_number, v_item, v_result.id);
      end if;
      v_results := v_results || jsonb_build_array(jsonb_build_object('rowNumber', v_row_number, 'status', 'success', 'order', to_jsonb(v_result)));
    exception when others then
      -- PostgreSQL rolls back just this row's order, payment steps, notifications and audit.
      v_results := v_results || jsonb_build_array(jsonb_build_object('rowNumber', v_row_number, 'status', 'failed', 'message', sqlerrm));
    end;
  end loop;
  return jsonb_build_object('items', v_results);
end;
$$;

create function public.admin_bulk_create_orders_for_members_v106(p_items jsonb, p_request_id uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select spark_private.admin_assign_orders_v106(p_items, p_request_id, 'excel');
$$;

create function public.admin_create_order_for_member_v106(p_target_user_id uuid, p_item jsonb, p_request_id uuid)
returns public.orders language plpgsql security definer set search_path = '' as $$
declare v_result jsonb;
begin
  v_result := spark_private.admin_assign_orders_v106(jsonb_build_array(
    p_item || jsonb_build_object('target_user_id', p_target_user_id, 'row_number', 1)), p_request_id, 'manual')->'items'->0;
  if v_result->>'status' is distinct from 'success' then raise exception '%', v_result->>'message'; end if;
  return jsonb_populate_record(null::public.orders, v_result->'order');
end;
$$;
revoke all on all functions in schema spark_private from public, anon, authenticated;
revoke all on function public.admin_bulk_create_orders_for_members_v106(jsonb, uuid) from public, anon;
revoke all on function public.admin_create_order_for_member_v106(uuid, jsonb, uuid) from public, anon;
grant execute on function public.admin_bulk_create_orders_for_members_v106(jsonb, uuid) to authenticated;
grant execute on function public.admin_create_order_for_member_v106(uuid, jsonb, uuid) to authenticated;

-- Current-group display/filtering only. Stored order/settlement history snapshots remain intact.
CREATE OR REPLACE FUNCTION public.get_my_settlement_filter_options_v92()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor public.profiles;
  v_result jsonb;
begin
  select * into v_actor from public.profiles where id = auth.uid();
  if v_actor.id is null or v_actor.approval_status is distinct from 'approved' or not v_actor.active or v_actor.role is null then
    raise exception '활성 승인 회원만 정산 필터를 조회할 수 있습니다.';
  end if;

  with visible as (
    select ps.payer_id, ps.payer_username,
      o.created_by as registrant_id,
      o.creator_username as registrant_username,
      case when v_actor.role::text = 'admin' then coalesce(current_creator.group_name, '') else '' end as creator_group_name
    from public.payment_steps ps
    join public.orders o on o.id = ps.order_id
    left join public.profiles current_creator on current_creator.id = o.created_by
    where ps.payee_id = v_actor.id
      and o.archived_at is null
  )
  select jsonb_build_object(
    'payers', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.payer_id, 'label', x.payer_username) order by x.payer_username)
      from (select distinct payer_id, payer_username from visible) x
    ), '[]'::jsonb),
    'registrants', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.registrant_id, 'label', x.registrant_username) order by x.registrant_username)
      from (select distinct registrant_id, registrant_username from visible) x
    ), '[]'::jsonb),
    'groups', coalesce((
      select jsonb_agg(x.creator_group_name order by x.creator_group_name)
      from (select distinct creator_group_name from visible where trim(creator_group_name) <> '') x
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.get_my_settlement_page_v92(p_page integer DEFAULT 1, p_page_size integer DEFAULT 50, p_status text DEFAULT 'waiting'::text, p_payer_id uuid DEFAULT NULL::uuid, p_registrant_id uuid DEFAULT NULL::uuid, p_group_name text DEFAULT NULL::text, p_query text DEFAULT NULL::text, p_program_type text DEFAULT NULL::text, p_start_date_from date DEFAULT NULL::date, p_start_date_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      case when v_actor.role::text = 'admin' then coalesce(current_creator.group_name, '') else '' end as registrant_group_name,
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
    left join public.profiles current_creator on current_creator.id = o.created_by
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
  ), totals as (
    select
      count(*)::bigint as total_count,
      coalesce(sum(total_amount), 0)::bigint as total_amount,
      count(*) filter (where confirmed_at is null and chain_ready)::bigint as ready_count,
      coalesce(sum(total_amount) filter (where confirmed_at is null and chain_ready), 0)::bigint as ready_amount
    from filtered
  ), paged as (
    select *
    from filtered
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
$function$
;
CREATE OR REPLACE FUNCTION public.get_my_settlement_page_v94(p_page integer DEFAULT 1, p_page_size integer DEFAULT 50, p_status text DEFAULT 'waiting'::text, p_payer_id uuid DEFAULT NULL::uuid, p_registrant_id uuid DEFAULT NULL::uuid, p_group_name text DEFAULT NULL::text, p_query text DEFAULT NULL::text, p_program_type text DEFAULT NULL::text, p_start_date_from date DEFAULT NULL::date, p_start_date_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      case when v_actor.role::text = 'admin' then coalesce(current_creator.group_name, '') else '' end as registrant_group_name,
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
    left join public.profiles current_creator on current_creator.id = o.created_by
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
      coalesce(sum(f.total_amount) filter (where f.program_type = 'spark_s') over (partition by f.registrant_id), 0)::bigint as registrant_spark_s_amount,
      count(*) filter (where f.program_type = 'spark_s_plus') over (partition by f.registrant_id)::bigint as registrant_spark_s_plus_count,
      coalesce(sum(f.total_amount) filter (where f.program_type = 'spark_s_plus') over (partition by f.registrant_id), 0)::bigint as registrant_spark_s_plus_amount
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
        'registrantSparkSPlusCount', p.registrant_spark_s_plus_count,
        'registrantSparkSPlusAmount', p.registrant_spark_s_plus_amount,
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
$function$
;
CREATE OR REPLACE FUNCTION public.create_settlement_quote_v92(p_selection_mode text, p_step_ids uuid[] DEFAULT ARRAY[]::uuid[], p_excluded_step_ids uuid[] DEFAULT ARRAY[]::uuid[], p_status text DEFAULT 'waiting'::text, p_payer_id uuid DEFAULT NULL::uuid, p_registrant_id uuid DEFAULT NULL::uuid, p_group_name text DEFAULT NULL::text, p_query text DEFAULT NULL::text, p_program_type text DEFAULT NULL::text, p_start_date_from date DEFAULT NULL::date, p_start_date_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor public.profiles;
  v_quote public.settlement_quotes;
  v_inserted integer;
  v_requested integer;
  v_result jsonb;
begin
  select * into v_actor from public.profiles where id = auth.uid();
  if v_actor.id is null or v_actor.approval_status is distinct from 'approved' or not v_actor.active or v_actor.role is null then
    raise exception '활성 승인 회원만 일괄 입금확인을 사용할 수 있습니다.';
  end if;
  if p_selection_mode not in ('explicit', 'filtered') then
    raise exception '선택 방식이 올바르지 않습니다.';
  end if;

  delete from public.settlement_quotes
  where status in ('pending', 'expired')
    and expires_at < now() - interval '1 day';

  insert into public.settlement_quotes (
    requested_by, selection_mode, filters
  ) values (
    v_actor.id,
    p_selection_mode,
    jsonb_build_object(
      'status', coalesce(p_status, 'waiting'),
      'payerId', p_payer_id,
      'registrantId', p_registrant_id,
      'groupName', p_group_name,
      'query', p_query,
      'programType', p_program_type,
      'startDateFrom', p_start_date_from,
      'startDateTo', p_start_date_to
    )
  ) returning * into v_quote;

  with base as (
    select ps.id, ps.payer_id, ps.payer_username, ps.total_amount
    from public.payment_steps ps
    join public.orders o on o.id = ps.order_id
    left join public.profiles current_creator on current_creator.id = o.created_by
    where ps.payee_id = v_actor.id
      and ps.confirmed_at is null
      and o.archived_at is null
      and not exists (
        select 1 from public.payment_steps previous_step
        where previous_step.order_id = ps.order_id
          and previous_step.step_order < ps.step_order
          and previous_step.confirmed_at is null
      )
      and (
        (p_selection_mode = 'explicit' and ps.id = any(coalesce(p_step_ids, array[]::uuid[])))
        or (
          p_selection_mode = 'filtered'
          and not (ps.id = any(coalesce(p_excluded_step_ids, array[]::uuid[])))
          and (p_payer_id is null or ps.payer_id = p_payer_id)
          and (p_registrant_id is null or o.created_by = p_registrant_id)
          and (
            v_actor.role::text <> 'admin'
            or nullif(trim(coalesce(p_group_name, '')), '') is null
            or coalesce(current_creator.group_name, '') = trim(p_group_name)
          )
          and (nullif(trim(coalesce(p_program_type, '')), '') is null or o.program_type = p_program_type)
          and (p_start_date_from is null or o.start_date >= p_start_date_from)
          and (p_start_date_to is null or o.start_date <= p_start_date_to)
          and (
            nullif(trim(coalesce(p_query, '')), '') is null
            or lower(o.store_name) like '%' || lower(trim(p_query)) || '%'
            or lower(o.mid) like '%' || lower(trim(p_query)) || '%'
            or lower(o.order_number) like '%' || lower(trim(p_query)) || '%'
            or lower(ps.payer_username) like '%' || lower(trim(p_query)) || '%'
            or lower(o.creator_username) like '%' || lower(trim(p_query)) || '%'
            or (v_actor.role::text = 'admin' and lower(coalesce(current_creator.group_name, '')) like '%' || lower(trim(p_query)) || '%')
          )
        )
      )
  )
  insert into public.settlement_quote_items (
    quote_id, payment_step_id, payer_id, payer_username, expected_amount
  )
  select v_quote.id, b.id, b.payer_id, b.payer_username, b.total_amount
  from base b
  limit 5001;

  get diagnostics v_inserted = row_count;

  if p_selection_mode = 'explicit' then
    select count(distinct x) into v_requested
    from unnest(coalesce(p_step_ids, array[]::uuid[])) x;
    if v_requested = 0 then
      raise exception '선택한 입금 내역이 없습니다.';
    end if;
    if v_inserted <> v_requested then
      raise exception '선택 항목 중 이미 처리됐거나 순서 대기·보관 상태인 내역이 있습니다. 새로고침 후 다시 선택해 주세요.';
    end if;
  end if;

  if v_inserted = 0 then
    raise exception '현재 조건에서 입금확인 가능한 내역이 없습니다.';
  end if;
  if v_inserted > 5000 then
    raise exception '한 번에 최대 5,000건까지 확인할 수 있습니다. 입금자 또는 기간 필터로 나눠 처리해 주세요.';
  end if;

  update public.settlement_quotes q
  set item_count = x.item_count,
      expected_amount = x.expected_amount
  from (
    select count(*)::integer as item_count, coalesce(sum(expected_amount), 0)::bigint as expected_amount
    from public.settlement_quote_items
    where quote_id = v_quote.id
  ) x
  where q.id = v_quote.id
  returning q.* into v_quote;

  select jsonb_build_object(
    'id', v_quote.id,
    'itemCount', v_quote.item_count,
    'expectedAmount', v_quote.expected_amount,
    'expiresAt', v_quote.expires_at,
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'payerId', g.payer_id,
        'payerUsername', g.payer_username,
        'itemCount', g.item_count,
        'expectedAmount', g.expected_amount
      ) order by g.payer_username)
      from (
        select payer_id, max(payer_username) as payer_username,
          count(*)::integer as item_count,
          sum(expected_amount)::bigint as expected_amount
        from public.settlement_quote_items
        where quote_id = v_quote.id
        group by payer_id
      ) g
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.get_admin_company_overview_v96(p_page integer DEFAULT 1, p_page_size integer DEFAULT 12, p_query text DEFAULT NULL::text, p_sort text DEFAULT 'pending_amount'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor public.profiles;
  v_page integer := greatest(1, coalesce(p_page, 1));
  v_page_size integer := least(24, greatest(6, coalesce(p_page_size, 12)));
  v_sort text := coalesce(nullif(trim(p_sort), ''), 'pending_amount');
  v_result jsonb;
begin
  select * into v_actor from public.profiles where id = auth.uid();
  if v_actor.id is null
     or v_actor.role::text <> 'admin'
     or v_actor.approval_status::text <> 'approved'
     or not v_actor.active then
    raise exception '관리자만 업체별 접수 현황을 조회할 수 있습니다.';
  end if;
  if v_sort not in ('pending_amount', 'daily_shots', 'orders', 'recent') then
    raise exception '정렬 기준이 올바르지 않습니다.';
  end if;

  with order_base as (
    select
      o.id,
      o.created_by as registrant_id,
      o.creator_username,
      coalesce(nullif(trim(p.group_name), ''), '미지정 그룹') as group_name,
      o.program_type::text as program_type,
      o.daily_shots,
      o.status::text as order_status,
      o.created_at,
      ps.waiting_step_count,
      ps.waiting_amount,
      ps.confirmed_step_count,
      ps.confirmed_amount
    from public.orders o
    left join public.profiles p on p.id = o.created_by
    left join lateral (
      select
        count(*) filter (where step.confirmed_at is null)::bigint as waiting_step_count,
        coalesce(sum(step.total_amount) filter (where step.confirmed_at is null), 0)::bigint as waiting_amount,
        count(*) filter (where step.confirmed_at is not null)::bigint as confirmed_step_count,
        coalesce(sum(step.total_amount) filter (where step.confirmed_at is not null), 0)::bigint as confirmed_amount
      from public.payment_steps step
      where step.order_id = o.id and step.payee_id = v_actor.id
    ) ps on true
    where o.archived_at is null
  ), grouped as (
    select
      b.registrant_id,
      max(b.creator_username) as username,
      max(b.group_name) as group_name,
      count(*)::bigint as total_orders,
      count(*) filter (where b.waiting_step_count > 0)::bigint as waiting_order_count,
      coalesce(sum(b.waiting_amount), 0)::bigint as waiting_amount,
      count(*) filter (where b.confirmed_step_count > 0)::bigint as confirmed_order_count,
      coalesce(sum(b.confirmed_amount), 0)::bigint as confirmed_amount,
      count(*) filter (where b.order_status = '만료')::bigint as expired_count,
      count(*) filter (where b.order_status = '구동중')::bigint as running_count,
      coalesce(sum(b.daily_shots::bigint) filter (
        where b.order_status = '구동중' and b.program_type in ('spark', 'spark_plus')
      ), 0)::bigint as daily_running_shots,
      coalesce(sum(b.daily_shots::bigint) filter (
        where b.order_status = '구동중' and b.program_type = 'spark_s'
      ), 0)::bigint as spark_s_running_units,
      coalesce(sum(b.daily_shots::bigint) filter (
        where b.order_status = '구동중' and b.program_type = 'spark_s_plus'
      ), 0)::bigint as spark_s_plus_running_units,
      count(*) filter (where b.program_type = 'spark')::bigint as spark_count,
      count(*) filter (where b.program_type = 'spark_plus')::bigint as spark_plus_count,
      count(*) filter (where b.program_type = 'spark_s')::bigint as spark_s_count,
      count(*) filter (where b.program_type = 'spark_s_plus')::bigint as spark_s_plus_count,
      max(b.created_at) as last_order_at
    from order_base b
    group by b.registrant_id
  ), filtered as (
    select *
    from grouped g
    where nullif(trim(coalesce(p_query, '')), '') is null
       or lower(g.group_name) like '%' || lower(trim(p_query)) || '%'
       or lower(g.username) like '%' || lower(trim(p_query)) || '%'
  ), totals as (
    select
      count(*)::bigint as company_count,
      coalesce(sum(total_orders), 0)::bigint as total_orders,
      coalesce(sum(waiting_amount), 0)::bigint as waiting_amount,
      coalesce(sum(confirmed_amount), 0)::bigint as confirmed_amount,
      coalesce(sum(expired_count), 0)::bigint as expired_count,
      coalesce(sum(daily_running_shots), 0)::bigint as daily_running_shots,
      coalesce(sum(spark_s_running_units), 0)::bigint as spark_s_running_units,
      coalesce(sum(spark_s_plus_running_units), 0)::bigint as spark_s_plus_running_units
    from filtered
  ), paged as (
    select *
    from filtered g
    order by
      case when v_sort = 'pending_amount' then g.waiting_amount end desc nulls last,
      case when v_sort = 'daily_shots' then g.daily_running_shots end desc nulls last,
      case when v_sort = 'orders' then g.total_orders end desc nulls last,
      case when v_sort = 'recent' then g.last_order_at end desc nulls last,
      g.group_name asc,
      g.username asc
    limit v_page_size
    offset (v_page - 1) * v_page_size
  )
  select jsonb_build_object(
    'page', v_page,
    'pageSize', v_page_size,
    'totalPages', greatest(1, ceil(t.company_count::numeric / v_page_size)::integer),
    'companyCount', t.company_count,
    'totalOrders', t.total_orders,
    'waitingAmount', t.waiting_amount,
    'confirmedAmount', t.confirmed_amount,
    'expiredCount', t.expired_count,
    'dailyRunningShots', t.daily_running_shots,
    'sparkSRunningUnits', t.spark_s_running_units,
    'sparkSPlusRunningUnits', t.spark_s_plus_running_units,
    'companies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'registrantId', p.registrant_id,
        'username', p.username,
        'groupName', p.group_name,
        'totalOrders', p.total_orders,
        'waitingOrderCount', p.waiting_order_count,
        'waitingAmount', p.waiting_amount,
        'confirmedOrderCount', p.confirmed_order_count,
        'confirmedAmount', p.confirmed_amount,
        'expiredCount', p.expired_count,
        'runningCount', p.running_count,
        'dailyRunningShots', p.daily_running_shots,
        'sparkSRunningUnits', p.spark_s_running_units,
        'sparkSPlusRunningUnits', p.spark_s_plus_running_units,
        'sparkCount', p.spark_count,
        'sparkPlusCount', p.spark_plus_count,
        'sparkSCount', p.spark_s_count,
        'sparkSPlusCount', p.spark_s_plus_count,
        'lastOrderAt', p.last_order_at
      ) order by
        case when v_sort = 'pending_amount' then p.waiting_amount end desc nulls last,
        case when v_sort = 'daily_shots' then p.daily_running_shots end desc nulls last,
        case when v_sort = 'orders' then p.total_orders end desc nulls last,
        case when v_sort = 'recent' then p.last_order_at end desc nulls last,
        p.group_name asc,
        p.username asc)
      from paged p
    ), '[]'::jsonb)
  ) into v_result
  from totals t;

  return coalesce(v_result, jsonb_build_object(
    'page', v_page,
    'pageSize', v_page_size,
    'totalPages', 1,
    'companyCount', 0,
    'totalOrders', 0,
    'waitingAmount', 0,
    'confirmedAmount', 0,
    'expiredCount', 0,
    'dailyRunningShots', 0,
    'sparkSRunningUnits', 0,
    'sparkSPlusRunningUnits', 0,
    'companies', '[]'::jsonb
  ));
end;
$function$
;

insert into public.app_schema_versions(version, description)
values ('v10.6.0', 'Admin member order assignment, row-isolated bulk intake and current group display');
notify pgrst, 'reload schema';
commit;
