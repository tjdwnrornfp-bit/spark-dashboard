# SPARK v10.4.0 적용 가이드

## 적용 순서

1. 운영 Supabase SQL Editor에서 `supabase/preflight_v10_4.sql`을 실행해 v10.3.0과 기존 중간관리자 조회 RPC가 준비되어 있는지 확인합니다.
2. 신규 migration `supabase/migrations/20260828220000_v10_4_admin_manager_assignment.sql`만 한 번 실행합니다. 과거 migration은 재실행하지 않습니다.
3. `supabase/verify_v10_4.sql`을 실행해 신규 RPC, `SECURITY DEFINER`, 빈 `search_path`, anon 실행 차단, 관리자 서버 검증, optimistic locking, sponsor 미변경 계약, 현재 `manager_id` 기반 조회 범위를 확인합니다.
4. 애플리케이션 v10.4.0을 배포합니다.

## 관리자 사용 방법

- `회원관리`의 회원 행 또는 모바일 카드에서 `중간관리자 배정`/`관리 담당 변경`을 누릅니다.
- 승인·활성 중간관리자를 선택하고 2자 이상의 사유를 입력해 적용합니다.
- `관리자 직속으로 해제`를 선택하면 `manager_id`와 `manager_username`만 null로 변경됩니다.
- 여러 회원을 체크한 뒤 상단 `중간관리자 배정`을 누르면 동일한 담당자와 사유로 최대 200명을 처리합니다. 결과는 회원별 완료/실패로 표시되고 실패한 회원은 변경되지 않습니다.
- admin, 중간관리자 계정, 비활성·반려 계정 등 관리 대상이 아닌 계정은 체크할 수 없습니다.

## 보안 및 데이터 보존

- `admin_assign_member_manager_v104(...)`와 `admin_bulk_assign_member_manager_v104(...)`는 프런트 직접 update 대신 사용하는 관리자 전용 `SECURITY DEFINER` RPC입니다.
- 호출자는 승인 완료·활성 admin인지 서버에서 다시 확인합니다. 새 담당자는 승인 완료·활성 `is_operations_manager = true` 프로필만 허용합니다.
- 개별 변경은 `expected_updated_at`을 비교해 오래된 화면의 덮어쓰기를 차단합니다. 일괄 변경은 같은 검사를 회원별로 수행하고 각 항목을 독립된 예외 블록에서 처리합니다.
- 변경 SQL은 `profiles.manager_id`, `profiles.manager_username`, `profiles.updated_at`만 갱신합니다. `sponsor_id`, `sponsor_username`, `hierarchy_depth`, 주문, payment step, 정산 데이터는 변경하지 않습니다.
- 각 성공 회원마다 `member.manager_changed` 감사로그가 남으며 변경 전/후 담당자, 유지된 sponsor, 실행 관리자, 사유와 시각을 기록합니다.

## 기존 작업 가시성

v10.2 관리 작업/필터/선택 Excel/필터 전체 Excel과 v10.3 대시보드/대행사 카드 RPC는 모두 주문 생성 시점이 아니라 현재 `profiles.manager_id = auth.uid()` 관계로 `orders.created_by`를 연결합니다. 따라서 재배정 즉시 과거·현재 작업 전체가 이전 담당자 범위에서 빠지고 새 담당자 범위에 포함됩니다. 관리자 직속 해제 시 어느 중간관리자 범위에도 포함되지 않습니다.
