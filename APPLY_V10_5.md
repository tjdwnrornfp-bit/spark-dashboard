# v10.5.0 적용 가이드

## 1. 운영 DB preflight

`supabase/preflight_v10_5_performance.sql`은 읽기 전용입니다. 필수 테이블, helper/RPC, 현재 RLS 정책과 인덱스를 확인합니다.

## 2. 신규 마이그레이션

다음 파일 한 개만 적용합니다. 과거 마이그레이션을 다시 실행하지 않습니다.

`supabase/migrations/20260831082543_optimize_realtime_rls_query_performance.sql`

이 마이그레이션은 운영 데이터 행을 삭제하거나 수정하지 않습니다. RLS SELECT 정책 병합/initPlan 최적화, 3개 인덱스 추가, `app_schema_versions`의 v10.5.0 메타데이터 기록만 수행합니다.

## 3. 검증

`supabase/verify_v10_5_performance.sql`로 다음을 확인합니다.

- manager dashboard/overview, managed orders, admin contacts RPC 보존
- orders/profiles 단일 SELECT 정책과 기존 OR 권한 의미
- payment steps, notifications, settlement RLS의 `(select auth.uid())` 적용
- 신규 인덱스 3개 존재

Performance Advisor에서 이번 범위의 `auth_rls_initplan` 10건과 orders/profiles `multiple_permissive_policies` 2건이 사라졌는지 다시 확인합니다. 의도적으로 제외한 낮은 우선순위 FK 경고는 남을 수 있습니다.

## 4. 앱 배포 후 확인

- 관리자: dashboard, orders, settlement, members, operations
- 중간관리자: dashboard summary/agency overview, managed orders, Excel export
- 일반 대행사: dashboard, program orders, settlement
- Realtime: orders/payment_steps/notifications/notices/settings 변경의 부분 갱신
- 입금확인/취소, 프로그램 변경/일괄 변경, manager 배정, 비밀번호 재설정, Spark S+

Vercel은 main push 뒤 자동 배포합니다. 배포 후 Network에서 초기 진입 시 profiles 전체 및 무제한 notifications 요청이 발생하지 않는지 확인합니다.
