# SPARK v5 → v6 서버 업데이트 가이드

이 문서는 이미 Supabase와 Vercel을 연결해 v5를 운영 중인 경우를 기준으로 작성되었습니다.

## 변경되는 구조

```text
회원가입
  ├─ 추천인 없음 → 관리자 승인
  └─ 추천인 있음 → 대행사 자동 지정 → 직접 추천인 승인

회원 계층
  관리자
    └─ 총판 또는 대행사
         └─ 대행사
              └─ 대행사 ...

주문 정산
  작업 접수자 → 직접 상위회원 → 그 상위회원 → 관리자
```

v6 데이터베이스 업데이트는 기존 회원·주문·공지·알림을 삭제하지 않습니다. 기존 테이블에 계층 컬럼을 추가하고, 정산 단계 테이블과 함수·정책을 추가 또는 교체합니다.

---

# 1. 업데이트 전에 준비할 것

다음 항목을 먼저 확인합니다.

- 현재 Production 사이트가 정상 동작하는지
- GitHub 저장소의 최신 코드가 v5와 일치하는지
- Supabase 프로젝트를 정확히 선택했는지
- Vercel 환경 변수에 기존 Supabase URL과 Publishable key가 있는지

가능하면 Supabase 데이터베이스 백업 또는 주요 테이블 CSV 내보내기를 먼저 진행합니다.

주요 테이블:

```text
profiles
orders
notifications
notices
app_settings
```

## v6 압축 파일에서 사용할 항목

```text
work-intake-dashboard-v6/
├─ src/
├─ supabase/
│  ├─ update_v6.sql
│  ├─ cron_v6.sql
│  ├─ verify_v6.sql
│  └─ migrations/20260731020000_referral_hierarchy.sql
├─ package.json
├─ README.md
├─ DEPLOYMENT.md
└─ 나머지 Vite 설정 파일
```

기존 프로젝트의 다음 항목은 삭제하거나 공개 저장소에 올리지 않습니다.

```text
.env.local
.git/
```

---

# 2. 적용 순서

반드시 다음 순서로 진행합니다.

```text
1. Supabase update_v6.sql 적용
2. Supabase cron_v6.sql 적용
3. Supabase verify_v6.sql 확인
4. 로컬에서 v6 코드 실행
5. GitHub에 v6 코드 push
6. Vercel Production 배포 확인
7. 실제 추천·정산·대량접수 테스트
```

프런트엔드를 먼저 배포하면 아직 생성되지 않은 `payment_steps`, `review_member_v6`, `create_orders_bulk` 등을 호출해 오류가 날 수 있습니다. 데이터베이스 업데이트를 먼저 적용합니다.

---

# 3. Supabase 데이터베이스 업데이트

## 3-1. 프로젝트 확인

Supabase Dashboard에서 기존 SPARK 운영 프로젝트를 엽니다. 새 프로젝트를 만들지 않습니다.

프로젝트 주소가 현재 Vercel의 `VITE_SUPABASE_URL`과 일치하는지 확인합니다.

## 3-2. update_v6.sql 실행

1. Supabase 왼쪽 메뉴에서 `SQL Editor`를 엽니다.
2. `New query`를 선택합니다.
3. 압축 파일의 `supabase/update_v6.sql` 전체를 복사합니다.
4. SQL Editor에 붙여 넣습니다.
5. `Run`을 누릅니다.

이 파일은 `begin; ... commit;` 트랜잭션으로 구성되어 있습니다. 중간에 SQL 오류가 발생하면 전체 적용이 완료되지 않아야 하며, 오류 내용을 먼저 해결한 뒤 다시 실행합니다.

### 추가되는 프로필 정보

```text
sponsor_id             직접 추천인 ID
sponsor_username       직접 추천인 아이디
referral_code          고유 추천 코드
group_name             관리자용 그룹명
hierarchy_depth        계층 깊이
bank                    하위 회원 입금 은행
account_number          하위 회원 입금 계좌번호
account_holder          예금주
```

### 추가되는 주문 정보

```text
sponsor_id              접수 당시 직접 상위회원
sponsor_username        접수 당시 상위회원 아이디
creator_group_name      접수 당시 관리자용 그룹명
```

이 정보는 스냅샷으로 저장되므로 회원의 그룹 또는 상위 관계가 나중에 바뀌더라도 기존 주문 식별 정보가 임의로 바뀌지 않습니다.

### 추가되는 테이블

```text
payment_steps
```

주문마다 다음 정산 단계가 저장됩니다.

```text
입금자
수취인
단계 순서
해당 단계 1타 단가
공급가액
부가세
합계
입금 확인 시각
```

### 교체되는 주요 함수

```text
handle_new_auth_user
review_member_v6
create_order
create_orders_bulk
confirm_payment_step
save_my_settlement_account
get_my_payment_account
start_paid_orders
expire_finished_orders
```

## 3-3. update_v6.sql 실행 결과 확인

SQL Editor에서 오류가 없고 `Success. No rows returned` 또는 정상 완료 메시지가 나오면 다음 단계로 이동합니다.

오류가 나오면 프런트엔드를 배포하지 말고 오류 전문을 보관합니다.

---

# 4. 자정 자동 구동 Cron 교체

v5의 오전 9시 Cron 등록을 제거하고 자정 기준 함수 확인으로 변경합니다.

1. Supabase에서 Cron 기능이 활성화되어 있는지 확인합니다.
2. SQL Editor에서 새 Query를 엽니다.
3. `supabase/cron_v6.sql` 전체를 실행합니다.

이 파일은 기존 Job 이름을 찾아 제거한 뒤 같은 이름으로 다시 등록합니다.

```text
spark-start-paid-orders
spark-expire-finished-orders
```

자동 시작 Job은 1분마다, 자동 만료 Job은 5분마다 실행됩니다.

### 자동 시작

```text
시작일 한국 시간 00:00 이후
+ 모든 정산 단계 확인 완료
+ 주문 상태 입금완료
→ 최대 약 1분 안에 구동중
```

시작일 전에 모든 입금이 확인되면 시작일까지 입금완료로 유지합니다.

시작일이 지난 뒤 마지막 정산 단계가 확인되면 다음 1분 Cron 실행에서 구동중으로 변경됩니다.

### 자동 만료

```text
한국 날짜가 종료일 다음 날로 변경
→ 입금완료·구동중·정지 작업을 최대 약 5분 안에 만료
```

정지 기간은 보존하지 않고 기존 종료일을 사용합니다.

---

# 5. 설치 검증

SQL Editor에서 `supabase/verify_v6.sql`을 실행합니다.

## 정상 확인 항목

### profiles 컬럼 8개

```text
account_holder
account_number
bank
group_name
hierarchy_depth
referral_code
sponsor_id
sponsor_username
```

### orders 컬럼 3개

```text
creator_group_name
sponsor_id
sponsor_username
```

### payment_steps

```text
table_name = payment_steps
rls_enabled = true
```

### 함수

다음 함수들이 조회되어야 합니다.

```text
can_read_profile
confirm_payment_step
create_orders_bulk
expire_finished_orders
get_my_payment_account
notify_admins
review_member_v6
save_my_settlement_account
start_paid_orders
```

### 설정

```text
auto_start_hour = 0
```

### Cron

```text
spark-start-paid-orders       active = true
spark-expire-finished-orders  active = true
```

### 수동 함수 확인

현재 조건에 맞는 주문이 없어도 오류 없이 숫자 결과가 나오면 됩니다.

```sql
select public.start_paid_orders();
select public.expire_finished_orders();
```

---

# 6. 기존 GitHub 프로젝트에 v6 덮어쓰기

## 방법 A: 파일 탐색기로 교체

1. 현재 GitHub 프로젝트 폴더를 엽니다.
2. 별도 백업 폴더를 하나 만듭니다.
3. v6 압축을 풉니다.
4. v6의 파일과 폴더를 기존 프로젝트에 복사해 덮어씁니다.
5. 기존 `.env.local`과 `.git` 폴더는 그대로 둡니다.

기본적으로 다음 항목을 교체합니다.

```text
src/
supabase/
package.json
package-lock.json  ← npm install 후 새로 생성되거나 갱신될 수 있음
README.md
DEPLOYMENT.md
UI_ANALYSIS.md
index.html
tsconfig.json
tsconfig.node.json
vite.config.ts
vercel.json
```

v6 ZIP에 `package-lock.json`이 없다면 기존 lock 파일을 삭제한 후 `npm install`로 다시 만드는 방법이 안전합니다.

```bash
rm package-lock.json
npm install
```

Windows PowerShell에서는 다음처럼 실행할 수 있습니다.

```powershell
Remove-Item package-lock.json -ErrorAction SilentlyContinue
npm install
```

## 방법 B: Git 브랜치에서 작업

```bash
git checkout -b upgrade/referral-v6
```

v6 파일을 덮어쓴 뒤 다음을 실행합니다.

```bash
npm install
npm run build
git status
```

`.env.local`이 변경 목록에 나오지 않는지 확인합니다.

---

# 7. 로컬에서 서버 연결 테스트

기존 `.env.local`은 그대로 사용합니다.

```env
VITE_SUPABASE_URL=https://기존프로젝트.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=기존_publishable_key
```

개발 서버를 다시 시작합니다.

```bash
npm run dev
```

## 7-1. 관리자 직속 회원 확인

v5에서 이미 승인된 회원은 관리자 직속으로 유지됩니다. 기존 회원에게는 추천 코드가 자동 생성됩니다.

관리자로 로그인해 다음을 확인합니다.

- 회원관리 표에 기존 회원이 표시되는지
- 추천 코드가 생성되었는지
- 그룹명이 비어 있는 기존 회원이 있다면 수정 화면에서 그룹명을 지정할 수 있는지
- 기존 주문이 그대로 표시되는지

기존 회원은 그룹명이 비어 있을 수 있으므로 운영 식별을 위해 관리자가 한 번씩 그룹명을 지정하는 것이 좋습니다.

## 7-2. 상위회원 계좌 등록

대행사 또는 총판 계정으로 로그인합니다.

```text
내 정보
→ 하위 대행사 입금 계좌
→ 은행·계좌번호·예금주 저장
```

계좌를 등록하지 않으면 하위 추천 회원을 승인할 수 없습니다.

## 7-3. 추천 가입 테스트

1. 승인된 대행사 또는 총판의 `내 정보`에서 추천 코드를 복사합니다.
2. 시크릿 창 또는 다른 브라우저에서 회원가입합니다.
3. 추천인 아이디 또는 코드에 복사한 값을 입력합니다.
4. 가입 후 직접 추천인 계정으로 로그인합니다.
5. 알림센터에 `하위 대행사 승인 요청`이 나타나는지 확인합니다.
6. 회원관리에서 해당 회원을 선택합니다.
7. 상위 단가보다 높은 1타당 단가를 입력합니다.
8. 승인합니다.
9. 신규 회원으로 로그인합니다.
10. 신규 회원 역할이 대행사이고, 정산 화면에 추천인의 계좌가 표시되는지 확인합니다.

추천 가입 요청은 관리자 회원관리에도 보이지만, 승인 버튼은 직접 추천인 대상이라는 안내와 함께 비활성화됩니다.

## 7-4. 단가 검증

예시:

```text
총판 단가 20원
직속 대행사 단가 30원 이상
그 아래 대행사 단가 31원 이상
```

다음 입력은 서버에서 거부되어야 합니다.

```text
상위 단가와 같은 단가
상위 단가보다 낮은 단가
이미 승인된 하위 단가 이상으로 상위 단가를 올리는 수정
```

## 7-5. 계층 정산 테스트

예시 구조:

```text
관리자
└─ 총판 A: 20원
   └─ 대행사 B: 30원
      └─ 대행사 C: 40원
```

대행사 C가 작업을 접수하면 정산 단계는 다음처럼 생성됩니다.

```text
C → B : 40원 기준
B → A : 30원 기준
A → 관리자 : 20원 기준
```

테스트 순서:

1. C가 작업 접수
2. B 정산 탭에서 C의 입금을 확인
3. A 정산 탭에서 B의 입금을 확인
4. 관리자 정산 탭에서 A의 입금을 확인
5. 모든 단계 확인 후 주문 상태가 입금완료로 바뀌는지 확인
6. 접수자와 관리자 알림센터에 완료 알림이 나타나는지 확인

실제 금전 이동은 시스템이 수행하지 않습니다. 사용자가 계좌 입금을 확인한 뒤 버튼으로 상태만 기록합니다.

## 7-6. 대량 작업 접수 테스트

1. 대행사·총판 작업접수 화면에서 `대량접수 양식`을 누릅니다.
2. 내려받은 XLSX에 여러 행을 작성합니다.
3. `대량작업접수`를 누르고 파일을 선택합니다.
4. 오류 행이 있으면 행 번호가 표시되는지 확인합니다.
5. 오류가 없으면 건수와 총 금액을 확인하고 접수합니다.
6. 관리자 작업 목록 맨 아래에 모든 주문이 생성되는지 확인합니다.
7. 관리자 알림센터에 새 작업 접수 알림이 표시되는지 확인합니다.

대량 접수는 최대 500행입니다. 중간 행에서 서버 오류가 발생하면 전체 RPC 트랜잭션이 실패하도록 구성했습니다.

## 7-7. Realtime 테스트

두 컴퓨터 또는 일반 창과 시크릿 창을 동시에 엽니다.

- 추천 회원가입 후 추천인 알림이 자동 갱신되는지
- 추천 승인 후 신규 회원 로그인이 가능한지
- 작업 접수 후 관리자 목록과 알림이 갱신되는지
- 입금확인 후 각 사용자 정산 상태가 갱신되는지
- 알림 삭제가 다른 탭에도 반영되는지

갱신이 바로 되지 않으면 페이지 새로고침 후 확인하고, Supabase Realtime publication에 `payment_steps`가 포함되었는지 `verify_v6.sql`로 확인합니다.

---

# 8. GitHub push와 Vercel 업데이트

로컬 빌드가 성공하면 커밋합니다.

```bash
git add .
git commit -m "Add referral hierarchy and bulk orders"
git push -u origin upgrade/referral-v6
```

브랜치 Preview에서 화면을 먼저 확인할 수 있습니다. Preview 환경 변수도 Production과 같은 Supabase 프로젝트를 사용하면 테스트 데이터가 실제 운영 DB에 저장되므로 주의합니다.

확인이 끝나면 main에 반영합니다.

```bash
git checkout main
git pull origin main
git merge upgrade/referral-v6
git push origin main
```

GitHub와 Vercel이 연결되어 있으면 main push 후 자동으로 Production 빌드가 시작됩니다.

Vercel에서 확인:

```text
Project
→ Deployments
→ 가장 최근 배포
→ Environment: Production
→ Status: Ready
```

기존 Production 도메인은 유지됩니다.

## 환경 변수

v5에서 정상 동작했다면 새 환경 변수는 필요하지 않습니다.

다음 두 값이 Production에 계속 있어야 합니다.

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
```

환경 변수를 수정했다면 Vercel에서 새 배포를 실행해야 적용됩니다.

---

# 9. Production 최종 점검

다음 순서로 확인합니다.

## 관리자

- [ ] 로그인 정상
- [ ] 기존 회원·주문 유지
- [ ] 전체 회원의 추천 관계 표시
- [ ] 관리자용 그룹명 표시
- [ ] 추천 회원가입 알림 표시
- [ ] 새 작업 접수 알림 표시
- [ ] 주문에 등록자·상위회원·그룹명 표시
- [ ] 최상위 정산 입금확인 가능

## 총판·대행사

- [ ] 회원관리 탭 표시
- [ ] 추천 코드 표시
- [ ] 하위 계좌 저장 가능
- [ ] 직접 하위 회원만 표시
- [ ] 하위 회원 승인·반려 가능
- [ ] 상위보다 높은 단가만 저장 가능
- [ ] 직접 상위회원 계좌 표시
- [ ] 하위 입금 확인과 상위 정산 내역 표시
- [ ] 대량 양식 다운로드·업로드 가능

## 자동 처리

- [ ] `auto_start_hour = 0`
- [ ] Cron Job 2개 active
- [ ] 시작일 자정 이후 입금완료 작업이 구동중으로 변경
- [ ] 진행률이 하루 동안 감소 없이 증가
- [ ] 23:50까지 100%
- [ ] 종료일 다음 날 만료

---

# 10. 문제가 생겼을 때

## v6 화면에서 RPC 오류

다음 메시지와 비슷한 오류가 나오면 데이터베이스 마이그레이션이 적용되지 않았거나 다른 Supabase 프로젝트를 보고 있을 가능성이 큽니다.

```text
function review_member_v6 does not exist
relation payment_steps does not exist
function create_orders_bulk does not exist
```

확인:

1. Vercel의 `VITE_SUPABASE_URL`
2. SQL을 실행한 Supabase 프로젝트 URL
3. `verify_v6.sql` 결과
4. Vercel 최신 Production 배포 여부

## 추천 코드 가입 실패

확인:

- 추천인이 승인 상태인지
- 추천인이 활성 상태인지
- 추천인 역할이 대행사 또는 총판인지
- 아이디 또는 추천 코드를 정확히 입력했는지

## 하위 회원 승인 실패

확인:

- 승인하는 사람이 직접 추천인인지
- 추천인이 자신의 계좌를 등록했는지
- 하위 단가가 상위 단가보다 높은지
- 승인 대상이 이미 다른 추천인의 하위 회원인지

## 주문이 입금완료가 되지 않음

정산 탭에서 해당 주문의 모든 `payment_steps`가 확인되었는지 확인합니다.

SQL 확인:

```sql
select
  order_number,
  step_order,
  payer_username,
  payee_username,
  total_amount,
  confirmed_at
from public.payment_steps
where order_number = '확인할 주문번호'
order by step_order;
```

## 자정 자동 구동이 되지 않음

확인:

```sql
select cutoff_hour, auto_start_hour from public.app_settings where id = true;
select jobid, jobname, schedule, active from cron.job;
select * from cron.job_run_details order by start_time desc limit 30;
```

수동 실행:

```sql
select public.start_paid_orders();
```

주문은 다음 조건을 모두 만족해야 합니다.

```text
status = 입금완료
start_date <= 오늘 한국 날짜
end_date >= 오늘 한국 날짜
```

## 프런트엔드만 이전 버전으로 되돌리기

Vercel에서 이전 정상 배포로 Rollback할 수 있습니다. 다만 v6 데이터베이스 함수는 그대로 남습니다. 장기간 v5 화면으로 되돌릴 경우 v5의 단일 입금완료 처리 방식과 v6의 정산 계층 규칙이 충돌할 수 있으므로 임시 화면 롤백 용도로만 사용합니다.

---

# 11. Supabase CLI를 사용하는 경우

Dashboard SQL Editor 대신 마이그레이션 파일로 적용할 수도 있습니다.

v6에는 다음 파일이 포함되어 있습니다.

```text
supabase/migrations/20260731020000_referral_hierarchy.sql
```

프로젝트를 연결한 뒤 변경 내용을 확인합니다.

```bash
npx supabase login
npx supabase link --project-ref 본인프로젝트REF
npx supabase db push --dry-run
npx supabase db push
```

Cron은 프로젝트 환경에 따라 별도로 `supabase/cron_v6.sql`을 SQL Editor에서 실행하는 방식이 단순합니다.

SQL Editor 방식과 CLI `db push` 방식을 같은 마이그레이션에 중복 적용하지 않습니다. 현재처럼 이미 Dashboard에서 직접 운영해 왔다면 이번에는 `update_v6.sql`을 SQL Editor에서 한 번 실행하는 방식이 가장 명확합니다.
