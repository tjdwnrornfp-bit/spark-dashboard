-- v10.5: preserve the existing authorization model while reducing per-row
-- auth helper evaluation and adding indexes used by notification/settlement paths.

do $$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.app_schema_versions') is null
     or to_regclass('public.orders') is null
     or to_regclass('public.payment_steps') is null
     or to_regclass('public.notifications') is null
     or to_regclass('public.settlement_quotes') is null
     or to_regclass('public.settlement_quote_items') is null
     or to_regclass('public.settlement_batches') is null
     or to_regclass('public.settlement_batch_items') is null then
    raise exception 'v10.5 performance prerequisites are missing';
  end if;

  if not exists (select 1 from public.app_schema_versions where version = 'v10.4.0') then
    raise exception 'app_schema_versions does not contain v10.4.0';
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'orders' and policyname = 'orders admin read')
     or not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'orders' and policyname = 'orders own read')
     or not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'admin profiles read')
     or not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profile hierarchy read')
     or not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profile self read') then
    raise exception 'v10.5 expected read policies are missing; refusing to broaden or replace unknown authorization rules';
  end if;
end
$$;

-- These pairs/triples were permissive SELECT policies for the same role, so
-- PostgreSQL already OR-ed them. The single policies below preserve that exact OR.
drop policy "orders admin read" on public.orders;
drop policy "orders own read" on public.orders;
create policy "orders read" on public.orders
  for select to authenticated
  using (
    created_by = (select auth.uid())
    or (select public.is_admin())
  );

drop policy "admin profiles read" on public.profiles;
drop policy "profile hierarchy read" on public.profiles;
drop policy "profile self read" on public.profiles;
create policy "profiles authorized read" on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or public.can_read_profile(id)
    or (select public.is_admin())
  );

alter policy "payment steps participant read" on public.payment_steps
  using (
    (select public.is_admin())
    or payer_id = (select auth.uid())
    or payee_id = (select auth.uid())
  );

alter policy "notifications own read" on public.notifications
  using (user_id = (select auth.uid()) or (select public.is_admin()));

alter policy "notifications own update" on public.notifications
  using (user_id = (select auth.uid()) or (select public.is_admin()))
  with check (user_id = (select auth.uid()) or (select public.is_admin()));

alter policy "notifications own delete" on public.notifications
  using (user_id = (select auth.uid()) or (select public.is_admin()));

alter policy "settlement quote owner read" on public.settlement_quotes
  using (requested_by = (select auth.uid()));

alter policy "settlement quote item owner read" on public.settlement_quote_items
  using (
    exists (
      select 1
      from public.settlement_quotes q
      where q.id = settlement_quote_items.quote_id
        and q.requested_by = (select auth.uid())
    )
  );

alter policy "settlement batch participant read" on public.settlement_batches
  using (
    (select public.is_admin())
    or payer_id = (select auth.uid())
    or payee_id = (select auth.uid())
  );

alter policy "settlement batch item participant read" on public.settlement_batch_items
  using (
    exists (
      select 1
      from public.settlement_batches b
      where b.id = settlement_batch_items.batch_id
        and (
          (select public.is_admin())
          or b.payer_id = (select auth.uid())
          or b.payee_id = (select auth.uid())
        )
    )
  );

create index if not exists notifications_order_id_idx
  on public.notifications(order_id);

create index if not exists settlement_quote_items_payment_step_idx
  on public.settlement_quote_items(payment_step_id);

create index if not exists settlement_batch_items_registrant_idx
  on public.settlement_batch_items(registrant_id);

insert into public.app_schema_versions(version, description)
values ('v10.5.0', 'Realtime partial refresh, bounded fetches, and RLS query performance')
on conflict (version) do nothing;
