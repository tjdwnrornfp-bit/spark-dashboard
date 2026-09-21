-- v10.11: bounded read paths; existing order/payment amounts and write policies are unchanged.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create or replace function public.get_order_page_v1011(
  p_program_type text default null, p_status text default null,
  p_archived boolean default false, p_query text default null,
  p_created_from date default null, p_created_to date default null,
  p_page integer default 1, p_page_size integer default 50, p_sort text default 'desc',
  p_order_ids text[] default null, p_export_before timestamptz default null,
  p_expected_revision text default null
) returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_actor public.profiles; v_result jsonb;
  v_size integer := least(1000, greatest(1, coalesce(p_page_size, 50)));
  v_page integer := greatest(1, coalesce(p_page, 1));
begin
  select * into v_actor from public.profiles where id = auth.uid();
  if v_actor.id is null or v_actor.approval_status is distinct from 'approved' or not v_actor.active or v_actor.role is null or v_actor.is_operations_manager then
    raise exception '활성 승인 회원만 작업을 조회할 수 있습니다.' using errcode = '42501';
  end if;
  if p_program_type is not null and p_program_type not in ('spark','spark_plus','spark_s','spark_s_plus') then raise exception '잘못된 프로그램입니다.'; end if;
  if p_status is not null and p_status not in ('입금대기','입금완료','구동중','정지','만료') then raise exception '잘못된 작업 상태입니다.'; end if;
  if p_sort is null or p_sort not in ('asc','desc') then raise exception '잘못된 정렬입니다.'; end if;
  if p_created_from > p_created_to then raise exception '조회 기간을 확인해 주세요.'; end if;
  with base as materialized (
    select o.*, coalesce(p.group_name, '') as current_creator_group_name,
      p.updated_at as creator_updated_at
    from public.orders o left join public.profiles p on p.id = o.created_by
    where (v_actor.role::text = 'admin' or o.created_by = v_actor.id)
      and (p_archived is null or (coalesce(p_archived, false) and o.archived_at is not null) or (not coalesce(p_archived, false) and o.archived_at is null))
      and (p_program_type is null or o.program_type = p_program_type)
      and (p_created_from is null or o.created_at >= p_created_from::timestamp at time zone 'Asia/Seoul')
      and (p_created_to is null or o.created_at < (p_created_to + 1)::timestamp at time zone 'Asia/Seoul')
      and (p_export_before is null or o.created_at <= p_export_before)
  ), filtered as materialized (
    select * from base o where (p_status is null or o.status::text = p_status)
      and (p_order_ids is null or o.order_number = any(p_order_ids))
      and (nullif(btrim(p_query),'') is null or exists (
        select 1 from unnest(array[o.order_number,o.creator_username,coalesce(o.sponsor_username,''),o.current_creator_group_name,o.store_name,o.keyword,o.mid]) value
        where strpos(lower(value), lower(btrim(p_query))) > 0
      ))
  ), stats as (
    select count(*) as total, greatest(1, ceil(count(*)::numeric / v_size)::integer) as pages,
      coalesce(max(greatest(updated_at, creator_updated_at))::text, '') || ':' || count(*)::text as revision
    from filtered
  ), paged as (
    select o.* from filtered o
    order by case when p_sort = 'asc' then o.created_at end asc,
      case when p_sort = 'desc' then o.created_at end desc,
      case when p_sort = 'asc' then o.order_number end asc,
      case when p_sort = 'desc' then o.order_number end desc
    limit v_size offset (least(v_page, (select pages from stats)) - 1) * v_size
  )
  select jsonb_build_object(
    'totalCount', s.total, 'totalPages', s.pages, 'page', least(v_page,s.pages), 'pageSize', v_size, 'revision', s.revision,
    'counts', (select jsonb_build_object('전체',count(*),'입금대기',count(*) filter(where status='입금대기'),
      '입금완료',count(*) filter(where status='입금완료'),'구동중',count(*) filter(where status='구동중'),
      '정지',count(*) filter(where status='정지'),'만료',count(*) filter(where status='만료')) from base),
    'rows', coalesce((select jsonb_agg((to_jsonb(o) - 'creator_updated_at') || jsonb_build_object('settlement_amount',
      case when v_actor.role::text = 'admin' then coalesce((select sum(ps.total_amount) from public.payment_steps ps where ps.order_id=o.id and ps.payee_id=v_actor.id),0)
      else o.total_amount end)) from paged o),'[]'::jsonb)
  ) into v_result from stats s;
  if p_expected_revision is not null and p_expected_revision <> v_result->>'revision' then
    raise exception '내보내기 중 작업이 변경되었습니다. 최신 상태에서 다시 시도해 주세요.' using errcode='40001';
  end if;
  return v_result;
end; $$;

create or replace function public.get_dashboard_summary_v1011()
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_actor public.profiles; v_result jsonb;
begin
  select * into v_actor from public.profiles where id=auth.uid();
  if v_actor.id is null or v_actor.approval_status is distinct from 'approved' or not v_actor.active or v_actor.role is null or v_actor.is_operations_manager then
    raise exception '활성 승인 회원만 대시보드를 조회할 수 있습니다.' using errcode='42501';
  end if;
  with visible as materialized (
    select o.* from public.orders o where o.archived_at is null and (v_actor.role::text='admin' or o.created_by=v_actor.id)
  )
  select jsonb_build_object(
    'totalCount',count(*),'runningCount',count(*) filter(where status='구동중'),
    'runningShots',coalesce(sum(daily_shots) filter(where status='구동중' and program_type in ('spark','spark_plus')),0),
    'runningCases',coalesce(sum(daily_shots) filter(where status='구동중' and program_type='spark_s'),0),
    'runningSPlusCases',coalesce(sum(daily_shots) filter(where status='구동중' and program_type='spark_s_plus'),0),
    'totalContractShots',coalesce(sum(daily_shots::bigint*operation_days) filter(where program_type in ('spark','spark_plus')),0),
    'totalContractCases',coalesce(sum(daily_shots::bigint*operation_days) filter(where program_type='spark_s'),0),
    'totalContractSPlusCases',coalesce(sum(daily_shots::bigint*operation_days) filter(where program_type='spark_s_plus'),0),
    'statusCounts',jsonb_build_object('입금대기',count(*) filter(where status='입금대기'),'입금완료',count(*) filter(where status='입금완료'),
      '구동중',count(*) filter(where status='구동중'),'정지',count(*) filter(where status='정지'),'만료',count(*) filter(where status='만료')),
    'programSummaries',(select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) from (
      select program_type as type,count(*) as total,count(*) filter(where status='입금대기') as waiting,
      count(*) filter(where status='입금완료') as paid,count(*) filter(where status='구동중') as running,count(*) filter(where status='만료') as expired
      from visible group by program_type) p),
    -- This is the exact existing settlement accounting routine, not an order/page sum.
    'settlement',public.get_my_settlement_summary_v92(),
    'recent',(public.get_order_page_v1011(p_page_size=>7)->'rows')
  ) into v_result from visible;
  return v_result;
end; $$;

create or replace function public.get_outgoing_settlement_page_v1011(p_page integer default 1,p_page_size integer default 50)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_actor public.profiles; v_result jsonb; v_size integer:=least(200,greatest(1,coalesce(p_page_size,50)));
begin
  select * into v_actor from public.profiles where id=auth.uid();
  if v_actor.id is null or v_actor.approval_status is distinct from 'approved' or not v_actor.active or v_actor.role is null or v_actor.is_operations_manager then
    raise exception '활성 승인 회원만 정산을 조회할 수 있습니다.' using errcode='42501';
  end if;
  with steps as materialized (
    -- Retains the existing participant checks, archived exclusions and chain order.
    select ps.* from public.get_my_active_payment_steps_v91() ps where ps.payer_id=v_actor.id
  ), totals as (select count(*) as total,greatest(1,ceil(count(*)::numeric/v_size)::integer) as pages from steps),
  paged as (select * from steps order by created_at desc,id desc limit v_size
    offset (least(greatest(1,coalesce(p_page,1)),(select pages from totals))-1)*v_size)
  select jsonb_build_object('totalCount',total,'page',least(greatest(1,coalesce(p_page,1)),pages),'pageSize',v_size,
    'rows',coalesce((select jsonb_agg(to_jsonb(p)) from paged p),'[]'::jsonb)) into v_result from totals;
  return v_result;
end; $$;

create or replace function public.get_my_notification_counts_v1011()
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_actor public.profiles; v_result jsonb;
begin
  select * into v_actor from public.profiles where id=auth.uid();
  if v_actor.id is null or v_actor.approval_status is distinct from 'approved' or not v_actor.active or v_actor.role is null then
    raise exception '활성 승인 회원만 알림을 조회할 수 있습니다.' using errcode='42501';
  end if;
  select jsonb_build_object('totalCount',count(*),'unreadCount',count(*) filter(where read_at is null)) into v_result
    from public.notifications where user_id=v_actor.id and (target_role is null or target_role=v_actor.role);
  return v_result;
end; $$;

create or replace function public.get_my_notifications_page_v1011(
  p_unread boolean default false,p_limit integer default 100,p_before_time timestamptz default null,p_before_id uuid default null
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_actor public.profiles; v_result jsonb; v_size integer:=least(200,greatest(1,coalesce(p_limit,100)));
begin
  select * into v_actor from public.profiles where id=auth.uid();
  if v_actor.id is null or v_actor.approval_status is distinct from 'approved' or not v_actor.active or v_actor.role is null then
    raise exception '활성 승인 회원만 알림을 조회할 수 있습니다.' using errcode='42501';
  end if;
  if (p_before_time is null) <> (p_before_id is null) then raise exception '알림 페이지 기준이 올바르지 않습니다.'; end if;
  with candidates as materialized (
    select n.*, o.order_number from public.notifications n left join public.orders o on o.id=n.order_id
    where n.user_id=v_actor.id and (n.target_role is null or n.target_role=v_actor.role)
      and (not coalesce(p_unread,false) or n.read_at is null)
      and (p_before_time is null or (n.created_at,n.id)<(p_before_time,p_before_id))
    order by n.created_at desc,n.id desc limit v_size+1
  ), paged as (select * from candidates order by created_at desc,id desc limit v_size)
  select public.get_my_notification_counts_v1011() || jsonb_build_object(
    'hasMore',(select count(*)>v_size from candidates),
    'rows',coalesce((select jsonb_agg(to_jsonb(p)) from paged p),'[]'::jsonb),
    'cursor',(select jsonb_build_object('createdAt',created_at,'id',id) from paged order by created_at asc,id asc limit 1)
  ) into v_result;
  return v_result;
end; $$;

create or replace function public.mark_all_my_notifications_read_v1011()
returns integer language plpgsql security invoker set search_path='' as $$
declare v_actor public.profiles; v_count integer;
begin
  select * into v_actor from public.profiles where id=auth.uid();
  if v_actor.id is null or v_actor.approval_status is distinct from 'approved' or not v_actor.active or v_actor.role is null then
    raise exception '활성 승인 회원만 알림을 처리할 수 있습니다.' using errcode='42501';
  end if;
  update public.notifications set read_at=now()
    where user_id=v_actor.id and (target_role is null or target_role=v_actor.role) and read_at is null;
  get diagnostics v_count=row_count;
  return v_count;
end; $$;

-- Do not add permissive policies: new invoker functions retain existing table RLS.
revoke all on function public.get_order_page_v1011(text,text,boolean,text,date,date,integer,integer,text,text[],timestamptz,text) from public,anon;
grant execute on function public.get_order_page_v1011(text,text,boolean,text,date,date,integer,integer,text,text[],timestamptz,text) to authenticated;
revoke all on function public.get_dashboard_summary_v1011() from public,anon;
grant execute on function public.get_dashboard_summary_v1011() to authenticated;
revoke all on function public.get_outgoing_settlement_page_v1011(integer,integer) from public,anon;
grant execute on function public.get_outgoing_settlement_page_v1011(integer,integer) to authenticated;
revoke all on function public.get_my_notification_counts_v1011() from public,anon;
grant execute on function public.get_my_notification_counts_v1011() to authenticated;
revoke all on function public.get_my_notifications_page_v1011(boolean,integer,timestamptz,uuid) from public,anon;
grant execute on function public.get_my_notifications_page_v1011(boolean,integer,timestamptz,uuid) to authenticated;
revoke all on function public.mark_all_my_notifications_read_v1011() from public,anon;
grant execute on function public.mark_all_my_notifications_read_v1011() to authenticated;

alter function public.touch_updated_at() set search_path='';
create index if not exists notices_created_by_v1011_idx on public.notices(created_by);
create index if not exists orders_archived_by_v1011_idx on public.orders(archived_by);
create index if not exists payment_steps_confirmed_by_v1011_idx on public.payment_steps(confirmed_by);
create index if not exists settlement_batches_confirmed_by_v1011_idx on public.settlement_batches(confirmed_by);
create index if not exists settlement_batches_voided_by_v1011_idx on public.settlement_batches(voided_by);
create index if not exists settlement_quote_items_payer_v1011_idx on public.settlement_quote_items(payer_id);
create index if not exists admin_order_assignments_order_v1011_idx on spark_private.admin_order_assignments_v106(order_id);
create index if not exists notifications_unread_v1011_idx on public.notifications(user_id,created_at desc,id desc) where read_at is null;

-- Preserve authenticated compatibility and internal trigger execution; remove only anonymous/public API execution.
do $$ declare f regprocedure; begin
  for f in select p.oid::regprocedure from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('audit_payment_steps_trigger','audit_profiles_trigger','handle_new_auth_user','is_admin','create_order','review_member','set_order_status')
  loop
    execute format('grant execute on function %s to authenticated',f);
    execute format('revoke execute on function %s from public,anon',f);
    if exists(select 1 from pg_catalog.pg_roles where rolname='service_role') then execute format('grant execute on function %s to service_role',f); end if;
  end loop;
end $$;
notify pgrst,'reload schema';
