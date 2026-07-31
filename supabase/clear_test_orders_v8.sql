-- 테스트용 작업/정산/알림 데이터 초기화
begin;
delete from public.notifications where order_id is not null;
delete from public.payment_steps;
delete from public.orders;
commit;
