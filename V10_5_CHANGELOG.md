# Spark Dashboard v10.5.0

## 성능 최적화

- `fetchRemoteSnapshot()` 전체 묶음 조회를 members, orders, payment steps, notifications, notices, settings, payment account 단위 조회로 분리했습니다.
- 로그인 직후에는 현재 역할의 대시보드에 필요한 데이터만 로드합니다. 중간관리자는 서버 dashboard/managed-orders RPC를 사용하며 전체 orders/payment_steps/profiles를 받지 않습니다.
- 회원 목록은 회원 페이지 진입 시 로드하고, 관리자 연락처 RPC도 관리자 회원 페이지에서만 지연 로드합니다.
- Realtime 7개 테이블 변경을 320ms 리소스별 debounce로 분리했습니다. 주문·정산단계·알림이 연속으로 변경되어도 각 리소스는 한 번씩만 다시 조회합니다.
- settlement batch 변경은 전체 snapshot을 갱신하지 않고 현재 서버 정산/중간관리자 화면 데이터만 coalesce해서 재조회합니다.
- 쓰기 액션 후 전체 snapshot 호출을 제거하고 orders/paymentSteps/notifications/profiles/notices 중 실제 영향 범위만 갱신합니다.
- 알림은 최신 100개만 먼저 받고, 알림센터의 `이전 알림 더보기`로 100개씩 추가 조회합니다. 최대 요청 크기는 200개로 제한했습니다.
- notifications, orders, profiles, notices, settings의 `select *`를 화면 mapper에 필요한 컬럼 목록으로 축소했습니다.
- ManagerDashboard와 ManagedOrders의 server mode에서 로컬 전체 배열 집계를 건너뛰며, dashboard summary/overview RPC는 관련 Realtime burst당 한 번씩 재조회합니다.
- 부분 refresh 실패는 전체 앱 오류 배너 대신 리소스 단위 안내로 표시합니다.

## 운영 DB 마이그레이션

- `(select auth.uid())` 및 `(select is_admin())` initPlan 패턴으로 기존 RLS 조건을 최적화합니다.
- orders SELECT의 `own OR admin`, profiles SELECT의 `self OR hierarchy OR admin` 의미를 그대로 유지하면서 각각 단일 permissive policy로 합칩니다.
- 실제 조회/검증 경로가 있는 다음 인덱스만 추가합니다.
  - `notifications(order_id)`
  - `settlement_quote_items(payment_step_id)`
  - `settlement_batch_items(registrant_id)`
- `payment_steps.confirmed_by`와 `settlement_quote_items.payer_id`는 현재 조회 빈도 및 기존 복합 인덱스를 고려해 추가하지 않았습니다.

## 성능 기준선

- 변경 전 누적 통계: notifications 전체 join 조회 6,549회 / 평균 52.01ms, `get_my_active_payment_steps_v91` 5,307회 / 평균 55.73ms, profiles 전체 3,636회 / 평균 46.48ms, orders 전체 3,620회 / 평균 27.52ms.
- 이번 패치는 개별 SQL을 과도하게 재작성하지 않고 호출 횟수, 응답 컬럼, 초기 다운로드량, React state churn을 우선 줄입니다.
- 누적 `pg_stat_statements` 값은 배포 전후가 섞이므로, 배포 후 24시간 요청 수와 평균/상위 지연을 별도로 비교해야 합니다.

## 다음 단계

- 관리자 작업 목록의 전체 orders 배열은 현재 데이터량에서 유지합니다. 데이터가 수천 건 이상으로 증가하면 목록 자체를 서버 페이지네이션으로 전환합니다.
