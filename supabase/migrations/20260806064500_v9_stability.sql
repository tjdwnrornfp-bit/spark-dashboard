-- SPARK v9 stability update
-- Existing v8.6 production databases: run this file once in Supabase SQL Editor.
-- This migration preserves profiles, orders, payment steps, notifications and notices.

begin;

-- 1. Schema version and recoverable order archive
create table if not exists public.app_schema_versions (
  version text primary key,
  description text not null,
  applied_at timestamptz not null default now()
);

alter table public.orders add column if not exists archived_at timestamptz;
alter table public.orders add column if not exists archived_by uuid references public.profiles(id) on delete set null;
alter table public.orders add column if not exists archive_reason text not null default '';
alter table public.orders add column if not exists lock_version integer not null default 1;

update public.orders set lock_version = 1 where lock_version is null or lock_version < 1;

create index if not exists orders_active_program_created_idx
  on public.orders(program_type, created_at desc) where archived_at is null;
create index if not exists orders_archived_created_idx
  on public.orders(archived_at desc) where archived_at is not null;
create index if not exists orders_lock_version_idx on public.orders(id, lock_version);

-- 2. Immutable audit trail for critical changes
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor_id uuid references public.profiles(id) on delete set null,
  actor_username text not null default 'system',
  actor_role public.member_role,
  action text not null,
  entity_type text not null check (entity_type in ('order', 'member', 'payment', 'system')),
  entity_id uuid,
  entity_label text not null default '',
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists audit_logs_created_idx on public.audit_logs(created_at desc);
create index if not exists audit_logs_entity_idx on public.audit_logs(entity_type, entity_id, created_at desc);
create index if not exists audit_logs_actor_idx on public.audit_logs(actor_id, created_at desc);

alter table public.audit_logs enable row level security;
drop policy if exists "audit logs admin read" on public.audit_logs;
create policy "audit logs admin read" on public.audit_logs
for select to authenticated using (public.is_admin());
grant select on public.audit_logs to authenticated;
revoke insert, update, delete on public.audit_logs from authenticated, anon;

create or replace function public.write_audit_log(
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_entity_label text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

revoke all on function public.write_audit_log(text, text, uuid, text, jsonb) from public, anon, authenticated;

create or replace function public.audit_orders_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

create or replace function public.audit_profiles_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text;
  v_metadata jsonb;
begin
  if tg_op = 'INSERT' then
    v_action := 'member.created';
    v_metadata := jsonb_build_object('approval', new.approval_status, 'sponsor', coalesce(new.sponsor_username, '관리자 직속'));
  elsif old.approval_status is distinct from new.approval_status
     or old.role is distinct from new.role
     or old.active is distinct from new.active
     or old.spark_price_per_shot is distinct from new.spark_price_per_shot
     or old.spark_plus_price_per_shot is distinct from new.spark_plus_price_per_shot
     or old.spark_s_price_per_shot is distinct from new.spark_s_price_per_shot
     or old.group_name is distinct from new.group_name then
    v_action := 'member.updated';
    v_metadata := jsonb_build_object(
      'approval', new.approval_status,
      'role', new.role,
      'active', new.active,
      'spark', new.spark_price_per_shot,
      'spark_plus', new.spark_plus_price_per_shot,
      'spark_s', new.spark_s_price_per_shot
    );
  elsif old.bank is distinct from new.bank
     or old.account_number is distinct from new.account_number
     or old.account_holder is distinct from new.account_holder then
    v_action := 'member.account_updated';
    v_metadata := jsonb_build_object('bank', new.bank, 'holder', new.account_holder);
  else
    return new;
  end if;

  perform public.write_audit_log(v_action, 'member', new.id, new.username, v_metadata);
  return new;
end;
$$;

create or replace function public.audit_payment_steps_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.confirmed_at is null and new.confirmed_at is not null then
    perform public.write_audit_log(
      'payment.confirmed', 'payment', new.id, new.order_number || ' ' || new.store_name,
      jsonb_build_object('step', new.step_order, 'payer', new.payer_username, 'payee', new.payee_username, 'amount', new.total_amount)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists audit_orders_changes on public.orders;
create trigger audit_orders_changes after insert or update on public.orders
for each row execute function public.audit_orders_trigger();

drop trigger if exists audit_profiles_changes on public.profiles;
create trigger audit_profiles_changes after insert or update on public.profiles
for each row execute function public.audit_profiles_trigger();

drop trigger if exists audit_payment_steps_changes on public.payment_steps;
create trigger audit_payment_steps_changes after update on public.payment_steps
for each row execute function public.audit_payment_steps_trigger();

-- 3. Optimistic locking and guarded status transitions
create or replace function public.is_valid_order_transition(
  p_old public.order_status,
  p_new public.order_status
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_old = p_new or case p_old
    when '입금대기' then p_new in ('구동중', '정지')
    when '입금완료' then p_new in ('구동중', '정지')
    when '구동중' then p_new in ('정지', '만료')
    when '정지' then p_new in ('입금대기', '구동중', '만료')
    when '만료' then p_new in ('정지')
    else false
  end;
$$;

create or replace function public.set_order_status_v9(
  p_order_id uuid,
  p_status public.order_status,
  p_expected_version integer,
  p_reason text
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles;
  v_order public.orders;
  v_result public.orders;
begin
  select * into v_actor from public.profiles where id = auth.uid();
  if v_actor.id is null or v_actor.role is distinct from 'admin' or not v_actor.active then raise exception '관리자만 상태를 변경할 수 있습니다.'; end if;
  if char_length(trim(coalesce(p_reason, ''))) < 2 then raise exception '상태 변경 사유를 2자 이상 입력해 주세요.'; end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then raise exception '작업을 찾을 수 없습니다.'; end if;
  if v_order.archived_at is not null then raise exception '보관된 작업은 상태를 변경할 수 없습니다.'; end if;
  if v_order.lock_version <> p_expected_version then raise exception '다른 사용자가 먼저 작업을 변경했습니다. 새로고침 후 다시 시도해 주세요.'; end if;
  if not public.is_valid_order_transition(v_order.status, p_status) then
    raise exception '허용되지 않는 상태 변경입니다: % → %', v_order.status, p_status;
  end if;

  if p_status = '입금완료' and exists (
    select 1 from public.payment_steps ps where ps.order_id = p_order_id and ps.confirmed_at is null
  ) then
    raise exception '입금완료는 정산 단계가 모두 확인된 후에만 처리할 수 있습니다.';
  end if;
  if p_status = '입금대기' and exists (
    select 1 from public.payment_steps ps where ps.order_id = p_order_id and ps.confirmed_at is not null
  ) then
    raise exception '이미 확인된 정산 단계가 있어 입금대기로 되돌릴 수 없습니다.';
  end if;

  perform set_config('spark.change_reason', trim(p_reason), true);
  update public.orders
  set status = p_status,
      activated_at = case
        when p_status = '구동중' and v_order.status <> '구동중' then now()
        when p_status in ('입금대기', '입금완료') then null
        else v_order.activated_at
      end,
      stopped_at = case when p_status = '정지' then now() else null end,
      payment_notified_at = case when p_status = '입금완료' then coalesce(v_order.payment_notified_at, now()) else v_order.payment_notified_at end,
      lock_version = v_order.lock_version + 1
  where id = p_order_id
  returning * into v_result;

  insert into public.notifications (user_id, title, message, order_id)
  values (
    v_result.created_by,
    case p_status when '구동중' then '작업 구동 시작' when '정지' then '작업 정지' when '만료' then '작업 기간 만료' else '작업 상태 변경' end,
    v_result.store_name || ' 작업 상태가 ' || p_status::text || '(으)로 변경되었습니다.',
    v_result.id
  );

  return v_result;
end;
$$;

revoke all on function public.set_order_status_v9(uuid, public.order_status, integer, text) from public, anon;
grant execute on function public.set_order_status_v9(uuid, public.order_status, integer, text) to authenticated;

-- Backward-compatible v8 RPC now uses the guarded v9 transition.
create or replace function public.set_order_status(p_order_id uuid, p_status public.order_status)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version integer;
  v_result public.orders;
begin
  select lock_version into v_version from public.orders where id = p_order_id;
  select * into v_result from public.set_order_status_v9(p_order_id, p_status, v_version, 'v8 호환 상태 변경');
  return v_result;
end;
$$;

-- 4. Soft archive and admin restore
create or replace function public.archive_order(
  p_order_id uuid,
  p_expected_version integer,
  p_reason text
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles;
  v_order public.orders;
  v_result public.orders;
begin
  select * into v_actor from public.profiles where id = auth.uid();
  select * into v_order from public.orders where id = p_order_id for update;
  if v_actor.id is null or v_order.id is null then raise exception '작업을 찾을 수 없습니다.'; end if;
  if v_actor.approval_status is distinct from 'approved' or not v_actor.active or v_actor.role is null then raise exception '활성 승인 회원만 작업을 보관할 수 있습니다.'; end if;
  if v_order.archived_at is not null then return v_order; end if;
  if v_order.lock_version <> p_expected_version then raise exception '다른 사용자가 먼저 작업을 변경했습니다. 새로고침 후 다시 시도해 주세요.'; end if;
  if char_length(trim(coalesce(p_reason, ''))) < 2 then raise exception '보관 사유를 2자 이상 입력해 주세요.'; end if;

  if v_actor.role is distinct from 'admin' then
    if v_order.created_by is distinct from v_actor.id then raise exception '본인이 접수한 작업만 보관할 수 있습니다.'; end if;
    if v_order.status not in ('입금대기', '정지', '만료') then raise exception '입금대기, 정지, 만료 상태에서만 보관할 수 있습니다.'; end if;
    if exists (select 1 from public.payment_steps ps where ps.order_id = v_order.id and ps.confirmed_at is not null) then
      raise exception '입금확인 이력이 있는 작업은 관리자에게 보관을 요청해 주세요.';
    end if;
  end if;

  perform set_config('spark.change_reason', trim(p_reason), true);
  update public.orders
  set archived_at = now(), archived_by = v_actor.id, archive_reason = trim(p_reason), lock_version = v_order.lock_version + 1
  where id = p_order_id
  returning * into v_result;
  return v_result;
end;
$$;

create or replace function public.restore_order(
  p_order_id uuid,
  p_expected_version integer,
  p_reason text
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles;
  v_order public.orders;
  v_result public.orders;
begin
  select * into v_actor from public.profiles where id = auth.uid();
  if v_actor.id is null or v_actor.role is distinct from 'admin' or not v_actor.active then raise exception '관리자만 작업을 복원할 수 있습니다.'; end if;
  if char_length(trim(coalesce(p_reason, ''))) < 2 then raise exception '복원 사유를 2자 이상 입력해 주세요.'; end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then raise exception '작업을 찾을 수 없습니다.'; end if;
  if v_order.archived_at is null then return v_order; end if;
  if v_order.lock_version <> p_expected_version then raise exception '다른 사용자가 먼저 작업을 변경했습니다. 새로고침 후 다시 시도해 주세요.'; end if;

  perform set_config('spark.change_reason', trim(p_reason), true);
  update public.orders
  set archived_at = null, archived_by = null, archive_reason = '', lock_version = v_order.lock_version + 1
  where id = p_order_id
  returning * into v_result;
  return v_result;
end;
$$;

revoke all on function public.archive_order(uuid, integer, text) from public, anon;
revoke all on function public.restore_order(uuid, integer, text) from public, anon;
grant execute on function public.archive_order(uuid, integer, text) to authenticated;
grant execute on function public.restore_order(uuid, integer, text) to authenticated;

-- v8 delete RPC is retained as a soft-archive compatibility wrapper.
create or replace function public.delete_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version integer;
begin
  select lock_version into v_version from public.orders where id = p_order_id;
  perform public.archive_order(p_order_id, v_version, 'v8 호환 보관 처리');
end;
$$;

-- 5. Member review with concurrent edit and child price protection
create or replace function public.review_member_v9(
  p_member_id uuid,
  p_role public.member_role,
  p_spark_price_per_shot integer,
  p_spark_plus_price_per_shot integer,
  p_spark_s_price_per_shot integer,
  p_approval_status public.approval_status,
  p_group_name text,
  p_expected_updated_at timestamptz
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles;
  v_target public.profiles;
  v_result public.profiles;
begin
  select * into v_actor from public.profiles where id = auth.uid();
  select * into v_target from public.profiles where id = p_member_id for update;
  if v_actor.id is null or v_target.id is null then raise exception '회원 정보를 찾을 수 없습니다.'; end if;
  if v_actor.approval_status is distinct from 'approved' or not v_actor.active or v_actor.role is null then raise exception '회원 관리 권한이 없습니다.'; end if;
  if v_target.updated_at is distinct from p_expected_updated_at then raise exception '다른 사용자가 먼저 회원 정보를 변경했습니다. 새로고침 후 다시 시도해 주세요.'; end if;
  if v_actor.role is distinct from 'admin' and v_target.sponsor_id is distinct from v_actor.id then raise exception '직접 추천한 회원만 관리할 수 있습니다.'; end if;

  if p_approval_status = 'approved' and (
    p_spark_price_per_shot < 1 or p_spark_plus_price_per_shot < 1 or p_spark_s_price_per_shot < 1
  ) then raise exception '세 프로그램 단가를 모두 1원 이상 입력해 주세요.'; end if;

  if v_actor.role is distinct from 'admin' and p_approval_status = 'approved' and (
    p_spark_price_per_shot <= coalesce(v_actor.spark_price_per_shot, v_actor.price_per_shot, 0)
    or p_spark_plus_price_per_shot <= coalesce(v_actor.spark_plus_price_per_shot, 0)
    or p_spark_s_price_per_shot <= coalesce(v_actor.spark_s_price_per_shot, 0)
  ) then raise exception '하위 회원의 각 프로그램 단가는 내 단가보다 높아야 합니다.'; end if;

  if p_approval_status = 'approved' and exists (
    select 1 from public.profiles c
    where c.sponsor_id = v_target.id and c.approval_status = 'approved' and c.active
      and (
        c.spark_price_per_shot <= p_spark_price_per_shot
        or c.spark_plus_price_per_shot <= p_spark_plus_price_per_shot
        or c.spark_s_price_per_shot <= p_spark_s_price_per_shot
      )
  ) then raise exception '기존 하위 회원 단가보다 높거나 같은 값으로 변경할 수 없습니다.'; end if;

  update public.profiles
  set role = case when v_target.sponsor_id is not null then 'agency'::public.member_role else p_role end,
      approval_status = p_approval_status,
      active = (p_approval_status = 'approved'),
      approved_at = case when p_approval_status = 'approved' then coalesce(v_target.approved_at, now()) else v_target.approved_at end,
      group_name = case when v_target.sponsor_id is not null
        then coalesce((select group_name from public.profiles where id = v_target.sponsor_id), v_target.group_name)
        else coalesce(nullif(trim(p_group_name), ''), v_target.group_name) end,
      price_per_shot = case when p_approval_status = 'approved' then p_spark_price_per_shot else price_per_shot end,
      spark_price_per_shot = case when p_approval_status = 'approved' then p_spark_price_per_shot else spark_price_per_shot end,
      spark_plus_price_per_shot = case when p_approval_status = 'approved' then p_spark_plus_price_per_shot else spark_plus_price_per_shot end,
      spark_s_price_per_shot = case when p_approval_status = 'approved' then p_spark_s_price_per_shot else spark_s_price_per_shot end,
      updated_at = now()
  where id = p_member_id
  returning * into v_result;

  insert into public.notifications (user_id, title, message)
  values (
    v_result.id,
    case when p_approval_status = 'approved' then '회원가입 승인 완료' else '회원가입 반려' end,
    case when p_approval_status = 'approved'
      then '승인되었습니다. 스파크 ' || p_spark_price_per_shot || '원 / 스파크+ ' || p_spark_plus_price_per_shot || '원 / 스파크S ' || p_spark_s_price_per_shot || '원입니다.'
      else '회원가입 신청이 반려되었습니다.' end
  );
  return v_result;
end;
$$;

revoke all on function public.review_member_v9(uuid, public.member_role, integer, integer, integer, public.approval_status, text, timestamptz) from public, anon;
grant execute on function public.review_member_v9(uuid, public.member_role, integer, integer, integer, public.approval_status, text, timestamptz) to authenticated;

create or replace function public.review_member_v8(
  p_member_id uuid,
  p_role public.member_role,
  p_spark_price_per_shot integer,
  p_spark_plus_price_per_shot integer,
  p_spark_s_price_per_shot integer,
  p_approval_status public.approval_status,
  p_group_name text default ''
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated_at timestamptz;
  v_result public.profiles;
begin
  select updated_at into v_updated_at from public.profiles where id = p_member_id;
  select * into v_result from public.review_member_v9(
    p_member_id, p_role, p_spark_price_per_shot, p_spark_plus_price_per_shot,
    p_spark_s_price_per_shot, p_approval_status, p_group_name, v_updated_at
  );
  return v_result;
end;
$$;

-- 6. Sequential and idempotent payment confirmation
create or replace function public.confirm_payment_step(p_step_id uuid)
returns public.payment_steps
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles;
  v_step public.payment_steps;
  v_result public.payment_steps;
  v_order public.orders;
  v_pending integer;
  v_was_notified boolean;
begin
  select * into v_actor from public.profiles where id = auth.uid();
  select * into v_step from public.payment_steps where id = p_step_id for update;
  if v_actor.id is null or v_step.id is null then raise exception '정산 내역을 찾을 수 없습니다.'; end if;
  if v_actor.approval_status is distinct from 'approved' or not v_actor.active or v_actor.role is null then raise exception '활성 승인 회원만 입금을 확인할 수 있습니다.'; end if;
  if v_step.payee_id <> v_actor.id then raise exception '입금 확인 권한이 없습니다.'; end if;
  if v_step.confirmed_at is not null then return v_step; end if;

  select * into v_order from public.orders where id = v_step.order_id for update;
  if v_order.archived_at is not null then raise exception '보관된 작업의 입금은 확인할 수 없습니다.'; end if;
  if exists (
    select 1 from public.payment_steps ps
    where ps.order_id = v_step.order_id and ps.step_order < v_step.step_order and ps.confirmed_at is null
  ) then raise exception '이전 정산 단계의 입금 확인이 먼저 필요합니다.'; end if;

  update public.payment_steps
  set confirmed_at = now(), confirmed_by = v_actor.id
  where id = p_step_id
  returning * into v_result;

  select count(*) into v_pending from public.payment_steps
  where order_id = v_step.order_id and confirmed_at is null;

  if v_pending = 0 then
    v_was_notified := v_order.payment_notified_at is not null;
    perform set_config('spark.change_reason', '최종 정산 확인 완료', true);
    update public.orders
    set status = case when status = '입금대기' then '입금완료'::public.order_status else status end,
        payment_notified_at = coalesce(payment_notified_at, now()),
        lock_version = lock_version + 1
    where id = v_step.order_id
    returning * into v_order;

    if not v_was_notified then
      insert into public.notifications (user_id, title, message, order_id)
      values (v_order.created_by, '전체 입금 확인 완료', v_order.store_name || ' 작업의 입금 확인이 완료되었습니다.', v_order.id);
      perform public.notify_admins('작업 입금완료', v_order.creator_username || ' 회원의 ' || v_order.store_name || ' 작업이 입금완료 처리되었습니다.', v_order.id);
    end if;
  end if;
  return v_result;
end;
$$;

-- 7. Cron excludes archived orders and increments optimistic lock version
create or replace function public.start_paid_orders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target public.orders;
  v_changed integer := 0;
begin
  for v_target in
    select * from public.orders
    where archived_at is null
      and status = '입금완료'
      and start_date <= (now() at time zone 'Asia/Seoul')::date
      and end_date >= (now() at time zone 'Asia/Seoul')::date
    for update
  loop
    perform set_config('spark.change_reason', '시작일 자정 자동 구동', true);
    update public.orders
    set status = '구동중', activated_at = coalesce(activated_at, now()), lock_version = lock_version + 1
    where id = v_target.id;
    insert into public.notifications (user_id, title, message, order_id)
    values (v_target.created_by, '구동 자동 시작', v_target.store_name || ' 작업이 시작일 자정 기준으로 구동중으로 변경되었습니다.', v_target.id);
    v_changed := v_changed + 1;
  end loop;
  return v_changed;
end;
$$;

create or replace function public.expire_finished_orders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target public.orders;
  v_changed integer := 0;
begin
  for v_target in
    select * from public.orders
    where archived_at is null
      and status in ('입금완료', '구동중', '정지')
      and end_date < (now() at time zone 'Asia/Seoul')::date
    for update
  loop
    perform set_config('spark.change_reason', '종료일 경과 자동 만료', true);
    update public.orders set status = '만료', lock_version = lock_version + 1 where id = v_target.id;
    insert into public.notifications (user_id, title, message, order_id)
    values (v_target.created_by, '작업 기간 만료', v_target.store_name || ' 작업이 종료일 경과로 만료 처리되었습니다.', v_target.id);
    v_changed := v_changed + 1;
  end loop;
  return v_changed;
end;
$$;

-- 8. Admin health check
create or replace function public.get_operations_health()
returns table (
  schema_version text,
  active_admins bigint,
  active_orders bigint,
  archived_orders bigint,
  orders_without_payment_steps bigint,
  invalid_payment_states bigint,
  inactive_cron_jobs bigint,
  checked_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inactive_cron bigint := 2;
begin
  if not public.is_admin() then raise exception '관리자만 운영 상태를 확인할 수 있습니다.'; end if;

  if to_regclass('cron.job') is not null then
    execute $q$
      select count(*) from (values ('spark-start-paid-orders'), ('spark-expire-finished-orders')) expected(jobname)
      where not exists (
        select 1 from cron.job j where j.jobname = expected.jobname and j.active = true
      )
    $q$ into v_inactive_cron;
  end if;

  return query
  select
    coalesce((select version from public.app_schema_versions order by applied_at desc limit 1), 'unknown'),
    (select count(*) from public.profiles where role = 'admin' and approval_status = 'approved' and active),
    (select count(*) from public.orders where archived_at is null),
    (select count(*) from public.orders where archived_at is not null),
    (select count(*) from public.orders o where o.archived_at is null and not exists (select 1 from public.payment_steps ps where ps.order_id = o.id)),
    (select count(*) from public.orders o where o.archived_at is null and (
      (o.status = '입금대기' and exists (select 1 from public.payment_steps ps where ps.order_id = o.id) and not exists (select 1 from public.payment_steps ps where ps.order_id = o.id and ps.confirmed_at is null))
      or (o.status <> '입금대기' and exists (select 1 from public.payment_steps ps where ps.order_id = o.id and ps.confirmed_at is null))
    )),
    v_inactive_cron,
    now();
end;
$$;

revoke all on function public.get_operations_health() from public, anon;
grant execute on function public.get_operations_health() to authenticated;

-- Realtime audit feed for the admin operations page.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'audit_logs'
  ) then
    alter publication supabase_realtime add table public.audit_logs;
  end if;
end $$;

insert into public.app_schema_versions(version, description)
values ('v9.0.0', 'Soft archive, audit trail, optimistic locking, guarded settlement and operations health')
on conflict (version) do nothing;

select public.write_audit_log('system.migration', 'system', null, 'SPARK v9.0.0', jsonb_build_object('description', 'stability update'));

commit;
