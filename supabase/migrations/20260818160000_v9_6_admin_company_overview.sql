-- SPARK v9.6 - 관리자 업체별 접수/정산/구동 현황
-- 기존 회원, 작업, 정산, 알림, 감사기록 데이터는 변경하거나 삭제하지 않습니다.

begin;

-- 대량 운영에서 업체별 집계를 빠르게 하기 위한 보조 인덱스
create index if not exists orders_company_overview_v96_idx
  on public.orders(created_by, status, program_type, created_at desc)
  where archived_at is null;

create index if not exists payment_steps_order_payee_v96_idx
  on public.payment_steps(order_id, payee_id, step_order desc);

create or replace function public.get_admin_company_overview_v96(
  p_page integer default 1,
  p_page_size integer default 12,
  p_query text default null,
  p_sort text default 'pending_amount'
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
  v_page_size integer := least(24, greatest(6, coalesce(p_page_size, 12)));
  v_sort text := coalesce(nullif(trim(p_sort), ''), 'pending_amount');
  v_result jsonb;
begin
  select * into v_actor
  from public.profiles
  where id = auth.uid();

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
      coalesce(nullif(trim(p.group_name), ''), nullif(trim(o.creator_group_name), ''), '미지정 그룹') as group_name,
      o.program_type::text as program_type,
      o.daily_shots,
      o.status::text as order_status,
      o.created_at,
      ps.id as admin_step_id,
      ps.total_amount as admin_amount,
      ps.confirmed_at as admin_confirmed_at
    from public.orders o
    left join public.profiles p on p.id = o.created_by
    left join lateral (
      select step.id, step.total_amount, step.confirmed_at
      from public.payment_steps step
      where step.order_id = o.id
        and step.payee_id = v_actor.id
      order by step.step_order desc
      limit 1
    ) ps on true
    where o.archived_at is null
  ), grouped as (
    select
      b.registrant_id,
      max(b.creator_username) as username,
      max(b.group_name) as group_name,
      count(*)::bigint as total_orders,
      count(*) filter (where b.admin_step_id is not null and b.admin_confirmed_at is null)::bigint as waiting_order_count,
      coalesce(sum(b.admin_amount) filter (where b.admin_step_id is not null and b.admin_confirmed_at is null), 0)::bigint as waiting_amount,
      count(*) filter (where b.admin_step_id is not null and b.admin_confirmed_at is not null)::bigint as confirmed_order_count,
      coalesce(sum(b.admin_amount) filter (where b.admin_step_id is not null and b.admin_confirmed_at is not null), 0)::bigint as confirmed_amount,
      count(*) filter (where b.order_status = '만료')::bigint as expired_count,
      count(*) filter (where b.order_status = '구동중')::bigint as running_count,
      coalesce(sum(b.daily_shots::bigint) filter (
        where b.order_status = '구동중' and b.program_type in ('spark', 'spark_plus')
      ), 0)::bigint as daily_running_shots,
      coalesce(sum(b.daily_shots::bigint) filter (
        where b.order_status = '구동중' and b.program_type = 'spark_s'
      ), 0)::bigint as spark_s_running_units,
      count(*) filter (where b.program_type = 'spark')::bigint as spark_count,
      count(*) filter (where b.program_type = 'spark_plus')::bigint as spark_plus_count,
      count(*) filter (where b.program_type = 'spark_s')::bigint as spark_s_count,
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
      coalesce(sum(spark_s_running_units), 0)::bigint as spark_s_running_units
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
        'sparkCount', p.spark_count,
        'sparkPlusCount', p.spark_plus_count,
        'sparkSCount', p.spark_s_count,
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
    'companies', '[]'::jsonb
  ));
end;
$$;

revoke all on function public.get_admin_company_overview_v96(integer, integer, text, text) from public, anon;
grant execute on function public.get_admin_company_overview_v96(integer, integer, text, text) to authenticated;

insert into public.app_schema_versions(version, description)
values ('v9.6.0', 'Admin company overview cards for settlement operations')
on conflict (version) do update
set description = excluded.description,
    applied_at = now();

select public.write_audit_log(
  'system.migration',
  'system',
  null,
  'SPARK v9.6.0',
  jsonb_build_object('description', 'admin company settlement overview cards')
);

commit;
