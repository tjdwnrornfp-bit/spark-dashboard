# SPARK v9.8 적용 순서

## 1. SQL 적용 여부

v9.8은 새 테이블, 열, RPC를 추가하지 않으므로 **신규 SQL migration은 없습니다.** 기존 v9.0 이상 환경의 `public.profiles`와 `public.audit_logs`를 사용합니다.

Supabase SQL Editor에서 아래 확인 쿼리 결과가 모두 `true`인지 확인합니다.

```sql
select
  to_regclass('public.profiles') is not null as profiles_ready,
  to_regclass('public.audit_logs') is not null as audit_logs_ready;
```

`audit_logs_ready`가 `false`이면 v9.8을 먼저 배포하지 말고, 해당 운영 DB의 현재 버전을 확인한 뒤 기존 `supabase/update_v9_stability.sql`부터 순서대로 적용합니다. 운영 데이터가 있는 DB에 `schema.sql`을 다시 실행하지 않습니다.

## 2. Edge Function 배포

Supabase CLI를 사용하는 경우 저장소 루트에서 실행합니다.

```bash
supabase functions deploy reset-member-password
```

Dashboard에서 배포할 때는 함수 이름을 `reset-member-password`로 만들고 `supabase/functions/reset-member-password/index.ts`를 사용합니다.

- JWT 검증을 끄지 않습니다.
- `SUPABASE_SERVICE_ROLE_KEY`를 `VITE_` 환경 변수나 프런트엔드에 추가하지 않습니다.
- Hosted Supabase Edge Function의 서버 환경에서만 service role을 사용합니다.

## 3. 프런트엔드 배포

```bash
npm ci
npm run typecheck
npm run build
```

검증이 끝난 `main`을 Vercel Production에 배포합니다.

## 4. 운영 확인

1. 관리자 계정으로 각 작업 프로그램 탭의 `통합 엑셀`을 엽니다.
2. 프로그램과 상태를 두 개 이상 선택하고 그룹명/등록자 검색 결과 건수를 확인합니다.
3. `조건에 맞는 전체 작업`과 `작업을 직접 선택`을 각각 다운로드합니다.
4. Excel 파일이 한 시트인지, A~M 열 순서와 프로그램 문자열이 정확한지 확인합니다.
5. J/K 열 셀 형식이 날짜이며 표시 형식이 `yyyy-mm-dd`인지 확인합니다.
6. 회원관리에서 테스트 일반 회원의 임시 비밀번호를 생성해 재설정합니다.
7. 해당 회원이 새 비밀번호로 로그인되고 이전 비밀번호로는 로그인되지 않는지 확인합니다.
8. 운영기록에서 `비밀번호 재설정` 로그의 대상/관리자/시각을 확인하고 비밀번호가 포함되지 않았는지 확인합니다.
9. 관리자 계정은 재설정 대상 목록에 나오지 않고 `내 정보`에서만 비밀번호를 변경하는지 확인합니다.
