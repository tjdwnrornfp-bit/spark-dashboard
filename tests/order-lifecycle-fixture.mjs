// Sanitized catalog fixtures only. Never connects to the production database.
import { readFileSync, readdirSync } from 'node:fs'
const read = p => readFileSync(p, 'utf8')
const legacy = read('supabase/migrations/20260806064500_v9_stability.sql')
export const lifecycleFixture = [
  read('tests/fixtures/v105-intake.sql'), read('tests/fixtures/v105-quotes.sql'),
  read('supabase/migrations/20260903094128_v10_6_admin_order_assignment.sql'),
  `grant usage on schema spark_private to authenticated;
   alter table order_program_transfers add column order_id uuid references orders(id);
   create table settlement_batch_items(id uuid primary key default gen_random_uuid(),order_id uuid references orders(id),payment_step_id uuid references payment_steps(id));
   alter table settlement_quote_items add foreign key(payment_step_id) references payment_steps(id);
   create function public.audit_payment_steps_trigger() returns trigger language plpgsql security definer set search_path='' as $$begin
     if old.confirmed_at is null and new.confirmed_at is not null then
       perform public.write_audit_log('payment.confirmed','payment',new.id,new.order_number||' '||new.store_name,jsonb_build_object('amount',new.total_amount));
     end if; return new; end$$;
   create trigger payment_audit after update on payment_steps for each row execute function public.audit_payment_steps_trigger();`,
  legacy.slice(legacy.indexOf('create or replace function public.archive_order('), legacy.indexOf('create or replace function public.delete_order(')),
  read('supabase/migrations/' + readdirSync('supabase/migrations').find(f => f.endsWith('_v10_14_admin_order_lifecycle.sql'))),
].join('\n')
if (process.argv.includes('--dump')) process.stdout.write(lifecycleFixture)
