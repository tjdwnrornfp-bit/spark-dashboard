-- Sanitized catalog-derived fixture: no production user/order data.
create role anon; create role authenticated;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create type public.approval_status as enum ('pending','approved','rejected');
create type public.member_role as enum ('admin','agency','distributor');
create type public.order_status as enum ('입금대기','입금완료','구동중','정지','만료');
create sequence public.order_number_seq;
create table public.order_program_transfers(id uuid primary key);
create table public.app_schema_versions(
  version text not null,
  description text not null,
  applied_at timestamptz default now() not null
);
create table public.audit_logs(
  id uuid default gen_random_uuid() not null,
  created_at timestamptz default now() not null,
  actor_id uuid,
  actor_username text default 'system'::text not null,
  actor_role public.member_role,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  entity_label text default ''::text not null,
  metadata jsonb default '{}'::jsonb not null
);
create table public.notifications(
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  target_role public.member_role,
  title text not null,
  message text not null,
  order_id uuid,
  read_at timestamptz,
  created_at timestamptz default now() not null
);
create table public.orders(
  id uuid default gen_random_uuid() not null,
  order_number text not null,
  created_by uuid not null,
  creator_username text not null,
  place_url text not null,
  mid text not null,
  store_name text not null,
  keyword text not null,
  daily_shots int4 not null,
  operation_days int4 not null,
  price_per_shot int4 not null,
  supply_amount int8 not null,
  vat_amount int8 not null,
  total_amount int8 not null,
  start_date date not null,
  end_date date not null,
  status public.order_status default '입금대기'::order_status not null,
  memo text default ''::text not null,
  activated_at timestamptz,
  stopped_at timestamptz,
  payment_notified_at timestamptz,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  sponsor_id uuid,
  sponsor_username text,
  creator_group_name text default ''::text not null,
  program_type text default 'spark'::text not null,
  archived_at timestamptz,
  archived_by uuid,
  archive_reason text default ''::text not null,
  lock_version int4 default 1 not null,
  program_transfer_state text default 'none'::text not null,
  program_transfer_difference int8 default 0 not null,
  last_program_transfer_at timestamptz,
  settlement_reversal_pending bool default false not null
);
create table public.payment_steps(
  id uuid default gen_random_uuid() not null,
  order_id uuid not null,
  order_number text not null,
  store_name text not null,
  step_order int4 not null,
  payer_id uuid not null,
  payer_username text not null,
  payee_id uuid not null,
  payee_username text not null,
  unit_price int4 not null,
  supply_amount int8 not null,
  vat_amount int8 not null,
  total_amount int8 not null,
  confirmed_at timestamptz,
  confirmed_by uuid,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  program_type text not null,
  step_kind text default 'standard'::text not null,
  program_transfer_id uuid
);
create table public.profiles(
  id uuid not null,
  username text not null,
  username_key text not null,
  role public.member_role,
  approval_status public.approval_status default 'pending'::approval_status not null,
  price_per_shot int4 default 0 not null,
  active bool default false not null,
  requested_at timestamptz default now() not null,
  approved_at timestamptz,
  updated_at timestamptz default now() not null,
  sponsor_id uuid,
  sponsor_username text,
  referral_code text not null,
  group_name text default ''::text not null,
  hierarchy_depth int4 default 0 not null,
  bank text default ''::text not null,
  account_number text default ''::text not null,
  account_holder text default ''::text not null,
  spark_price_per_shot int4 default 0 not null,
  spark_plus_price_per_shot int4 default 0 not null,
  spark_s_price_per_shot int4 default 0 not null,
  is_operations_manager bool default false not null,
  manager_id uuid,
  manager_username text,
  spark_s_plus_price_per_shot int4 default 40 not null
);
alter table public.app_schema_versions add constraint app_schema_versions_pkey PRIMARY KEY (version);
alter table public.audit_logs add constraint audit_logs_entity_type_check CHECK ((entity_type = ANY (ARRAY['order'::text, 'member'::text, 'payment'::text, 'system'::text])));
alter table public.audit_logs add constraint audit_logs_pkey PRIMARY KEY (id);
alter table public.profiles add constraint profiles_check CHECK ((((approval_status = 'approved'::approval_status) AND (role IS NOT NULL) AND (active = true) AND ((role = 'admin'::member_role) OR (price_per_shot > 0))) OR (approval_status <> 'approved'::approval_status)));
alter table public.profiles add constraint profiles_hierarchy_depth_check CHECK (((hierarchy_depth >= 0) AND (hierarchy_depth <= 25)));
alter table public.profiles add constraint profiles_pkey PRIMARY KEY (id);
alter table public.profiles add constraint profiles_price_per_shot_check CHECK ((price_per_shot >= 0));
alter table public.profiles add constraint profiles_spark_s_plus_price_per_shot_check CHECK ((spark_s_plus_price_per_shot >= 0));
alter table public.profiles add constraint profiles_username_check CHECK ((((char_length(TRIM(BOTH FROM username)) >= 4) AND (char_length(TRIM(BOTH FROM username)) <= 40)) AND (username !~ '[[:cntrl:]]'::text)));
alter table public.profiles add constraint profiles_username_key_check CHECK (((char_length(TRIM(BOTH FROM username_key)) >= 4) AND (char_length(TRIM(BOTH FROM username_key)) <= 120)));
alter table public.profiles add constraint profiles_username_key_key UNIQUE (username_key);
alter table public.notifications add constraint notifications_pkey PRIMARY KEY (id);
alter table public.orders add constraint orders_check CHECK ((total_amount = (supply_amount + vat_amount)));
alter table public.orders add constraint orders_check1 CHECK ((end_date >= start_date));
alter table public.orders add constraint orders_daily_shots_check CHECK ((daily_shots > 0));
alter table public.orders add constraint orders_keyword_check CHECK (((char_length(TRIM(BOTH FROM keyword)) >= 1) AND (char_length(TRIM(BOTH FROM keyword)) <= 50)));
alter table public.orders add constraint orders_memo_check CHECK ((char_length(memo) <= 300));
alter table public.orders add constraint orders_mid_check CHECK ((mid ~ '^[0-9]+$'::text));
alter table public.orders add constraint orders_operation_days_check CHECK ((operation_days > 0));
alter table public.orders add constraint orders_order_number_key UNIQUE (order_number);
alter table public.orders add constraint orders_pkey PRIMARY KEY (id);
alter table public.orders add constraint orders_price_per_shot_check CHECK ((price_per_shot > 0));
alter table public.orders add constraint orders_program_transfer_difference_check CHECK (((program_transfer_state = 'payment_pending'::text) OR (program_transfer_difference = 0)));
alter table public.orders add constraint orders_program_transfer_state_check CHECK ((program_transfer_state = ANY (ARRAY['none'::text, 'payment_pending'::text])));
alter table public.orders add constraint orders_program_type_check CHECK ((program_type = ANY (ARRAY['spark'::text, 'spark_plus'::text, 'spark_s'::text, 'spark_s_plus'::text])));
alter table public.orders add constraint orders_store_name_check CHECK (((char_length(TRIM(BOTH FROM store_name)) >= 1) AND (char_length(TRIM(BOTH FROM store_name)) <= 50)));
alter table public.orders add constraint orders_supply_amount_check CHECK ((supply_amount >= 0));
alter table public.orders add constraint orders_vat_amount_check CHECK ((vat_amount >= 0));
alter table public.payment_steps add constraint payment_steps_check CHECK ((total_amount = (supply_amount + vat_amount)));
alter table public.payment_steps add constraint payment_steps_order_id_step_order_key UNIQUE (order_id, step_order);
alter table public.payment_steps add constraint payment_steps_pkey PRIMARY KEY (id);
alter table public.payment_steps add constraint payment_steps_program_type_check CHECK ((program_type = ANY (ARRAY['spark'::text, 'spark_plus'::text, 'spark_s'::text, 'spark_s_plus'::text])));
alter table public.payment_steps add constraint payment_steps_step_kind_check CHECK ((step_kind = ANY (ARRAY['standard'::text, 'program_adjustment'::text])));
alter table public.payment_steps add constraint payment_steps_step_order_check CHECK (((step_order >= 1) AND (step_order <= 100)));
alter table public.payment_steps add constraint payment_steps_supply_amount_check CHECK ((supply_amount >= 0));
alter table public.payment_steps add constraint payment_steps_unit_price_check CHECK ((unit_price > 0));
alter table public.payment_steps add constraint payment_steps_vat_amount_check CHECK ((vat_amount >= 0));
alter table public.audit_logs add constraint audit_logs_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public.profiles add constraint profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.profiles add constraint profiles_manager_id_fkey FOREIGN KEY (manager_id) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public.profiles add constraint profiles_sponsor_id_fkey FOREIGN KEY (sponsor_id) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public.notifications add constraint notifications_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
alter table public.notifications add constraint notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public.orders add constraint orders_archived_by_fkey FOREIGN KEY (archived_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public.orders add constraint orders_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id);
alter table public.orders add constraint orders_sponsor_id_fkey FOREIGN KEY (sponsor_id) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public.payment_steps add constraint payment_steps_confirmed_by_fkey FOREIGN KEY (confirmed_by) REFERENCES profiles(id);
alter table public.payment_steps add constraint payment_steps_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
alter table public.payment_steps add constraint payment_steps_payee_id_fkey FOREIGN KEY (payee_id) REFERENCES profiles(id);
alter table public.payment_steps add constraint payment_steps_payer_id_fkey FOREIGN KEY (payer_id) REFERENCES profiles(id);
alter table public.payment_steps add constraint payment_steps_program_transfer_id_fkey FOREIGN KEY (program_transfer_id) REFERENCES order_program_transfers(id);
CREATE OR REPLACE FUNCTION public.create_orders_bulk_v10(p_items jsonb)
 RETURNS SETOF orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  item jsonb;
  result public.orders;
  item_count integer;
begin
  item_count := jsonb_array_length(coalesce(p_items, '[]'::jsonb));
  if item_count < 1 then raise exception '접수할 작업이 없습니다.'; end if;
  if item_count > 500 then raise exception '한 번에 최대 500건까지 접수할 수 있습니다.'; end if;

  for item in select value from jsonb_array_elements(p_items)
  loop
    select * into result from public.create_order_v10(
      coalesce(item ->> 'program_type', 'spark'),
      item ->> 'place_url',
      item ->> 'mid',
      item ->> 'store_name',
      item ->> 'keyword',
      (item ->> 'daily_shots')::integer,
      (item ->> 'operation_days')::integer,
      (item ->> 'start_date')::date,
      coalesce(item ->> 'memo', '')
    );
    return next result;
  end loop;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.notify_admins(p_title text, p_message text, p_order_id uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  inserted_count integer;
begin
  insert into public.notifications (user_id, target_role, title, message, order_id)
  select p.id, 'admin'::public.member_role, p_title, p_message, p_order_id
  from public.profiles p
  where p.role = 'admin'::public.member_role
    and p.approval_status = 'approved'::public.approval_status
    and p.active = true;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.set_payment_step_program_snapshot_v99()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.program_type is null then
    select o.program_type into new.program_type
    from public.orders o where o.id = new.order_id;
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.audit_orders_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_action text;
  v_metadata jsonb;
  v_reason text := nullif(current_setting('spark.change_reason', true), '');
begin
  if tg_op = 'INSERT' then
    v_action := 'order.created';
    v_metadata := jsonb_build_object(
      'program', new.program_type,
      'status', new.status,
      'total_amount', new.total_amount,
      'start_date', new.start_date,
      'end_date', new.end_date
    );
  elsif old.archived_at is null and new.archived_at is not null then
    v_action := 'order.archived';
    v_metadata := jsonb_build_object('status', new.status, 'reason', coalesce(new.archive_reason, v_reason, ''));
  elsif old.archived_at is not null and new.archived_at is null then
    v_action := 'order.restored';
    v_metadata := jsonb_build_object('status', new.status, 'reason', coalesce(v_reason, ''));
  elsif old.status is distinct from new.status then
    v_action := 'order.status_changed';
    v_metadata := jsonb_build_object('from', old.status, 'to', new.status, 'reason', coalesce(v_reason, '자동 처리'));
  elsif old.start_date is distinct from new.start_date
     or old.end_date is distinct from new.end_date
     or old.daily_shots is distinct from new.daily_shots
     or old.operation_days is distinct from new.operation_days
     or old.price_per_shot is distinct from new.price_per_shot then
    v_action := 'order.updated';
    v_metadata := jsonb_build_object('reason', coalesce(v_reason, ''), 'version', new.lock_version);
  else
    return new;
  end if;

  perform public.write_audit_log(v_action, 'order', new.id, new.order_number || ' ' || new.store_name, v_metadata);
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.create_order_v10(p_program_type text, p_place_url text, p_mid text, p_store_name text, p_keyword text, p_daily_shots integer, p_operation_days integer, p_start_date date, p_memo text DEFAULT ''::text)
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  member public.profiles;
  result public.orders;
  order_prefix text;
  order_number text;
  local_today date;
  minimum_start date;
  calculated_end date;
  unit_price integer;
  supply bigint;
  vat bigint;
  v_payer public.profiles;
  v_payee public.profiles;
  v_admin public.profiles;
  v_step integer := 1;
  v_unit_price integer;
  v_step_supply bigint;
  v_step_vat bigint;
begin
  select * into member from public.profiles where id = auth.uid() for update;
  if member.id is null
     or member.role not in ('agency', 'distributor')
     or member.approval_status <> 'approved'
     or not member.active
     or coalesce(member.is_operations_manager, false) then
    raise exception '승인된 대행사 또는 총판만 접수할 수 있습니다.';
  end if;

  if p_program_type not in ('spark', 'spark_plus', 'spark_s', 'spark_s_plus') then
    raise exception '지원하지 않는 프로그램입니다.';
  end if;

  unit_price := case p_program_type
    when 'spark' then coalesce(member.spark_price_per_shot, member.price_per_shot, 0)
    when 'spark_plus' then coalesce(member.spark_plus_price_per_shot, 0)
    when 'spark_s' then coalesce(member.spark_s_price_per_shot, 0)
    when 'spark_s_plus' then coalesce(member.spark_s_plus_price_per_shot, 0)
  end;
  if unit_price <= 0 then raise exception '해당 프로그램 단가가 설정된 회원만 접수할 수 있습니다.'; end if;
  if p_daily_shots <= 0 or p_operation_days <= 0 then raise exception '수량과 구동일수는 1 이상의 정수여야 합니다.'; end if;
  if p_mid !~ '^[0-9]+$' then raise exception 'MID 형식이 올바르지 않습니다.'; end if;
  if char_length(trim(p_store_name)) < 1 or char_length(trim(p_keyword)) < 1 then raise exception '상호명과 대표 키워드를 입력해야 합니다.'; end if;
  if char_length(coalesce(p_memo, '')) > 300 then raise exception '메모는 300자 이하로 입력해야 합니다.'; end if;

  local_today := (now() at time zone 'Asia/Seoul')::date;
  minimum_start := local_today + 1;
  if p_start_date is null then raise exception '시작일을 선택해 주세요.'; end if;
  if p_start_date < minimum_start then raise exception '시작일은 익일부터 선택할 수 있습니다.'; end if;

  select * into v_admin from public.profiles
  where role = 'admin' and approval_status = 'approved' and active
  order by approved_at nulls last limit 1;
  if v_admin.id is null then raise exception '승인된 관리자 계정을 찾을 수 없습니다.'; end if;

  calculated_end := p_start_date + (p_operation_days - 1);
  supply := p_daily_shots::bigint * p_operation_days::bigint * unit_price::bigint;
  vat := round(supply * 0.1);
  order_prefix := case p_program_type
    when 'spark' then 'SPK'
    when 'spark_plus' then 'SPP'
    when 'spark_s' then 'SPS'
    when 'spark_s_plus' then 'SPSP'
  end;
  order_number := order_prefix || '-' || to_char(local_today, 'YYYYMMDD') || '-' || lpad(nextval('public.order_number_seq')::text, 6, '0');

  insert into public.orders (
    order_number, created_by, creator_username, sponsor_id, sponsor_username, creator_group_name,
    program_type, place_url, mid, store_name, keyword, daily_shots, operation_days, price_per_shot,
    supply_amount, vat_amount, total_amount, start_date, end_date, memo
  ) values (
    order_number, member.id, member.username, member.sponsor_id, member.sponsor_username, member.group_name,
    p_program_type, trim(p_place_url), p_mid, trim(p_store_name), trim(p_keyword), p_daily_shots, p_operation_days, unit_price,
    supply, vat, supply + vat, p_start_date, calculated_end, coalesce(p_memo, '')
  ) returning * into result;

  v_payer := member;
  loop
    if v_payer.sponsor_id is null then
      v_payee := v_admin;
    else
      select * into v_payee from public.profiles where id = v_payer.sponsor_id;
      if v_payee.id is null or v_payee.approval_status <> 'approved' or not v_payee.active then
        raise exception '정산 계정 정보를 확인할 수 없습니다.';
      end if;
    end if;

    v_unit_price := case p_program_type
      when 'spark' then coalesce(v_payer.spark_price_per_shot, v_payer.price_per_shot, 0)
      when 'spark_plus' then coalesce(v_payer.spark_plus_price_per_shot, 0)
      when 'spark_s' then coalesce(v_payer.spark_s_price_per_shot, 0)
      when 'spark_s_plus' then coalesce(v_payer.spark_s_plus_price_per_shot, 0)
    end;
    if v_unit_price <= 0 then raise exception '% 회원의 대상 프로그램 단가를 확인해 주세요.', v_payer.username; end if;
    v_step_supply := p_daily_shots::bigint * p_operation_days::bigint * v_unit_price::bigint;
    v_step_vat := round(v_step_supply * 0.1);

    insert into public.payment_steps (
      order_id, order_number, store_name, step_order,
      payer_id, payer_username, payee_id, payee_username,
      unit_price, supply_amount, vat_amount, total_amount
    ) values (
      result.id, result.order_number, result.store_name, v_step,
      v_payer.id, v_payer.username, v_payee.id, v_payee.username,
      v_unit_price, v_step_supply, v_step_vat, v_step_supply + v_step_vat
    );

    exit when v_payee.role = 'admin';
    v_payer := v_payee;
    v_step := v_step + 1;
    if v_step > 25 then raise exception '정산 계층이 너무 깊습니다.'; end if;
  end loop;

  insert into public.notifications (user_id, title, message, order_id)
  values (member.id, '작업 접수 완료', trim(p_store_name) || ' 작업이 입금대기 상태로 접수되었습니다.', result.id);

  if member.sponsor_id is not null then
    insert into public.notifications (user_id, title, message, order_id)
    values (member.sponsor_id, '하위 대행사 작업 접수', member.username || ' 회원이 ' || trim(p_store_name) || ' 작업을 접수했습니다.', result.id);
  end if;

  perform public.notify_admins(
    '새 작업 접수',
    member.username || ' 회원이 ' || trim(p_store_name) || ' 작업을 접수했습니다. 프로그램: ' || p_program_type
      || ', 정산: ' || case when member.sponsor_id is null then '관리자 직결' else coalesce(member.sponsor_username, '-') end
      || ', 관리담당: ' || coalesce(member.manager_username, '-')
      || ', 그룹: ' || coalesce(nullif(member.group_name, ''), '-'),
    result.id
  );

  return result;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.write_audit_log(p_action text, p_entity_type text, p_entity_id uuid, p_entity_label text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor_id uuid := auth.uid();
  v_actor_username text := 'system';
  v_actor_role public.member_role;
begin
  if v_actor_id is not null then
    select p.username, p.role into v_actor_username, v_actor_role
    from public.profiles p where p.id = v_actor_id;
    v_actor_username := coalesce(v_actor_username, 'unknown');
  end if;

  insert into public.audit_logs (
    actor_id, actor_username, actor_role, action, entity_type, entity_id, entity_label, metadata
  ) values (
    v_actor_id, v_actor_username, v_actor_role, p_action, p_entity_type, p_entity_id,
    coalesce(p_entity_label, ''), coalesce(p_metadata, '{}'::jsonb)
  );
exception when others then
  raise warning '감사 기록 저장 실패: %', sqlerrm;
end;
$function$
;
create trigger payment_program before insert on public.payment_steps for each row execute function public.set_payment_step_program_snapshot_v99();
create trigger order_audit after insert or update on public.orders for each row execute function public.audit_orders_trigger();
insert into public.app_schema_versions(version,description) values ('v10.5.0','Test fixture');
grant usage on schema public, auth to authenticated, anon;
