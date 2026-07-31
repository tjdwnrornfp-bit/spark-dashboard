-- SPARK work intake dashboard - Supabase production schema
-- Run in a new Supabase project's SQL Editor.

create extension if not exists pgcrypto;

do $$ begin
  create type public.member_role as enum ('admin', 'agency', 'distributor');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.approval_status as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.order_status as enum ('입금대기', '입금완료', '구동중', '정지', '만료');
exception when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null check (char_length(trim(username)) between 4 and 40 and username !~ '[[:cntrl:]]'),
  username_key text not null unique check (char_length(trim(username_key)) between 4 and 120),
  role public.member_role,
  approval_status public.approval_status not null default 'pending',
  price_per_shot integer not null default 0 check (price_per_shot >= 0),
  active boolean not null default false,
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  updated_at timestamptz not null default now(),
  check (
    (approval_status = 'approved' and role is not null and active = true and (role = 'admin' or price_per_shot > 0))
    or approval_status <> 'approved'
  )
);

create table if not exists public.app_settings (
  id boolean primary key default true check (id),
  cutoff_hour smallint not null default 18 check (cutoff_hour between 0 and 23),
  auto_start_hour smallint not null default 9 check (auto_start_hour = 9),
  bank text not null default '',
  account_number text not null default '',
  account_holder text not null default '',
  updated_at timestamptz not null default now()
);
insert into public.app_settings (id) values (true) on conflict (id) do nothing;

create sequence if not exists public.order_number_seq;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  created_by uuid not null references public.profiles(id),
  creator_username text not null,
  place_url text not null,
  mid text not null check (mid ~ '^[0-9]+$'),
  store_name text not null check (char_length(trim(store_name)) between 1 and 50),
  keyword text not null check (char_length(trim(keyword)) between 1 and 50),
  daily_shots integer not null check (daily_shots > 0),
  operation_days integer not null check (operation_days > 0),
  price_per_shot integer not null check (price_per_shot > 0),
  supply_amount bigint not null check (supply_amount >= 0),
  vat_amount bigint not null check (vat_amount >= 0),
  total_amount bigint not null check (total_amount = supply_amount + vat_amount),
  start_date date not null,
  end_date date not null check (end_date >= start_date),
  status public.order_status not null default '입금대기',
  memo text not null default '' check (char_length(memo) <= 300),
  activated_at timestamptz,
  stopped_at timestamptz,
  payment_notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  target_role public.member_role,
  title text not null,
  message text not null,
  order_id uuid references public.orders(id) on delete cascade,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.notices (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 1 and 100),
  content text not null check (char_length(trim(content)) between 1 and 1000),
  pinned boolean not null default false,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists orders_created_by_idx on public.orders(created_by);
create index if not exists orders_status_start_end_idx on public.orders(status, start_date, end_date);
create index if not exists orders_created_at_idx on public.orders(created_at desc);
create index if not exists notifications_user_created_idx on public.notifications(user_id, created_at desc);
create index if not exists profiles_approval_idx on public.profiles(approval_status, requested_at desc);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at before update on public.profiles for each row execute function public.touch_updated_at();
drop trigger if exists orders_touch_updated_at on public.orders;
create trigger orders_touch_updated_at before update on public.orders for each row execute function public.touch_updated_at();
drop trigger if exists notices_touch_updated_at on public.notices;
create trigger notices_touch_updated_at before update on public.notices for each row execute function public.touch_updated_at();
drop trigger if exists settings_touch_updated_at on public.app_settings;
create trigger settings_touch_updated_at before update on public.app_settings for each row execute function public.touch_updated_at();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
      and approval_status = 'approved'
      and active
  );
$$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username text;
  v_username_key text;
begin
  v_username := trim(coalesce(new.raw_user_meta_data ->> 'username', ''));
  v_username_key := lower(trim(coalesce(new.raw_user_meta_data ->> 'username_key', v_username)));

  if char_length(v_username) < 4 or char_length(v_username) > 40 or v_username ~ '[[:cntrl:]]' then
    raise exception '아이디는 종류와 관계없이 4~40자로 입력해야 합니다.';
  end if;

  insert into public.profiles (id, username, username_key)
  values (new.id, v_username, v_username_key);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

alter table public.profiles enable row level security;
alter table public.app_settings enable row level security;
alter table public.orders enable row level security;
alter table public.notifications enable row level security;
alter table public.notices enable row level security;

drop policy if exists "profile self read" on public.profiles;
create policy "profile self read" on public.profiles for select to authenticated using (id = auth.uid());
drop policy if exists "admin profiles read" on public.profiles;
create policy "admin profiles read" on public.profiles for select to authenticated using (public.is_admin());
drop policy if exists "admin profiles update" on public.profiles;
create policy "admin profiles update" on public.profiles for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "settings authenticated read" on public.app_settings;
create policy "settings authenticated read" on public.app_settings for select to authenticated using (true);
drop policy if exists "settings admin update" on public.app_settings;
create policy "settings admin update" on public.app_settings for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "orders own read" on public.orders;
create policy "orders own read" on public.orders for select to authenticated using (created_by = auth.uid());
drop policy if exists "orders admin read" on public.orders;
create policy "orders admin read" on public.orders for select to authenticated using (public.is_admin());
drop policy if exists "orders admin update" on public.orders;
create policy "orders admin update" on public.orders for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "notifications own read" on public.notifications;
create policy "notifications own read" on public.notifications for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists "notifications own update" on public.notifications;
create policy "notifications own update" on public.notifications for update to authenticated using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin());
drop policy if exists "notifications own delete" on public.notifications;
create policy "notifications own delete" on public.notifications for delete to authenticated using (user_id = auth.uid() or public.is_admin());

drop policy if exists "notices authenticated read" on public.notices;
create policy "notices authenticated read" on public.notices for select to authenticated using (true);
drop policy if exists "notices admin insert" on public.notices;
create policy "notices admin insert" on public.notices for insert to authenticated with check (public.is_admin());
drop policy if exists "notices admin update" on public.notices;
create policy "notices admin update" on public.notices for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "notices admin delete" on public.notices;
create policy "notices admin delete" on public.notices for delete to authenticated using (public.is_admin());

grant usage on schema public to anon, authenticated;
grant select on public.profiles, public.app_settings, public.orders, public.notifications, public.notices to authenticated;
grant update on public.profiles, public.app_settings, public.orders, public.notifications to authenticated;
grant delete on public.notifications, public.notices to authenticated;
grant insert, update on public.notices to authenticated;
grant usage, select on sequence public.order_number_seq to authenticated;

-- The member's current per-shot price is copied into each new order.
create or replace function public.create_order(
  p_place_url text,
  p_mid text,
  p_store_name text,
  p_keyword text,
  p_daily_shots integer,
  p_operation_days integer,
  p_memo text default ''
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  member public.profiles;
  settings public.app_settings;
  supply bigint;
  vat bigint;
  result public.orders;
  number text;
  local_now timestamp;
  calculated_start date;
  calculated_end date;
begin
  select * into member from public.profiles where id = auth.uid() for update;
  if member.id is null or member.role not in ('agency', 'distributor') or member.approval_status <> 'approved' or not member.active or member.price_per_shot <= 0 then
    raise exception '승인된 대행사 또는 총판만 접수할 수 있습니다.';
  end if;
  if p_daily_shots <= 0 or p_operation_days <= 0 then
    raise exception '수량과 구동일수는 1 이상의 정수여야 합니다.';
  end if;
  if p_mid !~ '^[0-9]+$' then
    raise exception 'MID 형식이 올바르지 않습니다.';
  end if;
  if char_length(trim(p_store_name)) < 1 or char_length(trim(p_keyword)) < 1 then
    raise exception '상호명과 대표 키워드를 입력해야 합니다.';
  end if;
  if char_length(coalesce(p_memo, '')) > 300 then
    raise exception '메모는 300자 이하로 입력해야 합니다.';
  end if;

  select * into settings from public.app_settings where id = true;
  local_now := now() at time zone 'Asia/Seoul';
  calculated_start := local_now::date + case when extract(hour from local_now) >= settings.cutoff_hour then 2 else 1 end;
  calculated_end := calculated_start + (p_operation_days - 1);

  supply := p_daily_shots::bigint * p_operation_days::bigint * member.price_per_shot::bigint;
  vat := round(supply * 0.1);
  number := 'SP-' || to_char(local_now::date, 'YYYYMMDD') || '-' || lpad(nextval('public.order_number_seq')::text, 6, '0');

  insert into public.orders (
    order_number, created_by, creator_username, place_url, mid, store_name, keyword,
    daily_shots, operation_days, price_per_shot, supply_amount, vat_amount, total_amount,
    start_date, end_date, memo
  ) values (
    number, member.id, member.username, trim(p_place_url), p_mid, trim(p_store_name), trim(p_keyword),
    p_daily_shots, p_operation_days, member.price_per_shot, supply, vat, supply + vat,
    calculated_start, calculated_end, coalesce(p_memo, '')
  ) returning * into result;

  insert into public.notifications (user_id, title, message, order_id)
  values (member.id, '작업 접수 완료', trim(p_store_name) || ' 작업이 입금대기 상태로 접수되었습니다.', result.id);

  return result;
end;
$$;

create or replace function public.set_order_status(
  p_order_id uuid,
  p_status public.order_status
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  current_order public.orders;
  result public.orders;
  notice_title text;
  notice_message text;
begin
  if not public.is_admin() then
    raise exception '관리자만 상태를 변경할 수 있습니다.';
  end if;

  select * into current_order from public.orders where id = p_order_id for update;
  if current_order.id is null then
    raise exception '작업을 찾을 수 없습니다.';
  end if;
  if current_order.status = p_status then
    return current_order;
  end if;

  update public.orders
  set status = p_status,
      activated_at = case
        when p_status = '구동중' and current_order.status <> '구동중' then now()
        when p_status in ('입금대기', '입금완료') then null
        else current_order.activated_at
      end,
      stopped_at = case when p_status = '정지' then now() else null end,
      payment_notified_at = case when p_status = '입금완료' then coalesce(current_order.payment_notified_at, now()) else current_order.payment_notified_at end
  where id = p_order_id
  returning * into result;

  notice_title := case
    when p_status = '입금완료' then '입금 확인 완료'
    when p_status = '구동중' then '작업 구동 시작'
    when p_status = '정지' then '작업 정지'
    when p_status = '만료' then '작업 기간 만료'
    else '작업 상태 변경'
  end;
  notice_message := result.store_name || ' 작업 상태가 ' || p_status::text || '(으)로 변경되었습니다.';

  insert into public.notifications (user_id, title, message, order_id)
  values (result.created_by, notice_title, notice_message, result.id);

  return result;
end;
$$;

create or replace function public.review_member(
  p_member_id uuid,
  p_role public.member_role,
  p_price_per_shot integer,
  p_approval_status public.approval_status
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.profiles;
begin
  if not public.is_admin() then
    raise exception '관리자만 회원을 승인할 수 있습니다.';
  end if;
  if p_approval_status not in ('approved', 'rejected') then
    raise exception '승인 또는 반려만 처리할 수 있습니다.';
  end if;
  if p_approval_status = 'approved' and (p_role not in ('agency', 'distributor') or p_price_per_shot < 1) then
    raise exception '회원 유형과 1타당 단가를 확인해 주세요.';
  end if;

  update public.profiles
  set role = case when p_approval_status = 'approved' then p_role else role end,
      price_per_shot = case when p_approval_status = 'approved' then p_price_per_shot else price_per_shot end,
      approval_status = p_approval_status,
      active = p_approval_status = 'approved',
      approved_at = case when p_approval_status = 'approved' then coalesce(approved_at, now()) else approved_at end
  where id = p_member_id and coalesce(role::text, '') <> 'admin'
  returning * into result;

  if result.id is null then
    raise exception '회원을 찾을 수 없습니다.';
  end if;

  insert into public.notifications (user_id, title, message)
  values (
    result.id,
    case when p_approval_status = 'approved' then '회원가입 승인 완료' else '회원가입 반려' end,
    case when p_approval_status = 'approved'
      then case when p_role = 'distributor' then '총판' else '대행사' end || ' 회원으로 승인되었습니다. 1타당 단가는 ' || p_price_per_shot || '원입니다.'
      else '회원가입 신청이 반려되었습니다.'
    end
  );

  return result;
end;
$$;

-- Run every day at 00:00 UTC, which is 09:00 in Asia/Seoul.
create or replace function public.start_paid_orders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.orders;
  changed integer := 0;
begin
  for target in
    select * from public.orders
    where status = '입금완료'
      and start_date <= (now() at time zone 'Asia/Seoul')::date
      and end_date >= (now() at time zone 'Asia/Seoul')::date
      and (now() at time zone 'Asia/Seoul')::time >= make_time(
        (select auto_start_hour from public.app_settings where id = true),
        0,
        0
      )
    for update
  loop
    update public.orders set status = '구동중', activated_at = coalesce(activated_at, now()) where id = target.id;
    insert into public.notifications (user_id, title, message, order_id)
    values (target.created_by, '구동 자동 시작', target.store_name || ' 작업이 오전 9시에 구동중으로 변경되었습니다.', target.id);
    changed := changed + 1;
  end loop;
  return changed;
end;
$$;

-- Run shortly after Seoul midnight. A stopped order keeps its original end date.
create or replace function public.expire_finished_orders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.orders;
  changed integer := 0;
begin
  for target in
    select * from public.orders
    where status in ('입금완료', '구동중', '정지')
      and end_date < (now() at time zone 'Asia/Seoul')::date
    for update
  loop
    update public.orders set status = '만료' where id = target.id;
    insert into public.notifications (user_id, title, message, order_id)
    values (target.created_by, '작업 기간 만료', target.store_name || ' 작업이 종료일 경과로 만료 처리되었습니다.', target.id);
    changed := changed + 1;
  end loop;
  return changed;
end;
$$;

revoke all on function public.create_order(text, text, text, text, integer, integer, text) from public;
revoke all on function public.set_order_status(uuid, public.order_status) from public;
revoke all on function public.review_member(uuid, public.member_role, integer, public.approval_status) from public;
grant execute on function public.create_order(text, text, text, text, integer, integer, text) to authenticated;
grant execute on function public.set_order_status(uuid, public.order_status) to authenticated;
grant execute on function public.review_member(uuid, public.member_role, integer, public.approval_status) to authenticated;
revoke all on function public.start_paid_orders() from public, anon, authenticated;
revoke all on function public.expire_finished_orders() from public, anon, authenticated;

-- Enable low-volume Postgres Changes subscriptions for multi-PC synchronization.
do $$
declare
  table_name text;
begin
  foreach table_name in array array['profiles', 'orders', 'notifications', 'notices', 'app_settings']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end $$;
-- SPARK v6 update: referral hierarchy, multi-level settlement, bulk orders, midnight start
-- Existing Supabase projects: run this file once in SQL Editor.
-- This migration does not delete existing profiles, orders, notifications, or notices.

begin;

-- 1. Profile hierarchy and account fields
alter table public.profiles add column if not exists sponsor_id uuid references public.profiles(id) on delete set null;
alter table public.profiles add column if not exists sponsor_username text;
alter table public.profiles add column if not exists referral_code text;
alter table public.profiles add column if not exists group_name text not null default '';
alter table public.profiles add column if not exists hierarchy_depth integer not null default 0 check (hierarchy_depth between 0 and 25);
alter table public.profiles add column if not exists bank text not null default '';
alter table public.profiles add column if not exists account_number text not null default '';
alter table public.profiles add column if not exists account_holder text not null default '';

update public.profiles
set referral_code = 'SP' || upper(substr(replace(id::text, '-', ''), 1, 12))
where coalesce(trim(referral_code), '') = '';

alter table public.profiles alter column referral_code set not null;
create unique index if not exists profiles_referral_code_lower_key on public.profiles (lower(referral_code));
create index if not exists profiles_sponsor_idx on public.profiles(sponsor_id, approval_status, requested_at desc);

-- Existing direct members remain administrator-direct. Existing admins get a visible group label.
update public.profiles set group_name = '관리자' where role = 'admin' and group_name = '';

-- 2. Order snapshots for administrator identification
alter table public.orders add column if not exists sponsor_id uuid references public.profiles(id) on delete set null;
alter table public.orders add column if not exists sponsor_username text;
alter table public.orders add column if not exists creator_group_name text not null default '';

update public.orders o
set sponsor_id = p.sponsor_id,
    sponsor_username = p.sponsor_username,
    creator_group_name = p.group_name
from public.profiles p
where p.id = o.created_by
  and (o.sponsor_id is distinct from p.sponsor_id
    or o.sponsor_username is distinct from p.sponsor_username
    or o.creator_group_name is distinct from p.group_name);

create index if not exists orders_sponsor_idx on public.orders(sponsor_id, created_at);
create index if not exists orders_group_idx on public.orders(creator_group_name, created_at);

-- 3. Midnight automatic start
alter table public.app_settings drop constraint if exists app_settings_auto_start_hour_check;
alter table public.app_settings alter column auto_start_hour set default 0;
update public.app_settings set auto_start_hour = 0 where id = true;
alter table public.app_settings add constraint app_settings_auto_start_hour_check check (auto_start_hour = 0);

-- 4. Multi-level payment chain
create table if not exists public.payment_steps (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  order_number text not null,
  store_name text not null,
  step_order integer not null check (step_order between 1 and 25),
  payer_id uuid not null references public.profiles(id),
  payer_username text not null,
  payee_id uuid not null references public.profiles(id),
  payee_username text not null,
  unit_price integer not null check (unit_price > 0),
  supply_amount bigint not null check (supply_amount >= 0),
  vat_amount bigint not null check (vat_amount >= 0),
  total_amount bigint not null check (total_amount = supply_amount + vat_amount),
  confirmed_at timestamptz,
  confirmed_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique(order_id, step_order)
);

create index if not exists payment_steps_payer_idx on public.payment_steps(payer_id, confirmed_at, created_at);
create index if not exists payment_steps_payee_idx on public.payment_steps(payee_id, confirmed_at, created_at);
create index if not exists payment_steps_order_idx on public.payment_steps(order_id, step_order);

alter table public.payment_steps enable row level security;
drop policy if exists "payment steps participant read" on public.payment_steps;
create policy "payment steps participant read" on public.payment_steps
for select to authenticated
using (public.is_admin() or payer_id = auth.uid() or payee_id = auth.uid());

grant select on public.payment_steps to authenticated;

-- Backfill one administrator payment step for old orders. New orders use the full hierarchy.
insert into public.payment_steps (
  order_id, order_number, store_name, step_order,
  payer_id, payer_username, payee_id, payee_username,
  unit_price, supply_amount, vat_amount, total_amount,
  confirmed_at, confirmed_by, created_at
)
select
  o.id, o.order_number, o.store_name, 1,
  o.created_by, o.creator_username, a.id, a.username,
  o.price_per_shot, o.supply_amount, o.vat_amount, o.total_amount,
  case when o.status = '입금대기' then null else coalesce(o.payment_notified_at, o.updated_at) end,
  case when o.status = '입금대기' then null else a.id end,
  o.created_at
from public.orders o
cross join lateral (
  select id, username from public.profiles
  where role = 'admin' and approval_status = 'approved' and active
  order by approved_at nulls last
  limit 1
) a
where not exists (select 1 from public.payment_steps ps where ps.order_id = o.id);

-- 5. Permission helpers
create or replace function public.can_read_profile(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_profile_id = auth.uid()
    or public.is_admin()
    or exists (
      select 1 from public.profiles child
      where child.id = p_profile_id and child.sponsor_id = auth.uid()
    )
    or exists (
      select 1 from public.profiles me
      where me.id = auth.uid() and me.sponsor_id = p_profile_id
    );
$$;

revoke all on function public.can_read_profile(uuid) from public, anon;
grant execute on function public.can_read_profile(uuid) to authenticated;

drop policy if exists "profile self read" on public.profiles;
drop policy if exists "admin profiles read" on public.profiles;
drop policy if exists "profile hierarchy read" on public.profiles;
create policy "profile hierarchy read" on public.profiles
for select to authenticated
using (public.can_read_profile(id));

create or replace function public.notify_admins(
  p_title text,
  p_message text,
  p_order_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer;
begin
  insert into public.notifications (user_id, target_role, title, message, order_id)
  select id, 'admin', p_title, p_message, p_order_id
  from public.profiles
  where role = 'admin' and approval_status = 'approved' and active;
  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

revoke all on function public.notify_admins(text, text, uuid) from public, anon, authenticated;

-- 6. Signup trigger: optional sponsor username/referral code
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username text;
  v_username_key text;
  v_referral_input text;
  v_sponsor public.profiles;
  v_referral_code text;
begin
  v_username := trim(coalesce(new.raw_user_meta_data ->> 'username', ''));
  v_username_key := lower(trim(coalesce(new.raw_user_meta_data ->> 'username_key', v_username)));
  v_referral_input := lower(trim(coalesce(new.raw_user_meta_data ->> 'referral_code', '')));

  if char_length(v_username) < 4 or char_length(v_username) > 40 or v_username ~ '[[:cntrl:]]' then
    raise exception '아이디는 종류와 관계없이 4~40자로 입력해야 합니다.';
  end if;

  if v_referral_input <> '' then
    select * into v_sponsor
    from public.profiles
    where approval_status = 'approved'
      and active
      and role in ('agency', 'distributor')
      and (username_key = v_referral_input or lower(referral_code) = v_referral_input)
    limit 1;

    if v_sponsor.id is null then
      raise exception '유효한 추천인 아이디 또는 코드를 찾을 수 없습니다.';
    end if;
    if v_sponsor.hierarchy_depth >= 24 then
      raise exception '추천 계층의 최대 깊이를 초과했습니다.';
    end if;
  end if;

  v_referral_code := 'SP' || upper(substr(replace(new.id::text, '-', ''), 1, 12));

  insert into public.profiles (
    id, username, username_key, role, sponsor_id, sponsor_username,
    referral_code, group_name, hierarchy_depth
  ) values (
    new.id, v_username, v_username_key,
    case when v_sponsor.id is null then null else 'agency'::public.member_role end,
    v_sponsor.id, v_sponsor.username,
    v_referral_code, coalesce(v_sponsor.group_name, ''), coalesce(v_sponsor.hierarchy_depth + 1, 0)
  );

  if v_sponsor.id is not null then
    insert into public.notifications (user_id, target_role, title, message)
    values (v_sponsor.id, v_sponsor.role, '하위 대행사 승인 요청', v_username || ' 회원이 추천 코드를 사용해 가입했습니다. 단가를 지정해 승인해 주세요.');
    perform public.notify_admins('추천 회원가입 신청', v_username || ' 회원이 ' || v_sponsor.username || ' 추천으로 가입했습니다.', null);
  else
    perform public.notify_admins('회원가입 승인 요청', v_username || ' 회원의 가입 승인이 필요합니다.', null);
  end if;

  return new;
end;
$$;

-- 7. Settlement account APIs
create or replace function public.save_my_settlement_account(
  p_bank text,
  p_account_number text,
  p_account_holder text
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.profiles;
begin
  if char_length(trim(coalesce(p_bank, ''))) < 1
    or char_length(trim(coalesce(p_account_number, ''))) < 1
    or char_length(trim(coalesce(p_account_holder, ''))) < 1 then
    raise exception '은행, 계좌번호, 예금주를 모두 입력해 주세요.';
  end if;

  update public.profiles
  set bank = trim(p_bank),
      account_number = trim(p_account_number),
      account_holder = trim(p_account_holder)
  where id = auth.uid() and role in ('agency', 'distributor')
  returning * into result;

  if result.id is null then raise exception '계좌를 저장할 수 있는 회원이 아닙니다.'; end if;
  return result;
end;
$$;

create or replace function public.get_my_payment_account()
returns table (
  payee_id uuid,
  payee_username text,
  bank text,
  account_number text,
  account_holder text,
  source text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me public.profiles;
  sponsor public.profiles;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.id is null then return; end if;

  if me.sponsor_id is not null then
    select * into sponsor from public.profiles where id = me.sponsor_id;
    return query select sponsor.id, sponsor.username, sponsor.bank, sponsor.account_number, sponsor.account_holder, 'sponsor'::text;
  else
    return query
      select a.id, a.username, s.bank, s.account_number, s.account_holder, 'admin'::text
      from public.app_settings s
      left join lateral (
        select id, username from public.profiles
        where role = 'admin' and approval_status = 'approved' and active
        order by approved_at nulls last limit 1
      ) a on true
      where s.id = true;
  end if;
end;
$$;

revoke all on function public.save_my_settlement_account(text, text, text) from public, anon;
revoke all on function public.get_my_payment_account() from public, anon;
grant execute on function public.save_my_settlement_account(text, text, text) to authenticated;
grant execute on function public.get_my_payment_account() to authenticated;

-- 8. Admin or direct sponsor member review
create or replace function public.review_member_v6(
  p_member_id uuid,
  p_role public.member_role,
  p_price_per_shot integer,
  p_approval_status public.approval_status,
  p_group_name text default ''
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles;
  target public.profiles;
  sponsor public.profiles;
  result public.profiles;
  final_role public.member_role;
  final_group text;
begin
  select * into actor from public.profiles where id = auth.uid();
  select * into target from public.profiles where id = p_member_id for update;
  if actor.id is null or target.id is null then raise exception '회원 정보를 찾을 수 없습니다.'; end if;
  if target.role = 'admin' then raise exception '관리자 계정은 수정할 수 없습니다.'; end if;
  if p_approval_status not in ('approved', 'rejected') then raise exception '승인 또는 반려만 처리할 수 있습니다.'; end if;

  if actor.role = 'admin' and actor.approval_status = 'approved' and actor.active then
    if target.sponsor_id is not null and target.approval_status = 'pending' then
      raise exception '추천 가입 회원은 직접 추천인이 승인해야 합니다.';
    end if;
    if target.sponsor_id is null then
      if p_role not in ('agency', 'distributor') then raise exception '회원 유형을 확인해 주세요.'; end if;
      final_role := p_role;
      final_group := trim(p_group_name);
      if p_approval_status = 'approved' and final_group = '' then raise exception '관리자용 그룹명을 입력해 주세요.'; end if;
    else
      select * into sponsor from public.profiles where id = target.sponsor_id;
      final_role := 'agency';
      final_group := coalesce(nullif(trim(p_group_name), ''), sponsor.group_name);
      if p_approval_status = 'approved' and p_price_per_shot <= sponsor.price_per_shot then
        raise exception '하위 대행사 단가는 상위 회원 단가보다 높아야 합니다.';
      end if;
    end if;
  elsif actor.role in ('agency', 'distributor') and actor.approval_status = 'approved' and actor.active then
    if target.sponsor_id is distinct from actor.id then raise exception '직접 추천한 회원만 관리할 수 있습니다.'; end if;
    final_role := 'agency';
    final_group := actor.group_name;
    if p_approval_status = 'approved' then
      if actor.bank = '' or actor.account_number = '' or actor.account_holder = '' then
        raise exception '내 정보에서 하위 대행사 입금 계좌를 먼저 등록해 주세요.';
      end if;
      if p_price_per_shot <= actor.price_per_shot then
        raise exception '하위 대행사 단가는 내 단가보다 높아야 합니다.';
      end if;
    end if;
  else
    raise exception '회원 승인 권한이 없습니다.';
  end if;

  if p_approval_status = 'approved' and p_price_per_shot < 1 then raise exception '1타당 단가를 확인해 주세요.'; end if;
  if p_approval_status = 'approved' and exists (
    select 1 from public.profiles child
    where child.sponsor_id = target.id
      and child.approval_status = 'approved'
      and child.active
      and child.price_per_shot <= p_price_per_shot
  ) then
    raise exception '이 회원의 단가는 승인된 하위 회원 단가보다 낮아야 합니다.';
  end if;

  update public.profiles
  set role = case when p_approval_status = 'approved' then final_role else role end,
      price_per_shot = case when p_approval_status = 'approved' then p_price_per_shot else price_per_shot end,
      group_name = case when p_approval_status = 'approved' then final_group else group_name end,
      approval_status = p_approval_status,
      active = p_approval_status = 'approved',
      approved_at = case when p_approval_status = 'approved' then coalesce(approved_at, now()) else approved_at end
  where id = p_member_id
  returning * into result;

  if actor.role = 'admin' and p_approval_status = 'approved' and final_group <> '' then
    with recursive member_tree as (
      select id from public.profiles where id = result.id
      union all
      select child.id from public.profiles child join member_tree parent on child.sponsor_id = parent.id
    )
    update public.profiles set group_name = final_group where id in (select id from member_tree);
    select * into result from public.profiles where id = p_member_id;
  end if;

  insert into public.notifications (user_id, title, message)
  values (
    result.id,
    case when p_approval_status = 'approved' then '회원가입 승인 완료' else '회원가입 반려' end,
    case when p_approval_status = 'approved'
      then '대행사 회원으로 승인되었습니다. 1타당 단가는 ' || p_price_per_shot || '원입니다.'
      else '회원가입 신청이 반려되었습니다.' end
  );

  if actor.role <> 'admin' then
    perform public.notify_admins('추천 회원 승인 처리', actor.username || ' 회원이 ' || result.username || ' 회원을 ' || case when p_approval_status = 'approved' then '승인했습니다.' else '반려했습니다.' end, null);
  end if;
  return result;
end;
$$;

revoke all on function public.review_member_v6(uuid, public.member_role, integer, public.approval_status, text) from public, anon;
grant execute on function public.review_member_v6(uuid, public.member_role, integer, public.approval_status, text) to authenticated;

-- 9. Replace order creation with hierarchy snapshots and payment steps
create or replace function public.create_order(
  p_place_url text,
  p_mid text,
  p_store_name text,
  p_keyword text,
  p_daily_shots integer,
  p_operation_days integer,
  p_memo text default ''
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  member public.profiles;
  settings public.app_settings;
  result public.orders;
  number text;
  local_now timestamp;
  calculated_start date;
  calculated_end date;
  supply bigint;
  vat bigint;
  v_payer public.profiles;
  v_payee public.profiles;
  v_admin public.profiles;
  v_step integer := 1;
  v_step_supply bigint;
  v_step_vat bigint;
begin
  select * into member from public.profiles where id = auth.uid() for update;
  if member.id is null or member.role not in ('agency', 'distributor') or member.approval_status <> 'approved' or not member.active or member.price_per_shot <= 0 then
    raise exception '승인된 대행사 또는 총판만 접수할 수 있습니다.';
  end if;
  if p_daily_shots <= 0 or p_operation_days <= 0 then raise exception '수량과 구동일수는 1 이상의 정수여야 합니다.'; end if;
  if p_mid !~ '^[0-9]+$' then raise exception 'MID 형식이 올바르지 않습니다.'; end if;
  if char_length(trim(p_store_name)) < 1 or char_length(trim(p_keyword)) < 1 then raise exception '상호명과 대표 키워드를 입력해야 합니다.'; end if;
  if char_length(coalesce(p_memo, '')) > 300 then raise exception '메모는 300자 이하로 입력해야 합니다.'; end if;

  select * into settings from public.app_settings where id = true;
  select * into v_admin from public.profiles where role = 'admin' and approval_status = 'approved' and active order by approved_at nulls last limit 1;
  if v_admin.id is null then raise exception '승인된 관리자 계정을 찾을 수 없습니다.'; end if;

  local_now := now() at time zone 'Asia/Seoul';
  calculated_start := local_now::date + case when extract(hour from local_now) >= settings.cutoff_hour then 2 else 1 end;
  calculated_end := calculated_start + (p_operation_days - 1);
  supply := p_daily_shots::bigint * p_operation_days::bigint * member.price_per_shot::bigint;
  vat := round(supply * 0.1);
  number := 'SP-' || to_char(local_now::date, 'YYYYMMDD') || '-' || lpad(nextval('public.order_number_seq')::text, 6, '0');

  insert into public.orders (
    order_number, created_by, creator_username, sponsor_id, sponsor_username, creator_group_name,
    place_url, mid, store_name, keyword, daily_shots, operation_days, price_per_shot,
    supply_amount, vat_amount, total_amount, start_date, end_date, memo
  ) values (
    number, member.id, member.username, member.sponsor_id, member.sponsor_username, member.group_name,
    trim(p_place_url), p_mid, trim(p_store_name), trim(p_keyword), p_daily_shots, p_operation_days, member.price_per_shot,
    supply, vat, supply + vat, calculated_start, calculated_end, coalesce(p_memo, '')
  ) returning * into result;

  v_payer := member;
  loop
    if v_payer.sponsor_id is null then
      v_payee := v_admin;
    else
      select * into v_payee from public.profiles where id = v_payer.sponsor_id;
      if v_payee.id is null or v_payee.approval_status <> 'approved' or not v_payee.active then raise exception '상위 회원 정보를 확인할 수 없습니다.'; end if;
    end if;

    v_step_supply := p_daily_shots::bigint * p_operation_days::bigint * v_payer.price_per_shot::bigint;
    v_step_vat := round(v_step_supply * 0.1);
    insert into public.payment_steps (
      order_id, order_number, store_name, step_order,
      payer_id, payer_username, payee_id, payee_username,
      unit_price, supply_amount, vat_amount, total_amount
    ) values (
      result.id, result.order_number, result.store_name, v_step,
      v_payer.id, v_payer.username, v_payee.id, v_payee.username,
      v_payer.price_per_shot, v_step_supply, v_step_vat, v_step_supply + v_step_vat
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
  perform public.notify_admins('새 작업 접수', member.username || ' 회원이 ' || trim(p_store_name) || ' 작업을 접수했습니다. 상위회원: ' || coalesce(member.sponsor_username, '관리자') || ', 그룹: ' || coalesce(nullif(member.group_name, ''), '-'), result.id);
  return result;
end;
$$;

create or replace function public.create_orders_bulk(p_items jsonb)
returns setof public.orders
language plpgsql
security definer
set search_path = public
as $$
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
    select * into result from public.create_order(
      item ->> 'place_url', item ->> 'mid', item ->> 'store_name', item ->> 'keyword',
      (item ->> 'daily_shots')::integer, (item ->> 'operation_days')::integer,
      coalesce(item ->> 'memo', '')
    );
    return next result;
  end loop;
end;
$$;

revoke all on function public.create_orders_bulk(jsonb) from public, anon;
grant execute on function public.create_orders_bulk(jsonb) to authenticated;

-- 10. Each payee confirms only their payment step. The order becomes paid when every step is confirmed.
create or replace function public.confirm_payment_step(p_step_id uuid)
returns public.payment_steps
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles;
  step public.payment_steps;
  result public.payment_steps;
  target_order public.orders;
  pending_count integer;
  next_step public.payment_steps;
begin
  select * into actor from public.profiles where id = auth.uid();
  select * into step from public.payment_steps where id = p_step_id for update;
  if actor.id is null or step.id is null then raise exception '정산 단계를 찾을 수 없습니다.'; end if;
  if step.payee_id <> actor.id then raise exception '입금 수취인만 확인할 수 있습니다.'; end if;
  if step.confirmed_at is not null then return step; end if;

  update public.payment_steps
  set confirmed_at = now(), confirmed_by = actor.id
  where id = p_step_id
  returning * into result;

  insert into public.notifications (user_id, title, message, order_id)
  values (result.payer_id, '입금 확인 완료', result.payee_username || ' 회원이 ' || result.store_name || ' 작업 입금을 확인했습니다.', result.order_id);

  select count(*) into pending_count from public.payment_steps where order_id = result.order_id and confirmed_at is null;
  if pending_count = 0 then
    update public.orders
    set status = case when status = '입금대기' then '입금완료'::public.order_status else status end,
        payment_notified_at = coalesce(payment_notified_at, now())
    where id = result.order_id
    returning * into target_order;

    insert into public.notifications (user_id, title, message, order_id)
    values (target_order.created_by, '전체 입금 확인 완료', target_order.store_name || ' 작업의 모든 상위 정산 단계가 확인되었습니다.', target_order.id);
    perform public.notify_admins('작업 입금완료', target_order.creator_username || ' 회원의 ' || target_order.store_name || ' 작업이 입금완료 처리되었습니다.', target_order.id);
  else
    select * into next_step
    from public.payment_steps
    where order_id = result.order_id and payer_id = actor.id and confirmed_at is null
    order by step_order
    limit 1;
    if next_step.id is not null then
      insert into public.notifications (user_id, title, message, order_id)
      values (actor.id, '상위 정산 필요', next_step.payee_username || ' 회원에게 ' || next_step.total_amount || '원을 정산해 주세요.', result.order_id);
    end if;
  end if;
  return result;
end;
$$;

revoke all on function public.confirm_payment_step(uuid) from public, anon;
grant execute on function public.confirm_payment_step(uuid) to authenticated;

-- 11. Start at Seoul midnight; expire after the original end date.
create or replace function public.start_paid_orders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.orders;
  changed integer := 0;
begin
  for target in
    select * from public.orders
    where status = '입금완료'
      and start_date <= (now() at time zone 'Asia/Seoul')::date
      and end_date >= (now() at time zone 'Asia/Seoul')::date
    for update
  loop
    update public.orders set status = '구동중', activated_at = coalesce(activated_at, now()) where id = target.id;
    insert into public.notifications (user_id, title, message, order_id)
    values (target.created_by, '구동 자동 시작', target.store_name || ' 작업이 시작일 자정 기준으로 구동중으로 변경되었습니다.', target.id);
    changed := changed + 1;
  end loop;
  return changed;
end;
$$;

create or replace function public.expire_finished_orders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.orders;
  changed integer := 0;
begin
  for target in
    select * from public.orders
    where status in ('입금완료', '구동중', '정지')
      and end_date < (now() at time zone 'Asia/Seoul')::date
    for update
  loop
    update public.orders set status = '만료' where id = target.id;
    insert into public.notifications (user_id, title, message, order_id)
    values (target.created_by, '작업 기간 만료', target.store_name || ' 작업이 종료일 경과로 만료 처리되었습니다.', target.id);
    changed := changed + 1;
  end loop;
  return changed;
end;
$$;

-- 12. Realtime for the new payment table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'payment_steps'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.payment_steps;
  END IF;
END $$;

commit;
