# SPARK v10.2.0 적용 가이드

## 적용 순서

1. 운영 Supabase SQL Editor에서 `supabase/preflight_v10_2.sql`을 실행해 최신 버전이 v10.1.0이고 v10.1 정산 역전 RPC 및 필수 컬럼이 존재하는지 확인합니다.
2. 신규 마이그레이션 `supabase/migrations/20260828120000_v10_2_manager_managed_orders.sql` 전체를 한 번 실행합니다. 과거 마이그레이션은 재실행하지 않습니다.
3. `supabase/verify_v10_2.sql`을 실행해 세 RPC, `SECURITY DEFINER`, 빈 `search_path`, anon 실행 차단, authenticated 실행 허용, `manager_id = auth.uid()` 범위 가드를 확인합니다.
4. 애플리케이션 v10.2.0을 배포합니다.
5. 승인·활성 중간관리자 계정으로 로그인해 대시보드 요약, `관리 작업`의 서버 페이지네이션, 필터, 선택/필터 전체 Excel을 확인합니다.

## 신규 읽기 RPC

- `get_manager_managed_orders_v102`: 관리 작업 목록·필터·페이지네이션. 페이지당 최대 500건입니다.
- `get_manager_managed_order_filter_options_v102`: 현재 중간관리자에 연결된 대행사 옵션만 반환합니다.
- `get_manager_managed_orders_summary_v102`: 대시보드용 관리 대행사·전체 작업·구동중·정산대기 요약을 반환합니다.

세 함수 모두 호출자의 `is_operations_manager = true`, `approval_status = approved`, `active = true`를 검사하며, 결과 범위는 `profiles.manager_id = auth.uid()`인 profile과 그 profile의 `orders.created_by`가 일치하는 미보관 주문으로 제한됩니다.

## 안전성

- 신규 읽기 함수와 조회용 인덱스만 추가합니다. 데이터 삭제·수정·이력 재생성은 없습니다.
- 중간관리자에게 기존 쓰기 RPC 실행 권한을 새로 부여하지 않습니다.
- 정산 상태 계산은 `payment_steps`와 주문의 v10.1 상태를 읽기만 하며 immutable batch/history를 수정하지 않습니다.
- 앱만 먼저 배포하면 신규 RPC가 없어서 중간관리자 화면이 오류를 표시하므로, 운영 DB 마이그레이션을 먼저 적용하는 순서를 권장합니다.
