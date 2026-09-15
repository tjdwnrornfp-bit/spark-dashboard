-- Run as a database operator. No account login, persisted settings or data writes.
-- Only transaction-local JWT subject settings are used; all application reads run
-- through the same SECURITY DEFINER routines and authorization guards as the API.
begin transaction isolation level repeatable read read only;
set local statement_timeout='60s';
do $$
declare
  manager record; folder jsonb; response jsonb; all_folders jsonb;
  dashboard record; pg integer; own_agency uuid; other_agency uuid;
  old_rows jsonb; new_rows jsonb; query_value text; matched bigint; expected bigint;
  managers_checked integer:=0; agencies_checked integer:=0;
begin
  for manager in select id from public.profiles where is_operations_manager and active and approval_status='approved' order by id loop
    perform set_config('request.jwt.claim.sub',manager.id::text,true);
    all_folders:='[]'::jsonb; pg:=1;
    loop
      response:=public.get_manager_agency_folders_v109(p_page=>pg,p_page_size=>50);
      all_folders:=all_folders||(response->'agencies');
      exit when pg>=(response->>'totalPages')::integer; pg:=pg+1;
    end loop;
    if jsonb_array_length(all_folders)<>(select count(*) from public.profiles where manager_id=manager.id) then raise exception 'Agency count mismatch'; end if;
    if (select count(distinct x->>'agencyId') from jsonb_array_elements(all_folders) x)<>jsonb_array_length(all_folders) then raise exception 'Duplicate agency page'; end if;
    select * into dashboard from public.get_manager_dashboard_summary_v103();
    if (select coalesce(sum((x->>'settlementWaitingAmount')::bigint),0) from jsonb_array_elements(all_folders) x)<>dashboard.settlement_waiting_amount then raise exception 'Waiting amount mismatch'; end if;
    if (select coalesce(sum((x->>'settlementCompletedAmount')::bigint),0) from jsonb_array_elements(all_folders) x)<>dashboard.settlement_completed_amount then raise exception 'Completed amount mismatch'; end if;
    for folder in select * from jsonb_array_elements(all_folders) loop
      own_agency:=(folder->>'agencyId')::uuid;
      if not exists(select 1 from public.profiles where id=own_agency and manager_id=manager.id) then raise exception 'Scope leak'; end if;
      select count(*) into expected from public.orders where created_by=own_agency and archived_at is null and status::text in ('입금대기','입금완료');
      if expected<>(folder->>'inProgressCount')::bigint then raise exception 'Composite count mismatch'; end if;
      agencies_checked:=agencies_checked+1;
    end loop;
    select (x->>'agencyId')::uuid into own_agency from jsonb_array_elements(all_folders) x where (x->>'totalOrderCount')::bigint>0 limit 1;
    if own_agency is not null then
      for pg in 1..2 loop
        select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into old_rows from public.get_manager_managed_orders_v108(p_agency_id=>own_agency,p_page=>pg,p_page_size=>20) r;
        select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into new_rows from public.get_manager_agency_orders_v109(p_agency_id=>own_agency,p_page=>pg,p_page_size=>20) r;
        if old_rows<>new_rows then raise exception 'Order page differs from v108'; end if;
      end loop;
      -- Identical agency export scope and all fields for a bounded 500-row export page.
      select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into old_rows from public.get_manager_managed_orders_v108(p_agency_id=>own_agency,p_page_size=>500,p_order_statuses=>array['입금대기','입금완료']) r;
      select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into new_rows from public.get_manager_agency_orders_v109(p_agency_id=>own_agency,p_page_size=>500,p_order_statuses=>array['입금대기','입금완료']) r;
      if old_rows<>new_rows then raise exception 'Export differs from v108'; end if;
      for query_value in select unnest(array[o.store_name,o.keyword,o.mid]) from public.orders o where o.created_by=own_agency and o.archived_at is null limit 3 loop
        if nullif(trim(query_value),'') is null then continue; end if;
        response:=public.get_manager_agency_folders_v109(p_agency_id=>own_agency,p_query=>query_value);
        matched:=coalesce((response->'agencies'->0->>'matchedOrderCount')::bigint,0);
        select coalesce(max(r.total_count),0) into expected from public.get_manager_agency_orders_v109(p_agency_id=>own_agency,p_query=>query_value,p_page_size=>1) r;
        if expected<>matched or matched=0 then raise exception 'Search count mismatch'; end if;
      end loop;
    end if;
    select id into other_agency from public.profiles where manager_id is not null and manager_id<>manager.id limit 1;
    if other_agency is not null then
      begin perform public.get_manager_agency_orders_v109(p_agency_id=>other_agency); raise exception 'Cross-manager read allowed'; exception when insufficient_privilege then null; end;
      begin perform public.get_manager_agency_folders_v109(p_agency_id=>other_agency); raise exception 'Cross-manager folder allowed'; exception when insufficient_privilege then null; end;
    end if;
    begin perform public.get_manager_agency_orders_v109(); raise exception 'Null agency allowed'; exception when insufficient_privilege then null; end;
    managers_checked:=managers_checked+1;
  end loop;
  perform set_config('request.jwt.claim.sub','',true);
  begin perform public.get_manager_agency_folders_v109(); raise exception 'Unauthenticated allowed'; exception when insufficient_privilege then null; end;
  perform set_config('spark.v109_verify',jsonb_build_object('managers_checked',managers_checked,'agencies_checked',agencies_checked,'scope','PASS','dashboard_amounts','PASS','composite','PASS','pagination_export_parity','PASS','server_search','PASS','cross_manager_denied','PASS')::text,true);
end $$;
select current_setting('spark.v109_verify')::jsonb verification;
rollback;
