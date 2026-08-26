-- Read-only preflight for SPARK v10.0.0.
select version, description, applied_at
from public.app_schema_versions
order by applied_at desc
limit 5;

select
  to_regclass('public.profiles') is not null as profiles_ready,
  to_regclass('public.orders') is not null as orders_ready,
  to_regclass('public.payment_steps') is not null as payment_steps_ready,
  to_regclass('public.order_program_transfers') is not null as transfers_ready,
  to_regprocedure('public.review_member_v93(uuid,public.member_role,boolean,integer,integer,integer,public.approval_status,text,timestamp with time zone)') is not null as member_review_v93_ready,
  to_regprocedure('public.preview_order_program_transfer_v99(uuid,text,integer)') is not null as transfer_preview_v99_ready,
  to_regprocedure('public.transfer_order_program_v99(uuid,text,integer,text)') is not null as transfer_v99_ready,
  to_regprocedure('public.preview_bulk_order_program_transfer_v910(jsonb,text)') is not null as bulk_preview_v910_ready,
  to_regprocedure('public.transfer_bulk_order_program_v910(jsonb,text,text)') is not null as bulk_transfer_v910_ready;

select
  count(*) as existing_profiles,
  count(*) filter (where role = 'admin') as admin_profiles,
  count(*) filter (where approval_status = 'approved' and active) as active_approved_profiles
from public.profiles;

select
  count(*) as existing_orders,
  count(*) filter (where program_type not in ('spark', 'spark_plus', 'spark_s')) as unexpected_program_types
from public.orders;

select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'profiles'
  and column_name = 'spark_s_plus_price_per_shot';
