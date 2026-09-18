-- Read-only production verification; no account, order, payment or profile writes.
begin transaction isolation level repeatable read read only;
set local statement_timeout='60s';
do $$
declare
  actor record; response jsonb; groups jsonb; folders jsonb; item jsonb;
  expected_ids uuid[]; allowed_ids uuid[]; actual_ids uuid[]; page_ids uuid[];
  pg integer; expected_groups integer; member_id uuid; outsider uuid; expected_amount bigint;
  old_rows jsonb; new_rows jsonb; managers_checked integer:=0; callers_checked integer:=0;
begin
  if not exists(select 1 from public.app_schema_versions where version='v10.10.0') then raise exception 'Missing v10.10.0'; end if;
  for actor in select id,is_operations_manager,role from public.profiles where active and approval_status='approved' and role in ('agency','distributor') order by id loop
    perform set_config('request.jwt.claim.sub',actor.id::text,true);
    if actor.is_operations_manager then
      select coalesce(array_agg(id),'{}'::uuid[]) into allowed_ids from public.profiles where manager_id=actor.id;
      execute 'set local role authenticated';
      folders:='[]'::jsonb; pg:=1;
      loop
        response:=public.get_manager_agency_folders_v1010(p_page=>pg,p_page_size=>20);
        folders:=folders||(response->'agencies');
        exit when pg>=(response->>'totalPages')::integer; pg:=pg+1;
      end loop;
      if jsonb_array_length(folders)<>cardinality(allowed_ids) or exists(select 1 from jsonb_array_elements(folders) x where not ((x->>'agencyId')::uuid=any(allowed_ids))) then raise exception 'Manager scope mismatch'; end if;
      select coalesce(jsonb_agg(to_jsonb(r)),'[]') into old_rows from public.get_manager_managed_orders_v108(p_page_size=>500) r;
      select coalesce(jsonb_agg(to_jsonb(r)-'current_group_name'),'[]') into new_rows from public.get_manager_managed_orders_v1010(p_page_size=>500) r;
      if old_rows<>new_rows then raise exception 'Manager old/new order parity failed'; end if;
      begin perform public.get_downline_orders_v1010(); raise exception 'Manager used downline API'; exception when insufficient_privilege then null; end;
      begin perform public.get_manager_agency_orders_v1010(p_agency_id=>actor.id); raise exception 'Manager self detail allowed'; exception when insufficient_privilege then null; end;
      execute 'reset role';
      for item in select * from jsonb_array_elements(folders) loop
        if item->>'groupName'<>(select coalesce(nullif(trim(group_name),''),'미지정 그룹') from public.profiles where id=(item->>'agencyId')::uuid) then raise exception 'Manager current group mismatch'; end if;
      end loop;
      managers_checked:=managers_checked+1;
    else
      with recursive tree(id) as (select actor.id union select p.id from public.profiles p join tree t on p.sponsor_id=t.id)
      select coalesce(array_agg(p.id),'{}'::uuid[]) into allowed_ids from tree t join public.profiles p on p.id=t.id where p.id<>actor.id and p.role in ('agency','distributor') and not coalesce(p.is_operations_manager,false);
      select count(distinct coalesce(nullif(trim(group_name),''),'미지정 그룹')) into expected_groups from public.profiles where id=any(allowed_ids);
      select coalesce(array_agg(id order by id),'{}'::uuid[]) into expected_ids from public.orders where created_by=any(allowed_ids) and archived_at is null;
      select coalesce(sum(s.total_amount),0) into expected_amount from public.payment_steps s join public.orders o on o.id=s.order_id where o.created_by=any(allowed_ids) and o.archived_at is null and s.payee_id=actor.id and s.confirmed_at is null;
      select id into outsider from public.profiles where id<>actor.id and not(id=any(allowed_ids)) limit 1;
      execute 'set local role authenticated';
      groups:='[]'; pg:=1;
      loop
        response:=public.get_downline_group_overview_v1010(p_page=>pg,p_page_size=>20);
        groups:=groups||(response->'groups');
        exit when pg>=(response->>'totalPages')::integer; pg:=pg+1;
      end loop;
      if jsonb_array_length(groups)<>expected_groups then raise exception 'Group count mismatch'; end if;
      if (select coalesce(sum((x->>'settlementWaitingAmount')::bigint),0) from jsonb_array_elements(groups) x)<>expected_amount then raise exception 'Receivable amount mismatch'; end if;
      folders:='[]';
      for item in select * from jsonb_array_elements(groups) loop
        pg:=1;
        loop
          response:=public.get_downline_agency_overview_v1010(p_group_name=>item->>'groupName',p_page=>pg,p_page_size=>20);
          folders:=folders||(response->'agencies');
          exit when pg>=(response->>'totalPages')::integer; pg:=pg+1;
        end loop;
      end loop;
      if jsonb_array_length(folders)<>cardinality(allowed_ids) or (select count(distinct x->>'agencyId') from jsonb_array_elements(folders)x)<>cardinality(allowed_ids) then raise exception 'Agency pages mismatch'; end if;
      if exists(select 1 from jsonb_array_elements(folders)x where not((x->>'agencyId')::uuid=any(allowed_ids))) then raise exception 'Non-descendant agency'; end if;
      actual_ids:='{}'; pg:=1;
      loop
        select coalesce(array_agg(r.order_id),'{}'::uuid[]) into page_ids from public.get_downline_orders_v1010(p_page=>pg,p_page_size=>50) r;
        actual_ids:=actual_ids||page_ids;
        exit when cardinality(page_ids)<50; pg:=pg+1;
      end loop;
      select coalesce(array_agg(x order by x),'{}'::uuid[]) into actual_ids from unnest(actual_ids)x;
      if actual_ids<>expected_ids then raise exception 'Order scope/pagination mismatch'; end if;
      begin perform public.get_downline_orders_v1010(p_agency_id=>actor.id); raise exception 'Self order allowed'; exception when insufficient_privilege then null; end;
      if outsider is not null then
        begin perform public.get_downline_orders_v1010(p_agency_id=>outsider); raise exception 'Unauthorized agency allowed'; exception when insufficient_privilege then null; end;
        begin perform public.get_downline_agency_overview_v1010(p_agency_id=>outsider); raise exception 'Unauthorized summary allowed'; exception when insufficient_privilege then null; end;
      end if;
      begin perform public.get_manager_agency_folders_v1010(); raise exception 'Agency used manager API'; exception when insufficient_privilege then null; end;
      execute 'reset role';
      for item in select * from jsonb_array_elements(folders) loop
        member_id:=(item->>'agencyId')::uuid;
        if item->>'groupName'<>(select coalesce(nullif(trim(group_name),''),'미지정 그룹') from public.profiles where id=member_id) then raise exception 'Current group mismatch'; end if;
        if exists(select 1 from public.get_downline_orders_v1010(p_agency_id=>member_id,p_page_size=>500) r join public.profiles p on p.id=r.registrant_id where r.current_group_name<>coalesce(nullif(trim(p.group_name),''),'미지정 그룹')) then raise exception 'Order current group mismatch'; end if;
      end loop;
      callers_checked:=callers_checked+1;
    end if;
  end loop;
  perform set_config('request.jwt.claim.sub','',true);
  execute 'set local role authenticated';
  begin perform public.get_downline_orders_v1010(); raise exception 'No subject allowed'; exception when insufficient_privilege then null; end;
  execute 'reset role';
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like '%v1010' and (has_function_privilege('anon',p.oid,'EXECUTE') or not has_function_privilege('authenticated',p.oid,'EXECUTE') or p.proconfig is distinct from array['search_path=""'])) then raise exception 'RPC grants/search_path'; end if;
  perform set_config('spark.v1010_verify',jsonb_build_object('managers_checked',managers_checked,'downline_callers_checked',callers_checked,'scope','PASS','unauthorized_ids','PASS','pagination','PASS','current_groups','PASS','caller_receivables','PASS','manager_parity','PASS','authenticated_role','PASS')::text,true);
end $$;
select current_setting('spark.v1010_verify')::jsonb verification;
rollback;
