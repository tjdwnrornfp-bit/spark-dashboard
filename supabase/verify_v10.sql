-- Post-migration verification for SPARK v10.0.0.
do $$
declare
  v_non_40 bigint;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'spark_s_plus_price_per_shot'
      and is_nullable = 'NO'
  ) then
    raise exception 'spark_s_plus_price_per_shot 컬럼이 없거나 NULL을 허용합니다.';
  end if;

  select count(*) into v_non_40
  from public.profiles
  where spark_s_plus_price_per_shot <> 40;
  if v_non_40 > 0 then
    raise exception '기존 회원 40원 backfill 미적용 프로필: %건', v_non_40;
  end if;

  if to_regprocedure('public.review_member_v10(uuid,public.member_role,boolean,integer,integer,integer,integer,public.approval_status,text,timestamp with time zone)') is null
     or to_regprocedure('public.create_order_v10(text,text,text,text,text,integer,integer,date,text)') is null
     or to_regprocedure('public.create_orders_bulk_v10(jsonb)') is null then
    raise exception 'v10 회원 승인/접수 RPC가 없습니다.';
  end if;

  if position('spark_s_plus' in pg_get_functiondef('public.get_approved_program_price_v99(uuid,text)'::regprocedure)) = 0
     or position('spark_s_plus' in pg_get_functiondef('public.preview_order_program_transfer_v99(uuid,text,integer)'::regprocedure)) = 0
     or position('spark_s_plus' in pg_get_functiondef('public.transfer_bulk_order_program_v910(jsonb,text,text)'::regprocedure)) = 0
     or position('sparkSPlusRunningUnits' in pg_get_functiondef('public.get_admin_company_overview_v96(integer,integer,text,text)'::regprocedure)) = 0
     or position('registrantSparkSPlusCount' in pg_get_functiondef('public.get_my_settlement_page_v94(integer,integer,text,uuid,uuid,text,text,text,date,date)'::regprocedure)) = 0 then
    raise exception '기존 RPC 중 스파크S+ 확장이 누락되었습니다.';
  end if;
end $$;

select
  count(*) as profile_count,
  count(*) filter (where spark_s_plus_price_per_shot = 40) as profiles_at_initial_40,
  count(*) filter (where spark_s_plus_price_per_shot is null) as null_prices,
  min(spark_s_plus_price_per_shot) as minimum_price,
  max(spark_s_plus_price_per_shot) as maximum_price
from public.profiles;

select conrelid::regclass::text as table_name, conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conname in (
  'orders_program_type_check',
  'payment_steps_program_type_check',
  'order_program_transfers_before_program_check',
  'order_program_transfers_after_program_check',
  'profiles_spark_s_plus_price_per_shot_check'
)
order by table_name, conname;

select version, description, applied_at
from public.app_schema_versions
where version = 'v10.0.0';
