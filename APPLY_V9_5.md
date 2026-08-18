# SPARK v9.5 적용 순서

1. `supabase/preflight_v9_5.sql` 실행
2. `supabase/update_v9_5_member_cleanup.sql` 전체 실행
3. `supabase/verify_v9_5.sql` 실행
4. Supabase Dashboard > Edge Functions에서 `delete-member` 함수 생성
5. `supabase/functions/delete-member/index.ts` 전체를 붙여넣고 Deploy
6. 프런트 파일 반영
7. `npm run build`
8. GitHub push / Vercel 배포

## 테스트

1. 작업/정산 이력이 없는 테스트 계정 선택
2. `계정 영구 삭제` 클릭
3. `삭제 가능` 확인 후 영구 삭제
4. 회원관리 목록에서 사라졌는지 확인
5. 같은 아이디로 신규 회원가입
6. 정상적으로 가입 신청되는지 확인
7. 작업 이력이 있는 회원을 선택해 삭제가 차단되는지 확인
