-- SPARK v9.1 settlement consistency update
-- Run once after v9.0.0. This migration does not delete or rewrite existing orders,
-- profiles, payment steps, notifications, or settlement confirmations.

begin;

do $$
begin
  if to_regclass('public.orders') is null
     or to_regclass('public.payment_steps') is null
     or to_regclass('public.app_schema_versions') is null then
    raise exception 'SPARK v9.0.0이 먼저 적용되어 있어야 합니다.';
  end if;
end $$;

-- Touch participant-visible payment rows whenever an order is archived or restored.
-- This produces a Realtime event for each payer/payee so their dashboard totals refresh
-- even when order RLS does not expose a deep descendant's order row.
alter table public.payment_steps
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.touch_payment_steps_on_order_archive_v91()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.archived_at is distinct from new.archived_at then
    update public.payment_steps
    set updated_at = now()
    where order_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists touch_payment_steps_on_order_archive_v91 on public.orders;
create trigger touch_payment_steps_on_order_archive_v91
after update of archived_at on public.orders
for each row
when (old.archived_at is distinct from new.archived_at)
execute function public.touch_payment_steps_on_order_archive_v91();

revoke all on function public.touch_payment_steps_on_order_archive_v91() from public, anon, authenticated;

-- Return only active-order settlement steps that the current member participates in.
-- This avoids relying on order RLS when a direct child created the order, while still
-- preventing unrelated hierarchy data from being exposed.
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
    o.program_type,
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
        select 1
        from public.payment_steps previous_step
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
      select 1
      from public.profiles actor
      where actor.id = auth.uid()
        and actor.approval_status = 'approved'
        and actor.active
        and actor.role is not null
    )
    and (
      public.is_admin()
      or ps.payer_id = auth.uid()
      or ps.payee_id = auth.uid()
    )
  order by ps.created_at, ps.step_order;
$$;

revoke all on function public.get_my_active_payment_steps_v91() from public, anon;
grant execute on function public.get_my_active_payment_steps_v91() to authenticated;

insert into public.app_schema_versions(version, description)
values ('v9.1.0', 'Active settlement RPC, direct-child payment visibility, archive-consistent totals and chain readiness')
on conflict (version) do update
set description = excluded.description,
    applied_at = now();

select public.write_audit_log(
  'system.migration',
  'system',
  null,
  'SPARK v9.1.0',
  jsonb_build_object('description', 'settlement hierarchy and archive consistency update')
);

commit;
