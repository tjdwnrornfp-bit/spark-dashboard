# SPARK v9.9 적용 순서

## 1. 적용 전 확인

운영 데이터가 있는 DB에 `schema.sql`을 다시 실행하지 않습니다. v9.6.0 이상이 적용된 운영 DB에서 SQL Editor로 다음 파일을 실행합니다.

```text
supabase/preflight_v9_9.sql
```

`orders_without_payment_steps`가 0인지 확인합니다. 0이 아니면 해당 주문은 프로그램 변경 RPC가 자동 차단하므로 먼저 원인을 점검합니다. 프로그램별 미설정 단가 수는 배포를 막지는 않지만 해당 회원의 해당 프로그램 이동은 차단됩니다.

## 2. v9.9 migration 적용

둘 중 운영 방식에 맞는 한 가지 경로만 사용합니다.

### Supabase migration 배포

```text
supabase/migrations/20260821090000_v9_9_admin_program_transfer.sql
```

### SQL Editor 수동 적용

```text
supabase/update_v9_9_admin_program_transfer.sql
```

두 파일의 내용은 동일합니다. 기존 주문, 확인된 결제 단계, 배치 정산 기록을 삭제하거나 덮어쓰지 않습니다.

## 3. 적용 확인

```text
supabase/verify_v9_9.sql
```

설치 여부 항목이 모두 `true`이고 아래 값이 모두 0인지 확인합니다.

- `invalid_payment_program_snapshots`
- `invalid_payment_step_kinds`
- `invalid_cleared_transfer_amounts`
- `pending_markers_without_payment_steps`

## 4. Edge Function

v9.9 프로그램 변경에는 새 Edge Function이 필요하지 않습니다. 기존 `reset-member-password`, `delete-member` 함수 배포 상태는 그대로 유지합니다.

## 5. 프런트엔드 배포

```bash
npm ci
npm run typecheck
npm run build
```

검증이 끝난 `main`을 Vercel Production에 배포합니다. 프런트엔드를 먼저 배포하면 새 RPC가 없어 프로그램 변경이 실패하므로 SQL을 먼저 적용합니다.

## 6. 운영 시나리오 확인

1. **미입금/확인 0건**: 프로그램 변경 후 기존 미확인 단계가 사라지고 새 프로그램의 현재 참여자별 단가로 전부 재생성되는지 확인합니다.
2. **부분입금**: 확인된 단계와 기존 배치 이력이 그대로 남고, 미확인 의무가 새 목표 금액의 잔액 단계로 교체되는지 확인합니다.
3. **입금완료 + 추가금**: 주문이 `입금대기`와 `추가입금 대기` 표시로 바뀌고 마지막 단계 확인 후 `입금완료`로 복귀하는지 확인합니다.
4. **구동중 + 추가금**: 상태와 진행이 `구동중`으로 유지되며 변경 정산만 대기 표시되는지 확인합니다.
5. **정지/만료**: 기존 운영 상태를 유지하면서 변경 정산 대기가 표시되고 완료 후 표시만 사라지는지 확인합니다.
6. **하향 변경 + 확인 이력**: 차감/환불 필요 안내와 함께 변경이 차단되는지 확인합니다.
7. **단가 0/미설정**: 등록자 또는 정산 참여자의 대상 프로그램 단가가 없을 때 변경이 차단되는지 확인합니다.
8. **동시 변경**: 모달을 연 뒤 다른 세션에서 주문/정산을 변경하면 optimistic locking 오류가 나오고 재시도를 요구하는지 확인합니다.
9. **엑셀/단위/게이지**: 통합 엑셀과 대상 프로그램 탭에 새 프로그램이 표시되고, SparkS는 `건` 단위이며 진행 게이지가 없는지 확인합니다.
10. **감사로그**: `order.program_transferred`에 요구된 전후 값·차액·관리자·사유·시각이 모두 기록되는지 확인합니다.
