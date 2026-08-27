# SPARK v10.1.0 적용 가이드

## 적용 순서

1. 운영 Supabase SQL Editor에서 `supabase/preflight_v10_1.sql`을 실행하고 v10.0.0, 정산·감사·프로그램 변경 테이블/RPC가 준비됐는지 확인합니다.
2. 신규 마이그레이션 `supabase/migrations/20260827110000_v10_1_payment_confirmation_reversal.sql` 전체를 한 번 실행합니다.
3. `supabase/verify_v10_1.sql`을 실행합니다. assertion 블록이 성공하고 v10.1 RPC·트리거가 모두 `true`, `stale_reversal_markers`가 0인지 확인합니다.
4. 애플리케이션 v10.1.0을 배포합니다.
5. 관리자 정산탭의 `확인완료` 필터에서 테스트 가능한 확인 건을 골라 모달 표시만 확인합니다. 실제 역전은 운영 정책상 필요한 건에만 수행합니다.

## 역전 정책

- 허용: 후속 confirmed step이 없고, 해당 확인 뒤 프로그램 변경 정산이 없으며, 화면의 confirmed_at/order lock version이 DB와 일치하는 관리자 귀속 step.
- 시작 전 `입금완료`: `입금대기`로 복구하고 재확인을 허용합니다.
- `구동중`/`정지`/`만료`: 운영 상태는 유지하고 `settlement_reversal_pending`만 켭니다. 마지막 미확인 step이 재확인되면 표식이 자동 해제됩니다.
- 차단: 보관 주문, 시작일이 도래했거나 운영 이력이 있는 `입금완료`, 후속 확인 단계 존재, 확인 뒤 프로그램 변경 존재, stale version/confirmed_at.
- 일괄 확인 건: 기존 batch/item은 immutable로 유지합니다. 개별 역전 감사로그에 관련 batch가 기록되며, 재확인 시 새 batch/item을 추가할 수 있습니다.

## 안전성

- 기존 주문, payment step, 감사로그, settlement batch/item을 삭제하지 않습니다.
- 과거 마이그레이션을 재실행하지 않습니다.
- 앱만 먼저 배포하면 v10.1 조회 RPC가 없을 때 v9.4/v9.2 조회로 fallback하지만, `확인 취소`는 신규 RPC 적용 전에는 성공하지 않습니다. 운영 적용은 DB 마이그레이션 후 앱 배포 순서를 권장합니다.
- 문제가 생겨 앱을 롤백해도 새 컬럼·RPC·감사로그는 유지합니다. 이미 생성된 역전 기록은 삭제하지 않습니다.
