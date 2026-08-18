# delete-member Edge Function

관리자 UI에서 미사용 회원의 Supabase Auth 계정을 hard delete 하기 위한 서버 전용 함수입니다.

- 브라우저에는 `service_role` 키를 노출하지 않습니다.
- 호출자의 Auth access token을 다시 검증합니다.
- 활성 승인 관리자만 실행할 수 있습니다.
- `member_deletion_check_core_v95`에서 작업/정산/하위회원 이력을 재검사한 뒤 삭제합니다.
- hard delete 후 같은 아이디의 deterministic auth email을 다시 사용할 수 있습니다.

Supabase Dashboard의 Edge Functions에서 함수 이름을 `delete-member`로 만들고 `index.ts` 내용을 배포하세요.
