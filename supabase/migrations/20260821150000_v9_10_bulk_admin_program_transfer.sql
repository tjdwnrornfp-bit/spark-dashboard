-- SPARK v9.10.0: bulk admin program transfer with per-order savepoints.
begin;

do $$
begin
  if to_regprocedure('public.preview_order_program_transfer_v99(uuid,text,integer)') is null
     or to_regprocedure('public.transfer_order_program_v99(uuid,text,integer,text)') is null then
    raise exception 'SPARK v9.9.0까지 먼저 적용되어 있어야 합니다.';
  end if;
end $$;

-- Returns a server-computed summary for all selected orders. No data is changed.
create or replace function public.preview_bulk_order_program_transfer_v910(
  p_items jsonb,
  p_target_program text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles;
  v_item record;
  v_order public.orders;
  v_preview jsonb;
  v_items jsonb := '[]'::jsonb;
  v_error text;
  v_selected_count integer := 0;
  v_ready_count integer := 0;
  v_excluded_count integer := 0;
  v_blocked_count integer := 0;
  v_spark_count integer := 0;
  v_spark_plus_count integer := 0;
  v_spark_s_count integer := 0;
  v_additional bigint := 0;
  v_deduction bigint := 0;
  v_difference bigint := 0;
  v_item_difference bigint := 0;
begin
  select * into v_actor from public.profiles where id = auth.uid();
  if v_actor.id is null or v_actor.role is distinct from 'admin' or not v_actor.active or v_actor.approval_status is distinct from 'approved' then
    raise exception '관리자만 작업 프로그램을 변경할 수 있습니다.';
  end if;
  if p_target_program is null or p_target_program not in ('spark', 'spark_plus', 'spark_s') then
    raise exception '지원하지 않는 프로그램입니다.';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception '프로그램을 변경할 작업을 선택해 주세요.';
  end if;
  if jsonb_array_length(p_items) > 500 then
    raise exception '한 번에 최대 500건까지 변경할 수 있습니다.';
  end if;

  for v_item in
    select
      (entry.value ->> 'order_id')::uuid as order_id,
      coalesce((entry.value ->> 'expected_version')::integer, 0) as expected_version
    from jsonb_array_elements(p_items) with ordinality as entry(value, position)
    order by (entry.value ->> 'order_id')::uuid, entry.position
  loop
    v_selected_count := v_selected_count + 1;
    v_order := null;
    select * into v_order from public.orders where id = v_item.order_id;

    if v_order.id is null then
      v_blocked_count := v_blocked_count + 1;
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'orderDbId', v_item.order_id,
        'orderNumber', '',
        'storeName', '',
        'beforeProgram', null,
        'status', 'blocked',
        'difference', 0,
        'expectedVersion', v_item.expected_version,
        'blockedReason', '작업을 찾을 수 없습니다.',
        'preview', null
      ));
      continue;
    end if;

    if v_order.program_type = 'spark' then v_spark_count := v_spark_count + 1;
    elsif v_order.program_type = 'spark_plus' then v_spark_plus_count := v_spark_plus_count + 1;
    elsif v_order.program_type = 'spark_s' then v_spark_s_count := v_spark_s_count + 1;
    end if;

    if v_order.program_type = p_target_program then
      v_excluded_count := v_excluded_count + 1;
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'orderDbId', v_order.id,
        'orderNumber', v_order.order_number,
        'storeName', v_order.store_name,
        'beforeProgram', v_order.program_type,
        'status', 'excluded',
        'difference', 0,
        'expectedVersion', v_order.lock_version,
        'blockedReason', '이미 변경 대상 프로그램으로 등록된 작업입니다.',
        'preview', null
      ));
      continue;
    end if;

    begin
      v_preview := public.preview_order_program_transfer_v99(v_order.id, p_target_program, v_item.expected_version);
      v_item_difference := coalesce((v_preview ->> 'difference')::bigint, 0);
      if coalesce((v_preview ->> 'canTransfer')::boolean, false) then
        v_ready_count := v_ready_count + 1;
        v_difference := v_difference + v_item_difference;
        if v_item_difference > 0 then v_additional := v_additional + v_item_difference; end if;
        if v_item_difference < 0 then v_deduction := v_deduction + abs(v_item_difference); end if;
        v_items := v_items || jsonb_build_array(jsonb_build_object(
          'orderDbId', v_order.id,
          'orderNumber', v_order.order_number,
          'storeName', v_order.store_name,
          'beforeProgram', v_order.program_type,
          'status', 'ready',
          'difference', v_item_difference,
          'expectedVersion', v_item.expected_version,
          'blockedReason', '',
          'preview', v_preview
        ));
      else
        v_blocked_count := v_blocked_count + 1;
        v_items := v_items || jsonb_build_array(jsonb_build_object(
          'orderDbId', v_order.id,
          'orderNumber', v_order.order_number,
          'storeName', v_order.store_name,
          'beforeProgram', v_order.program_type,
          'status', 'blocked',
          'difference', v_item_difference,
          'expectedVersion', v_item.expected_version,
          'blockedReason', coalesce(nullif(v_preview ->> 'blockedReason', ''), '프로그램을 변경할 수 없습니다.'),
          'preview', v_preview
        ));
      end if;
    exception when others then
      get stacked diagnostics v_error = message_text;
      v_blocked_count := v_blocked_count + 1;
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'orderDbId', v_order.id,
        'orderNumber', v_order.order_number,
        'storeName', v_order.store_name,
        'beforeProgram', v_order.program_type,
        'status', 'blocked',
        'difference', 0,
        'expectedVersion', v_item.expected_version,
        'blockedReason', coalesce(nullif(v_error, ''), '프로그램 변경 정보를 확인하지 못했습니다.'),
        'preview', null
      ));
    end;
  end loop;

  return jsonb_build_object(
    'selectedCount', v_selected_count,
    'readyCount', v_ready_count,
    'excludedCount', v_excluded_count,
    'blockedCount', v_blocked_count,
    'programCounts', jsonb_build_object('spark', v_spark_count, 'spark_plus', v_spark_plus_count, 'spark_s', v_spark_s_count),
    'targetProgram', p_target_program,
    'expectedAdditionalAmount', v_additional,
    'expectedDeductionAmount', v_deduction,
    'expectedDifference', v_difference,
    'items', v_items
  );
end;
$$;

revoke all on function public.preview_bulk_order_program_transfer_v910(jsonb, text) from public, anon;
grant execute on function public.preview_bulk_order_program_transfer_v910(jsonb, text) to authenticated;

-- Executes the v9.9 transfer RPC inside a per-order exception block. Each block is
-- a PostgreSQL subtransaction: a failed order is rolled back without undoing other orders.
create or replace function public.transfer_bulk_order_program_v910(
  p_items jsonb,
  p_target_program text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles;
  v_item record;
  v_order public.orders;
  v_call jsonb;
  v_items jsonb := '[]'::jsonb;
  v_error text;
  v_selected_count integer := 0;
  v_succeeded_count integer := 0;
  v_failed_count integer := 0;
  v_excluded_count integer := 0;
begin
  select * into v_actor from public.profiles where id = auth.uid();
  if v_actor.id is null or v_actor.role is distinct from 'admin' or not v_actor.active or v_actor.approval_status is distinct from 'approved' then
    raise exception '관리자만 작업 프로그램을 변경할 수 있습니다.';
  end if;
  if p_target_program is null or p_target_program not in ('spark', 'spark_plus', 'spark_s') then
    raise exception '지원하지 않는 프로그램입니다.';
  end if;
  if char_length(trim(coalesce(p_reason, ''))) < 2 or char_length(trim(coalesce(p_reason, ''))) > 500 then
    raise exception '프로그램 변경 사유를 2자 이상 500자 이하로 입력해 주세요.';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception '프로그램을 변경할 작업을 선택해 주세요.';
  end if;
  if jsonb_array_length(p_items) > 500 then
    raise exception '한 번에 최대 500건까지 변경할 수 있습니다.';
  end if;

  -- UUID ordering gives concurrent bulk transfers a consistent order-lock sequence.
  for v_item in
    select
      (entry.value ->> 'order_id')::uuid as order_id,
      coalesce((entry.value ->> 'expected_version')::integer, 0) as expected_version
    from jsonb_array_elements(p_items) with ordinality as entry(value, position)
    order by (entry.value ->> 'order_id')::uuid, entry.position
  loop
    v_selected_count := v_selected_count + 1;
    v_order := null;
    select * into v_order from public.orders where id = v_item.order_id;

    if v_order.id is null then
      v_failed_count := v_failed_count + 1;
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'orderDbId', v_item.order_id,
        'orderNumber', '',
        'storeName', '',
        'status', 'failed',
        'message', '작업을 찾을 수 없습니다.',
        'order', null,
        'transfer', null
      ));
      continue;
    end if;

    if v_order.program_type = p_target_program then
      v_excluded_count := v_excluded_count + 1;
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'orderDbId', v_order.id,
        'orderNumber', v_order.order_number,
        'storeName', v_order.store_name,
        'status', 'excluded',
        'message', '이미 변경 대상 프로그램으로 등록된 작업입니다.',
        'order', null,
        'transfer', null
      ));
      continue;
    end if;

    begin
      v_call := public.transfer_order_program_v99(v_order.id, p_target_program, v_item.expected_version, trim(p_reason));
      v_succeeded_count := v_succeeded_count + 1;
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'orderDbId', v_order.id,
        'orderNumber', v_order.order_number,
        'storeName', v_order.store_name,
        'status', 'succeeded',
        'message', '프로그램 변경이 완료되었습니다.',
        'order', v_call -> 'order',
        'transfer', v_call -> 'transfer'
      ));
    exception when others then
      get stacked diagnostics v_error = message_text;
      v_failed_count := v_failed_count + 1;
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'orderDbId', v_order.id,
        'orderNumber', v_order.order_number,
        'storeName', v_order.store_name,
        'status', 'failed',
        'message', coalesce(nullif(v_error, ''), '프로그램을 변경하지 못했습니다.'),
        'order', null,
        'transfer', null
      ));
    end;
  end loop;

  return jsonb_build_object(
    'selectedCount', v_selected_count,
    'succeededCount', v_succeeded_count,
    'failedCount', v_failed_count,
    'excludedCount', v_excluded_count,
    'targetProgram', p_target_program,
    'items', v_items
  );
end;
$$;

revoke all on function public.transfer_bulk_order_program_v910(jsonb, text, text) from public, anon;
grant execute on function public.transfer_bulk_order_program_v910(jsonb, text, text) to authenticated;

insert into public.app_schema_versions(version, description)
values ('v9.10.0', 'Bulk admin program transfer with per-order transactional results')
on conflict (version) do nothing;

select public.write_audit_log(
  'system.migration', 'system', null, 'SPARK v9.10.0',
  jsonb_build_object('description', 'bulk admin program transfer RPCs with per-order rollback')
);

commit;
