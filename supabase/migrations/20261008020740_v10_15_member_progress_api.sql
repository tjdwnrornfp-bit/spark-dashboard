-- Additive server-to-server API. No order/payment/member mutation or RLS change.
create table spark_private.progress_api_keys_v1015 (
  id uuid primary key,
  member_id uuid not null references public.profiles(id) on delete cascade,
  token_hash text not null unique check(token_hash ~ '^[0-9a-f]{64}$'),
  label text not null check(length(label) between 1 and 80),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create unique index progress_api_one_active_member_v1015 on spark_private.progress_api_keys_v1015(member_id) where revoked_at is null;
create table spark_private.progress_api_usage_v1015 (
  member_id uuid primary key references public.profiles(id) on delete cascade,
  minute_at timestamptz not null,
  minute_count integer not null default 0,
  day_at date not null,
  day_count integer not null default 0,
  total_count bigint not null default 0,
  last_requested_at timestamptz
);
alter table spark_private.progress_api_keys_v1015 enable row level security;
alter table spark_private.progress_api_usage_v1015 enable row level security;
revoke all on spark_private.progress_api_keys_v1015,spark_private.progress_api_usage_v1015 from public,anon,authenticated,service_role;

create function spark_private.issue_progress_api_key_v1015(p_key_id uuid,p_member_id uuid,p_token_hash text,p_label text,p_expires_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.profiles; member public.profiles; prior spark_private.progress_api_keys_v1015;
begin
  select * into actor from public.profiles where id=auth.uid() for share;
  if actor.id is null or actor.role is distinct from 'admin'::public.member_role or not actor.active or actor.approval_status<>'approved' or actor.is_operations_manager then raise exception '관리자만 API 키를 발급할 수 있습니다.'; end if;
  select * into member from public.profiles where id=p_member_id for update;
  if member.id is null or member.role not in ('agency','distributor') or member.role is null or not member.active or member.approval_status<>'approved' or member.is_operations_manager then raise exception '승인된 활성 대행사·총판만 연동할 수 있습니다.'; end if;
  if p_key_id is null or p_token_hash is null or p_token_hash!~'^[0-9a-f]{64}$' or p_label is null or length(btrim(p_label)) not between 1 and 80 then raise exception '키 발급 정보를 확인해 주세요.'; end if;
  select * into prior from spark_private.progress_api_keys_v1015 where id=p_key_id;
  if found then
    if prior.member_id<>p_member_id or prior.token_hash<>p_token_hash or prior.label<>btrim(p_label) or prior.expires_at is distinct from p_expires_at then raise exception '같은 발급 요청의 내용이 변경되었습니다.'; end if;
    return jsonb_build_object('key_id',prior.id,'username',member.username,'expires_at',prior.expires_at,'revoked_at',prior.revoked_at);
  end if;
  if p_expires_at is null or p_expires_at<=now()+interval '1 hour' or p_expires_at>now()+interval '366 days' then raise exception '키 만료일을 1시간 이후부터 366일 이내로 설정해 주세요.'; end if;
  update spark_private.progress_api_keys_v1015 set revoked_at=now() where member_id=p_member_id and revoked_at is null;
  insert into spark_private.progress_api_keys_v1015(id,member_id,token_hash,label,created_by,expires_at) values(p_key_id,p_member_id,p_token_hash,btrim(p_label),actor.id,p_expires_at);
  insert into public.audit_logs(actor_id,actor_username,actor_role,action,entity_type,entity_id,entity_label,metadata)
    values(actor.id,actor.username,actor.role,'member.progress_api_key_issued','member',member.id,member.username,jsonb_build_object('key_id',p_key_id,'expires_at',p_expires_at,'scope','own_order_progress'));
  return jsonb_build_object('key_id',p_key_id,'username',member.username,'expires_at',p_expires_at,'revoked_at',null);
end $$;

create function spark_private.revoke_progress_api_key_v1015(p_key_id uuid,p_reason text)
returns boolean language plpgsql security definer set search_path='' as $$
declare actor public.profiles; target spark_private.progress_api_keys_v1015; username text;
begin
  select * into actor from public.profiles where id=auth.uid() for share;
  if actor.id is null or actor.role is distinct from 'admin'::public.member_role or not actor.active or actor.approval_status<>'approved' or actor.is_operations_manager then raise exception '관리자만 API 키를 중지할 수 있습니다.'; end if;
  if p_reason is null or length(btrim(p_reason)) not between 2 and 500 then raise exception '중지 사유를 2~500자로 입력해 주세요.'; end if;
  update spark_private.progress_api_keys_v1015 set revoked_at=now() where id=p_key_id and revoked_at is null returning * into target;
  if not found then return false; end if;
  select p.username into username from public.profiles p where p.id=target.member_id;
  insert into public.audit_logs(actor_id,actor_username,actor_role,action,entity_type,entity_id,entity_label,metadata)
    values(actor.id,actor.username,actor.role,'member.progress_api_key_revoked','member',target.member_id,coalesce(username,''),jsonb_build_object('key_id',p_key_id,'reason',btrim(p_reason)));
  return true;
end $$;

-- Only the trusted edge worker may call this function. A SHA-256 digest of a
-- 256-bit random partner key authenticates one member, never a supplied user ID.
create function spark_private.get_order_progress_inputs_v1015(p_key_hash text,p_order_numbers text[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  owner_id uuid;
  usage spark_private.progress_api_usage_v1015;
  observed_at timestamptz:=clock_timestamp();
  minute_bucket timestamptz:=date_trunc('minute',observed_at);
  day_bucket date:=(observed_at at time zone 'Asia/Seoul')::date;
  rows jsonb;
begin
  if p_key_hash is null or p_key_hash!~'^[0-9a-f]{64}$' then return jsonb_build_object('error','unauthorized'); end if;
  select k.member_id into owner_id from spark_private.progress_api_keys_v1015 k join public.profiles p on p.id=k.member_id
    where k.token_hash=p_key_hash and k.revoked_at is null and k.expires_at>observed_at
      and p.active and p.approval_status='approved' and p.role in ('agency','distributor') and not p.is_operations_manager;
  if owner_id is null then return jsonb_build_object('error','unauthorized'); end if;
  if p_order_numbers is null or coalesce(cardinality(p_order_numbers),0) not between 1 and 100
    or exists(select 1 from unnest(p_order_numbers) n where n is null or n !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$')
    or (select count(distinct n) from unnest(p_order_numbers) n)<>cardinality(p_order_numbers) then return jsonb_build_object('error','invalid_request'); end if;
  insert into spark_private.progress_api_usage_v1015(member_id,minute_at,day_at) values(owner_id,minute_bucket,day_bucket) on conflict do nothing;
  select * into usage from spark_private.progress_api_usage_v1015 where member_id=owner_id for update;
  -- Compute buckets after the lock: queued calls must not reset a newer bucket.
  observed_at:=clock_timestamp();
  minute_bucket:=date_trunc('minute',observed_at);
  day_bucket:=(observed_at at time zone 'Asia/Seoul')::date;
  if not exists(select 1 from spark_private.progress_api_keys_v1015 k join public.profiles p on p.id=k.member_id
    where k.token_hash=p_key_hash and k.member_id=owner_id and k.revoked_at is null and k.expires_at>observed_at
      and p.active and p.approval_status='approved' and p.role in ('agency','distributor') and not p.is_operations_manager)
    then return jsonb_build_object('error','unauthorized'); end if;
  if usage.minute_at<>minute_bucket then usage.minute_count:=0; end if;
  if usage.day_at<>day_bucket then usage.day_count:=0; end if;
  if usage.day_count>=10000 then return jsonb_build_object('error','rate_limited','retry_after_seconds',greatest(1,ceil(extract(epoch from (((day_bucket+1)::timestamp at time zone 'Asia/Seoul')-observed_at)))::integer)); end if;
  if usage.minute_count>=30 then return jsonb_build_object('error','rate_limited','retry_after_seconds',greatest(1,ceil(extract(epoch from (minute_bucket+interval '1 minute'-observed_at)))::integer)); end if;
  update spark_private.progress_api_usage_v1015 set minute_at=minute_bucket,minute_count=usage.minute_count+1,day_at=day_bucket,day_count=usage.day_count+1,total_count=total_count+1,last_requested_at=observed_at where member_id=owner_id;
  select coalesce(jsonb_agg(jsonb_build_object('order_number',o.order_number,'program_type',o.program_type,'status',o.status,'archived',o.archived_at is not null,
    'daily_shots',o.daily_shots,'start_date',o.start_date,'end_date',o.end_date,'activated_at',o.activated_at) order by o.order_number),'[]') into rows
    from public.orders o where o.created_by=owner_id and o.order_number=any(p_order_numbers);
  return jsonb_build_object('as_of',observed_at,'rows',rows,'remaining_minute',29-usage.minute_count);
end $$;

create function public.issue_progress_api_key_v1015(p_key_id uuid,p_member_id uuid,p_token_hash text,p_label text,p_expires_at timestamptz)
returns jsonb language sql security invoker set search_path='' as $$select spark_private.issue_progress_api_key_v1015(p_key_id,p_member_id,p_token_hash,p_label,p_expires_at)$$;
create function public.revoke_progress_api_key_v1015(p_key_id uuid,p_reason text)
returns boolean language sql security invoker set search_path='' as $$select spark_private.revoke_progress_api_key_v1015(p_key_id,p_reason)$$;
create function public.get_order_progress_inputs_v1015(p_key_hash text,p_order_numbers text[])
returns jsonb language sql security invoker set search_path='' as $$select spark_private.get_order_progress_inputs_v1015(p_key_hash,p_order_numbers)$$;
revoke all on function spark_private.issue_progress_api_key_v1015(uuid,uuid,text,text,timestamptz),public.issue_progress_api_key_v1015(uuid,uuid,text,text,timestamptz),spark_private.revoke_progress_api_key_v1015(uuid,text),public.revoke_progress_api_key_v1015(uuid,text),spark_private.get_order_progress_inputs_v1015(text,text[]),public.get_order_progress_inputs_v1015(text,text[]) from public,anon,authenticated,service_role;
grant usage on schema spark_private to authenticated,service_role;
grant execute on function spark_private.issue_progress_api_key_v1015(uuid,uuid,text,text,timestamptz),public.issue_progress_api_key_v1015(uuid,uuid,text,text,timestamptz),spark_private.revoke_progress_api_key_v1015(uuid,text),public.revoke_progress_api_key_v1015(uuid,text) to authenticated;
grant execute on function spark_private.get_order_progress_inputs_v1015(text,text[]),public.get_order_progress_inputs_v1015(text,text[]) to service_role;
insert into public.app_schema_versions(version,description) values('10.15.0','회원 본인 작업 진행률 외부 조회 API');
notify pgrst,'reload schema';
