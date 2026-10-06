-- Additive administrator lifecycle API. Existing archive/restore and settlement
-- policies remain authoritative. Preview is read-only; no production cleanup.
create table spark_private.order_lifecycle_requests_v1014 (
  actor_id uuid not null,
  request_id uuid not null,
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (actor_id, request_id)
);
alter table spark_private.order_lifecycle_requests_v1014 enable row level security;
revoke all on spark_private.order_lifecycle_requests_v1014 from public, anon, authenticated;

create function spark_private.order_lifecycle_info_v1014(p_order public.orders, p_action text)
returns jsonb language plpgsql set search_path = '' as $$
declare
  reason text := '';
  steps jsonb;
  waiting bigint;
begin
  select coalesce(jsonb_agg(to_jsonb(s) order by s.id), '[]'::jsonb),
    coalesce(sum(s.total_amount) filter (where s.payer_id=p_order.created_by and s.confirmed_at is null),0)
    into steps, waiting from public.payment_steps s where s.order_id=p_order.id;
  if steps='[]'::jsonb and p_order.status='입금대기' then waiting:=p_order.total_amount; end if;
  if p_action='archive' and p_order.archived_at is not null then reason:='이미 보관된 작업입니다.';
  elsif p_action in ('restore','delete') and p_order.archived_at is null then reason:='보관함에 있는 작업만 처리할 수 있습니다.';
  elsif p_action='delete' then
    if p_order.status<>'입금대기' or p_order.activated_at is not null or p_order.stopped_at is not null
      or p_order.payment_notified_at is not null or p_order.settlement_reversal_pending then
      reason:='입금·구동 등 처리 이력이 있는 작업입니다.';
    elsif p_order.program_transfer_state<>'none' or p_order.last_program_transfer_at is not null
      or exists(select 1 from public.order_program_transfers t where t.order_id=p_order.id) then
      reason:='프로그램 변경 이력이 있습니다.';
    elsif exists(select 1 from spark_private.admin_order_assignments_v106 a where a.order_id=p_order.id) then
      reason:='관리자가 부여한 작업의 이력을 보존해야 합니다.';
    elsif exists(select 1 from public.payment_steps s where s.order_id=p_order.id
      and (s.confirmed_at is not null or s.confirmed_by is not null or s.program_transfer_id is not null or s.step_kind<>'standard')) then
      reason:='입금확인 또는 변경 정산 이력이 있습니다.';
    elsif exists(select 1 from public.settlement_batch_items b where b.order_id=p_order.id)
      or exists(select 1 from public.settlement_quote_items q join public.payment_steps s on s.id=q.payment_step_id where s.order_id=p_order.id) then
      reason:='정산 확인·처리 내역에 연결되어 있습니다.';
    elsif exists(select 1 from public.audit_logs a where
      ((a.entity_type='order' and a.entity_id=p_order.id)
        or a.metadata->>'order_id'=p_order.id::text or a.metadata->>'order_number'=p_order.order_number
        or (a.entity_type='payment' and (a.entity_id in (select s.id from public.payment_steps s where s.order_id=p_order.id)
          or a.entity_label=p_order.order_number or left(a.entity_label,length(p_order.order_number)+1)=p_order.order_number||' ')))
      and a.action not in ('order.created','order.archived','order.restored')) then
      reason:='과거 입금확인·수정 등 처리 이력이 있습니다. 취소된 이력도 보존합니다.';
    end if;
  end if;
  return jsonb_build_object('id',p_order.id,'orderNumber',p_order.order_number,'storeName',p_order.store_name,
    'programType',p_order.program_type,'status',p_order.status,'version',p_order.lock_version,
    'waitingAmount',waiting,'eligible',reason='','reason',reason,
    'fingerprint',md5(to_jsonb(p_order)::text||steps::text||reason));
end $$;
revoke all on function spark_private.order_lifecycle_info_v1014(public.orders,text) from public,anon,authenticated;

create function spark_private.preview_admin_order_lifecycle_v1014(p_action text, p_order_ids text[] default null, p_filters jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor public.profiles;
  programs text[];
  selected uuid[];
  from_date date;
  to_date date;
  v_status text;
  term text;
  result jsonb;
begin
  select * into actor from public.profiles where id=auth.uid();
  if actor.id is null or actor.role is distinct from 'admin'::public.member_role or not actor.active
    or actor.approval_status<>'approved' or actor.is_operations_manager then raise exception '관리자만 작업을 정리할 수 있습니다.'; end if;
  if p_action is null or p_action not in ('archive','restore','delete') then raise exception '처리 방식을 확인해 주세요.'; end if;
  if p_filters is null or jsonb_typeof(p_filters)<>'object' then raise exception '검색 조건을 확인해 주세요.'; end if;
  if exists(select 1 from jsonb_object_keys(p_filters) k where k not in ('programs','status','query','from','to')) then raise exception '검색 조건을 확인해 주세요.'; end if;
  if jsonb_typeof(p_filters->'programs') is distinct from 'array' then raise exception '프로그램을 선택해 주세요.'; end if;
  select array_agg(value) into programs from jsonb_array_elements_text(p_filters->'programs');
  if cardinality(programs) is null or cardinality(programs)>4 or exists(select 1 from unnest(programs) p where p is null or p not in ('spark','spark_plus','spark_s','spark_s_plus')) then raise exception '프로그램을 선택해 주세요.'; end if;
  v_status:=nullif(p_filters->>'status',''); term:=lower(btrim(coalesce(p_filters->>'query','')));
  if v_status is not null and v_status not in ('입금대기','입금완료','구동중','정지','만료') then raise exception '작업 상태를 확인해 주세요.'; end if;
  from_date:=nullif(p_filters->>'from','')::date; to_date:=nullif(p_filters->>'to','')::date;
  if from_date>to_date then raise exception '조회 시작일과 종료일을 확인해 주세요.'; end if;
  if p_order_ids is not null and (coalesce(cardinality(p_order_ids),0) not between 1 and 500
    or exists(select 1 from unnest(p_order_ids) i where i is null or i='')
    or (select count(distinct i) from unnest(p_order_ids) i)<>cardinality(p_order_ids)) then raise exception '중복 없이 1~500건을 선택해 주세요.'; end if;
  select array_agg(id) into selected from (
    select o.id from public.orders o left join public.profiles p on p.id=o.created_by
    where o.program_type=any(programs)
      and (p_order_ids is null or o.order_number=any(p_order_ids))
      and (p_order_ids is not null or (o.archived_at is not null)=(p_action<>'archive'))
      and (v_status is null or o.status::text=v_status)
      and (from_date is null or o.created_at>=from_date::timestamp at time zone 'Asia/Seoul')
      and (to_date is null or o.created_at<(to_date+1)::timestamp at time zone 'Asia/Seoul')
      and (term='' or exists(select 1 from unnest(array[o.order_number,o.creator_username,coalesce(o.sponsor_username,''),coalesce(p.group_name,''),o.store_name,o.keyword,o.mid]) value where strpos(lower(value),term)>0))
    order by o.created_at,o.id limit 501
  ) matches;
  if cardinality(selected)>500 then raise exception '검색 결과가 500건을 초과합니다. 기간이나 상태를 좁혀 주세요.'; end if;
  if p_order_ids is not null and coalesce(cardinality(selected),0)<>cardinality(p_order_ids) then raise exception '선택한 작업이나 검색 조건이 변경되었습니다. 목록을 새로 확인해 주세요.'; end if;
  select coalesce(jsonb_agg(spark_private.order_lifecycle_info_v1014(o,p_action) order by o.created_at,o.id),'[]') into result
    from public.orders o where o.id=any(selected);
  return jsonb_build_object('items',result);
end $$;

create function spark_private.apply_admin_order_lifecycle_v1014(p_action text,p_items jsonb,p_reason text,p_request_id uuid,p_confirmation text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor public.profiles;
  item jsonb;
  info jsonb;
  target public.orders;
  payload jsonb;
  saved spark_private.order_lifecycle_requests_v1014;
  results jsonb:='[]';
  outcome jsonb;
  old_reason text:=current_setting('spark.change_reason',true);
begin
  select * into actor from public.profiles where id=auth.uid() for share nowait;
  if actor.id is null or actor.role is distinct from 'admin'::public.member_role or not actor.active
    or actor.approval_status<>'approved' or actor.is_operations_manager then raise exception '관리자만 작업을 정리할 수 있습니다.'; end if;
  if p_action is null or p_action not in ('archive','restore','delete') then raise exception '처리 방식을 확인해 주세요.'; end if;
  if p_request_id is null or p_reason is null or length(btrim(p_reason)) not between 2 and 500 then raise exception '처리 사유를 2~500자로 입력해 주세요.'; end if;
  if p_confirmation is distinct from (case when p_action='delete' then '영구 삭제' else '확인' end) then raise exception '처리 대상과 영향을 확인해 주세요.'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' then raise exception '처리할 작업을 선택해 주세요.'; end if;
  if jsonb_array_length(p_items) not between 1 and 500 then raise exception '한 번에 1~500건을 처리할 수 있습니다.'; end if;
  if exists(select 1 from jsonb_array_elements(p_items) i where jsonb_typeof(i)<>'object'
    or coalesce(i->>'id','')!~'^[0-9a-fA-F-]{36}$' or coalesce(i->>'version','')!~'^[1-9][0-9]*$'
    or coalesce(i->>'fingerprint','')!~'^[0-9a-f]{32}$')
    or (select count(distinct (i->>'id')::uuid) from jsonb_array_elements(p_items) i)<>jsonb_array_length(p_items) then raise exception '대상 확인을 다시 진행해 주세요.'; end if;
  payload:=jsonb_build_object('action',p_action,'items',p_items,'reason',btrim(p_reason),'confirmation',p_confirmation);
  if not pg_try_advisory_xact_lock(('x'||substr(md5(actor.id::text||p_request_id::text),1,16))::bit(64)::bigint) then raise exception '같은 요청을 처리 중입니다. 잠시 후 처리 결과를 다시 확인해 주세요.'; end if;
  select * into saved from spark_private.order_lifecycle_requests_v1014 where actor_id=actor.id and request_id=p_request_id;
  if found then
    if saved.payload<>payload then raise exception '처리 요청이 변경되었습니다. 새로 확인해 주세요.'; end if;
    return saved.result;
  end if;
  for item in select value from jsonb_array_elements(p_items) order by value->>'id' loop
    begin
      select * into target from public.orders where id=(item->>'id')::uuid for update nowait;
      if not found then raise exception '작업이 삭제되었거나 더 이상 존재하지 않습니다.'; end if;
      -- Legacy payment APIs sometimes lock steps before orders: NOWAIT prevents
      -- a deadlock and yields a retryable per-order result, without partial rows.
      perform id from public.payment_steps where order_id=target.id order by id for update nowait;
      info:=spark_private.order_lifecycle_info_v1014(target,p_action);
      if not (info->>'eligible')::boolean then raise exception '%',info->>'reason'; end if;
      if target.lock_version<>(item->>'version')::integer or info->>'fingerprint'<>item->>'fingerprint' then raise exception '확인 후 작업 또는 입금 내역이 변경되었습니다. 다시 확인해 주세요.'; end if;
      if p_action='archive' then perform public.archive_order(target.id,target.lock_version,btrim(p_reason));
      elsif p_action='restore' then perform public.restore_order(target.id,target.lock_version,btrim(p_reason));
      else
        -- Fail closed: audit persistence and deletion commit or roll back together.
        insert into public.audit_logs(actor_id,actor_username,actor_role,action,entity_type,entity_id,entity_label,metadata)
          values(actor.id,actor.username,actor.role,'order.permanently_deleted','order',target.id,target.order_number||' '||target.store_name,
            jsonb_build_object('reason',btrim(p_reason),'request_id',p_request_id,'order_number',target.order_number,
              'program_type',target.program_type,'created_by',target.created_by,'total_amount',target.total_amount,'status',target.status,
              'archived_at',target.archived_at,'archive_reason',target.archive_reason));
        delete from public.orders where id=target.id;
      end if;
      outcome:=jsonb_build_object('id',item->>'id','orderNumber',target.order_number,'success',true,'reason','');
    exception
      when lock_not_available or deadlock_detected then outcome:=jsonb_build_object('id',item->>'id','success',false,'reason','다른 관리자가 처리 중입니다. 다시 확인해 주세요.');
      when foreign_key_violation then outcome:=jsonb_build_object('id',item->>'id','success',false,'reason','보존해야 하는 연결 이력이 있습니다. 보관함에 유지합니다.');
      when raise_exception then outcome:=jsonb_build_object('id',item->>'id','success',false,'reason',sqlerrm);
      when others then outcome:=jsonb_build_object('id',item->>'id','success',false,'reason','처리를 완료하지 못했습니다. 새로 확인 후 다시 시도해 주세요.');
    end;
    results:=results||jsonb_build_array(outcome);
  end loop;
  perform set_config('spark.change_reason',coalesce(old_reason,''),true);
  outcome:=jsonb_build_object('requestId',p_request_id,'results',results);
  insert into spark_private.order_lifecycle_requests_v1014(actor_id,request_id,payload,result) values(actor.id,p_request_id,payload,outcome);
  return outcome;
end $$;

create function public.preview_admin_order_lifecycle_v1014(p_action text,p_order_ids text[] default null,p_filters jsonb default '{}')
returns jsonb language sql security invoker set search_path='' as $$ select spark_private.preview_admin_order_lifecycle_v1014(p_action,p_order_ids,p_filters) $$;
create function public.apply_admin_order_lifecycle_v1014(p_action text,p_items jsonb,p_reason text,p_request_id uuid,p_confirmation text)
returns jsonb language sql security invoker set search_path='' as $$ select spark_private.apply_admin_order_lifecycle_v1014(p_action,p_items,p_reason,p_request_id,p_confirmation) $$;
revoke all on function spark_private.preview_admin_order_lifecycle_v1014(text,text[],jsonb),spark_private.apply_admin_order_lifecycle_v1014(text,jsonb,text,uuid,text),public.preview_admin_order_lifecycle_v1014(text,text[],jsonb),public.apply_admin_order_lifecycle_v1014(text,jsonb,text,uuid,text) from public,anon,authenticated;
grant execute on function spark_private.preview_admin_order_lifecycle_v1014(text,text[],jsonb),spark_private.apply_admin_order_lifecycle_v1014(text,jsonb,text,uuid,text),public.preview_admin_order_lifecycle_v1014(text,text[],jsonb),public.apply_admin_order_lifecycle_v1014(text,jsonb,text,uuid,text) to authenticated;
insert into public.app_schema_versions(version,description) values('10.14.0','관리자 일괄 보관·복원·이력 없는 보관 작업 영구 삭제');
notify pgrst,'reload schema';
