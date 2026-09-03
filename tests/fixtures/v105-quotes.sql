-- Settlement quote types for validating the current-group selection path.
create table public.settlement_quote_items(
  quote_id uuid not null,
  payment_step_id uuid not null,
  payer_id uuid not null,
  payer_username text not null,
  expected_amount int8 not null
);
create table public.settlement_quotes(
  id uuid default gen_random_uuid() not null primary key,
  requested_by uuid not null,
  selection_mode text not null,
  filters jsonb default '{}'::jsonb not null,
  item_count int4 default 0 not null,
  expected_amount int8 default 0 not null,
  status text default 'pending'::text not null,
  expires_at timestamptz default (now() + '00:05:00'::interval) not null,
  confirmed_at timestamptz,
  created_at timestamptz default now() not null
);
