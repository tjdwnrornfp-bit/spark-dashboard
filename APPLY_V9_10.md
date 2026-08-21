# SPARK v9.10 적용 순서

## 1. 적용 전 확인

운영 데이터가 있는 DB에 `schema.sql`을 다시 실행하지 않습니다. v9.9.0이 적용된 운영 DB에서 다음 파일을 읽기 전용으로 실행합니다.

```text
supabase/preflight_v9_10.sql
```

`version_v9_9_installed`, `single_preview_rpc_installed`, `single_transfer_rpc_installed`가 모두 `true`인지 확인합니다. 단가 미설정 회원과 정산 단계가 없는 주문은 마이그레이션을 막지 않지만 해당 주문의 일괄 변경 결과에서 차단됩니다.

## 2. v9.10 migration 적용

```text
supabase/migrations/20260821150000_v9_10_bulk_admin_program_transfer.sql
```

이 migration은 기존 주문, 정산 단계, 확인 이력, 배치, 회원, 감사로그를 삭제하거나 덮어쓰지 않습니다. 일괄 미리보기와 실행 RPC만 추가합니다.

## 3. 적용 확인

```text
supabase/verify_v9_10.sql
```

설치·권한·기존 단일 RPC 보존 항목이 모두 `true`이고 다음 값이 0인지 확인합니다.

- `invalid_cleared_transfer_amounts`
- `pending_markers_without_payment_steps`
- `incomplete_program_transfer_audit_logs`

## 4. 프런트엔드 배포

```bash
npm ci
npm run typecheck
npm run build
```

운영 DB migration을 먼저 적용한 후 v9.10 프런트엔드를 배포합니다. 기존 Edge Function의 재배포는 필요하지 않습니다.

## 5. 사용 방법과 제약

1. 관리자 작업 목록에서 여러 작업을 체크합니다. 프로그램 메뉴를 이동해 서로 다른 프로그램 작업을 추가로 선택할 수 있습니다.
2. 상단 `프로그램 변경`을 누르고 대상 프로그램과 공통 사유를 입력합니다.
3. 추가금·차감, 동일 프로그램 제외, 변경 불가 사유를 확인한 뒤 실행합니다.
4. 주문별 결과에서 실패 건을 확인합니다. 실패 주문은 원상태를 유지하고 체크 상태도 남아 재검토할 수 있습니다.
5. 한 번에 최대 500건을 처리합니다. 확인된 정산보다 목표 정산이 작아 환불·과납 처리가 필요한 주문, 단가 미설정 주문, 보관 주문, 미리보기 후 동시 수정된 주문은 자동 변경하지 않습니다.
