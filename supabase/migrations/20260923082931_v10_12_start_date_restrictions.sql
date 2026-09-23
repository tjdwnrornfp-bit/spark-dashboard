-- v10.12: no holiday dates are seeded; existing orders/payment rows are unchanged.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create table public.order_start_restrictions (
  id uuid primary key default gen_random_uuid(),
  start_date date not null,
  end_date date not null,
  reason text not null check (char_length(btrim(reason)) between 1 and 300),
  enabled boolean not null default true,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  check (start_date <= end_date),
  check (isfinite(start_date) and isfinite(end_date))
);
alter table public.order_start_restrictions enable row level security;
revoke all on public.order_start_restrictions from public, anon, authenticated;
grant select on public.order_start_restrictions to authenticated;
create policy order_start_restrictions_read on public.order_start_restrictions for select to authenticated
using (
  exists (select 1 from public.profiles p where p.id=(select auth.uid()) and p.active
    and p.approval_status='approved' and p.role is not null)
  and (enabled or (select public.is_admin()))
);
create index order_start_restrictions_active_idx on public.order_start_restrictions(start_date,end_date) where enabled;
create index order_start_restrictions_creator_idx on public.order_start_restrictions(created_by);
create index order_start_restrictions_updater_idx on public.order_start_restrictions(updated_by);

-- Shared row locks permit concurrent intakes; a configuration save takes an exclusive
-- lock until commit. Updating this row also makes stale REPEATABLE READ writers fail
-- with a serialization error instead of accepting an out-of-date policy snapshot.
create table spark_private.start_restriction_state_v1012 (
  id integer primary key check (id=1), revision bigint not null default 0
);
insert into spark_private.start_restriction_state_v1012(id) values(1);
alter table spark_private.start_restriction_state_v1012 enable row level security;
revoke all on spark_private.start_restriction_state_v1012 from public,anon,authenticated;

create function spark_private.assert_order_start_dates_v1012(p_dates date[])
returns void language plpgsql volatile security definer set search_path='' as $$
declare v_block record;
begin
  -- This private guard never exempts admins or service maintenance from the date rule.
  -- Authorization of the write remains with existing RPCs/RLS, not this business rule.
  perform 1 from spark_private.start_restriction_state_v1012 where id=1 for share;
  if not found then raise exception '접수 제한 설정을 확인할 수 없습니다. 관리자에게 문의해 주세요.'; end if;
  select d.start_date as requested_date,r.start_date,r.end_date,r.reason into v_block
    from unnest(p_dates) with ordinality d(start_date,n)
    join public.order_start_restrictions r on r.enabled and d.start_date between r.start_date and r.end_date
    order by d.n,r.start_date,r.id limit 1;
  if found then
    raise exception '시작일 %은 접수 제한 기간(% ~ %)입니다. 사유: %',
      v_block.requested_date,v_block.start_date,v_block.end_date,v_block.reason
      using errcode='23514',constraint='order_start_date_restricted_v1012';
  end if;
end; $$;
revoke all on function spark_private.assert_order_start_dates_v1012(date[]) from public,anon,authenticated;

create function spark_private.guard_order_start_date_v1012()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' then
    if new.start_date is not distinct from old.start_date then return new; end if;
  end if;
  perform spark_private.assert_order_start_dates_v1012(array[new.start_date]);
  return new;
end; $$;
revoke all on function spark_private.guard_order_start_date_v1012() from public,anon,authenticated;
create trigger orders_start_date_restricted_v1012 before insert or update of start_date on public.orders
for each row execute function spark_private.guard_order_start_date_v1012();

create function public.get_order_start_restrictions_v1012(p_admin boolean default false)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare a public.profiles; result jsonb;
begin
  select * into a from public.profiles where id=auth.uid();
  if a.id is null or not a.active or a.approval_status is distinct from 'approved' or a.role is null then
    raise exception '승인된 활성 회원만 접수 제한을 조회할 수 있습니다.' using errcode='42501';
  end if;
  if coalesce(p_admin,false) and (a.role is distinct from 'admin' or coalesce(a.is_operations_manager,false)) then
    raise exception '관리자만 접수 제한 설정을 조회할 수 있습니다.' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'startDate',r.start_date,'endDate',r.end_date,
    'reason',r.reason,'enabled',r.enabled,'version',r.version,'updatedAt',r.updated_at)
    order by r.start_date,r.id),'[]'::jsonb) into result
  from public.order_start_restrictions r where coalesce(p_admin,false) or r.enabled;
  return result;
end; $$;

create function public.preview_order_start_restriction_v1012(p_start_date date,p_end_date date)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
  if not exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'
      and p.approval_status='approved' and p.active and not coalesce(p.is_operations_manager,false)) then
    raise exception '관리자만 접수 제한 설정을 확인할 수 있습니다.' using errcode='42501';
  end if;
  if p_start_date is null or p_end_date is null or not isfinite(p_start_date) or not isfinite(p_end_date) or p_start_date>p_end_date then
    raise exception '차단 시작일과 종료일을 확인해 주세요.';
  end if;
  return (select jsonb_build_object('existingCount',count(*),'waitingCount',count(*) filter(where status in ('입금대기','입금완료')),
    'runningCount',count(*) filter(where status='구동중')) from public.orders
    where start_date between p_start_date and p_end_date and archived_at is null);
end; $$;

create function spark_private.save_order_start_restriction_v1012(
  p_id uuid,p_start_date date,p_end_date date,p_reason text,p_enabled boolean,p_expected_version integer
) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.profiles; old_row public.order_start_restrictions; new_row public.order_start_restrictions;
begin
  select * into a from public.profiles where id=auth.uid();
  if a.id is null or a.role is distinct from 'admin' or a.approval_status is distinct from 'approved'
    or not a.active or coalesce(a.is_operations_manager,false) then
    raise exception '승인된 활성 관리자만 접수 제한을 설정할 수 있습니다.' using errcode='42501';
  end if;
  if p_id is null or p_enabled is null or p_expected_version is null or p_expected_version<0 then
    raise exception '설정 식별자와 버전을 확인해 주세요.';
  end if;
  if p_start_date is null or p_end_date is null or not isfinite(p_start_date) or not isfinite(p_end_date) or p_start_date>p_end_date then
    raise exception '차단 시작일과 종료일을 확인해 주세요.';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 300 then raise exception '안내 문구는 1~300자로 입력해 주세요.'; end if;
  perform 1 from spark_private.start_restriction_state_v1012 where id=1 for update;
  if not found then raise exception '접수 제한 설정을 확인할 수 없습니다.'; end if;
  select * into old_row from public.order_start_restrictions where id=p_id for update;
  if found then
    if old_row.version<>p_expected_version then raise exception '다른 관리자가 먼저 변경했습니다. 새로고침 후 다시 시도해 주세요.' using errcode='40001'; end if;
    update public.order_start_restrictions set start_date=p_start_date,end_date=p_end_date,reason=btrim(p_reason),enabled=p_enabled,
      version=version+1,updated_at=clock_timestamp(),updated_by=a.id where id=p_id returning * into new_row;
  else
    if p_expected_version<>0 then raise exception '설정을 찾을 수 없습니다. 새로고침해 주세요.' using errcode='40001'; end if;
    insert into public.order_start_restrictions(id,start_date,end_date,reason,enabled,created_by,updated_by)
      values(p_id,p_start_date,p_end_date,btrim(p_reason),p_enabled,a.id,a.id) returning * into new_row;
  end if;
  update spark_private.start_restriction_state_v1012 set revision=revision+1 where id=1;
  insert into public.audit_logs(actor_id,actor_username,actor_role,action,entity_type,entity_id,entity_label,metadata)
    values(a.id,a.username,a.role,'intake.start_date_restriction_saved','system',p_id,
      p_start_date::text||' ~ '||p_end_date::text,
      jsonb_build_object('reason',new_row.reason,'enabled',p_enabled,'before',to_jsonb(old_row),'after',to_jsonb(new_row),'existing_orders_preserved',true));
  return to_jsonb(new_row);
end; $$;
revoke all on function spark_private.save_order_start_restriction_v1012(uuid,date,date,text,boolean,integer) from public,anon;
grant usage on schema spark_private to authenticated;
grant execute on function spark_private.save_order_start_restriction_v1012(uuid,date,date,text,boolean,integer) to authenticated;
create function public.save_order_start_restriction_v1012(
  p_id uuid,p_start_date date,p_end_date date,p_reason text,p_enabled boolean,p_expected_version integer
) returns jsonb language sql security invoker set search_path='' as $$
  select spark_private.save_order_start_restriction_v1012(p_id,p_start_date,p_end_date,p_reason,p_enabled,p_expected_version);
$$;

-- Preflight the entire RPC before any row can be committed. Existing non-date
-- per-row errors/idempotent retries in the admin engine keep their semantics.
create or replace function public.admin_bulk_create_orders_for_members_v106(p_items jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'
    and p.approval_status='approved' and p.active and not coalesce(p.is_operations_manager,false)) then
    raise exception '승인된 활성 관리자만 작업을 부여할 수 있습니다.' using errcode='42501';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception '작업 배열이 필요합니다.'; end if;
  if jsonb_array_length(p_items) not between 1 and 500 then raise exception '한 번에 1~500건까지 부여할 수 있습니다.'; end if;
  -- Already committed identical rows are result lookups, not new intake.
  perform spark_private.assert_order_start_dates_v1012(array(
    select (i.value->>'start_date')::date from jsonb_array_elements(p_items) with ordinality i(value,n)
    where not exists(select 1 from spark_private.admin_order_assignments_v106 done
      where done.actor_id=auth.uid() and done.request_id=p_request_id
        and done.row_number=coalesce((i.value->>'row_number')::integer,i.n::integer) and done.payload=i.value)
      and coalesce(i.value->>'start_date','') ~ '^\d{4}-\d{2}-\d{2}$'
  ));
  return spark_private.admin_assign_orders_v106(p_items,p_request_id,'excel');
end; $$;

revoke all on function public.get_order_start_restrictions_v1012(boolean) from public,anon;
revoke all on function public.preview_order_start_restriction_v1012(date,date) from public,anon;
revoke all on function public.save_order_start_restriction_v1012(uuid,date,date,text,boolean,integer) from public,anon;
grant execute on function public.get_order_start_restrictions_v1012(boolean) to authenticated;
grant execute on function public.preview_order_start_restriction_v1012(date,date) to authenticated;
grant execute on function public.save_order_start_restriction_v1012(uuid,date,date,text,boolean,integer) to authenticated;

-- Realtime is a convenience only: the write trigger always reads current policy.
do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(
    select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='order_start_restrictions'
  ) then alter publication supabase_realtime add table public.order_start_restrictions; end if;
end $$;
notify pgrst,'reload schema';
