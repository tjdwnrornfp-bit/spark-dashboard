# v10.7 적용 및 사용 안내

## 적용

운영 프로젝트 `aoiqdvxrimopmodojcza`는 2026-09-07 적용 완료. 과거 migration 또는 이번 migration을 다시 실행하지 마세요.

1. 현재 main과 `app_schema_versions` 최신 버전 확인. 기준 main `2d29096fd1ae17324d4d577399a6849a62e76aec`, 앱 스키마 `v10.6.0`.
2. 신규 파일 `supabase/migrations/20260907045616_v10_7_admin_order_correction.sql`만 적용. 로컬 파일은 CLI 생성 시각, 운영 기록은 MCP 적용 시각 `20260907050841`로 기록됨.
3. `v10.7.0` 및 다음 RPC 존재/권한 확인:
   - `admin_preview_order_correction_v107(uuid, integer, jsonb, text)`
   - `admin_apply_order_correction_v107(uuid, integer, jsonb, text)`
4. anon 실행 불가, authenticated 실행 시 함수 내부에서 approved/active admin 및 중간관리자 제외 검증. empty search_path, lock_version 필수, apply는 주문/입금 단계를 잠근 뒤 preview 재검증.
5. `npm run typecheck`, `npm run test:assignment`, `npm run test:correction`, `npm run build`.

## 관리자 사용법

프로그램 접수 목록 → 행의 `수정` → 변경값과 사유 입력 → `변경 영향 확인` → 변경 전/후·종료일·금액 영향 확인 → `수정 적용`.

| 상태 | 규칙 |
| --- | --- |
| 입금대기 | 금액 불변 허용. 입금확인 전 증가/감소 허용. 일부 확인이면 증가는 차액 정산, 감소 차단 |
| 입금완료 | 금액 불변 허용. 증가는 입금대기로 전환하고 차액 추가. 감소 차단 |
| 구동중·정지 | 금액 불변 허용, 기존 상태·activated_at·stopped_at 유지. 금액 변경 차단 |
| 만료 | 상호명·키워드·URL·메모만. 기간·수량 변경 및 자동 재활성화 차단 |
| 보관 | 복원 후 수정 |

시작일은 기존 시작일이 오늘 이후이고 활성화 이력이 없는 입금대기/입금완료만 변경할 수 있습니다. 새 시작일도 오늘 이후여야 합니다. 만료를 제외한 변경 종료일은 오늘 이전 불가.

등록자, sponsor/manager, 프로그램, 단가 snapshot은 변경하지 않습니다. 프로그램 변경은 기존 기능을 이용합니다.

금액 변경에서 프로그램 변경 정산 이력·취소 대기·단가 불일치·복잡한 미확인 단계가 있으면 자동 차액 처리를 차단합니다. 과거 입금확인과 정산 이력은 삭제하지 않습니다. 구동중 금액 증감은 별도 정책 확인이 필요합니다.

## 운영 주문 정정 결과

`SPK-20260905-000342`: 3타 × 100일 → 100타 × 3일, 종료일 2026-12-14 → 2026-09-08, lock_version 3 → 4.

시작일 2026-09-06, 단가 20원, 공급가 6,000원, VAT 600원, 총액 6,600원, 구동중, activated_at `2026-09-07 02:51:00.031765+00` 유지.

payment_steps 1개 전체 필드와 settlement_batch_items를 정정 전후 JSON 비교하여 동일함을 확인하고 커밋. confirmed_at `2026-09-07 02:50:41.106164+00` 유지. `order.corrected` 감사로그 생성 확인.

## 보안 점검

새 RPC의 anon 권한은 차단됨. authenticated SECURITY DEFINER 경고는 관리자 검증을 수행하는 의도된 진입점에 대한 일반 경고이며 권한 테스트로 검증했습니다. 기존 함수 중 감사로그·입력방식 관련 3개만 변경되고 정산 confirm/reverse, transfer/bulk transfer, managedOrders/dashboard 및 cron 함수 정의는 그대로 유지됨.

참고: https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable
