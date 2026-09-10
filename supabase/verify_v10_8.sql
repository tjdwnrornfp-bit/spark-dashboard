-- No operating data writes. All calls are read-only or expected authorization failures.
begin;
set local statement_timeout='30s';
do $$
declare f record; m record; wanted uuid[]; actual uuid[]; kind text; rejected boolean;
begin
  if not exists(select 1 from public.app_schema_versions where version='v10.8.0') then raise exception 'Missing v10.8.0'; end if;
  for f in select p.oid,p.proname,p.prosecdef,p.proconfig from pg_proc p
    where p.pronamespace='public'::regnamespace and p.proname in ('member_preview_own_order_edit_v108','member_apply_own_order_edit_v108','member_own_order_edit_eligibility_v108','get_manager_managed_orders_v108')
  loop
    if not f.prosecdef or has_function_privilege('anon',f.oid,'execute') or not has_function_privilege('authenticated',f.oid,'execute') then raise exception 'Invalid function privileges: %',f.proname; end if;
    if not (f.proconfig @> array['search_path=""']) then raise exception 'Unsafe search_path: %',f.proname; end if;
  end loop;
  if (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('member_preview_own_order_edit_v108','member_apply_own_order_edit_v108','member_own_order_edit_eligibility_v108','get_manager_managed_orders_v108'))<>4 then raise exception 'Missing RPC'; end if;
  perform set_config('request.jwt.claim.sub','',true);
  rejected:=false;
  begin perform public.member_apply_own_order_edit_v108(null,1,'{}','권한 검증'); exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'Unauthenticated apply accepted'; end if;
  for m in select id from public.profiles where is_operations_manager and active and approval_status='approved' loop
    perform set_config('request.jwt.claim.sub',m.id::text,true);
    rejected:=false;
    begin perform public.member_apply_own_order_edit_v108(null,1,'{}','권한 검증'); exception when insufficient_privilege then rejected:=true; end;
    if not rejected then raise exception 'Manager mutation accepted'; end if;
    select array_agg(x.id order by x.id) into wanted from (
      select o.id from public.orders o join public.profiles p on p.id=o.created_by
      where p.manager_id=m.id and o.archived_at is null and o.status in ('입금대기','입금완료')
      order by case o.status when '입금대기' then 1 else 2 end,o.created_at desc,o.id desc limit 500
    ) x;
    select array_agg(x.order_id order by x.order_id) into actual from public.get_manager_managed_orders_v108(p_order_statuses=>array['입금대기','입금완료'],p_page_size=>500) x;
    if actual is distinct from wanted then raise exception 'Composite filter mismatch'; end if;
    foreach kind in array array['priority','newest','oldest','start_date'] loop
      select array_agg(x.id order by x.rn) into wanted from (
        select o.id,row_number() over(order by
          case when kind='priority' then case o.status when '입금대기' then 1 when '입금완료' then 2 when '구동중' then 3 when '정지' then 4 else 5 end end,
          case when kind='start_date' then o.start_date end,
          case when kind='oldest' then o.created_at end,
          o.created_at desc,o.id desc) rn
        from public.orders o join public.profiles p on p.id=o.created_by where p.manager_id=m.id and o.archived_at is null
      ) x where x.rn<=50;
      select array_agg(x.order_id order by x.ordinality) into actual from public.get_manager_managed_orders_v108(p_sort=>kind,p_page_size=>50) with ordinality x;
      if actual is distinct from wanted then raise exception 'Server sort mismatch: %',kind; end if;
    end loop;
  end loop;
end $$;
select 'PASS: RPC grants, anonymous/member mutation guard, manager read-only guard, composite filter and all four server sorts' as verification;
rollback;
