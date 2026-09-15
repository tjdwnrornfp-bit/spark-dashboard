-- v10.9: additive read-only manager folder API. Existing routines/RLS remain unchanged.
begin;
set local lock_timeout = '5s';
do $$ begin
  if not exists(select 1 from public.app_schema_versions where version='v10.8.0') then raise exception 'v10.8.0 required'; end if;
  if exists(select 1 from public.app_schema_versions where version='v10.9.0') then raise exception 'v10.9.0 already applied'; end if;
end $$;
create or replace function public.get_manager_agency_orders_v109(
  p_agency_id uuid default null,
  p_program_type text default null,
  p_order_statuses text[] default null,
  p_settlement_status text default null,
  p_query text default null,
  p_start_date_from date default null,
  p_start_date_to date default null,
  p_page integer default 1,
  p_page_size integer default 50,
  p_sort text default 'priority'
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
stable
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


  if p_agency_id is null or not exists (
    select 1 from public.profiles mp where mp.id = p_agency_id and mp.manager_id = auth.uid()
  ) then raise exception using errcode='42501', message='현재 관리 대행사만 조회할 수 있습니다.'; end if;

  if p_program_type is not null and p_program_type not in ('spark', 'spark_plus', 'spark_s', 'spark_s_plus') then
    raise exception '지원하지 않는 프로그램 필터입니다.';
  end if;
  if p_order_statuses is not null and (cardinality(p_order_statuses)=0 or array_position(p_order_statuses,null) is not null or not p_order_statuses <@ array['입금대기','입금완료','구동중','정지','만료']::text[]) then
    raise exception '지원하지 않는 작업상태 필터입니다.';
  end if;
  if p_settlement_status is not null and p_settlement_status not in ('정산대기', '부분완료', '정산완료') then
    raise exception '지원하지 않는 정산상태 필터입니다.';
  end if;
  if p_start_date_from is not null and p_start_date_to is not null and p_start_date_from > p_start_date_to then
    raise exception '시작일 범위를 확인해 주세요.';
  end if;

  if p_sort is null or p_sort not in ('priority','newest','oldest','start_date') then raise exception '지원하지 않는 정렬입니다.'; end if;
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
      and mp.id = p_agency_id
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
      and (p_order_statuses is null or l.order_status = any(p_order_statuses))
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
  order by
    case when p_sort='priority' then case f.order_status when '입금대기' then 1 when '입금완료' then 2 when '구동중' then 3 when '정지' then 4 when '만료' then 5 else 6 end end asc,
    case when p_sort='start_date' then f.start_date end asc,
    case when p_sort='oldest' then f.created_at end asc,
    f.created_at desc, f.order_id desc
  limit v_page_size
  offset (v_page - 1) * v_page_size;
end;
$$;

revoke all on function public.get_manager_agency_orders_v109(uuid,text,text[],text,text,date,date,integer,integer,text) from public, anon, authenticated;
grant execute on function public.get_manager_agency_orders_v109(uuid,text,text[],text,text,date,date,integer,integer,text) to authenticated;
create function public.get_manager_agency_folders_v109(
  p_page integer default 1, p_page_size integer default 20,
  p_query text default null, p_sort text default 'in_progress',
  p_agency_id uuid default null, p_program_type text default null,
  p_order_statuses text[] default null, p_settlement_status text default null,
  p_start_date_from date default null, p_start_date_to date default null
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor public.profiles;
  v_page integer := greatest(coalesce(p_page,1),1);
  v_size integer := least(greatest(coalesce(p_page_size,20),1),50);
  v_result jsonb;
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
  if p_order_statuses is not null and (cardinality(p_order_statuses)=0 or array_position(p_order_statuses,null) is not null or not p_order_statuses <@ array['입금대기','입금완료','구동중','정지','만료']::text[]) then
    raise exception '지원하지 않는 작업상태 필터입니다.';
  end if;
  if p_settlement_status is not null and p_settlement_status not in ('정산대기', '부분완료', '정산완료') then
    raise exception '지원하지 않는 정산상태 필터입니다.';
  end if;
  if p_start_date_from is not null and p_start_date_to is not null and p_start_date_from > p_start_date_to then
    raise exception '시작일 범위를 확인해 주세요.';
  end if;


  if p_sort is null or p_sort not in ('in_progress','settlement_waiting','recent','username') then raise exception '지원하지 않는 폴더 정렬입니다.'; end if;
  if p_agency_id is not null and not exists(select 1 from public.profiles where id=p_agency_id and manager_id=auth.uid()) then
    raise exception using errcode='42501', message='현재 관리 대행사만 조회할 수 있습니다.';
  end if;
  with managed as (
    select id,username from public.profiles where manager_id=auth.uid() and (p_agency_id is null or id=p_agency_id)
  ), financials as (
    select o.id, o.created_by, o.status::text order_status, o.created_at,
      -- Same direct-payer amount rules as dashboard v103, including the no-step fallback.
      case when ps.direct_count=0 then o.total_amount else ps.waiting_amount end waiting_amount,
      ps.completed_amount,
      (p_program_type is null or o.program_type=p_program_type)
      and (p_order_statuses is null or o.status::text=any(p_order_statuses))
      and (p_start_date_from is null or o.start_date>=p_start_date_from)
      and (p_start_date_to is null or o.start_date<=p_start_date_to)
      and (nullif(trim(p_query),'') is null or mp.username ilike '%'||trim(p_query)||'%'
        or o.store_name ilike '%'||trim(p_query)||'%' or o.keyword ilike '%'||trim(p_query)||'%' or o.mid ilike '%'||trim(p_query)||'%')
      and (p_settlement_status is null or p_settlement_status = case
        when coalesce(o.settlement_reversal_pending,false) or o.program_transfer_state='payment_pending' then '정산대기'
        when ps.total_steps=0 or ps.confirmed_steps=0 then '정산대기'
        when ps.confirmed_steps=ps.total_steps then '정산완료' else '부분완료' end) as matches
    from managed mp join public.orders o on o.created_by=mp.id
    left join lateral (
      select count(*) total_steps, count(*) filter(where s.confirmed_at is not null) confirmed_steps,
        count(*) filter(where s.payer_id=o.created_by) direct_count,
        coalesce(sum(s.total_amount) filter(where s.payer_id=o.created_by and s.confirmed_at is null),0)::bigint waiting_amount,
        coalesce(sum(s.total_amount) filter(where s.payer_id=o.created_by and s.confirmed_at is not null),0)::bigint completed_amount
      from public.payment_steps s where s.order_id=o.id
    ) ps on true where o.archived_at is null
  ), grouped as (
    select mp.id as agency_id,mp.username,
      count(f.id)::bigint total_order_count,
      count(f.id) filter(where f.matches)::bigint matched_order_count,
      count(f.id) filter(where f.order_status in ('입금대기','입금완료'))::bigint in_progress_count,
      count(f.id) filter(where f.order_status='구동중')::bigint running_count,
      count(f.id) filter(where f.order_status='만료')::bigint expired_count,
      count(f.id) filter(where f.order_status='정지')::bigint stopped_count,
      coalesce(sum(f.waiting_amount),0)::bigint waiting_amount,
      coalesce(sum(f.completed_amount),0)::bigint completed_amount,
      max(f.created_at) last_order_at
    from managed mp left join financials f on f.created_by=mp.id group by mp.id,mp.username
  ), filtered as (
    select * from grouped g where g.matched_order_count>0 or (
      p_program_type is null and p_order_statuses is null and p_settlement_status is null
      and p_start_date_from is null and p_start_date_to is null
      and (nullif(trim(p_query),'') is null or g.username ilike '%'||trim(p_query)||'%')
    )
  ), totals as (select count(*) n from filtered), bounds as (
    select n, greatest(1,ceil(n::numeric/v_size)::integer) pages,
      least(v_page,greatest(1,ceil(n::numeric/v_size)::integer)) page from totals
  ), ranked as (
    select g.*,row_number() over(order by
      case when p_sort='in_progress' then in_progress_count end desc,
      case when p_sort in ('in_progress','settlement_waiting') then waiting_amount end desc,
      case when p_sort in ('in_progress','settlement_waiting','recent') then last_order_at end desc nulls last,
      lower(username),agency_id) position from filtered g
  ), paged as (
    select r.* from ranked r cross join bounds b where r.position>(b.page-1)::bigint*v_size and r.position<=b.page::bigint*v_size
  ) select jsonb_build_object('page',b.page,'pageSize',v_size,'totalPages',b.pages,'agencyCount',b.n,
    'agencies',coalesce((select jsonb_agg(jsonb_build_object(
      'agencyId',agency_id,'username',username,'totalOrderCount',total_order_count,
      'matchedOrderCount',matched_order_count,'inProgressCount',in_progress_count,
      'runningCount',running_count,'expiredCount',expired_count,'stoppedCount',stopped_count,
      'settlementWaitingAmount',waiting_amount,'settlementCompletedAmount',completed_amount,'lastOrderAt',last_order_at
    ) order by position) from paged),'[]'::jsonb)) into v_result from bounds b;
  return v_result;
end $$;
revoke all on function public.get_manager_agency_folders_v109(integer,integer,text,text,uuid,text,text[],text,date,date) from public,anon,authenticated;
grant execute on function public.get_manager_agency_folders_v109(integer,integer,text,text,uuid,text,text[],text,date,date) to authenticated;

insert into public.app_schema_versions(version,description) values('v10.9.0','Manager agency folders with scoped lazy pagination and search');
notify pgrst,'reload schema';
commit;
