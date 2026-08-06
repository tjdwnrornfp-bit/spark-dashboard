# SPARK v9.1 적용 순서

## 해결 항목

- 4번 회원이 접수한 작업을 3번 회원이 직접 입금 확인할 수 있도록 정산 단계 조회를 수정했습니다.
- 주문 RLS로 하위 작업 원본이 보이지 않아도, 정산 당사자에게 필요한 단계만 안전하게 제공합니다.
- 현재 입금 확인 순서가 아닌 단계는 `순서 대기`로 표시합니다.
- 보관 작업은 대시보드와 정산 금액에서 동시에 제외됩니다.
- 보관·복원 시 모든 정산 당사자 화면이 Realtime으로 다시 계산됩니다.
- 기존 회원, 주문, 결제 단계, 확인 완료 내역은 삭제하지 않습니다.

## 1. Supabase SQL

`supabase/update_v9_1_settlement_consistency.sql` 전체를 실행합니다.

정상 실행 후 `supabase/verify_v9_1_settlement_consistency.sql`을 실행합니다.

## 2. 프런트 파일 적용

패치의 `src` 폴더와 `package.json`을 기존 프로젝트에 덮어씁니다.

```cmd
npm install
npm run build
```

## 3. Git 반영

```cmd
git add .
git commit -m "Fix hierarchical settlement and archive totals"
git pull --rebase origin main
git push origin main
```

## 4. 권장 테스트

1. 4번 계정으로 작업 1건 접수
2. 3번 계정 정산 화면에서 4번의 입금확인 버튼 확인
3. 3번 입금확인 후 2번 화면의 `순서 대기`가 `입금확인`으로 변경되는지 확인
4. 2번 → 1번 → 관리자 순서로 확인
5. 새 테스트 작업을 관리자가 보관
6. 4번·3번·2번·1번·관리자의 대시보드와 정산 금액에서 즉시 제외되는지 확인
7. 관리자가 복원한 뒤 다시 표시되는지 확인
