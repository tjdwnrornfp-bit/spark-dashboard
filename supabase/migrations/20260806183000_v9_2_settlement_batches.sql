-- SPARK v9.2 settlement operations update
-- Adds server-paginated settlement search, safe bulk confirmation quotes,
-- payer-separated settlement batches and auditable batch history.
-- Existing profiles, orders, payment steps and confirmations are preserved.

begin;

do $$
begin
  if to_regclass('public.orders') is null
     or to_regclass('public.payment_steps') is null
     or to_regclass('public.audit_logs') is null
     or to_regclass('public.app_schema_versions') is null then
    raise exception 'SPARK v9.1.0까지 먼저 적용되어 있어야 합니다.';
  end if;
end $$;

create sequence if not exists public.settlement_batch_number_seq;

create table if not exists public.settlement_quotes (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null references public.profiles(id),
  selection_mode text not null check (selection_mode in ('explicit', 'filtered')),
  filters jsonb not null default '{}'::jsonb,
  item_count integer not null default 0 check (item_count >= 0),
  expected_amount bigint not null default 0 check (expected_amount >= 0),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'expired')),
  expires_at timestamptz not null default (now() + interval '5 minutes'),
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.settlement_quote_items (
  quote_id uuid not null references public.settlement_quotes(id) on delete cascade,
  payment_step_id uuid not null references public.payment_steps(id),
  payer_id uuid not null references public.profiles(id),
  payer_username text not null,
  expected_amount bigint not null check (expected_amount >= 0),
  primary key (quote_id, payment_step_id)
);

create table if not exists public.settlement_batches (
  id uuid primary key default gen_random_uuid(),
  batch_number text not null unique,
  payer_id uuid not null references public.profiles(id),
  payer_username text not null,
  payee_id uuid not null references public.profiles(id),
  payee_username text not null,
  item_count integer not null check (item_count > 0),
  expected_amount bigint not null check (expected_amount >= 0),
  actual_amount bigint not null check (actual_amount >= 0),
  depositor_name text not null default '',
  memo text not null default '' check (char_length(memo) <= 500),
  status text not null default 'confirmed' check (status in ('confirmed', 'voided')),
  confirmed_by uuid not null references public.profiles(id),
  confirmed_at timestamptz not null default now(),
  voided_by uuid references public.profiles(id),
  voided_at timestamptz,
  void_reason text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.settlement_batch_items (
  batch_id uuid not null references public.settlement_batches(id),
  payment_step_id uuid not null references public.payment_steps(id),
  order_id uuid not null references public.orders(id),
  order_number text not null,
  store_name text not null,
  registrant_id uuid not null references public.profiles(id),
  registrant_username text not null,
  registrant_group_name text not null default '',
  program_type text not null,
  amount bigint not null check (amount >= 0),
  created_at timestamptz not null default now(),
  primary key (batch_id, payment_step_id),
  unique (payment_step_id)
);

create index if not exists settlement_quotes_requested_idx
  on public.settlement_quotes(requested_by, created_at desc);
create index if not exists settlement_quote_items_payer_idx
  on public.settlement_quote_items(quote_id, payer_id);
create index if not exists settlement_batches_payee_idx
  on public.settlement_batches(payee_id, confirmed_at desc);
create index if not exists settlement_batches_payer_idx
  on public.settlement_batches(payer_id, confirmed_at desc);
create index if not exists settlement_batch_items_order_idx
  on public.settlement_batch_items(order_id, created_at desc);
create index if not exists payment_steps_payee_waiting_v92_idx
  on public.payment_steps(payee_id, created_at desc, id)
  where confirmed_at is null;
create index if not exists orders_settlement_filter_v92_idx
  on public.orders(created_by, program_type, start_date, created_at desc)
  where archived_at is null;

alter table public.settlement_quotes enable row level security;
alter table public.settlement_quote_items enable row level security;
alter table public.settlement_batches enable row level security;
alter table public.settlement_batch_items enable row level security;

drop policy if exists "settlement quote owner read" on public.settlement_quotes;
create policy "settlement quote owner read" on public.settlement_quotes
for select to authenticated
using (requested_by = auth.uid());

drop policy if exists "settlement quote item owner read" on public.settlement_quote_items;
create policy "settlement quote item owner read" on public.settlement_quote_items
for select to authenticated
using (exists (
  select 1 from public.settlement_quotes q
  where q.id = quote_id and q.requested_by = auth.uid()
));

drop policy if exists "settlement batch participant read" on public.settlement_batches;
create policy "settlement batch participant read" on public.settlement_batches
for select to authenticated
using (public.is_admin() or payer_id = auth.uid() or payee_id = auth.uid());

drop policy if exists "settlement batch item participant read" on public.settlement_batch_items;
create policy "settlement batch item participant read" on public.settlement_batch_items
for select to authenticated
using (exists (
  select 1 from public.settlement_batches b
  where b.id = batch_id
    and (public.is_admin() or b.payer_id = auth.uid() or b.payee_id = auth.uid())
));

revoke all on public.settlement_quotes, public.settlement_quote_items,
  public.settlement_batches, public.settlement_batch_items from anon, authenticated;


-- Individual payment audit rows are suppressed only inside the v9.2 batch RPC.
-- The immutable batch items and one batch audit row preserve the full evidence
-- without producing thousands of duplicate audit events.
create or replace function public.audit_payment_steps_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('spark.batch_payment_confirm', true) = 'on' then
    return new;
  end if;
  if old.confirmed_at is null and new.confirmed_at is not null then
    perform public.write_audit_log(
      'payment.confirmed', 'payment', new.id, new.order_number || ' ' || new.store_name,
      jsonb_build_object('step', new.step_order, 'payer', new.payer_username, 'payee', new.payee_username, 'amount', new.total_amount)
    );
  end if;
  return new;
end;
$$;

create or replace function public.get_my_settlement_page_v92(
  p_page integer default 1,
  p_page_size integer default 50,
  p_status text default 'waiting',
  p_payer_id uuid default null,
  p_registrant_id uuid default null,
  p_group_name text default null,
  p_query text default null,
  p_program_type text default null,
  p_start_date_from date default null,
  p_start_date_to date default null
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
  v_page_size integer := least(100, greatest(10, coalesce(p_page_size, 50)));
  v_result jsonb;
begin
  select * into v_actor from public.profiles where id = auth.uid();
  if v_actor.id is null or v_actor.approval_status is distinct from 'approved' or not v_actor.active or v_actor.role is null then
    raise exception '활성 승인 회원만 정산 내역을 조회할 수 있습니다.';
  end if;
  if coalesce(p_status, 'waiting') not in ('waiting', 'confirmed', 'all') then
    raise exception '정산 상태 필터가 올바르지 않습니다.';
  end if;

  with base as (
    select
      ps.id,
      ps.order_id,
      ps.order_number,
      ps.store_name,
      o.mid,
      o.program_type,
      o.created_by as registrant_id,
      o.creator_username as registrant_username,
      case when v_actor.role::text = 'admin' then o.creator_group_name else '' end as registrant_group_name,
      o.start_date,
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
      ps.created_at,
      not exists (
        select 1
        from public.payment_steps previous_step
        where previous_step.order_id = ps.order_id
          and previous_step.step_order < ps.step_order
          and previous_step.confirmed_at is null
      ) as chain_ready,
      (
        select count(*)
        from public.payment_steps previous_step
        where previous_step.order_id = ps.order_id
          and previous_step.step_order < ps.step_order
          and previous_step.confirmed_at is null
      ) as previous_pending_count
    from public.payment_steps ps
    join public.orders o on o.id = ps.order_id
    where ps.payee_id = v_actor.id
      and o.archived_at is null
  ), filtered as (
    select *
    from base b
    where (
        p_status = 'all'
        or (p_status = 'waiting' and b.confirmed_at is null)
        or (p_status = 'confirmed' and b.confirmed_at is not null)
      )
      and (p_payer_id is null or b.payer_id = p_payer_id)
      and (p_registrant_id is null or b.registrant_id = p_registrant_id)
      and (nullif(trim(coalesce(p_group_name, '')), '') is null or b.registrant_group_name = trim(p_group_name))
      and (nullif(trim(coalesce(p_program_type, '')), '') is null or b.program_type = p_program_type)
      and (p_start_date_from is null or b.start_date >= p_start_date_from)
      and (p_start_date_to is null or b.start_date <= p_start_date_to)
      and (
        nullif(trim(coalesce(p_query, '')), '') is null
        or lower(b.store_name) like '%' || lower(trim(p_query)) || '%'
        or lower(b.mid) like '%' || lower(trim(p_query)) || '%'
        or lower(b.order_number) like '%' || lower(trim(p_query)) || '%'
        or lower(b.payer_username) like '%' || lower(trim(p_query)) || '%'
        or lower(b.registrant_username) like '%' || lower(trim(p_query)) || '%'
        or lower(b.registrant_group_name) like '%' || lower(trim(p_query)) || '%'
      )
  ), totals as (
    select
      count(*)::bigint as total_count,
      coalesce(sum(total_amount), 0)::bigint as total_amount,
      count(*) filter (where confirmed_at is null and chain_ready)::bigint as ready_count,
      coalesce(sum(total_amount) filter (where confirmed_at is null and chain_ready), 0)::bigint as ready_amount
    from filtered
  ), paged as (
    select *
    from filtered
    order by created_at desc, id
    limit v_page_size
    offset (v_page - 1) * v_page_size
  )
  select jsonb_build_object(
    'page', v_page,
    'pageSize', v_page_size,
    'totalPages', greatest(1, ceil(t.total_count::numeric / v_page_size)::integer),
    'totalCount', t.total_count,
    'totalAmount', t.total_amount,
    'readyCount', t.ready_count,
    'readyAmount', t.ready_amount,
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'orderDbId', p.order_id,
        'orderNumber', p.order_number,
        'storeName', p.store_name,
        'mid', p.mid,
        'programType', p.program_type,
        'registrantId', p.registrant_id,
        'registrantUsername', p.registrant_username,
        'registrantGroupName', p.registrant_group_name,
        'startDate', p.start_date,
        'stepOrder', p.step_order,
        'payerId', p.payer_id,
        'payerUsername', p.payer_username,
        'payeeId', p.payee_id,
        'payeeUsername', p.payee_username,
        'unitPrice', p.unit_price,
        'supplyAmount', p.supply_amount,
        'vatAmount', p.vat_amount,
        'totalAmount', p.total_amount,
        'confirmedAt', p.confirmed_at,
        'canConfirm', (p.confirmed_at is null and p.chain_ready),
        'previousPendingCount', p.previous_pending_count,
        'createdAt', p.created_at
      ) order by p.created_at desc, p.id)
      from paged p
    ), '[]'::jsonb)
  ) into v_result
  from totals t;

  return coalesce(v_result, jsonb_build_object(
    'page', v_page, 'pageSize', v_page_size, 'totalPages', 1,
    'totalCount', 0, 'totalAmount', 0, 'readyCount', 0, 'readyAmount', 0,
    'rows', '[]'::jsonb
  ));
end;
$$;

revoke all on function public.get_my_settlement_page_v92(integer, integer, text, uuid, uuid, text, text, text, date, date) from public, anon;
grant execute on function public.get_my_settlement_page_v92(integer, integer, text, uuid, uuid, text, text, text, date, date) to authenticated;

create or replace function public.get_my_settlement_summary_v92()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles;
  v_result jsonb;
begin
  select * into v_actor from public.profiles where id = auth.uid();
  if v_actor.id is null or v_actor.approval_status is distinct from 'approved' or not v_actor.active or v_actor.role is null then
    raise exception '활성 승인 회원만 정산 요약을 조회할 수 있습니다.';
  end if;

  with active_steps as (
    select ps.*
    from public.payment_steps ps
    join public.orders o on o.id = ps.order_id
    where o.archived_at is null
  ), settlement_side as (
    select * from active_steps ps
    where (v_actor.role::text = 'admin' and ps.payee_id = v_actor.id)
       or (v_actor.role::text <> 'admin' and ps.payer_id = v_actor.id)
  ), received_side as (
    select * from active_steps ps
    where ps.payee_id = v_actor.id and ps.confirmed_at is not null
  )
  select jsonb_build_object(
    'waitingCount', count(*) filter (where s.confirmed_at is null),
    'waitingAmount', coalesce(sum(s.total_amount) filter (where s.confirmed_at is null), 0),
    'confirmedCount', count(*) filter (where s.confirmed_at is not null),
    'confirmedAmount', coalesce(sum(s.total_amount) filter (where s.confirmed_at is not null), 0),
    'totalCount', count(*),
    'totalAmount', coalesce(sum(s.total_amount), 0),
    'receivedCount', (select count(*) from received_side),
    'receivedAmount', (select coalesce(sum(total_amount), 0) from received_side)
  ) into v_result
  from settlement_side s;

  return v_result;
end;
$$;

revoke all on function public.get_my_settlement_summary_v92() from public, anon;
grant execute on function public.get_my_settlement_summary_v92() to authenticated;

create or replace function public.get_my_settlement_filter_options_v92()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles;
  v_result jsonb;
begin
  select * into v_actor from public.profiles where id = auth.uid();
  if v_actor.id is null or v_actor.approval_status is distinct from 'approved' or not v_actor.active or v_actor.role is null then
    raise exception '활성 승인 회원만 정산 필터를 조회할 수 있습니다.';
  end if;

  with visible as (
    select ps.payer_id, ps.payer_username,
      o.created_by as registrant_id,
      o.creator_username as registrant_username,
      case when v_actor.role::text = 'admin' then o.creator_group_name else '' end as creator_group_name
    from public.payment_steps ps
    join public.orders o on o.id = ps.order_id
    where ps.payee_id = v_actor.id
      and o.archived_at is null
  )
  select jsonb_build_object(
    'payers', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.payer_id, 'label', x.payer_username) order by x.payer_username)
      from (select distinct payer_id, payer_username from visible) x
    ), '[]'::jsonb),
    'registrants', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.registrant_id, 'label', x.registrant_username) order by x.registrant_username)
      from (select distinct registrant_id, registrant_username from visible) x
    ), '[]'::jsonb),
    'groups', coalesce((
      select jsonb_agg(x.creator_group_name order by x.creator_group_name)
      from (select distinct creator_group_name from visible where trim(creator_group_name) <> '') x
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_my_settlement_filter_options_v92() from public, anon;
grant execute on function public.get_my_settlement_filter_options_v92() to authenticated;

create or replace function public.create_settlement_quote_v92(
  p_selection_mode text,
  p_step_ids uuid[] default array[]::uuid[],
  p_excluded_step_ids uuid[] default array[]::uuid[],
  p_status text default 'waiting',
  p_payer_id uuid default null,
  p_registrant_id uuid default null,
  p_group_name text default null,
  p_query text default null,
  p_program_type text default null,
  p_start_date_from date default null,
  p_start_date_to date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles;
  v_quote public.settlement_quotes;
  v_inserted integer;
  v_requested integer;
  v_result jsonb;
begin
  select * into v_actor from public.profiles where id = auth.uid();
  if v_actor.id is null or v_actor.approval_status is distinct from 'approved' or not v_actor.active or v_actor.role is null then
    raise exception '활성 승인 회원만 일괄 입금확인을 사용할 수 있습니다.';
  end if;
  if p_selection_mode not in ('explicit', 'filtered') then
    raise exception '선택 방식이 올바르지 않습니다.';
  end if;

  delete from public.settlement_quotes
  where status in ('pending', 'expired')
    and expires_at < now() - interval '1 day';

  insert into public.settlement_quotes (
    requested_by, selection_mode, filters
  ) values (
    v_actor.id,
    p_selection_mode,
    jsonb_build_object(
      'status', coalesce(p_status, 'waiting'),
      'payerId', p_payer_id,
      'registrantId', p_registrant_id,
      'groupName', p_group_name,
      'query', p_query,
      'programType', p_program_type,
      'startDateFrom', p_start_date_from,
      'startDateTo', p_start_date_to
    )
  ) returning * into v_quote;

  with base as (
    select ps.id, ps.payer_id, ps.payer_username, ps.total_amount
    from public.payment_steps ps
    join public.orders o on o.id = ps.order_id
    where ps.payee_id = v_actor.id
      and ps.confirmed_at is null
      and o.archived_at is null
      and not exists (
        select 1 from public.payment_steps previous_step
        where previous_step.order_id = ps.order_id
          and previous_step.step_order < ps.step_order
          and previous_step.confirmed_at is null
      )
      and (
        (p_selection_mode = 'explicit' and ps.id = any(coalesce(p_step_ids, array[]::uuid[])))
        or (
          p_selection_mode = 'filtered'
          and not (ps.id = any(coalesce(p_excluded_step_ids, array[]::uuid[])))
          and (p_payer_id is null or ps.payer_id = p_payer_id)
          and (p_registrant_id is null or o.created_by = p_registrant_id)
          and (
            v_actor.role::text <> 'admin'
            or nullif(trim(coalesce(p_group_name, '')), '') is null
            or o.creator_group_name = trim(p_group_name)
          )
          and (nullif(trim(coalesce(p_program_type, '')), '') is null or o.program_type = p_program_type)
          and (p_start_date_from is null or o.start_date >= p_start_date_from)
          and (p_start_date_to is null or o.start_date <= p_start_date_to)
          and (
            nullif(trim(coalesce(p_query, '')), '') is null
            or lower(o.store_name) like '%' || lower(trim(p_query)) || '%'
            or lower(o.mid) like '%' || lower(trim(p_query)) || '%'
            or lower(o.order_number) like '%' || lower(trim(p_query)) || '%'
            or lower(ps.payer_username) like '%' || lower(trim(p_query)) || '%'
            or lower(o.creator_username) like '%' || lower(trim(p_query)) || '%'
            or (v_actor.role::text = 'admin' and lower(o.creator_group_name) like '%' || lower(trim(p_query)) || '%')
          )
        )
      )
  )
  insert into public.settlement_quote_items (
    quote_id, payment_step_id, payer_id, payer_username, expected_amount
  )
  select v_quote.id, b.id, b.payer_id, b.payer_username, b.total_amount
  from base b
  limit 5001;

  get diagnostics v_inserted = row_count;

  if p_selection_mode = 'explicit' then
    select count(distinct x) into v_requested
    from unnest(coalesce(p_step_ids, array[]::uuid[])) x;
    if v_requested = 0 then
      raise exception '선택한 입금 내역이 없습니다.';
    end if;
    if v_inserted <> v_requested then
      raise exception '선택 항목 중 이미 처리됐거나 순서 대기·보관 상태인 내역이 있습니다. 새로고침 후 다시 선택해 주세요.';
    end if;
  end if;

  if v_inserted = 0 then
    raise exception '현재 조건에서 입금확인 가능한 내역이 없습니다.';
  end if;
  if v_inserted > 5000 then
    raise exception '한 번에 최대 5,000건까지 확인할 수 있습니다. 입금자 또는 기간 필터로 나눠 처리해 주세요.';
  end if;

  update public.settlement_quotes q
  set item_count = x.item_count,
      expected_amount = x.expected_amount
  from (
    select count(*)::integer as item_count, coalesce(sum(expected_amount), 0)::bigint as expected_amount
    from public.settlement_quote_items
    where quote_id = v_quote.id
  ) x
  where q.id = v_quote.id
  returning q.* into v_quote;

  select jsonb_build_object(
    'id', v_quote.id,
    'itemCount', v_quote.item_count,
    'expectedAmount', v_quote.expected_amount,
    'expiresAt', v_quote.expires_at,
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'payerId', g.payer_id,
        'payerUsername', g.payer_username,
        'itemCount', g.item_count,
        'expectedAmount', g.expected_amount
      ) order by g.payer_username)
      from (
        select payer_id, max(payer_username) as payer_username,
          count(*)::integer as item_count,
          sum(expected_amount)::bigint as expected_amount
        from public.settlement_quote_items
        where quote_id = v_quote.id
        group by payer_id
      ) g
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.create_settlement_quote_v92(text, uuid[], uuid[], text, uuid, uuid, text, text, text, date, date) from public, anon;
grant execute on function public.create_settlement_quote_v92(text, uuid[], uuid[], text, uuid, uuid, text, text, text, date, date) to authenticated;

create or replace function public.confirm_settlement_quote_v92(
  p_quote_id uuid,
  p_payer_confirmations jsonb,
  p_memo text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles;
  v_quote public.settlement_quotes;
  v_group record;
  v_batch public.settlement_batches;
  v_actual_amount bigint;
  v_depositor_name text;
  v_expected_group_count integer;
  v_confirmation_count integer;
  v_distinct_confirmation_count integer;
  v_batches jsonb := '[]'::jsonb;
  v_order_ids uuid[];
  v_completed_order_ids uuid[];
  v_completed_count integer := 0;
  v_now timestamptz := now();
begin
  select * into v_actor from public.profiles where id = auth.uid();
  if v_actor.id is null or v_actor.approval_status is distinct from 'approved' or not v_actor.active or v_actor.role is null then
    raise exception '활성 승인 회원만 일괄 입금확인을 사용할 수 있습니다.';
  end if;
  if char_length(coalesce(p_memo, '')) > 500 then
    raise exception '입금 메모는 500자 이하로 입력해 주세요.';
  end if;
  if jsonb_typeof(p_payer_confirmations) is distinct from 'array' then
    raise exception '입금자별 확인 금액이 올바르지 않습니다.';
  end if;

  select * into v_quote
  from public.settlement_quotes
  where id = p_quote_id
  for update;

  if v_quote.id is null or v_quote.requested_by <> v_actor.id then
    raise exception '입금확인 견적을 찾을 수 없습니다.';
  end if;
  if v_quote.status <> 'pending' then
    raise exception '이미 처리되었거나 만료된 입금확인 견적입니다.';
  end if;
  if v_quote.expires_at < v_now then
    update public.settlement_quotes set status = 'expired' where id = v_quote.id;
    raise exception '확인 시간이 만료되었습니다. 목록에서 금액을 다시 확인해 주세요.';
  end if;

  perform 1
  from public.payment_steps ps
  join public.settlement_quote_items qi on qi.payment_step_id = ps.id
  where qi.quote_id = v_quote.id
  order by ps.id
  for update of ps;

  if exists (
    select 1
    from public.settlement_quote_items qi
    join public.payment_steps ps on ps.id = qi.payment_step_id
    join public.orders o on o.id = ps.order_id
    where qi.quote_id = v_quote.id
      and (
        ps.payee_id <> v_actor.id
        or ps.confirmed_at is not null
        or o.archived_at is not null
        or exists (
          select 1 from public.payment_steps previous_step
          where previous_step.order_id = ps.order_id
            and previous_step.step_order < ps.step_order
            and previous_step.confirmed_at is null
        )
      )
  ) then
    raise exception '선택 내역 중 상태가 변경된 항목이 있습니다. 목록을 새로고침한 뒤 다시 확인해 주세요.';
  end if;

  select count(*) into v_expected_group_count
  from (
    select payer_id
    from public.settlement_quote_items
    where quote_id = v_quote.id
    group by payer_id
  ) x;

  select count(*), count(distinct payer_id)
  into v_confirmation_count, v_distinct_confirmation_count
  from jsonb_to_recordset(p_payer_confirmations)
    as c(payer_id uuid, actual_amount bigint, depositor_name text);

  if v_confirmation_count <> v_expected_group_count or v_distinct_confirmation_count <> v_expected_group_count then
    raise exception '입금자별 확인 정보가 누락되었거나 중복되었습니다.';
  end if;

  if exists (
    select 1
    from (
      select payer_id, sum(expected_amount)::bigint as expected_amount
      from public.settlement_quote_items
      where quote_id = v_quote.id
      group by payer_id
    ) expected
    left join jsonb_to_recordset(p_payer_confirmations)
      as c(payer_id uuid, actual_amount bigint, depositor_name text)
      on c.payer_id = expected.payer_id
    where c.payer_id is null
      or c.actual_amount is distinct from expected.expected_amount
      or trim(coalesce(c.depositor_name, '')) = ''
  ) then
    raise exception '실제 입금액은 입금자별 예정금액과 정확히 일치해야 하며 입금자명을 입력해야 합니다.';
  end if;

  for v_group in
    select payer_id, max(payer_username) as payer_username,
      count(*)::integer as item_count,
      sum(expected_amount)::bigint as expected_amount
    from public.settlement_quote_items
    where quote_id = v_quote.id
    group by payer_id
    order by max(payer_username)
  loop
    select c.actual_amount, trim(c.depositor_name)
    into v_actual_amount, v_depositor_name
    from jsonb_to_recordset(p_payer_confirmations)
      as c(payer_id uuid, actual_amount bigint, depositor_name text)
    where c.payer_id = v_group.payer_id;

    insert into public.settlement_batches (
      batch_number,
      payer_id, payer_username,
      payee_id, payee_username,
      item_count, expected_amount, actual_amount,
      depositor_name, memo,
      confirmed_by, confirmed_at
    ) values (
      'SET-' || to_char(v_now at time zone 'Asia/Seoul', 'YYYYMMDD') || '-' || lpad(nextval('public.settlement_batch_number_seq')::text, 6, '0'),
      v_group.payer_id, v_group.payer_username,
      v_actor.id, v_actor.username,
      v_group.item_count, v_group.expected_amount, v_actual_amount,
      v_depositor_name, trim(coalesce(p_memo, '')),
      v_actor.id, v_now
    ) returning * into v_batch;

    insert into public.settlement_batch_items (
      batch_id, payment_step_id,
      order_id, order_number, store_name,
      registrant_id, registrant_username, registrant_group_name,
      program_type, amount
    )
    select
      v_batch.id, qi.payment_step_id,
      o.id, o.order_number, o.store_name,
      o.created_by, o.creator_username, o.creator_group_name,
      o.program_type, ps.total_amount
    from public.settlement_quote_items qi
    join public.payment_steps ps on ps.id = qi.payment_step_id
    join public.orders o on o.id = ps.order_id
    where qi.quote_id = v_quote.id
      and qi.payer_id = v_group.payer_id;

    v_batches := v_batches || jsonb_build_array(jsonb_build_object(
      'id', v_batch.id,
      'batchNumber', v_batch.batch_number,
      'payerId', v_batch.payer_id,
      'payerUsername', v_batch.payer_username,
      'itemCount', v_batch.item_count,
      'expectedAmount', v_batch.expected_amount,
      'actualAmount', v_batch.actual_amount,
      'confirmedAt', v_batch.confirmed_at
    ));
  end loop;

  perform set_config('spark.batch_payment_confirm', 'on', true);

  update public.payment_steps ps
  set confirmed_at = v_now,
      confirmed_by = v_actor.id,
      updated_at = v_now
  from public.settlement_quote_items qi
  where qi.quote_id = v_quote.id
    and qi.payment_step_id = ps.id;

  select array_agg(distinct ps.order_id)
  into v_order_ids
  from public.settlement_quote_items qi
  join public.payment_steps ps on ps.id = qi.payment_step_id
  where qi.quote_id = v_quote.id;

  if coalesce(array_length(v_order_ids, 1), 0) > 0 then
    select array_agg(o.id)
    into v_completed_order_ids
    from public.orders o
    where o.id = any(v_order_ids)
      and o.archived_at is null
      and o.payment_notified_at is null
      and not exists (
        select 1 from public.payment_steps pending
        where pending.order_id = o.id and pending.confirmed_at is null
      );
  end if;

  v_completed_count := coalesce(array_length(v_completed_order_ids, 1), 0);
  if v_completed_count > 0 then
    perform set_config('spark.change_reason', '일괄 최종 정산 확인 완료', true);

    update public.orders o
    set status = case when o.status = '입금대기' then '입금완료'::public.order_status else o.status end,
        payment_notified_at = v_now,
        lock_version = o.lock_version + 1
    where o.id = any(v_completed_order_ids);

    insert into public.notifications (user_id, title, message, order_id)
    select
      o.created_by,
      '전체 입금 확인 완료',
      case when count(*) = 1
        then max(o.store_name) || ' 작업의 입금 확인이 완료되었습니다.'
        else count(*)::text || '건 작업의 입금 확인이 완료되었습니다.'
      end,
      case when count(*) = 1 then (array_agg(o.id))[1] else null end
    from public.orders o
    where o.id = any(v_completed_order_ids)
    group by o.created_by;

    perform public.notify_admins(
      '일괄 입금확인 완료',
      v_actor.username || ' 회원이 ' || v_quote.item_count::text || '건 / ' || v_quote.expected_amount::text || '원의 입금을 일괄 확인했습니다.',
      null
    );
  end if;

  update public.settlement_quotes
  set status = 'confirmed', confirmed_at = v_now
  where id = v_quote.id;

  perform public.write_audit_log(
    'payment.batch_confirm',
    'payment',
    v_quote.id,
    '일괄 입금확인 ' || v_quote.item_count::text || '건',
    jsonb_build_object(
      'item_count', v_quote.item_count,
      'expected_amount', v_quote.expected_amount,
      'completed_orders', v_completed_count,
      'batch_count', v_expected_group_count
    )
  );

  return jsonb_build_object(
    'itemCount', v_quote.item_count,
    'totalAmount', v_quote.expected_amount,
    'batches', v_batches
  );
end;
$$;

revoke all on function public.confirm_settlement_quote_v92(uuid, jsonb, text) from public, anon;
grant execute on function public.confirm_settlement_quote_v92(uuid, jsonb, text) to authenticated;

create or replace function public.get_my_settlement_batches_v92(p_limit integer default 50)
returns table (
  "id" uuid,
  "batchNumber" text,
  "payerId" uuid,
  "payerUsername" text,
  "payeeId" uuid,
  "payeeUsername" text,
  "itemCount" integer,
  "expectedAmount" bigint,
  "actualAmount" bigint,
  "depositorName" text,
  "memo" text,
  "status" text,
  "confirmedAt" timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    b.id,
    b.batch_number,
    b.payer_id,
    b.payer_username,
    b.payee_id,
    b.payee_username,
    b.item_count,
    b.expected_amount,
    b.actual_amount,
    b.depositor_name,
    b.memo,
    b.status,
    b.confirmed_at
  from public.settlement_batches b
  where b.payer_id = auth.uid()
     or b.payee_id = auth.uid()
  order by b.confirmed_at desc, b.id
  limit least(200, greatest(1, coalesce(p_limit, 50)));
$$;

revoke all on function public.get_my_settlement_batches_v92(integer) from public, anon;
grant execute on function public.get_my_settlement_batches_v92(integer) to authenticated;


create or replace function public.get_settlement_batch_items_v92(p_batch_id uuid)
returns table (
  "paymentStepId" uuid,
  "orderId" uuid,
  "orderNumber" text,
  "storeName" text,
  "registrantId" uuid,
  "registrantUsername" text,
  "registrantGroupName" text,
  "programType" text,
  "amount" bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
begin
  if not exists (
    select 1
    from public.settlement_batches b
    where b.id = p_batch_id
      and (public.is_admin() or b.payer_id = v_actor_id or b.payee_id = v_actor_id)
  ) then
    raise exception '정산 묶음 상세 조회 권한이 없습니다.';
  end if;

  return query
  select
    i.payment_step_id,
    i.order_id,
    i.order_number,
    i.store_name,
    i.registrant_id,
    i.registrant_username,
    case when public.is_admin() then i.registrant_group_name else '' end,
    i.program_type,
    i.amount
  from public.settlement_batch_items i
  where i.batch_id = p_batch_id
  order by i.created_at, i.order_number;
end;
$$;

revoke all on function public.get_settlement_batch_items_v92(uuid) from public, anon;
grant execute on function public.get_settlement_batch_items_v92(uuid) to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'settlement_batches'
  ) then
    alter publication supabase_realtime add table public.settlement_batches;
  end if;
end $$;

insert into public.app_schema_versions(version, description)
values ('v9.2.0', 'Server-paginated settlement filters, quote-validated bulk confirmations and payer-separated batch history')
on conflict (version) do update
set description = excluded.description,
    applied_at = now();

select public.write_audit_log(
  'system.migration',
  'system',
  null,
  'SPARK v9.2.0',
  jsonb_build_object('description', 'settlement operations and bulk confirmation update')
);

commit;
