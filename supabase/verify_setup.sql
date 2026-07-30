-- SPARK Supabase 설치 점검용 SQL

-- 1. 필수 테이블
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('profiles', 'orders', 'notifications', 'notices', 'app_settings')
order by table_name;

-- 2. RLS 활성화 여부
select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('profiles', 'orders', 'notifications', 'notices', 'app_settings')
order by c.relname;

-- 3. Realtime publication 등록 여부
select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
  and schemaname = 'public'
  and tablename in ('profiles', 'orders', 'notifications', 'notices', 'app_settings')
order by tablename;

-- 4. 자동 상태 처리 Cron
-- Cron 모듈이 아직 활성화되지 않았어도 오류 없이 안내만 출력합니다.
do $$
declare
  item record;
begin
  if to_regclass('cron.job') is null then
    raise notice 'Cron 모듈이 아직 활성화되지 않았습니다.';
  else
    for item in execute $query$
      select jobid, jobname, schedule, command, active
      from cron.job
      where jobname in ('spark-start-paid-orders', 'spark-expire-finished-orders')
      order by jobname
    $query$
    loop
      raise notice 'jobid=%, jobname=%, schedule=%, active=%', item.jobid, item.jobname, item.schedule, item.active;
    end loop;
  end if;
end $$;

-- 5. 관리자 계정
select username, role, approval_status, active, requested_at, approved_at
from public.profiles
where role = 'admin'
order by approved_at desc nulls last;

-- 6. 핵심 함수 존재 여부
select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name in ('create_order', 'set_order_status', 'review_member', 'start_paid_orders', 'expire_finished_orders')
order by routine_name;
