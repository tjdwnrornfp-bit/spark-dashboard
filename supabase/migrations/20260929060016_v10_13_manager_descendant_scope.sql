-- v10.13: expand ONLY manager read scope. No profile/order/payment data is changed.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

-- ID-only recursion: UNION deduplicates overlapping roots and terminates cycles.
-- Explicit assignments are roots. A different manager is a boundary; a nested
-- explicit assignment to this manager is independently included as its own root.
create or replace function spark_private.manager_scope_ids_v1013()
returns table(id uuid) language plpgsql stable security invoker set search_path = '' as $$
declare actor public.profiles;
begin
  select * into actor from public.profiles p where p.id = auth.uid();
  if actor.id is null or not coalesce(actor.is_operations_manager,false)
    or actor.approval_status is distinct from 'approved' or not coalesce(actor.active,false) then
    raise exception '승인된 활성 중간관리자만 관리 작업을 조회할 수 있습니다.' using errcode='42501';
  end if;
  return query with recursive members(member_id) as (
    select p.id from public.profiles p
    where p.manager_id=actor.id and p.id<>actor.id
      and not coalesce(p.is_operations_manager,false)
      and (p.role is null or p.role in ('agency','distributor'))
    union
    select p.id from public.profiles p join members m on p.sponsor_id=m.member_id
    where (p.manager_id is null or p.manager_id=actor.id) and p.id<>actor.id
      and not coalesce(p.is_operations_manager,false)
      and (p.role is null or p.role in ('agency','distributor'))
  ) select m.member_id from members m;
  -- Inactive/rejected intermediate agencies retain historical descendant scope.
end $$;
revoke all on function spark_private.manager_scope_ids_v1013() from public,anon,authenticated;

-- Preserve each existing read routine's return type, sorting, pagination,
-- financial calculations, guards, owner and ACL. Change only scope predicates.
-- Restrict transformation to this explicit allowlist and fail on catalog drift.
do $$
declare f record; definition text; rewritten text; pattern text; expected integer; matched integer;
begin
  for f in select p.oid,p.proname,p.prosecdef,p.provolatile from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=any(array[
      'get_manager_agency_folders_v1010','get_manager_agency_orders_v1010',
      'get_manager_managed_orders_v1010','get_manager_agency_folders_v109',
      'get_manager_agency_orders_v109','get_manager_managed_orders_v108',
      'get_manager_agency_overview_v103','get_manager_dashboard_summary_v103',
      'get_manager_managed_order_filter_options_v102','get_manager_managed_orders_summary_v102',
      'get_manager_managed_orders_v102'])
  loop
    if not f.prosecdef then raise exception 'Unexpected manager read definition: %',f.proname; end if;
    definition:=pg_catalog.pg_get_functiondef(f.oid);
    if f.proname in ('get_manager_agency_folders_v1010','get_manager_agency_folders_v109') then
      pattern:='manager_id[[:space:]]*=[[:space:]]*auth\.uid\(\)';
      rewritten:=regexp_replace(definition,pattern,'id in (select scope.id from spark_private.manager_scope_ids_v1013() scope)','g');
      expected:=2;
    elsif f.proname in ('get_manager_managed_order_filter_options_v102','get_manager_managed_orders_summary_v102') then
      pattern:='p\.manager_id[[:space:]]*=[[:space:]]*auth\.uid\(\)';
      rewritten:=regexp_replace(definition,pattern,'p.id in (select scope.id from spark_private.manager_scope_ids_v1013() scope)','g');
      expected:=case when f.proname='get_manager_managed_orders_summary_v102' then 2 else 1 end;
    else
      pattern:='mp\.manager_id[[:space:]]*=[[:space:]]*auth\.uid\(\)';
      rewritten:=regexp_replace(definition,pattern,'mp.id in (select scope.id from spark_private.manager_scope_ids_v1013() scope)','g');
      expected:=case when f.proname in ('get_manager_agency_orders_v1010','get_manager_managed_orders_v1010','get_manager_agency_orders_v109','get_manager_dashboard_summary_v103') then 2 else 1 end;
    end if;
    select count(*) into matched from regexp_matches(definition,pattern,'g');
    if matched<>expected or rewritten=definition then raise exception 'Manager scope predicate drift: % (%/%)',f.proname,matched,expected; end if;
    execute rewritten;
  end loop;
  if (select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname like 'get_manager_%'
      and pg_catalog.pg_get_functiondef(p.oid) like '%spark_private.manager_scope_ids_v1013()%')<>11 then
    raise exception 'All eleven existing manager reads are required';
  end if;
end $$;

-- A small authorized revision response repairs missed RLS-filtered Realtime
-- events without exposing profiles or downloading entire order/payment lists.
create or replace function public.get_manager_read_revision_v1013()
returns text language plpgsql stable security definer set search_path='' as $$
declare result text;
begin
  with members as materialized (select id from spark_private.manager_scope_ids_v1013()),
  visible as materialized (select o.id,o.updated_at,o.lock_version from public.orders o
    where o.created_by in (select id from members) and o.archived_at is null)
  select md5(concat_ws('|',
    (select string_agg(concat_ws(':',p.id,p.username,p.group_name,p.sponsor_id,p.manager_id,p.updated_at),',' order by p.id)
      from public.profiles p where p.id in (select id from members)),
    (select string_agg(concat_ws(':',o.id,o.updated_at,o.lock_version),',' order by o.id) from visible o),
    (select string_agg(concat_ws(':',s.id,s.updated_at,s.confirmed_at),',' order by s.id)
      from public.payment_steps s where s.order_id in (select id from visible))
  )) into result;
  return result;
end $$;
revoke all on function public.get_manager_read_revision_v1013() from public,anon;
grant execute on function public.get_manager_read_revision_v1013() to authenticated;
notify pgrst,'reload schema';
