# SPARK v6 → v7 서버 업데이트 가이드

이 문서는 현재 v6가 Supabase와 Vercel에서 정상 운영 중인 상태를 기준으로 합니다.

## 업데이트 순서 요약

반드시 데이터베이스를 먼저 업데이트합니다.

```text
1. 현재 코드와 데이터 백업
2. Supabase에서 update_v7.sql 실행
3. verify_v7.sql 실행
4. 로컬 프로젝트를 v7 파일로 교체
5. 로컬 빌드 확인
6. GitHub에 push
7. Vercel Production 배포 확인
8. 두 계정으로 정산·실시간 동기화 테스트
```

v7 프런트엔드는 신규 주문을 만들 때 `p_start_date` 값을 전송합니다. DB를 먼저 업데이트하지 않고 프런트엔드부터 배포하면 작업 접수 RPC 인자 불일치 오류가 발생할 수 있습니다.

---

# 1. 업데이트 전 백업

## 코드 백업

현재 로컬 프로젝트에서 작업 중인 내용이 모두 GitHub에 올라가 있는지 확인합니다.

```powershell
git status
git log -1 --oneline
```

변경사항이 남아 있다면 먼저 커밋합니다.

```powershell
git add .
git commit -m "Backup before v7 update"
git push origin main
```

## 데이터 확인

Supabase Table Editor에서 최소한 다음 테이블의 데이터가 정상인지 확인합니다.

```text
profiles
orders
payment_steps
notifications
notices
app_settings
```

운영 데이터가 중요하면 Supabase의 현재 백업 상태를 확인하거나 주요 테이블을 CSV로 별도 내보냅니다.

---

# 2. Supabase v7 SQL 적용

## 실행할 파일

```text
supabase/update_v7.sql
```

Supabase Dashboard에서 진행합니다.

```text
프로젝트 선택
→ SQL Editor
→ New query
→ update_v7.sql 전체 붙여넣기
→ Run
```

정상 완료 시 `Success. No rows returned`와 유사한 메시지가 표시됩니다.

### 이 SQL이 변경하는 항목

- 사용자 지정 시작일을 받는 `create_order` 함수
- 시작일이 포함된 `create_orders_bulk` 함수
- 입금 확인 알림 문구
- 관리자 수동 상태 변경 알림
- 자정 자동 구동 함수
- 기존 정산 단계 계산 유지

다음 항목은 삭제하지 않습니다.

```text
기존 회원
기존 주문
기존 정산 단계
기존 알림
기존 공지
기존 계좌 설정
```

초기 설치용 파일은 다시 실행하지 않습니다.

```text
실행하지 않음: schema.sql
실행하지 않음: schema_fresh_v6.sql
실행하지 않음: update_v6.sql
```

---

# 3. Supabase 설치 검증

다음 파일을 SQL Editor에서 실행합니다.

```text
supabase/verify_v7.sql
```

첫 번째 결과에는 다음 함수가 보여야 합니다.

```text
confirm_payment_step
create_order
create_orders_bulk
set_order_status
start_paid_orders
```

`create_order`의 인자 목록에는 다음 항목이 있어야 합니다.

```text
p_start_date date
```

두 번째 결과에는 다음 Cron 작업이 활성 상태로 보여야 합니다.

```text
spark-start-paid-orders
spark-expire-finished-orders
```

Cron 결과가 없으면 기존 v6에서 Cron을 설치하지 않았거나 작업이 삭제된 상태입니다. 이 경우에만 다음 파일을 실행합니다.

```text
supabase/cron_v6.sql
```

`cron_v6.sql`은 같은 이름의 기존 작업을 해제한 뒤 다시 등록합니다.

- 자동 구동 확인: 매분
- 자동 만료 확인: 5분마다

자동 구동 함수 자체가 한국 날짜를 확인하므로, 선택 시작일 자정 이후 입금완료 작업만 구동중으로 바뀝니다.

---

# 4. 로컬 프로젝트 파일 교체

v7 ZIP 압축을 별도 폴더에 풉니다.

기존 Git 프로젝트에서 다음 항목은 삭제하거나 덮어쓰지 않습니다.

```text
.git
.env.local
```

v7의 다음 항목을 기존 프로젝트에 복사해 덮어씁니다.

```text
src/
supabase/
package.json
README.md
DEPLOYMENT.md
UI_ANALYSIS.md
index.html
tsconfig.json
tsconfig.node.json
vite.config.ts
vercel.json
```

Windows 탐색기로 덮어써도 되고, VS Code에서 프로젝트 전체를 열어 복사해도 됩니다.

환경 변수는 기존 값을 그대로 사용합니다.

```env
VITE_SUPABASE_URL=https://프로젝트주소.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=공개키
```

다음 값은 프런트엔드 파일에 넣지 않습니다.

```text
service_role
secret key
데이터베이스 비밀번호
데이터베이스 연결 문자열
```

---

# 5. 패키지 설치와 로컬 빌드

프로젝트 폴더에서 PowerShell 또는 VS Code 터미널을 엽니다.

의존성 파일을 새로 맞춥니다.

```powershell
npm install
```

개발 서버를 실행합니다.

```powershell
npm run dev
```

브라우저에서 표시된 로컬 주소로 접속합니다.

```text
http://localhost:5173
```

확인 후 개발 서버를 `Ctrl + C`로 종료하고 운영 빌드를 검사합니다.

```powershell
npm run build
```

`dist` 폴더가 생성되고 오류 없이 종료되어야 합니다.

---

# 6. 로컬 기능 테스트

## 회원가입

1. 시크릿 창에서 추천 코드를 넣어 가입
2. 성공 문구가 승인 안내만 표시되는지 확인
3. 추천 관계 또는 서버 구조 설명이 표시되지 않는지 확인

## 시작일

1. 대행사 계정으로 작업접수 열기
2. 오늘 날짜가 선택되지 않는지 확인
3. 익일 또는 이후 날짜 선택
4. 접수 후 관리자 작업 목록의 시작일 확인

## 대량접수

1. `대량접수 양식` 다운로드
2. `시작일` 열에 익일 이후 날짜 입력
3. 파일 업로드
4. 잘못된 날짜는 행 번호와 함께 거부되는지 확인
5. 정상 파일은 모든 작업이 목록 아래쪽에 추가되는지 확인

## 정산

브라우저를 두 개 사용합니다.

```text
일반 창: 정산을 받는 계정
시크릿 창: 하위 대행사 계정
```

1. 하위 대행사에서 작업 접수
2. 정산을 받는 계정에서 하위 입금확인 표 확인
3. 입금확인 버튼 클릭
4. 하위 계정 알림이 `입금이 확인되었습니다`처럼 중립적으로 표시되는지 확인
5. 정산을 받는 계정의 `입금 받은 금액`이 증가하는지 확인
6. 해당 계정의 관리자 정산 내역에 같은 작업의 납부 단계가 있는지 확인
7. 관리자에게 최종 입금확인을 완료
8. 주문이 입금완료로 변경되는지 확인

## 관리자 금액

관리자 정산 카드의 금액은 `payment_steps.payee_id = 관리자 ID`인 마지막 단계만 합산해야 합니다.

하위 회원의 판매 단가로 계산된 주문 총액이 아니라, 관리자에게 실제로 들어오는 단계의 단가가 사용되는지 확인합니다.

## 수동 구동

1. 시작일이 아직 오지 않은 주문을 준비
2. 관리자 작업접수 탭에서 상태를 `구동중`으로 변경
3. 대행사 화면에서 게이지가 0%부터 증가하는지 확인
4. 새로고침 후 같은 시간대에 크게 튀거나 감소하지 않는지 확인

---

# 7. GitHub에 업데이트 업로드

변경 파일을 확인합니다.

```powershell
git status
```

`.env.local`이 목록에 포함되면 커밋하지 않습니다.

업데이트를 커밋합니다.

```powershell
git add .
git commit -m "Update dashboard to v7"
git push origin main
```

Vercel 프로젝트의 Production Branch가 `main`이라면 push 후 Production 배포가 자동 생성됩니다.

---

# 8. Vercel 배포 확인

Vercel Dashboard에서 확인합니다.

```text
프로젝트
→ Deployments
→ 최신 배포
```

확인 기준:

```text
Status: Ready
Environment: Production
Branch: main
```

빌드 오류가 나면 최신 배포의 `Building` 또는 `Logs`에서 오류 메시지를 확인합니다.

배포가 성공하면 기존 Production 주소가 새 버전을 가리킵니다. 별도의 새 도메인을 만들 필요는 없습니다.

---

# 9. 운영 서버 최종 확인

다른 컴퓨터 또는 시크릿 창에서 Production 주소를 엽니다.

다음 항목을 순서대로 확인합니다.

- 회원가입 성공 문구
- 회원 승인
- 시작일 직접 선택
- 대량접수 시작일 업로드
- 관리자 알림
- 하위 입금확인 버튼 위치
- 입금 받은 금액
- 본인이 처리할 정산 합계
- 관리자 최종 정산 합계
- 관리자 그룹명 표시
- 수동 구동 게이지
- 실시간 동기화
- 종료일 다음 날 자동 만료

---

# 10. 오류 시 되돌리기

## 프런트엔드 오류

Vercel에서 직전 정상 배포를 선택해 Rollback할 수 있습니다.

```text
Vercel 프로젝트
→ Deployments
→ 직전 정상 배포
→ 메뉴
→ Rollback 또는 Promote to Production
```

또는 Git에서 이전 커밋을 되돌린 후 다시 push합니다.

```powershell
git log --oneline
git revert 문제커밋해시
git push origin main
```

## 데이터베이스 오류

프런트엔드 롤백은 Supabase 함수 변경을 자동으로 되돌리지 않습니다. `update_v7.sql` 적용 중 오류가 발생하면 오류 전문을 보관하고, 임의로 테이블을 삭제하지 않습니다.

`update_v7.sql`은 트랜잭션으로 묶여 있으므로 중간 SQL이 실패하면 해당 실행의 변경은 커밋되지 않습니다. 오류를 수정한 뒤 전체 파일을 다시 실행할 수 있도록 작성했습니다.

---

# 11. 앞으로의 업데이트 방식

운영 이후에는 초기 스키마 파일을 반복 실행하지 않고 버전별 마이그레이션을 추가합니다.

```text
supabase/migrations/
├─ 20260731020000_referral_hierarchy.sql
└─ 20260731050000_v7_start_date_settlement.sql
```

권장 흐름:

```text
기능 브랜치 작성
→ 로컬 빌드
→ Preview 배포 확인
→ Supabase 마이그레이션 적용
→ main 병합
→ Production 확인
```

DB 함수 인자가 바뀌는 버전은 항상 Supabase 마이그레이션을 먼저 적용한 뒤 프런트엔드를 배포합니다.
