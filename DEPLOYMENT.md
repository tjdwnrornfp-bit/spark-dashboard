# Supabase + Vercel 서버 배포 가이드

이 프로젝트는 다음 구조로 배포합니다.

```text
사용자 브라우저
  ├─ Vercel: React 화면 제공
  └─ Supabase
       ├─ Auth: 로그인·회원가입
       ├─ Postgres: 회원·주문·정산·알림·공지 저장
       ├─ Realtime: 여러 컴퓨터 화면 동기화
       └─ Cron: 오전 9시 자동 구동·종료일 경과 자동 만료
```

현재 Supabase **조직만 만든 상태**라면 아래 1번부터 순서대로 진행하면 됩니다.

---

## 0. 로컬 준비

### 필요한 프로그램

- Node.js 20.19 이상 또는 22.12 이상
- Git
- Chrome
- GitHub 계정
- Vercel 계정

프로젝트 압축을 풀고 폴더 안에서 터미널을 엽니다.

```bash
npm install
```

아직 Supabase 환경 변수를 만들지 않았다면 앱은 브라우저 `localStorage`를 사용하는 데모 모드로 실행됩니다.

---

## 1. 조직 안에 Supabase 프로젝트 만들기

1. Supabase Dashboard에 로그인합니다.
2. 만든 조직으로 이동합니다.
3. **New project**를 누릅니다.
4. 다음 값을 입력합니다.
   - Project name: 예) `spark-dashboard`
   - Database password: 임의의 강한 비밀번호
   - Region: 실제 사용자가 있는 지역과 가까운 곳
5. 프로젝트 생성을 시작합니다.
6. 데이터베이스 준비가 끝날 때까지 기다립니다.

데이터베이스 비밀번호는 프런트엔드 코드나 Vercel 환경 변수에 넣지 않습니다. 데이터베이스 직접 접속이 필요한 경우에만 별도로 사용합니다.

---

## 2. 데이터베이스와 보안 정책 설치

1. 생성한 Supabase 프로젝트를 엽니다.
2. 왼쪽 메뉴에서 **SQL Editor**를 선택합니다.
3. **New query**를 누릅니다.
4. 프로젝트의 `supabase/schema.sql` 파일 전체를 복사합니다.
5. SQL Editor에 붙여 넣고 **Run**을 누릅니다.

이 SQL이 설치하는 항목:

- `profiles`: 회원과 회원별 1타 단가
- `orders`: 작업 접수 데이터
- `notifications`: 사용자 알림
- `notices`: 공지사항
- `app_settings`: 계좌와 마감 시각
- RLS 권한 정책
- 주문 생성·상태 변경·회원 승인 함수
- Realtime publication
- 자동 구동·자동 만료 함수

### 실행 결과 확인

오류 없이 완료되면 SQL Editor에서 `supabase/verify_setup.sql`을 실행합니다.

첫 실행에서는 Cron을 아직 설정하지 않았으므로 Cron 조회 부분에서 오류가 나거나 결과가 없을 수 있습니다. 나머지 항목은 다음과 같이 보여야 합니다.

- 필수 테이블 5개
- 모든 필수 테이블의 `rls_enabled = true`
- Realtime publication에 필수 테이블 5개
- 핵심 함수 5개

---

## 3. Supabase Auth 설정

앱 화면에는 이메일 입력이 없지만 내부적으로 아이디를 고유한 가상 이메일로 변환해 Supabase Email/Password Auth를 사용합니다.

1. Supabase 왼쪽 메뉴에서 **Authentication**을 엽니다.
2. **Sign In / Providers** 또는 **Providers**를 엽니다.
3. Email provider를 선택합니다.
4. 다음 항목을 확인합니다.
   - Email provider: 활성화
   - Allow new users to sign up: 활성화
   - Confirm email: 비활성화

`Confirm email`을 꺼야 실제 이메일을 입력하지 않는 회원가입 방식으로 바로 계정을 만들 수 있습니다.

화면에서는 비밀번호를 종류와 관계없이 4자부터 허용합니다. Supabase에 전달할 때는 앱이 내부적으로 긴 인증용 문자열로 변환하므로 Supabase 최소 길이 검사와 충돌하지 않습니다. 사용자 계정 보안을 위해 실제 운영 비밀번호는 8자 이상을 권장합니다.

---

## 4. 프로젝트 URL과 Publishable key 복사

Supabase 프로젝트 상단의 **Connect** 버튼 또는 **Settings → API Keys**에서 다음 값을 확인합니다.

- Project URL
- Publishable key: `sb_publishable_...`

프로젝트 루트에 `.env.local` 파일을 만들고 입력합니다.

```env
VITE_SUPABASE_URL=https://프로젝트참조.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_실제키
```

기존 프로젝트라 Publishable key가 없고 legacy anon key만 있다면 다음 변수도 지원합니다.

```env
VITE_SUPABASE_ANON_KEY=legacy_anon_key
```

### 절대 넣으면 안 되는 값

```text
sb_secret_... 키
service_role 키
데이터베이스 비밀번호
직접 접속 connection string
```

프런트엔드는 Publishable key와 로그인 사용자의 JWT를 사용하며, 실제 데이터 접근 범위는 `schema.sql`의 RLS 정책이 제한합니다.

---

## 5. Supabase 연결 상태로 로컬 실행

프로젝트 폴더에서 실행합니다.

```bash
npm run dev
```

브라우저에서 터미널에 표시된 주소를 엽니다. 일반적으로 다음 주소입니다.

```text
http://localhost:5173
```

사이드바 하단 또는 로그인 안내에 서버 동기화 모드가 표시되면 `.env.local`이 정상 적용된 것입니다.

계속 데모 모드로 나오면 다음을 확인합니다.

1. 파일명이 정확히 `.env.local`인지
2. 변수 이름에 오타가 없는지
3. 값을 입력한 뒤 개발 서버를 껐다 다시 실행했는지

---

## 6. 첫 관리자 계정 만들기

관리자 계정도 먼저 일반 회원가입으로 Auth 계정을 생성한 뒤 SQL로 관리자 권한을 부여합니다.

### 6-1. 앱에서 관리자 아이디 가입

1. 로그인 화면에서 **회원가입**을 선택합니다.
2. 예를 들어 다음처럼 가입합니다.

```text
아이디: admin
비밀번호: 본인이 사용할 비밀번호
비밀번호 확인: 동일한 비밀번호
```

가입 직후에는 승인대기 상태이므로 로그인할 수 없는 것이 정상입니다.

### 6-2. 관리자 권한 부여

1. Supabase **SQL Editor**를 엽니다.
2. `supabase/bootstrap_admin.sql`을 실행합니다.
3. 결과에서 다음 항목을 확인합니다.

```text
role = admin
approval_status = approved
active = true
```

다른 관리자 아이디를 사용했다면 `bootstrap_admin.sql` 안의 아래 값을 수정한 뒤 실행합니다.

```sql
where username_key = 'admin';
```

이제 앱에서 관리자 아이디로 로그인할 수 있습니다.

---

## 7. 자동 구동과 자동 만료 Cron 설정

### 7-1. Cron 모듈 활성화

1. Supabase 프로젝트에서 **Integrations → Cron**을 엽니다.
2. Cron Postgres Module을 활성화합니다.

Cron 메뉴 이름이 다르게 보이면 Database Extensions에서 `pg_cron`을 검색해 활성화합니다.

### 7-2. 작업 등록

1. SQL Editor에서 `supabase/cron.sql`을 엽니다.
2. 전체를 실행합니다.

등록되는 작업:

| Job | 실행 | 처리 |
|---|---|---|
| `spark-start-paid-orders` | 한국 시간 09:00~23:55, 5분 간격 | 시작일이 된 입금완료 작업을 구동중으로 변경 |
| `spark-expire-finished-orders` | 24시간, 5분 간격 | 종료일이 지난 입금완료·구동중·정지 작업을 만료로 변경 |

종료일 당일에는 구동 상태를 유지하고, 한국 날짜가 다음 날로 넘어간 후 최대 5분 이내에 만료됩니다.

### 7-3. Cron 확인

`cron.sql` 마지막 조회 결과에 두 Job이 `active = true`로 표시되어야 합니다.

실행 이력은 Supabase Cron 화면 또는 SQL로 확인할 수 있습니다.

```sql
select *
from cron.job_run_details
order by start_time desc
limit 30;
```

수동 테스트도 가능합니다.

```sql
select public.start_paid_orders();
select public.expire_finished_orders();
```

---

## 8. 회원가입 승인과 단가 테스트

1. 관리자와 다른 브라우저 또는 시크릿 창을 엽니다.
2. 테스트 회원 아이디로 가입합니다.
3. 관리자 화면의 **회원관리**로 이동합니다.
4. 회원을 선택합니다.
5. 대행사 또는 총판을 지정합니다.
6. 1타당 단가를 입력합니다.
7. **가입 승인**을 누릅니다.
8. 테스트 회원이 로그인되는지 확인합니다.

회원 단가를 나중에 변경해도 과거 주문은 접수 당시 단가를 유지합니다. 변경 단가는 새 주문에만 적용됩니다.

---

## 9. 다중 컴퓨터 실시간 동기화 테스트

관리자 브라우저와 사용자 브라우저를 동시에 열어 다음을 확인합니다.

1. 사용자가 작업을 접수합니다.
2. 관리자 작업접수 목록의 맨 아래에 새 작업이 나타납니다.
3. 관리자가 정산 탭에서 **입금완료**를 누릅니다.
4. 사용자 화면의 주문 상태와 입금 금액이 갱신됩니다.
5. 사용자 알림센터에 입금완료 알림이 나타납니다.
6. 한 브라우저에서 알림을 삭제하면 다른 탭에서도 사라집니다.

Realtime 이벤트가 오면 앱이 현재 로그인 사용자의 권한으로 데이터를 다시 조회합니다. 따라서 일반 회원은 본인 주문과 본인 알림만 받을 수 있습니다.

---

## 10. GitHub 저장소에 업로드

GitHub에서 빈 저장소를 하나 만듭니다. README나 `.gitignore`를 GitHub에서 미리 생성하지 않는 편이 간단합니다.

프로젝트 폴더의 터미널에서 실행합니다.

```bash
git init
git add .
git commit -m "Initial SPARK dashboard"
git branch -M main
git remote add origin https://github.com/본인아이디/저장소이름.git
git push -u origin main
```

`.env.local`은 `.gitignore`에 포함되어 있으므로 GitHub에 올라가지 않습니다. 업로드 전 다음 명령으로 확인할 수 있습니다.

```bash
git status
```

`.env.local`이 변경 목록에 나오면 커밋하지 마세요.

---

## 11. Vercel에 화면 배포

### 11-1. 프로젝트 연결

1. Vercel Dashboard에 로그인합니다.
2. **Add New → Project**를 선택합니다.
3. 방금 만든 GitHub 저장소를 Import합니다.
4. Framework Preset이 `Vite`로 인식되는지 확인합니다.
5. 프로젝트가 저장소 루트에 있다면 Root Directory는 변경하지 않습니다.

일반 설정:

```text
Build Command: npm run build
Output Directory: dist
Install Command: npm install
```

대부분 Vercel이 자동으로 설정합니다.

### 11-2. 환경 변수 입력

Vercel 프로젝트 생성 화면의 Environment Variables에 다음 두 값을 넣습니다.

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
```

값은 로컬 `.env.local`과 같습니다. Production, Preview, Development 환경에 모두 적용하면 테스트가 편합니다.

### 11-3. Deploy

**Deploy**를 누릅니다. 빌드가 완료되면 다음 형태의 주소가 생성됩니다.

```text
https://프로젝트이름.vercel.app
```

`vercel.json`에 SPA rewrite가 포함되어 있어 `/orders` 같은 화면 상태에서 새로고침하더라도 `index.html`로 연결됩니다.

---

## 12. Vercel 주소를 Supabase Auth에 등록

배포 주소가 정해지면 Supabase에서 다음을 설정합니다.

1. **Authentication → URL Configuration**을 엽니다.
2. Site URL에 Vercel 운영 주소를 입력합니다.
3. Redirect URLs에 아래 주소를 추가합니다.

```text
http://localhost:5173/**
https://프로젝트이름.vercel.app/**
```

현재 앱은 이메일 확인 링크를 사용하지 않지만, Auth 설정을 운영 주소와 일치시키는 것이 좋습니다.

---

## 13. 배포 후 최종 확인

서로 다른 컴퓨터나 모바일에서 Vercel 주소를 열고 확인합니다.

### 계정

- 회원가입 가능
- 승인 전 로그인 차단
- 관리자의 회원 유형·단가 지정
- 승인 후 로그인 가능

### 주문

- 신규 주문이 목록 아래에 추가
- 다른 컴퓨터 관리자 화면에 실시간 표시
- 관리자만 상태 변경 가능
- 엑셀 파일이 `.xlsx`로 내려받아지고 열 너비가 유지

### 정산

- 입금대기 금액 집계
- 입금완료 금액 집계
- 총 접수 금액 집계
- 관리자 입금완료 버튼 동작

### 자동화

- 시작일 오전 9시 이후 입금완료 작업이 구동중으로 전환
- 종료일 다음 날 최대 5분 안에 만료
- 정지 작업도 종료일 연장 없이 만료

### 알림

- 상태 변경 알림 표시
- 모두 읽음
- 개별 삭제
- 전체 삭제
- 다른 탭과 동기화

---

## 문제 해결

### `relation "public.profiles" does not exist`

`schema.sql`이 실행되지 않았거나 다른 프로젝트에서 실행한 경우입니다. 현재 프로젝트의 SQL Editor에서 다시 실행하세요.

### 가입 후 `Database error saving new user`

대부분 `handle_new_auth_user` 트리거 또는 `profiles` 제약 조건 문제입니다.

1. SQL Editor의 오류 로그를 확인합니다.
2. `schema.sql`을 다시 실행합니다.
3. Authentication Users에서 실패한 테스트 계정을 삭제합니다.
4. 앱에서 다시 가입합니다.

### 관리자 가입했는데 로그인 불가

`bootstrap_admin.sql` 실행 결과를 확인하세요.

```sql
select username, role, approval_status, active
from public.profiles
where username_key = 'admin';
```

### 앱이 계속 데모 모드로 실행됨

- `.env.local` 위치가 `package.json`과 같은 폴더인지 확인
- Vite 개발 서버 재시작
- Vercel 환경 변수 입력 후 새로 배포

### 실시간 갱신이 안 됨

`verify_setup.sql`에서 Realtime publication에 다섯 테이블이 모두 나오는지 확인합니다.

```text
app_settings
notices
notifications
orders
profiles
```

브라우저 개발자 도구의 Console에서 WebSocket 또는 Supabase 오류도 확인하세요.

### Cron SQL에서 `schema cron does not exist`

Cron 모듈이 활성화되지 않은 상태입니다. **Integrations → Cron**에서 먼저 활성화한 뒤 `cron.sql`을 실행하세요.

### 자동 만료가 안 됨

1. `cron.job`에서 Job이 active인지 확인
2. `cron.job_run_details`에서 실패 기록 확인
3. 주문의 `end_date`와 현재 한국 날짜 확인
4. 수동으로 `select public.expire_finished_orders();` 실행

### Vercel 빌드에서 Node 버전 오류

Vercel Project Settings에서 Node.js 22 계열을 선택한 뒤 다시 배포하세요.
