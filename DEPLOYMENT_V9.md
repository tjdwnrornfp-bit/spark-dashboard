# SPARK v9 서버 적용 순서

## 1. 사전 확인

Supabase SQL Editor에서 `supabase/preflight_v9.sql`을 실행합니다.

확인 기준:

- 활성 관리자 1명 이상
- 기존 작업 수가 예상과 일치
- `review_member_v8`, `create_order`, `confirm_payment_step`, `start_paid_orders` 함수 확인

결과 화면을 캡처하거나 CSV로 보관합니다.

## 2. 데이터베이스 업데이트

SQL Editor의 새 쿼리에서 `supabase/update_v9_stability.sql` 전체를 실행합니다.

성공 메시지가 나온 다음 `supabase/verify_v9_stability.sql`을 실행합니다.

검증 결과:

- 스키마 버전 `v9.0.0`
- `orders`의 `archived_at`, `archived_by`, `archive_reason`, `lock_version`
- `audit_logs` 테이블과 RLS 활성화
- 감사 트리거 3개 활성화
- v9 RPC 함수 존재
- Cron 두 작업 활성화
- `get_operations_health()` 결과의 다음 항목이 0
  - `orders_without_payment_steps`
  - `invalid_payment_states`
  - `inactive_cron_jobs`

기존 데이터에 문제가 있어 0이 아닌 경우 프런트 배포 전에 해당 결과를 확인합니다.

## 3. 프런트 적용

기존 프로젝트의 `.git`, `.env.local`은 유지합니다. `supabase` 폴더는 기존 폴더를 백업한 뒤 v9의 `supabase` 폴더로 통째로 교체해 실행 파일 혼동을 방지합니다. 나머지 v9 파일은 덮어씁니다.

```cmd
npm install
npm run build
```

성공 후:

```cmd
git add .
git commit -m "Upgrade SPARK dashboard to v9 stability"
git pull --rebase origin main
git push origin main
```

## 4. 배포 후 필수 테스트

관리자:

1. `운영기록` 탭 접근
2. 운영 점검 경고 확인
3. 회원 단가 수정 및 감사기록 확인
4. 테스트 주문 상태 변경 시 사유 입력 확인
5. 작업 보관 후 대시보드·정산 집계에서 제외 확인
6. 보관함에서 복원 확인

대행사:

1. 개별 작업 접수
2. 엑셀 대량 접수
3. 자신의 입금대기·정지·만료 작업 보관
4. 구동중·입금완료 작업의 보관 제한 확인

정산:

1. 하위 단계보다 윗 단계 입금확인을 먼저 시도했을 때 차단 확인
2. 순서대로 확인
3. 관리자 최종 확인 후 알림 1회 확인
4. 작업이 입금완료로 바뀌는지 확인

## 5. 장애 시 대응

프런트 오류만 발생하면 Vercel에서 이전 정상 배포로 롤백할 수 있습니다. v9 DB는 구버전 프런트와 호환되도록 기존 RPC를 유지합니다.

DB SQL 실행 중 오류가 발생하면 트랜잭션이 롤백되므로 오류 문구 전체를 보관합니다. 일부 문장만 별도로 재실행하지 않습니다.
