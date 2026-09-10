begin;
do $$ begin
  if not exists(select 1 from public.app_schema_versions where version='v10.7.0') then raise exception 'v10.7.0 must be applied first'; end if;
end $$;
-- Same approved profile pricing rule as create_order_v10; no client-submitted unit prices.
create function spark_private.member_program_price_v108(p public.profiles, program text)
returns integer language sql immutable set search_path='' as $$
  select case program when 'spark' then coalesce(p.spark_price_per_shot,p.price_per_shot,0)
    when 'spark_plus' then coalesce(p.spark_plus_price_per_shot,0)
    when 'spark_s' then coalesce(p.spark_s_price_per_shot,0)
    when 'spark_s_plus' then coalesce(p.spark_s_plus_price_per_shot,0) else 0 end
$$;
revoke all on function spark_private.member_program_price_v108(public.profiles,text) from public,anon,authenticated;
create function public.member_preview_own_order_edit_v108(p_order_id uuid, p_expected_version integer, p_changes jsonb, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  a public.profiles; o public.orders; n public.orders;
  impact text; difference bigint; blocked text; cnt integer; confirmed integer;
  today date := (now() at time zone 'Asia/Seoul')::date;
  s record; qty bigint;
begin
  select * into a from public.profiles where id=auth.uid();
  if a.id is null or a.role is null or a.role not in ('agency','distributor') or a.approval_status is distinct from 'approved'
    or a.active is not true or coalesce(a.is_operations_manager,false) then
    raise exception '승인된 활성 일반 회원만 자기 작업을 수정할 수 있습니다.' using errcode='42501';
  end if;
  select * into o from public.orders where id=p_order_id and created_by=auth.uid();
  if o.id is null then raise exception '작업을 찾을 수 없습니다.'; end if;
  if p_expected_version is null or p_expected_version <> o.lock_version then
    raise exception '다른 사용자가 먼저 작업을 변경했습니다. 새로고침 후 다시 시도해 주세요.' using errcode='40001';
  end if;
  if coalesce(length(trim(p_reason)),0) not between 2 and 500 then raise exception '수정 사유는 2~500자로 입력해 주세요.'; end if;
  if jsonb_typeof(p_changes) is distinct from 'object' then raise exception '수정 항목이 필요합니다.'; end if;
  if exists (select 1 from jsonb_object_keys(p_changes) k where k not in ('store_name','keyword','place_url','daily_shots','operation_days','start_date','memo','program_type')) then
    raise exception '허용되지 않은 수정 항목입니다. 등록자와 정산 관계는 변경할 수 없습니다.';
  end if;
  if exists(select 1 from jsonb_each_text(p_changes) where key in ('daily_shots','operation_days') and (value is null or value !~ '^[0-9]+$')) then
    raise exception '수량과 기간은 1 이상의 정수여야 합니다.';
  end if;
  n := jsonb_populate_record(o,p_changes);
  n.store_name := trim(n.store_name); n.keyword := trim(n.keyword); n.place_url := trim(n.place_url);
  if coalesce(length(n.store_name),0) not between 1 and 50 or coalesce(length(n.keyword),0) not between 1 and 50 then raise exception '상호명과 키워드는 1~50자로 입력해 주세요.'; end if;
  if n.memo is null or length(n.memo)>300 then raise exception '메모는 300자 이하로 입력해 주세요.'; end if;
  if n.daily_shots is null or n.operation_days is null or n.daily_shots<1 or n.operation_days<1 then raise exception '수량과 기간은 1 이상의 정수여야 합니다.'; end if;
  if n.start_date is null then raise exception '시작일이 필요합니다.'; end if;
  if n.place_url is null or n.place_url !~* '^https?://([a-z0-9-]+\.)*(naver\.com|naver\.me)([/:?#]|$)' then raise exception '네이버 플레이스 URL을 확인해 주세요.'; end if;
  n.mid := spark_private.assignment_mid_v106(n.place_url);
  if n.mid='' then raise exception '플레이스 URL에서 MID를 확인할 수 없습니다.'; end if;
  if n.program_type is null or n.program_type not in ('spark','spark_plus','spark_s','spark_s_plus') then raise exception '지원하지 않는 프로그램입니다.'; end if;
  if n.program_type<>o.program_type then
    n.price_per_shot:=spark_private.member_program_price_v108(a,n.program_type);
    if n.price_per_shot<=0 then raise exception '대상 프로그램 승인 단가가 설정되어 있지 않아 변경할 수 없습니다.'; end if;
  end if;
  qty := n.daily_shots::bigint*n.operation_days::bigint;
  n.end_date := n.start_date+(n.operation_days-1);
  n.supply_amount := qty*n.price_per_shot::bigint;
  n.vat_amount := round(n.supply_amount*0.1);
  n.total_amount := n.supply_amount+n.vat_amount;
  difference := n.total_amount-o.total_amount;
  impact := case when difference=0 then 'financial_neutral' when difference>0 then 'increase' else 'decrease' end;
  select count(*),count(*) filter(where confirmed_at is not null) into cnt,confirmed from public.payment_steps where order_id=o.id;
  if o.archived_at is not null or o.status<>'입금대기' then blocked:='본인의 보관되지 않은 입금대기 작업만 수정할 수 있습니다.';
  elsif confirmed>0 then blocked:='일부 정산이 이미 진행된 작업입니다. 관리자에게 수정을 요청해 주세요.';
  elsif n.price_per_shot<=0 then blocked:='기존 주문 단가를 확인할 수 없습니다.';
  elsif n.start_date is distinct from o.start_date and (o.activated_at is not null or n.start_date<=today) then blocked:='시작일은 아직 구동하지 않은 작업에 한해 익일부터 변경할 수 있습니다.';
  elsif n.end_date<today then blocked:='변경 종료일이 오늘보다 과거입니다. 기간을 확인해 주세요.';
  end if;
  -- Validate the original chain before rebuilding amounts in place; never delete history.
  if blocked is null and (difference<>0 or n.program_type<>o.program_type) then
    if cnt=0 or o.program_transfer_state<>'none' or coalesce(o.settlement_reversal_pending,false)
      or exists(select 1 from public.payment_steps where order_id=o.id and (step_kind<>'standard' or program_transfer_id is not null or program_type<>o.program_type))
      or (select count(*) from public.payment_steps where order_id=o.id and payer_id=o.created_by)<>1
      or (select coalesce(sum(total_amount),0) from public.payment_steps where order_id=o.id and payer_id=o.created_by)<>o.total_amount then
      blocked:='기존 변경 정산 또는 정산 이력을 관리자에게 확인해 주세요.';
    end if;
    for s in select ps.*,p as payer from public.payment_steps ps join public.profiles p on p.id=ps.payer_id where ps.order_id=o.id loop
      if s.unit_price<=0 or s.supply_amount<>o.daily_shots::bigint*o.operation_days::bigint*s.unit_price
        or s.vat_amount<>round(s.supply_amount*0.1) or s.total_amount<>s.supply_amount+s.vat_amount then
        blocked:='정산 단계의 단가·금액 이력을 관리자에게 확인해 주세요.';
      end if;
      if n.program_type<>o.program_type and (spark_private.member_program_price_v108(s.payer,n.program_type)<=0
        or (s.payer).approval_status is distinct from 'approved' or (s.payer).active is not true) then
        blocked:='정산 계정의 대상 프로그램 승인 단가를 확인해 주세요.';
      end if;
    end loop;
  end if;
  return jsonb_build_object('allowed',blocked is null,'blockReason',blocked,'financialImpact',impact,
    'differenceAmount',difference,'before',to_jsonb(o),'after',to_jsonb(n),'confirmedPaymentCount',confirmed);
end $$;

create function public.member_apply_own_order_edit_v108(p_order_id uuid,p_expected_version integer,p_changes jsonb,p_reason text)
returns public.orders language plpgsql security definer set search_path='' as $$
declare a public.profiles; o public.orders; n public.orders; preview jsonb; s record;
  unit integer; supply bigint; vat bigint; prior_reason text:=current_setting('spark.change_reason',true);
begin
  select * into a from public.profiles where id=auth.uid() for share;
  if a.id is null or a.role is null or a.role not in ('agency','distributor') or a.approval_status is distinct from 'approved'
    or a.active is not true or coalesce(a.is_operations_manager,false) then raise exception '일반 회원만 자기 작업을 수정할 수 있습니다.' using errcode='42501'; end if;
  -- Acquire the order without waiting on a confirmer that already owns a step lock.
  select * into o from public.orders where id=p_order_id and created_by=a.id for update nowait;
  if o.id is null then raise exception '본인 작업을 찾을 수 없습니다.' using errcode='42501'; end if;
  perform 1 from public.payment_steps where order_id=o.id order by step_order,id for update nowait;
  perform 1 from public.profiles where id in (select payer_id from public.payment_steps where order_id=o.id) order by id for share nowait;
  preview:=public.member_preview_own_order_edit_v108(p_order_id,p_expected_version,p_changes,p_reason);
  if not (preview->>'allowed')::boolean then raise exception '%',preview->>'blockReason'; end if;
  n:=jsonb_populate_record(null::public.orders,preview->'after');
  if n.total_amount<>o.total_amount or n.program_type<>o.program_type then
    update public.settlement_quotes q set expires_at=least(q.expires_at,now())
      where exists(select 1 from public.settlement_quote_items qi join public.payment_steps ps on ps.id=qi.payment_step_id where qi.quote_id=q.id and ps.order_id=o.id);
    for s in select ps.*,p as payer from public.payment_steps ps join public.profiles p on p.id=ps.payer_id where ps.order_id=o.id order by ps.step_order,ps.id loop
      unit:=case when n.program_type=o.program_type then s.unit_price else spark_private.member_program_price_v108(s.payer,n.program_type) end;
      supply:=n.daily_shots::bigint*n.operation_days::bigint*unit; vat:=round(supply*0.1);
      update public.payment_steps set program_type=n.program_type,unit_price=unit,supply_amount=supply,vat_amount=vat,total_amount=supply+vat,updated_at=now() where id=s.id;
    end loop;
  end if;
  update public.payment_steps set store_name=n.store_name where order_id=o.id and store_name is distinct from n.store_name;
  perform set_config('spark.change_reason',trim(p_reason),true);
  update public.orders set store_name=n.store_name,keyword=n.keyword,place_url=n.place_url,mid=n.mid,
    daily_shots=n.daily_shots,operation_days=n.operation_days,start_date=n.start_date,end_date=n.end_date,memo=n.memo,
    program_type=n.program_type,price_per_shot=n.price_per_shot,supply_amount=n.supply_amount,vat_amount=n.vat_amount,total_amount=n.total_amount,
    lock_version=o.lock_version+1,updated_at=now() where id=o.id returning * into n;
  insert into public.audit_logs(actor_id,actor_username,actor_role,action,entity_type,entity_id,entity_label,metadata)
  values(a.id,a.username,a.role,case when o.program_type=n.program_type then 'order.member_corrected' else 'order.member_program_changed' end,'order',o.id,o.order_number,
    jsonb_build_object('reason',trim(p_reason),'actor_id',a.id,'before',to_jsonb(o),'after',to_jsonb(n),'program',n.program_type,'amount',n.total_amount,'difference_amount',n.total_amount-o.total_amount));
  perform set_config('spark.change_reason',coalesce(prior_reason,''),true);
  return n;
exception when lock_not_available then raise exception '정산 또는 작업 변경 중입니다. 새로고침 후 다시 시도해 주세요.' using errcode='40001';
end $$;
-- UI eligibility must count ALL steps on the server, including ones hidden by payment RLS.
create function public.member_own_order_edit_eligibility_v108(p_order_ids uuid[])
returns table(order_id uuid,confirmed_steps bigint) language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and role in ('agency','distributor') and approval_status='approved' and active and not coalesce(is_operations_manager,false)) then raise exception '일반 회원 권한이 필요합니다.' using errcode='42501'; end if;
  if coalesce(cardinality(p_order_ids),0)>500 then raise exception '한 번에 500개까지만 조회할 수 있습니다.'; end if;
  return query select o.id,(select count(*) from public.payment_steps ps where ps.order_id=o.id and ps.confirmed_at is not null)
    from public.orders o where o.id=any(p_order_ids) and o.created_by=auth.uid() and o.status='입금대기' and o.archived_at is null;
end $$;
revoke all on function public.member_preview_own_order_edit_v108(uuid,integer,jsonb,text) from public,anon;
revoke all on function public.member_apply_own_order_edit_v108(uuid,integer,jsonb,text) from public,anon;
revoke all on function public.member_own_order_edit_eligibility_v108(uuid[]) from public,anon;
grant execute on function public.member_preview_own_order_edit_v108(uuid,integer,jsonb,text) to authenticated;
grant execute on function public.member_apply_own_order_edit_v108(uuid,integer,jsonb,text) to authenticated;
grant execute on function public.member_own_order_edit_eligibility_v108(uuid[]) to authenticated;
create or replace function public.get_manager_managed_orders_v108(
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

revoke all on function public.get_manager_managed_orders_v108(uuid,text,text[],text,text,date,date,integer,integer,text) from public, anon, authenticated;
grant execute on function public.get_manager_managed_orders_v108(uuid,text,text[],text,text,date,date,integer,integer,text) to authenticated;


insert into public.app_schema_versions(version,description) values('v10.8.0','Member own unpaid order edits and server managed filters/sorting');
notify pgrst,'reload schema';
commit;
