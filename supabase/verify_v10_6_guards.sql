begin;
do $verify$
declare
  v_admin uuid;
  v_actor record;
  v_target record;
  v_failed boolean;
  v_result jsonb;
  v_count integer := 0;
begin
  select id into v_admin from public.profiles where role='admin' and approval_status='approved' and active limit 1;
  perform set_config('request.jwt.claim.sub','',true);
  v_failed := false;
  begin
    perform public.admin_bulk_create_orders_for_members_v106('[{}]'::jsonb,gen_random_uuid());
  exception when insufficient_privilege then v_failed := true;
  end;
  if not v_failed then raise exception 'Anonymous application guard failed'; end if;
  for v_actor in select distinct on (role,is_operations_manager,approval_status,active) id from public.profiles
    where role is distinct from 'admin' or approval_status is distinct from 'approved' or active is not true
  loop
    perform set_config('request.jwt.claim.sub',v_actor.id::text,true);
    v_failed := false;
    begin
      perform public.admin_bulk_create_orders_for_members_v106('[{}]'::jsonb,gen_random_uuid());
    exception when insufficient_privilege then v_failed := true;
    end;
    if not v_failed then raise exception 'Non-admin guard failed'; end if;
    v_count := v_count + 1;
  end loop;
  perform set_config('request.jwt.claim.sub',v_admin::text,true);
  for v_target in select distinct on (role,is_operations_manager,approval_status,active) id from public.profiles
    where role is null or role not in ('agency','distributor') or is_operations_manager
      or approval_status is distinct from 'approved' or active is not true
  loop
    v_result := public.admin_bulk_create_orders_for_members_v106(jsonb_build_array(jsonb_build_object('target_user_id',v_target.id)),gen_random_uuid());
    if v_result->'items'->0->>'status' is distinct from 'failed' or position('부여 대상' in (v_result->'items'->0->>'message')) = 0 then raise exception 'Target guard failed'; end if;
    v_count := v_count + 1;
  end loop;
  -- Valid existing target with invalid program: stops before any order/sequence is written.
  select id into v_target from public.profiles where role in ('agency','distributor') and approval_status='approved' and active and not is_operations_manager limit 1;
  v_result := public.admin_bulk_create_orders_for_members_v106(jsonb_build_array(jsonb_build_object(
    'target_user_id',v_target.id,'program_type','invalid','place_url','https://m.place.naver.com/place/123/home',
    'mid','123','daily_shots',1,'operation_days',1,'start_date','2099-01-01','store_name','guard','keyword','guard')),gen_random_uuid());
  if v_result->'items'->0->>'status' is distinct from 'failed' then raise exception 'Program guard failed'; end if;
  perform set_config('spark.v106_verified_guard_count',(v_count+2)::text,true);
end;
$verify$;
select current_setting('spark.v106_verified_guard_count')::integer as passed_guard_cases;
rollback;
