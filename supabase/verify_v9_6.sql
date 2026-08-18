-- SPARK v9.6 적용 확인
select
  exists(select 1 from public.app_schema_versions where version = 'v9.6.0') as version_v9_6,
  to_regprocedure('public.get_admin_company_overview_v96(integer,integer,text,text)') is not null as company_overview_rpc_installed;

select version, description, applied_at
from public.app_schema_versions
where version = 'v9.6.0';

-- 아래 호출은 관리자 로그인 세션에서 앱을 통해 실행됩니다.
-- SQL Editor는 auth.uid()가 없으므로 RPC 직접 호출 검증에는 적합하지 않습니다.
