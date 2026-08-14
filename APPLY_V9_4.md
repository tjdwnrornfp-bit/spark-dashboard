# v9.4 적용
1. supabase/preflight_v9_4.sql 실행
2. supabase/update_v9_4_member_phone_company_settlement.sql 전체 실행
3. supabase/verify_v9_4.sql 실행
4. 프런트 파일 덮어쓰기
5. npm run build
6. git add . && git commit -m "Add signup phone and company settlement cards" && git pull --rebase origin main && git push origin main

기존 데이터는 삭제하지 않습니다. 기존 회원은 전화번호가 없으므로 관리자 화면에서 '-'로 표시됩니다. v9.4 적용 이후 신규 가입부터 전화번호가 필수입니다.
