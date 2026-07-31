select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'profiles'
  and column_name in ('spark_price_per_shot', 'spark_plus_price_per_shot', 'spark_s_price_per_shot');

select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'orders'
  and column_name = 'program_type';

select proname
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('review_member_v8', 'create_order', 'create_orders_bulk', 'confirm_payment_step', 'delete_order')
order by proname;
