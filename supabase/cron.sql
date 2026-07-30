-- SPARK 자동 상태 처리 Cron
-- Supabase Dashboard > Integrations > Cron에서 Cron 모듈을 먼저 활성화한 뒤 실행합니다.
-- Cron 식은 UTC 기준입니다.

-- 같은 파일을 다시 실행해도 중복 Job이 남지 않게 기존 Job을 제거합니다.
select cron.unschedule(jobid)
from cron.job
where jobname in ('spark-start-paid-orders', 'spark-expire-finished-orders');

-- 한국 시간 09:00~23:55 사이 5분 간격 실행.
-- 시작일이 도래한 입금완료 작업을 구동중으로 변경합니다.
-- 09:00 이후 입금완료 처리된 작업도 최대 5분 안에 구동중으로 변경됩니다.
select cron.schedule(
  'spark-start-paid-orders',
  '*/5 0-14 * * *',
  $$select public.start_paid_orders();$$
);

-- 하루 종일 5분 간격 실행.
-- 한국 날짜가 종료일을 지난 작업을 만료로 변경합니다.
-- 정지 작업도 종료일을 연장하지 않고 동일하게 만료됩니다.
select cron.schedule(
  'spark-expire-finished-orders',
  '*/5 * * * *',
  $$select public.expire_finished_orders();$$
);

-- 등록 결과 확인
select jobid, jobname, schedule, command, active
from cron.job
where jobname in ('spark-start-paid-orders', 'spark-expire-finished-orders')
order by jobname;
