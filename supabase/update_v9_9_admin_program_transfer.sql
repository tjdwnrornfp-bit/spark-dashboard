-- SPARK v9.9 admin order program transfer
-- Preserves confirmed settlement history and rebuilds only unpaid obligations.

begin;

do $$
begin
  if to_regclass('public.orders') is null
     or to_regclass('public.payment_steps') is null
     or to_regclass('public.audit_logs') is null
     or to_regclass('public.settlement_quotes') is null
     or to_regclass('public.settlement_quote_items') is null
     or to_regclass('public.settlement_batch_items') is null
     or to_regclass('public.app_schema_versions') is null
     or to_regprocedure('public.get_admin_company_overview_v96(integer,integer,text,text)') is null then
    raise exception 'SPARK v9.6.0까지 먼저 적용되어 있어야 합니다.';
  end if;
end $$;

-- 1. Transfer state, immutable transfer records, and payment-step snapshots.
alter table public.orders add column if not exists program_transfer_state text not null default 'none';
alter table public.orders add column if not exists program_transfer_difference bigint not null default 0;
alter table public.orders add column if not exists last_program_transfer_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_program_transfer_state_check') then
    alter table public.orders
      add constraint orders_program_transfer_state_check
      check (program_transfer_state in ('none', 'payment_pending'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_program_transfer_difference_check') then
    alter table public.orders
      add constraint orders_program_transfer_difference_check
      check (program_transfer_state = 'payment_pending' or program_transfer_difference = 0);
  end if;
end $$;

create table if not exists public.order_program_transfers (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  before_program text not null check (before_program in ('spark', 'spark_plus', 'spark_s')),
  after_program text not null check (after_program in ('spark', 'spark_plus', 'spark_s')),
  before_unit_price integer not null check (before_unit_price >= 0),
  after_unit_price integer not null check (after_unit_price > 0),
  before_supply_amount bigint not null check (before_supply_amount >= 0),
  after_supply_amount bigint not null check (after_supply_amount >= 0),
  before_vat_amount bigint not null check (before_vat_amount >= 0),
  after_vat_amount bigint not null check (after_vat_amount >= 0),
  before_total_amount bigint not null check (before_total_amount >= 0),
  after_total_amount bigint not null check (after_total_amount >= 0),
  difference bigint not null,
  confirmed_payment_count integer not null check (confirmed_payment_count >= 0),
  settlement_mode text not null check (settlement_mode in ('rebuild', 'adjustment')),
  before_status public.order_status not null,
  after_status public.order_status not null,
  actor_id uuid not null references public.profiles(id),
  actor_username text not null,
  reason text not null check (char_length(trim(reason)) between 2 and 500),
  created_at timestamptz not null default now()
);

create index if not exists order_program_transfers_order_idx
  on public.order_program_transfers(order_id, created_at desc);
create index if not exists order_program_transfers_actor_idx
  on public.order_program_transfers(actor_id, created_at desc);

alter table public.order_program_transfers enable row level security;
drop policy if exists "order program transfers admin read" on public.order_program_transfers;
create policy "order program transfers admin read" on public.order_program_transfers
for select to authenticated using (public.is_admin());
grant select on public.order_program_transfers to authenticated;
revoke insert, update, delete on public.order_program_transfers from authenticated, anon;

alter table public.payment_steps add column if not exists program_type text;
alter table public.payment_steps add column if not exists step_kind text not null default 'standard';
alter table public.payment_steps add column if not exists program_transfer_id uuid references public.order_program_transfers(id);

update public.payment_steps ps
set program_type = o.program_type
from public.orders o
where o.id = ps.order_id and ps.program_type is null;

create or replace function public.set_payment_step_program_snapshot_v99()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.program_type is null then
    select o.program_type into new.program_type
    from public.orders o where o.id = new.order_id;
  end if;
  return new;
end;
$$;

drop trigger if exists set_payment_step_program_snapshot_v99 on public.payment_steps;
create trigger set_payment_step_program_snapshot_v99
before insert on public.payment_steps
for each row execute function public.set_payment_step_program_snapshot_v99();

alter table public.payment_steps alter column program_type set not null;
alter table public.payment_steps drop constraint if exists payment_steps_step_order_check;
alter table public.payment_steps
  add constraint payment_steps_step_order_check check (step_order between 1 and 100);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'payment_steps_program_type_check') then
    alter table public.payment_steps
      add constraint payment_steps_program_type_check
      check (program_type in ('spark', 'spark_plus', 'spark_s'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'payment_steps_step_kind_check') then
    alter table public.payment_steps
      add constraint payment_steps_step_kind_check
      check (step_kind in ('standard', 'program_adjustment'));
  end if;
end $$;

create index if not exists payment_steps_program_transfer_idx
  on public.payment_steps(program_transfer_id, step_order)
  where program_transfer_id is not null;

revoke all on function public.set_payment_step_program_snapshot_v99() from public, anon, authenticated;

-- 2. Approved current price helper. It deliberately ignores order/admin snapshots.
create or replace function public.get_approved_program_price_v99(
  p_profile_id uuid,
  p_program_type text
)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case p_program_type
      when 'spark' then coalesce(p.spark_price_per_shot, p.price_per_shot, 0)
      when 'spark_plus' then coalesce(p.spark_plus_price_per_shot, 0)
      when 'spark_s' then coalesce(p.spark_s_price_per_shot, 0)
      else 0
    end
    from public.profiles p
    where p.id = p_profile_id
      and p.approval_status = 'approved'
      and p.active
      and p.role is not null
  ), 0)::integer;
$$;

revoke all on function public.get_approved_program_price_v99(uuid, text) from public, anon, authenticated;

-- 3. Server-computed preview used by the confirmation modal and execution RPC.
create or replace function public.preview_order_program_transfer_v99(
  p_order_id uuid,
  p_target_program text,
  p_expected_version integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles;
  v_order public.orders;
  v_chain record;
  v_target_unit integer := 0;
  v_after_supply bigint := 0;
  v_after_vat bigint := 0;
  v_after_total bigint := 0;
  v_difference bigint := 0;
  v_confirmed_count integer := 0;
  v_pending_count integer := 0;
  v_step_count integer := 0;
  v_chain_count integer := 0;
  v_payer_unit integer := 0;
  v_chain_supply bigint := 0;
  v_chain_vat bigint := 0;
  v_paid_supply bigint := 0;
  v_paid_vat bigint := 0;
  v_block_reason text;
  v_settlement_mode text;
  v_settlement_impact text;
  v_after_status public.order_status;
  v_has_outstanding boolean := false;
begin
  select * into v_actor from public.profiles where id = auth.uid();
  if v_actor.id is null or v_actor.role is distinct from 'admin' or not v_actor.active or v_actor.approval_status is distinct from 'approved' then
    raise exception '관리자만 작업 프로그램을 변경할 수 있습니다.';
  end if;

  select * into v_order from public.orders where id = p_order_id;
  if v_order.id is null then raise exception '작업을 찾을 수 없습니다.'; end if;

  select
    count(*),
    count(*) filter (where ps.confirmed_at is not null),
    count(*) filter (where ps.confirmed_at is null)
  into v_step_count, v_confirmed_count, v_pending_count
  from public.payment_steps ps
  where ps.order_id = v_order.id;

  v_target_unit := public.get_approved_program_price_v99(v_order.created_by, p_target_program);
  v_after_supply := v_order.daily_shots::bigint * v_order.operation_days::bigint * v_target_unit::bigint;
  v_after_vat := round(v_after_supply * 0.1);
  v_after_total := v_after_supply + v_after_vat;
  v_difference := v_after_total - v_order.total_amount;
  v_settlement_mode := case when v_confirmed_count = 0 then 'rebuild' else 'adjustment' end;
  v_after_status := v_order.status;

  if p_target_program is null or p_target_program not in ('spark', 'spark_plus', 'spark_s') then
    v_block_reason := '지원하지 않는 프로그램입니다.';
  elsif v_order.archived_at is not null then
    v_block_reason := '보관된 작업은 복원한 뒤 프로그램을 변경해 주세요.';
  elsif v_order.program_type = p_target_program then
    v_block_reason := '현재 프로그램과 변경 대상이 같습니다.';
  elsif p_expected_version is not null and v_order.lock_version <> p_expected_version then
    v_block_reason := '다른 사용자가 먼저 작업을 변경했습니다. 새로고침 후 다시 시도해 주세요.';
  elsif v_target_unit <= 0 then
    v_block_reason := '등록자의 변경 대상 프로그램 현재 승인 단가가 0원이거나 설정되지 않았습니다.';
  elsif v_step_count = 0 then
    v_block_reason := '안전하게 재구성할 정산 체인을 찾을 수 없습니다.';
  elsif v_confirmed_count > 0 and v_difference < 0 then
    v_block_reason := '확인된 정산이 있어 차감 또는 환불이 필요한 하향 변경은 자동 처리할 수 없습니다. 별도 처리 후 변경해 주세요.';
  end if;

  if v_block_reason is null then
    for v_chain in
      select
        ps.payer_id,
        max(ps.payer_username) as payer_username,
        ps.payee_id,
        max(ps.payee_username) as payee_username,
        min(ps.step_order) as first_step
      from public.payment_steps ps
      where ps.order_id = v_order.id
      group by ps.payer_id, ps.payee_id
      order by min(ps.step_order), ps.payer_id, ps.payee_id
    loop
      v_chain_count := v_chain_count + 1;
      v_payer_unit := public.get_approved_program_price_v99(v_chain.payer_id, p_target_program);
      if v_payer_unit <= 0 then
        v_block_reason := v_chain.payer_username || ' 회원의 대상 프로그램 현재 승인 단가가 0원이거나 설정되지 않았습니다.';
        exit;
      end if;
      if not exists (
        select 1 from public.profiles p
        where p.id = v_chain.payee_id and p.approval_status = 'approved' and p.active and p.role is not null
      ) then
        v_block_reason := v_chain.payee_username || ' 정산 수취 계정이 현재 활성 승인 상태가 아닙니다.';
        exit;
      end if;

      v_chain_supply := v_order.daily_shots::bigint * v_order.operation_days::bigint * v_payer_unit::bigint;
      v_chain_vat := round(v_chain_supply * 0.1);
      select
        coalesce(sum(ps.supply_amount), 0),
        coalesce(sum(ps.vat_amount), 0)
      into v_paid_supply, v_paid_vat
      from public.payment_steps ps
      where ps.order_id = v_order.id
        and ps.payer_id = v_chain.payer_id
        and ps.payee_id = v_chain.payee_id
        and ps.confirmed_at is not null;

      if v_confirmed_count > 0 and (v_paid_supply > v_chain_supply or v_paid_vat > v_chain_vat) then
        v_block_reason := v_chain.payer_username || ' 정산 단계에 과납이 발생해 차감 또는 환불을 별도로 처리해야 합니다.';
        exit;
      end if;
      if v_chain_supply > v_paid_supply or v_chain_vat > v_paid_vat then
        v_has_outstanding := true;
      end if;
    end loop;

    if v_block_reason is null and v_chain_count = 0 then
      v_block_reason := '안전하게 재구성할 정산 참여자 체인이 없습니다.';
    end if;
  end if;

  if v_order.status = '입금완료' and v_has_outstanding then
    v_after_status := '입금대기';
  end if;

  if v_settlement_mode = 'rebuild' then
    v_settlement_impact := '확인된 입금이 없어 기존 미확인 단계를 대상 프로그램 현재 단가 기준으로 모두 다시 만듭니다.';
  else
    v_settlement_impact := '확인된 금액과 배치 이력은 유지하고, 참여자별 새 목표 공급가·VAT에서 확인액을 뺀 잔액만 보정 단계로 추가합니다.';
  end if;
  if v_order.status = '입금완료' and v_has_outstanding then
    v_settlement_impact := v_settlement_impact || ' 추가금 확인 전까지 주문 상태는 입금대기로 전환됩니다.';
  elsif v_order.status = '구동중' then
    v_settlement_impact := v_settlement_impact || ' 현재 구동은 중단하지 않고 변경 정산만 별도로 표시합니다.';
  elsif v_order.status in ('정지', '만료') then
    v_settlement_impact := v_settlement_impact || ' 운영 상태는 유지하고 변경 정산만 별도로 표시합니다.';
  end if;

  return jsonb_build_object(
    'orderDbId', v_order.id,
    'orderNumber', v_order.order_number,
    'currentStatus', v_order.status,
    'afterStatus', v_after_status,
    'beforeProgram', v_order.program_type,
    'afterProgram', p_target_program,
    'beforeUnitPrice', v_order.price_per_shot,
    'afterUnitPrice', v_target_unit,
    'beforeSupplyAmount', v_order.supply_amount,
    'afterSupplyAmount', v_after_supply,
    'beforeVatAmount', v_order.vat_amount,
    'afterVatAmount', v_after_vat,
    'beforeTotalAmount', v_order.total_amount,
    'afterTotalAmount', v_after_total,
    'difference', v_difference,
    'confirmedPaymentCount', v_confirmed_count,
    'pendingPaymentCount', v_pending_count,
    'settlementMode', v_settlement_mode,
    'settlementImpact', v_settlement_impact,
    'keepsOperationRunning', v_order.status = '구동중',
    'expectedVersion', v_order.lock_version,
    'canTransfer', v_block_reason is null,
    'blockedReason', coalesce(v_block_reason, '')
  );
end;
$$;

revoke all on function public.preview_order_program_transfer_v99(uuid, text, integer) from public, anon;
grant execute on function public.preview_order_program_transfer_v99(uuid, text, integer) to authenticated;

-- 4. Atomic transfer with quote expiry, optimistic locking, and per-party adjustments.
create or replace function public.transfer_order_program_v99(
  p_order_id uuid,
  p_target_program text,
  p_expected_version integer,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles;
  v_order public.orders;
  v_result public.orders;
  v_preview jsonb;
  v_transfer public.order_program_transfers;
  v_chain_json jsonb;
  v_chain record;
  v_confirmed_count integer;
  v_next_step integer := 0;
  v_created_steps integer := 0;
  v_unit_price integer;
  v_target_supply bigint;
  v_target_vat bigint;
  v_paid_supply bigint;
  v_paid_vat bigint;
  v_outstanding_supply bigint;
  v_outstanding_vat bigint;
  v_after_status public.order_status;
  v_now timestamptz := now();
begin
  select * into v_actor from public.profiles where id = auth.uid();
  if v_actor.id is null or v_actor.role is distinct from 'admin' or not v_actor.active or v_actor.approval_status is distinct from 'approved' then
    raise exception '관리자만 작업 프로그램을 변경할 수 있습니다.';
  end if;
  if char_length(trim(coalesce(p_reason, ''))) < 2 or char_length(trim(coalesce(p_reason, ''))) > 500 then
    raise exception '프로그램 변경 사유를 2자 이상 500자 이하로 입력해 주세요.';
  end if;

  -- Batch confirmation locks quotes before payment steps, so use the same order.
  perform q.id
  from public.settlement_quotes q
  where exists (
    select 1
    from public.settlement_quote_items qi
    join public.payment_steps ps on ps.id = qi.payment_step_id
    where qi.quote_id = q.id and ps.order_id = p_order_id
  )
  order by q.id
  for update;

  perform ps.id
  from public.payment_steps ps
  where ps.order_id = p_order_id
  order by ps.id
  for update;

  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then raise exception '작업을 찾을 수 없습니다.'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'payer_id', chain.payer_id,
    'payer_username', chain.payer_username,
    'payee_id', chain.payee_id,
    'payee_username', chain.payee_username,
    'first_step', chain.first_step
  ) order by chain.first_step, chain.payer_id, chain.payee_id), '[]'::jsonb)
  into v_chain_json
  from (
    select
      ps.payer_id,
      max(ps.payer_username) as payer_username,
      ps.payee_id,
      max(ps.payee_username) as payee_username,
      min(ps.step_order) as first_step
    from public.payment_steps ps
    where ps.order_id = p_order_id
    group by ps.payer_id, ps.payee_id
  ) chain;

  perform p.id
  from public.profiles p
  where p.id in (
    select x.profile_id
    from (
      select c.payer_id as profile_id
      from jsonb_to_recordset(v_chain_json) as c(payer_id uuid, payee_id uuid)
      union
      select c.payee_id as profile_id
      from jsonb_to_recordset(v_chain_json) as c(payer_id uuid, payee_id uuid)
    ) x
  )
  order by p.id
  for share;

  v_preview := public.preview_order_program_transfer_v99(p_order_id, p_target_program, p_expected_version);
  if not coalesce((v_preview ->> 'canTransfer')::boolean, false) then
    raise exception '%', coalesce(nullif(v_preview ->> 'blockedReason', ''), '프로그램을 변경할 수 없습니다.');
  end if;
  if v_order.lock_version <> p_expected_version then
    raise exception '다른 사용자가 먼저 작업을 변경했습니다. 새로고침 후 다시 시도해 주세요.';
  end if;

  v_confirmed_count := (v_preview ->> 'confirmedPaymentCount')::integer;

  insert into public.order_program_transfers (
    order_id,
    before_program, after_program,
    before_unit_price, after_unit_price,
    before_supply_amount, after_supply_amount,
    before_vat_amount, after_vat_amount,
    before_total_amount, after_total_amount,
    difference, confirmed_payment_count, settlement_mode,
    before_status, after_status,
    actor_id, actor_username, reason, created_at
  ) values (
    v_order.id,
    v_order.program_type, p_target_program,
    v_order.price_per_shot, (v_preview ->> 'afterUnitPrice')::integer,
    v_order.supply_amount, (v_preview ->> 'afterSupplyAmount')::bigint,
    v_order.vat_amount, (v_preview ->> 'afterVatAmount')::bigint,
    v_order.total_amount, (v_preview ->> 'afterTotalAmount')::bigint,
    (v_preview ->> 'difference')::bigint, v_confirmed_count, v_preview ->> 'settlementMode',
    v_order.status, (v_preview ->> 'afterStatus')::public.order_status,
    v_actor.id, v_actor.username, trim(p_reason), v_now
  ) returning * into v_transfer;

  update public.settlement_quotes q
  set status = 'expired'
  where q.status = 'pending'
    and exists (
      select 1
      from public.settlement_quote_items qi
      join public.payment_steps ps on ps.id = qi.payment_step_id
      where qi.quote_id = q.id and ps.order_id = v_order.id and ps.confirmed_at is null
    );

  delete from public.settlement_quote_items qi
  using public.payment_steps ps, public.settlement_quotes q
  where qi.payment_step_id = ps.id
    and qi.quote_id = q.id
    and ps.order_id = v_order.id
    and ps.confirmed_at is null
    and q.status = 'expired';

  delete from public.payment_steps ps
  where ps.order_id = v_order.id and ps.confirmed_at is null;

  select coalesce(max(ps.step_order), 0) into v_next_step
  from public.payment_steps ps where ps.order_id = v_order.id;

  for v_chain in
    select *
    from jsonb_to_recordset(v_chain_json) as c(
      payer_id uuid,
      payer_username text,
      payee_id uuid,
      payee_username text,
      first_step integer
    )
    order by c.first_step, c.payer_id, c.payee_id
  loop
    v_unit_price := public.get_approved_program_price_v99(v_chain.payer_id, p_target_program);
    if v_unit_price <= 0 then
      raise exception '% 회원의 대상 프로그램 현재 승인 단가를 확인할 수 없습니다.', v_chain.payer_username;
    end if;
    v_target_supply := v_order.daily_shots::bigint * v_order.operation_days::bigint * v_unit_price::bigint;
    v_target_vat := round(v_target_supply * 0.1);

    select
      coalesce(sum(ps.supply_amount), 0),
      coalesce(sum(ps.vat_amount), 0)
    into v_paid_supply, v_paid_vat
    from public.payment_steps ps
    where ps.order_id = v_order.id
      and ps.payer_id = v_chain.payer_id
      and ps.payee_id = v_chain.payee_id
      and ps.confirmed_at is not null;

    v_outstanding_supply := v_target_supply - v_paid_supply;
    v_outstanding_vat := v_target_vat - v_paid_vat;
    if v_outstanding_supply < 0 or v_outstanding_vat < 0 then
      raise exception '% 정산 단계에 차감 또는 환불이 필요해 자동 변경할 수 없습니다.', v_chain.payer_username;
    end if;

    if v_outstanding_supply > 0 or v_outstanding_vat > 0 then
      v_next_step := v_next_step + 1;
      if v_next_step > 100 then raise exception '정산 보정 단계가 허용 범위를 초과했습니다.'; end if;

      insert into public.payment_steps (
        order_id, order_number, store_name, program_type, step_kind, program_transfer_id,
        step_order, payer_id, payer_username, payee_id, payee_username,
        unit_price, supply_amount, vat_amount, total_amount, created_at, updated_at
      ) values (
        v_order.id, v_order.order_number, v_order.store_name, p_target_program,
        case when v_confirmed_count = 0 then 'standard' else 'program_adjustment' end,
        v_transfer.id, v_next_step,
        v_chain.payer_id, v_chain.payer_username, v_chain.payee_id, v_chain.payee_username,
        v_unit_price, v_outstanding_supply, v_outstanding_vat,
        v_outstanding_supply + v_outstanding_vat, v_now, v_now
      );
      v_created_steps := v_created_steps + 1;
    end if;
  end loop;

  v_after_status := v_order.status;
  if v_created_steps > 0 and v_order.status = '입금완료' then
    v_after_status := '입금대기';
  elsif v_created_steps = 0 and v_order.status = '입금대기' then
    v_after_status := '입금완료';
  end if;

  perform set_config('spark.change_reason', trim(p_reason), true);
  update public.orders
  set program_type = p_target_program,
      price_per_shot = (v_preview ->> 'afterUnitPrice')::integer,
      supply_amount = (v_preview ->> 'afterSupplyAmount')::bigint,
      vat_amount = (v_preview ->> 'afterVatAmount')::bigint,
      total_amount = (v_preview ->> 'afterTotalAmount')::bigint,
      status = v_after_status,
      activated_at = case when v_after_status = '입금대기' then null else v_order.activated_at end,
      payment_notified_at = case
        when v_order.status = '입금완료' and v_after_status = '입금대기' then null
        when v_created_steps = 0 and v_after_status = '입금완료' then coalesce(v_order.payment_notified_at, v_now)
        else v_order.payment_notified_at
      end,
      program_transfer_state = case when v_created_steps > 0 then 'payment_pending' else 'none' end,
      program_transfer_difference = case when v_created_steps > 0 then (v_preview ->> 'difference')::bigint else 0 end,
      last_program_transfer_at = v_now,
      lock_version = v_order.lock_version + 1,
      updated_at = v_now
  where id = v_order.id
  returning * into v_result;

  update public.order_program_transfers
  set after_status = v_after_status
  where id = v_transfer.id;

  insert into public.notifications (user_id, title, message, order_id)
  values (
    v_result.created_by,
    '작업 프로그램 변경',
    v_result.store_name || ' 작업이 '
      || case p_target_program when 'spark' then '스파크' when 'spark_plus' then '스파크 +' else '스파크S' end
      || '(으)로 변경되었습니다.'
      || case when v_created_steps > 0 then ' 변경 정산 내역을 확인해 주세요.' else '' end,
    v_result.id
  );

  insert into public.audit_logs (
    actor_id, actor_username, actor_role,
    action, entity_type, entity_id, entity_label, metadata, created_at
  ) values (
    v_actor.id, v_actor.username, v_actor.role,
    'order.program_transferred', 'order', v_order.id, v_order.order_number || ' ' || v_order.store_name,
    jsonb_build_object(
      'order_id', v_order.id,
      'before_program', v_order.program_type,
      'after_program', p_target_program,
      'before_unit_price', v_order.price_per_shot,
      'after_unit_price', (v_preview ->> 'afterUnitPrice')::integer,
      'before_total', v_order.total_amount,
      'after_total', (v_preview ->> 'afterTotalAmount')::bigint,
      'difference', (v_preview ->> 'difference')::bigint,
      'actor', v_actor.username,
      'actor_id', v_actor.id,
      'reason', trim(p_reason),
      'timestamp', v_now,
      'confirmed_payment_count', v_confirmed_count,
      'settlement_mode', v_preview ->> 'settlementMode',
      'created_payment_steps', v_created_steps,
      'before_status', v_order.status,
      'after_status', v_after_status
    ),
    v_now
  );

  return jsonb_build_object(
    'order', to_jsonb(v_result),
    'transfer', v_preview || jsonb_build_object(
      'afterStatus', v_after_status,
      'settlementStepCount', v_created_steps
    )
  );
end;
$$;

revoke all on function public.transfer_order_program_v99(uuid, text, integer, text) from public, anon;
grant execute on function public.transfer_order_program_v99(uuid, text, integer, text) to authenticated;

-- 5. Clear the transfer-payment marker when the last pending step is confirmed.
create or replace function public.complete_program_transfer_settlement_v99()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_difference bigint;
begin
  if old.confirmed_at is null and new.confirmed_at is not null then
    select * into v_order from public.orders where id = new.order_id for update;
    if v_order.program_transfer_state = 'payment_pending'
       and not exists (
         select 1 from public.payment_steps ps
         where ps.order_id = new.order_id and ps.confirmed_at is null
       ) then
      v_difference := v_order.program_transfer_difference;
      update public.orders
      set program_transfer_state = 'none',
          program_transfer_difference = 0,
          lock_version = lock_version + 1,
          updated_at = now()
      where id = v_order.id;

      insert into public.notifications (user_id, title, message, order_id)
      values (v_order.created_by, '프로그램 변경 정산 완료', v_order.store_name || ' 작업의 변경 정산 확인이 완료되었습니다.', v_order.id);

      perform public.write_audit_log(
        'order.program_transfer_settled', 'order', v_order.id,
        v_order.order_number || ' ' || v_order.store_name,
        jsonb_build_object('difference', v_difference, 'payment_step_id', new.id, 'timestamp', now())
      );
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists complete_program_transfer_settlement_v99 on public.payment_steps;
create trigger complete_program_transfer_settlement_v99
after update of confirmed_at on public.payment_steps
for each row execute function public.complete_program_transfer_settlement_v99();

revoke all on function public.complete_program_transfer_settlement_v99() from public, anon, authenticated;

-- 6. Participant settlement feed returns each payment step's immutable program snapshot.
create or replace function public.get_my_active_payment_steps_v91()
returns table (
  id uuid,
  order_id uuid,
  order_number text,
  store_name text,
  program_type text,
  step_order integer,
  payer_id uuid,
  payer_username text,
  payee_id uuid,
  payee_username text,
  unit_price integer,
  supply_amount bigint,
  vat_amount bigint,
  total_amount bigint,
  confirmed_at timestamptz,
  can_confirm boolean,
  previous_pending_count bigint,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    ps.id,
    ps.order_id,
    ps.order_number,
    ps.store_name,
    ps.program_type,
    ps.step_order,
    ps.payer_id,
    ps.payer_username,
    ps.payee_id,
    ps.payee_username,
    ps.unit_price,
    ps.supply_amount,
    ps.vat_amount,
    ps.total_amount,
    ps.confirmed_at,
    (
      ps.confirmed_at is null
      and ps.payee_id = auth.uid()
      and not exists (
        select 1 from public.payment_steps previous_step
        where previous_step.order_id = ps.order_id
          and previous_step.step_order < ps.step_order
          and previous_step.confirmed_at is null
      )
    ) as can_confirm,
    (
      select count(*)
      from public.payment_steps previous_step
      where previous_step.order_id = ps.order_id
        and previous_step.step_order < ps.step_order
        and previous_step.confirmed_at is null
    ) as previous_pending_count,
    ps.created_at
  from public.payment_steps ps
  join public.orders o on o.id = ps.order_id
  where o.archived_at is null
    and exists (
      select 1 from public.profiles actor
      where actor.id = auth.uid()
        and actor.approval_status = 'approved'
        and actor.active
        and actor.role is not null
    )
    and (public.is_admin() or ps.payer_id = auth.uid() or ps.payee_id = auth.uid())
  order by ps.created_at, ps.step_order;
$$;

revoke all on function public.get_my_active_payment_steps_v91() from public, anon;
grant execute on function public.get_my_active_payment_steps_v91() to authenticated;

-- 7. v9.6 company cards now sum every original/adjustment admin step per order.
create or replace function public.get_admin_company_overview_v96(
  p_page integer default 1,
  p_page_size integer default 12,
  p_query text default null,
  p_sort text default 'pending_amount'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles;
  v_page integer := greatest(1, coalesce(p_page, 1));
  v_page_size integer := least(24, greatest(6, coalesce(p_page_size, 12)));
  v_sort text := coalesce(nullif(trim(p_sort), ''), 'pending_amount');
  v_result jsonb;
begin
  select * into v_actor from public.profiles where id = auth.uid();
  if v_actor.id is null
     or v_actor.role::text <> 'admin'
     or v_actor.approval_status::text <> 'approved'
     or not v_actor.active then
    raise exception '관리자만 업체별 접수 현황을 조회할 수 있습니다.';
  end if;
  if v_sort not in ('pending_amount', 'daily_shots', 'orders', 'recent') then
    raise exception '정렬 기준이 올바르지 않습니다.';
  end if;

  with order_base as (
    select
      o.id,
      o.created_by as registrant_id,
      o.creator_username,
      coalesce(nullif(trim(p.group_name), ''), nullif(trim(o.creator_group_name), ''), '미지정 그룹') as group_name,
      o.program_type::text as program_type,
      o.daily_shots,
      o.status::text as order_status,
      o.created_at,
      ps.waiting_step_count,
      ps.waiting_amount,
      ps.confirmed_step_count,
      ps.confirmed_amount
    from public.orders o
    left join public.profiles p on p.id = o.created_by
    left join lateral (
      select
        count(*) filter (where step.confirmed_at is null)::bigint as waiting_step_count,
        coalesce(sum(step.total_amount) filter (where step.confirmed_at is null), 0)::bigint as waiting_amount,
        count(*) filter (where step.confirmed_at is not null)::bigint as confirmed_step_count,
        coalesce(sum(step.total_amount) filter (where step.confirmed_at is not null), 0)::bigint as confirmed_amount
      from public.payment_steps step
      where step.order_id = o.id and step.payee_id = v_actor.id
    ) ps on true
    where o.archived_at is null
  ), grouped as (
    select
      b.registrant_id,
      max(b.creator_username) as username,
      max(b.group_name) as group_name,
      count(*)::bigint as total_orders,
      count(*) filter (where b.waiting_step_count > 0)::bigint as waiting_order_count,
      coalesce(sum(b.waiting_amount), 0)::bigint as waiting_amount,
      count(*) filter (where b.confirmed_step_count > 0)::bigint as confirmed_order_count,
      coalesce(sum(b.confirmed_amount), 0)::bigint as confirmed_amount,
      count(*) filter (where b.order_status = '만료')::bigint as expired_count,
      count(*) filter (where b.order_status = '구동중')::bigint as running_count,
      coalesce(sum(b.daily_shots::bigint) filter (
        where b.order_status = '구동중' and b.program_type in ('spark', 'spark_plus')
      ), 0)::bigint as daily_running_shots,
      coalesce(sum(b.daily_shots::bigint) filter (
        where b.order_status = '구동중' and b.program_type = 'spark_s'
      ), 0)::bigint as spark_s_running_units,
      count(*) filter (where b.program_type = 'spark')::bigint as spark_count,
      count(*) filter (where b.program_type = 'spark_plus')::bigint as spark_plus_count,
      count(*) filter (where b.program_type = 'spark_s')::bigint as spark_s_count,
      max(b.created_at) as last_order_at
    from order_base b
    group by b.registrant_id
  ), filtered as (
    select *
    from grouped g
    where nullif(trim(coalesce(p_query, '')), '') is null
       or lower(g.group_name) like '%' || lower(trim(p_query)) || '%'
       or lower(g.username) like '%' || lower(trim(p_query)) || '%'
  ), totals as (
    select
      count(*)::bigint as company_count,
      coalesce(sum(total_orders), 0)::bigint as total_orders,
      coalesce(sum(waiting_amount), 0)::bigint as waiting_amount,
      coalesce(sum(confirmed_amount), 0)::bigint as confirmed_amount,
      coalesce(sum(expired_count), 0)::bigint as expired_count,
      coalesce(sum(daily_running_shots), 0)::bigint as daily_running_shots,
      coalesce(sum(spark_s_running_units), 0)::bigint as spark_s_running_units
    from filtered
  ), paged as (
    select *
    from filtered g
    order by
      case when v_sort = 'pending_amount' then g.waiting_amount end desc nulls last,
      case when v_sort = 'daily_shots' then g.daily_running_shots end desc nulls last,
      case when v_sort = 'orders' then g.total_orders end desc nulls last,
      case when v_sort = 'recent' then g.last_order_at end desc nulls last,
      g.group_name asc,
      g.username asc
    limit v_page_size
    offset (v_page - 1) * v_page_size
  )
  select jsonb_build_object(
    'page', v_page,
    'pageSize', v_page_size,
    'totalPages', greatest(1, ceil(t.company_count::numeric / v_page_size)::integer),
    'companyCount', t.company_count,
    'totalOrders', t.total_orders,
    'waitingAmount', t.waiting_amount,
    'confirmedAmount', t.confirmed_amount,
    'expiredCount', t.expired_count,
    'dailyRunningShots', t.daily_running_shots,
    'sparkSRunningUnits', t.spark_s_running_units,
    'companies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'registrantId', p.registrant_id,
        'username', p.username,
        'groupName', p.group_name,
        'totalOrders', p.total_orders,
        'waitingOrderCount', p.waiting_order_count,
        'waitingAmount', p.waiting_amount,
        'confirmedOrderCount', p.confirmed_order_count,
        'confirmedAmount', p.confirmed_amount,
        'expiredCount', p.expired_count,
        'runningCount', p.running_count,
        'dailyRunningShots', p.daily_running_shots,
        'sparkSRunningUnits', p.spark_s_running_units,
        'sparkCount', p.spark_count,
        'sparkPlusCount', p.spark_plus_count,
        'sparkSCount', p.spark_s_count,
        'lastOrderAt', p.last_order_at
      ) order by
        case when v_sort = 'pending_amount' then p.waiting_amount end desc nulls last,
        case when v_sort = 'daily_shots' then p.daily_running_shots end desc nulls last,
        case when v_sort = 'orders' then p.total_orders end desc nulls last,
        case when v_sort = 'recent' then p.last_order_at end desc nulls last,
        p.group_name asc,
        p.username asc)
      from paged p
    ), '[]'::jsonb)
  ) into v_result
  from totals t;

  return coalesce(v_result, jsonb_build_object(
    'page', v_page,
    'pageSize', v_page_size,
    'totalPages', 1,
    'companyCount', 0,
    'totalOrders', 0,
    'waitingAmount', 0,
    'confirmedAmount', 0,
    'expiredCount', 0,
    'dailyRunningShots', 0,
    'sparkSRunningUnits', 0,
    'companies', '[]'::jsonb
  ));
end;
$$;

revoke all on function public.get_admin_company_overview_v96(integer, integer, text, text) from public, anon;
grant execute on function public.get_admin_company_overview_v96(integer, integer, text, text) to authenticated;

-- 8. Running/stopped/expired orders may intentionally have a pending transfer adjustment.
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
      or (o.status <> '입금대기' and o.program_transfer_state <> 'payment_pending' and exists (select 1 from public.payment_steps ps where ps.order_id = o.id and ps.confirmed_at is null))
    )),
    v_inactive_cron,
    now();
end;
$$;

revoke all on function public.get_operations_health() from public, anon;
grant execute on function public.get_operations_health() to authenticated;

insert into public.app_schema_versions(version, description)
values ('v9.9.0', 'Admin program transfer with preserved confirmations and settlement adjustments')
on conflict (version) do nothing;

select public.write_audit_log(
  'system.migration', 'system', null, 'SPARK v9.9.0',
  jsonb_build_object('description', 'admin program transfer and settlement adjustment')
);

commit;
