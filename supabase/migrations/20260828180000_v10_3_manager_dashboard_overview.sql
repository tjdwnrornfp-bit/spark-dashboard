-- SPARK v10.3.0: operations-manager dashboard aggregates.
-- Read-only RPCs only. No order, payment, archive, member, or settlement mutation permission is added.

begin;

do $$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.orders') is null
     or to_regclass('public.payment_steps') is null
     or to_regclass('public.app_schema_versions') is null
     or to_regprocedure('public.get_manager_managed_orders_v102(uuid,text,text,text,text,date,date,integer,integer)') is null
     or to_regprocedure('public.get_manager_managed_order_filter_options_v102()') is null then
    raise exception 'SPARK v10.2.0까지 먼저 적용되어 있어야 합니다.';
  end if;
  if not exists (select 1 from public.app_schema_versions where version = 'v10.2.0') then
    raise exception 'app_schema_versions에서 v10.2.0을 확인할 수 없습니다.';
  end if;
end $$;

create index if not exists payment_steps_manager_finance_v103_idx
  on public.payment_steps(order_id, payer_id, confirmed_at);

create or replace function public.get_manager_dashboard_summary_v103()
returns table (
  managed_agency_count bigint,
  total_order_count bigint,
  total_settlement_amount bigint,
  settlement_waiting_amount bigint,
  settlement_completed_amount bigint,
  running_order_count bigint,
  payment_waiting_order_count bigint,
  payment_completed_order_count bigint,
  expired_order_count bigint,
  stopped_order_count bigint
)
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
     or not coalesce(v_actor.is_operations_manager, false)
     or v_actor.approval_status is distinct from 'approved'
     or not coalesce(v_actor.active, false) then
    raise exception using errcode = '42501', message = '승인된 활성 중간관리자만 대시보드 요약을 조회할 수 있습니다.';
  end if;

  return query
  with order_financials as (
    select
      o.id,
      o.status::text as order_status,
      case when ps.direct_step_count = 0
        then o.total_amount
        else ps.waiting_amount + ps.completed_amount
      end::bigint as effective_total_amount,
      case when ps.direct_step_count = 0
        then o.total_amount
        else ps.waiting_amount
      end::bigint as effective_waiting_amount,
      ps.completed_amount::bigint as effective_completed_amount
    from public.profiles mp
    join public.orders o on o.created_by = mp.id
    left join lateral (
      select
        count(*)::bigint as direct_step_count,
        coalesce(sum(step.total_amount) filter (where step.confirmed_at is null), 0)::bigint as waiting_amount,
        coalesce(sum(step.total_amount) filter (where step.confirmed_at is not null), 0)::bigint as completed_amount
      from public.payment_steps step
      where step.order_id = o.id
        and step.payer_id = o.created_by
    ) ps on true
    where mp.manager_id = auth.uid()
      and o.archived_at is null
  )
  select
    (select count(*) from public.profiles mp where mp.manager_id = auth.uid())::bigint,
    count(f.id)::bigint,
    coalesce(sum(f.effective_total_amount), 0)::bigint,
    coalesce(sum(f.effective_waiting_amount), 0)::bigint,
    coalesce(sum(f.effective_completed_amount), 0)::bigint,
    count(*) filter (where f.order_status = '구동중')::bigint,
    count(*) filter (where f.order_status = '입금대기')::bigint,
    count(*) filter (where f.order_status = '입금완료')::bigint,
    count(*) filter (where f.order_status = '만료')::bigint,
    count(*) filter (where f.order_status = '정지')::bigint
  from order_financials f;
end;
$$;

revoke all on function public.get_manager_dashboard_summary_v103() from public, anon, authenticated;
grant execute on function public.get_manager_dashboard_summary_v103() to authenticated;

create or replace function public.get_manager_agency_overview_v103(
  p_page integer default 1,
  p_page_size integer default 12,
  p_query text default null,
  p_sort text default 'settlement_waiting'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles;
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_page_size integer := least(greatest(coalesce(p_page_size, 12), 1), 24);
  v_sort text := coalesce(nullif(trim(p_sort), ''), 'settlement_waiting');
  v_result jsonb;
begin
  select * into v_actor from public.profiles where id = auth.uid();
  if v_actor.id is null
     or not coalesce(v_actor.is_operations_manager, false)
     or v_actor.approval_status is distinct from 'approved'
     or not coalesce(v_actor.active, false) then
    raise exception using errcode = '42501', message = '승인된 활성 중간관리자만 대행사별 현황을 조회할 수 있습니다.';
  end if;
  if v_sort not in ('settlement_waiting', 'orders', 'running', 'username') then
    raise exception '지원하지 않는 정렬 기준입니다.';
  end if;

  with managed_profiles as (
    select mp.id, mp.username
    from public.profiles mp
    where mp.manager_id = auth.uid()
  ), order_financials as (
    select
      o.id as order_id,
      o.created_by as agency_id,
      o.status::text as order_status,
      o.created_at,
      case when ps.direct_step_count = 0
        then o.total_amount
        else ps.waiting_amount + ps.completed_amount
      end::bigint as effective_total_amount,
      case when ps.direct_step_count = 0
        then o.total_amount
        else ps.waiting_amount
      end::bigint as effective_waiting_amount,
      ps.completed_amount::bigint as effective_completed_amount
    from managed_profiles mp
    join public.orders o on o.created_by = mp.id
    left join lateral (
      select
        count(*)::bigint as direct_step_count,
        coalesce(sum(step.total_amount) filter (where step.confirmed_at is null), 0)::bigint as waiting_amount,
        coalesce(sum(step.total_amount) filter (where step.confirmed_at is not null), 0)::bigint as completed_amount
      from public.payment_steps step
      where step.order_id = o.id
        and step.payer_id = o.created_by
    ) ps on true
    where o.archived_at is null
  ), grouped as (
    select
      mp.id as agency_id,
      mp.username,
      count(f.order_id)::bigint as total_order_count,
      count(*) filter (where f.order_status = '구동중')::bigint as running_order_count,
      count(*) filter (where f.order_status = '입금대기')::bigint as payment_waiting_order_count,
      count(*) filter (where f.order_status = '입금완료')::bigint as payment_completed_order_count,
      count(*) filter (where f.order_status = '만료')::bigint as expired_order_count,
      count(*) filter (where f.order_status = '정지')::bigint as stopped_order_count,
      coalesce(sum(f.effective_total_amount), 0)::bigint as total_settlement_amount,
      coalesce(sum(f.effective_waiting_amount), 0)::bigint as settlement_waiting_amount,
      coalesce(sum(f.effective_completed_amount), 0)::bigint as settlement_completed_amount,
      max(f.created_at) as last_order_at
    from managed_profiles mp
    left join order_financials f on f.agency_id = mp.id
    group by mp.id, mp.username
  ), filtered as (
    select *
    from grouped g
    where nullif(trim(coalesce(p_query, '')), '') is null
       or lower(g.username) like '%' || lower(trim(p_query)) || '%'
  ), totals as (
    select count(*)::bigint as agency_count from filtered
  ), paged as (
    select *
    from filtered g
    order by
      case when v_sort = 'settlement_waiting' then g.settlement_waiting_amount end desc nulls last,
      case when v_sort = 'orders' then g.total_order_count end desc nulls last,
      case when v_sort = 'running' then g.running_order_count end desc nulls last,
      case when v_sort = 'username' then lower(g.username) end asc nulls last,
      lower(g.username) asc,
      g.agency_id asc
    limit v_page_size
    offset (v_page - 1) * v_page_size
  )
  select jsonb_build_object(
    'page', v_page,
    'pageSize', v_page_size,
    'totalPages', greatest(1, ceil(t.agency_count::numeric / v_page_size)::integer),
    'agencyCount', t.agency_count,
    'agencies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'agencyId', p.agency_id,
        'username', p.username,
        'totalOrderCount', p.total_order_count,
        'runningOrderCount', p.running_order_count,
        'paymentWaitingOrderCount', p.payment_waiting_order_count,
        'paymentCompletedOrderCount', p.payment_completed_order_count,
        'expiredOrderCount', p.expired_order_count,
        'stoppedOrderCount', p.stopped_order_count,
        'totalSettlementAmount', p.total_settlement_amount,
        'settlementWaitingAmount', p.settlement_waiting_amount,
        'settlementCompletedAmount', p.settlement_completed_amount,
        'lastOrderAt', p.last_order_at
      ) order by
        case when v_sort = 'settlement_waiting' then p.settlement_waiting_amount end desc nulls last,
        case when v_sort = 'orders' then p.total_order_count end desc nulls last,
        case when v_sort = 'running' then p.running_order_count end desc nulls last,
        case when v_sort = 'username' then lower(p.username) end asc nulls last,
        lower(p.username) asc,
        p.agency_id asc)
      from paged p
    ), '[]'::jsonb)
  ) into v_result
  from totals t;

  return coalesce(v_result, jsonb_build_object(
    'page', v_page,
    'pageSize', v_page_size,
    'totalPages', 1,
    'agencyCount', 0,
    'agencies', '[]'::jsonb
  ));
end;
$$;

revoke all on function public.get_manager_agency_overview_v103(integer, integer, text, text) from public, anon, authenticated;
grant execute on function public.get_manager_agency_overview_v103(integer, integer, text, text) to authenticated;

insert into public.app_schema_versions(version, description)
values ('v10.3.0', 'Operations-manager agency operation and direct-settlement dashboard aggregates')
on conflict (version) do nothing;

select public.write_audit_log(
  'system.migration',
  'system',
  null,
  'SPARK v10.3.0',
  jsonb_build_object('description', 'manager-scoped read-only operation and direct-settlement dashboard aggregates')
);

commit;
