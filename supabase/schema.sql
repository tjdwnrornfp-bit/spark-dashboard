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
