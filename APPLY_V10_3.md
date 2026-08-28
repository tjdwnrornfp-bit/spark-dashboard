# SPARK v10.3.0 적용 가이드

## 적용 순서

1. 운영 Supabase SQL Editor에서 `supabase/preflight_v10_3.sql`을 실행합니다. 최신 앱 스키마가 v10.2.0이고 v10.2 중간관리자 읽기 RPC가 모두 존재해야 합니다.
2. 신규 migration `supabase/migrations/20260828180000_v10_3_manager_dashboard_overview.sql`만 한 번 실행합니다. 과거 migration은 재실행하지 않습니다.
3. `supabase/verify_v10_3.sql`을 실행해 RPC 존재, `SECURITY DEFINER`, 빈 `search_path`, anon 실행 차단, authenticated 실행 허용, `manager_id = auth.uid()` 및 등록 대행사 payer 범위, 금액 무결성을 확인합니다.
4. 애플리케이션 v10.3.0을 배포합니다.

## 신규 읽기 전용 RPC

- `get_manager_dashboard_summary_v103()`: 관리 대행사 수, 전체 작업, 총/대기/완료 정산금액과 작업상태 건수를 반환합니다.
- `get_manager_agency_overview_v103(p_page, p_page_size, p_query, p_sort)`: 대행사별 카드를 최대 24개 단위로 서버 페이지네이션하며 아이디 검색과 정산대기금액/전체작업/구동중/아이디 정렬을 제공합니다.

두 함수 모두 승인·활성 중간관리자만 실행할 수 있고 `profiles.manager_id = auth.uid()`인 대행사와 그 대행사의 미보관 주문만 집계합니다. 중간관리자에게 주문·프로그램·입금·보관 관련 쓰기 권한은 추가하지 않습니다.

## 정산금액 정의

- 한 주문의 유효 정산금액은 `payment_steps.order_id = orders.id AND payment_steps.payer_id = orders.created_by`인 등록 대행사 납부 단계의 합계입니다. 따라서 추천 계층의 상위 step을 중복 합산하지 않습니다.
- `confirmed_at IS NULL`은 정산대기, `confirmed_at IS NOT NULL`은 정산완료로 합산합니다. 프로그램 변경의 `program_adjustment` step과 입금확인 취소로 다시 미확인된 step도 같은 기준으로 자동 반영됩니다.
- payment step이 전혀 없는 비정상/레거시 주문만 주문 당시 snapshot인 `orders.total_amount`를 정산대기로 보완합니다.
- 보관 주문은 v10.2 관리 작업 화면과 동일하게 제외합니다. 항상 `총 정산금액 = 정산대기 금액 + 정산완료 금액`입니다.

## 화면 확인

1. 중간관리자 대시보드에서 승인대기/승인완료/반려/정산경로와 최근 가입 대행사 섹션이 사라졌는지 확인합니다.
2. 상단 5개 KPI, 작업상태 요약, 대행사별 카드와 4→3→2→1열 반응형 배치를 확인합니다.
3. 카드 또는 `작업 보기`를 누르면 해당 대행사 필터로 `관리 작업`이 열리는지 확인합니다.
4. 카드의 정산대기/정산완료 금액을 누르면 대행사와 정산상태 필터가 함께 적용되는지 확인합니다.
