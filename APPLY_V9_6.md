# SPARK v9.6 적용

1. Supabase SQL Editor에서 `supabase/preflight_v9_6.sql`을 실행합니다.
2. `supabase/update_v9_6_admin_company_overview.sql` 전체를 실행합니다.
3. `supabase/verify_v9_6.sql`로 `v9.6.0`과 RPC 설치를 확인합니다.
4. 패치의 프로젝트 파일을 기존 프로젝트에 덮어씁니다. `.git`, `.env.local`은 유지합니다.
5. `npm run build`를 실행합니다.
6. 성공하면 GitHub에 push하여 Vercel을 배포합니다.

기존 회원, 주문, 정산, 게이지, 회원 연락처, 계정 삭제 기능에는 변경이 없습니다.
