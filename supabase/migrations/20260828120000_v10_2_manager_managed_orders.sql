-- SPARK v10.2.0: operations-manager read-only managed order visibility.
-- This migration adds isolated read RPCs only. It does not grant any order or settlement mutation capability.

begin;

do $$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.orders') is null
     or to_regclass('public.payment_steps') is null
     or to_regclass('public.app_schema_versions') is null
     or to_regprocedure('public.admin_reverse_payment_confirmation_v101(uuid,timestamptz,integer,text)') is null then
    raise exception 'SPARK v10.1.0까지 먼저 적용되어 있어야 합니다.';
  end if;
  if not exists (select 1 from public.app_schema_versions where version = 'v10.1.0') then
    raise exception 'app_schema_versions에서 v10.1.0을 확인할 수 없습니다.';
  end if;
end $$;

create index if not exists orders_manager_read_v102_idx
  on public.orders(created_by, archived_at, created_at desc);

create or replace function public.get_manager_managed_orders_v102(
  p_agency_id uuid default null,
  p_program_type text default null,
  p_order_status text default null,
  p_settlement_status text default null,
  p_query text default null,
  p_start_date_from date default null,
  p_start_date_to date default null,
  p_page integer default 1,
  p_page_size integer default 50
)
returns table (
  order_id uuid,
  order_number text,
  registrant_id uuid,
  registrant_username text,
  program_type text,
  store_name text,
  keyword text,
  mid text,
  place_url text,
  daily_shots integer,
  operation_days integer,
  price_per_shot integer,
  supply_amount bigint,
  vat_amount bigint,
  total_amount bigint,
  start_date date,
  end_date date,
  order_status text,
  settlement_status text,
  settlement_detail text,
  confirmed_steps bigint,
  total_steps bigint,
  program_transfer_state text,
  settlement_reversal_pending boolean,
  created_at timestamptz,
  total_count bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles;
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_page_size integer := least(greatest(coalesce(p_page_size, 50), 1), 500);
begin
  select * into v_actor from public.profiles where id = auth.uid();
  if v_actor.id is null
     or not coalesce(v_actor.is_operations_manager, false)
     or v_actor.approval_status is distinct from 'approved'
     or not coalesce(v_actor.active, false) then
    raise exception using errcode = '42501', message = '승인된 활성 중간관리자만 관리 작업을 조회할 수 있습니다.';
  end if;

  if p_program_type is not null and p_program_type not in ('spark', 'spark_plus', 'spark_s', 'spark_s_plus') then
    raise exception '지원하지 않는 프로그램 필터입니다.';
  end if;
  if p_order_status is not null and p_order_status not in ('입금대기', '입금완료', '구동중', '정지', '만료') then
    raise exception '지원하지 않는 작업상태 필터입니다.';
  end if;
  if p_settlement_status is not null and p_settlement_status not in ('정산대기', '부분완료', '정산완료') then
    raise exception '지원하지 않는 정산상태 필터입니다.';
  end if;
  if p_start_date_from is not null and p_start_date_to is not null and p_start_date_from > p_start_date_to then
    raise exception '시작일 범위를 확인해 주세요.';
  end if;

  return query
  with scoped as (
    select
      o.id as order_id,
      o.order_number,
      mp.id as registrant_id,
      mp.username as registrant_username,
      o.program_type,
      o.store_name,
      o.keyword,
      o.mid,
      o.place_url,
      o.daily_shots,
      o.operation_days,
      o.price_per_shot,
      o.supply_amount,
      o.vat_amount,
      o.total_amount,
      o.start_date,
      o.end_date,
      o.status::text as order_status,
      coalesce(o.program_transfer_state, 'none') as program_transfer_state,
      coalesce(o.settlement_reversal_pending, false) as settlement_reversal_pending,
      o.created_at,
      coalesce(ps.confirmed_steps, 0)::bigint as confirmed_steps,
      coalesce(ps.total_steps, 0)::bigint as total_steps
    from public.profiles mp
    join public.orders o on o.created_by = mp.id
    left join lateral (
      select
        count(*) filter (where step.confirmed_at is not null)::bigint as confirmed_steps,
        count(*)::bigint as total_steps
      from public.payment_steps step
      where step.order_id = o.id
    ) ps on true
    where mp.manager_id = auth.uid()
      and o.archived_at is null
  ), labeled as (
    select
      s.*,
      case
        when s.settlement_reversal_pending or s.program_transfer_state = 'payment_pending' then '정산대기'
        when s.total_steps = 0 or s.confirmed_steps = 0 then '정산대기'
        when s.confirmed_steps = s.total_steps then '정산완료'
        else '부분완료'
      end as calculated_settlement_status,
      case
        when s.settlement_reversal_pending then '입금확인 취소 후 재확인 대기 · ' || s.confirmed_steps || '/' || s.total_steps || ' 완료'
        when s.program_transfer_state = 'payment_pending' then '프로그램 변경 추가금 입금대기 · ' || s.confirmed_steps || '/' || s.total_steps || ' 완료'
        when s.total_steps = 0 then '정산 단계 생성 대기'
        else s.confirmed_steps || '/' || s.total_steps || ' 완료'
      end as calculated_settlement_detail
    from scoped s
  ), filtered as (
    select l.*
    from labeled l
    where (p_agency_id is null or l.registrant_id = p_agency_id)
      and (p_program_type is null or l.program_type = p_program_type)
      and (p_order_status is null or l.order_status = p_order_status)
      and (p_settlement_status is null or l.calculated_settlement_status = p_settlement_status)
      and (p_start_date_from is null or l.start_date >= p_start_date_from)
      and (p_start_date_to is null or l.start_date <= p_start_date_to)
      and (
        nullif(trim(coalesce(p_query, '')), '') is null
        or l.store_name ilike '%' || trim(p_query) || '%'
        or l.keyword ilike '%' || trim(p_query) || '%'
        or l.mid ilike '%' || trim(p_query) || '%'
        or l.registrant_username ilike '%' || trim(p_query) || '%'
      )
  )
  select
    f.order_id,
    f.order_number,
    f.registrant_id,
    f.registrant_username,
    f.program_type,
    f.store_name,
    f.keyword,
    f.mid,
    f.place_url,
    f.daily_shots,
    f.operation_days,
    f.price_per_shot,
    f.supply_amount,
    f.vat_amount,
    f.total_amount,
    f.start_date,
    f.end_date,
    f.order_status,
    f.calculated_settlement_status,
    f.calculated_settlement_detail,
    f.confirmed_steps,
    f.total_steps,
    f.program_transfer_state,
    f.settlement_reversal_pending,
    f.created_at,
    count(*) over()::bigint
  from filtered f
  order by f.created_at desc, f.order_id desc
  limit v_page_size
  offset (v_page - 1) * v_page_size;
end;
$$;

revoke all on function public.get_manager_managed_orders_v102(uuid,text,text,text,text,date,date,integer,integer) from public, anon, authenticated;
grant execute on function public.get_manager_managed_orders_v102(uuid,text,text,text,text,date,date,integer,integer) to authenticated;

create or replace function public.get_manager_managed_order_filter_options_v102()
returns table (
  agency_id uuid,
  agency_username text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles;
begin
  select * into v_actor from public.profiles where id = auth.uid();
  if v_actor.id is null
     or not coalesce(v_actor.is_operations_manager, false)
     or v_actor.approval_status is distinct from 'approved'
     or not coalesce(v_actor.active, false) then
    raise exception using errcode = '42501', message = '승인된 활성 중간관리자만 관리 작업 필터를 조회할 수 있습니다.';
  end if;

  return query
  select p.id, p.username
  from public.profiles p
  where p.manager_id = auth.uid()
  order by p.username;
end;
$$;

revoke all on function public.get_manager_managed_order_filter_options_v102() from public, anon, authenticated;
grant execute on function public.get_manager_managed_order_filter_options_v102() to authenticated;

create or replace function public.get_manager_managed_orders_summary_v102()
returns table (
  managed_agency_count bigint,
  total_order_count bigint,
  running_order_count bigint,
  settlement_waiting_count bigint,
  total_amount bigint,
  settlement_waiting_amount bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles;
begin
  select * into v_actor from public.profiles where id = auth.uid();
  if v_actor.id is null
     or not coalesce(v_actor.is_operations_manager, false)
     or v_actor.approval_status is distinct from 'approved'
     or not coalesce(v_actor.active, false) then
    raise exception using errcode = '42501', message = '승인된 활성 중간관리자만 관리 작업 요약을 조회할 수 있습니다.';
  end if;

  return query
  with scoped as (
    select
      o.id,
      o.status::text as order_status,
      o.total_amount,
      coalesce(o.program_transfer_state, 'none') as program_transfer_state,
      coalesce(o.settlement_reversal_pending, false) as settlement_reversal_pending,
      coalesce(ps.total_steps, 0)::bigint as total_steps,
      coalesce(ps.pending_steps, 0)::bigint as pending_steps
    from public.profiles p
    join public.orders o on o.created_by = p.id
    left join lateral (
      select
        count(*)::bigint as total_steps,
        count(*) filter (where step.confirmed_at is null)::bigint as pending_steps
      from public.payment_steps step
      where step.order_id = o.id
    ) ps on true
    where p.manager_id = auth.uid()
      and o.archived_at is null
  ), labeled as (
    select s.*, (
      s.settlement_reversal_pending
      or s.program_transfer_state = 'payment_pending'
      or s.total_steps = 0
      or s.pending_steps > 0
    ) as settlement_waiting
    from scoped s
  )
  select
    (select count(*) from public.profiles p where p.manager_id = auth.uid())::bigint,
    count(*)::bigint,
    count(*) filter (where l.order_status = '구동중')::bigint,
    count(*) filter (where l.settlement_waiting)::bigint,
    coalesce(sum(l.total_amount), 0)::bigint,
    coalesce(sum(l.total_amount) filter (where l.settlement_waiting), 0)::bigint
  from labeled l;
end;
$$;

revoke all on function public.get_manager_managed_orders_summary_v102() from public, anon, authenticated;
grant execute on function public.get_manager_managed_orders_summary_v102() to authenticated;

insert into public.app_schema_versions(version, description)
values ('v10.2.0', 'Operations-manager read-only managed order visibility and export pagination')
on conflict (version) do nothing;

select public.write_audit_log(
  'system.migration',
  'system',
  null,
  'SPARK v10.2.0',
  jsonb_build_object('description', 'read-only manager-scoped order visibility, settlement summary and server pagination')
);

commit;
