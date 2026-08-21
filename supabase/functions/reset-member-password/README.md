# reset-member-password Edge Function

관리자 회원관리 화면에서 일반 회원의 비밀번호를 재설정하기 위한 서버 전용 함수입니다.

- 브라우저에는 `service_role` 키를 노출하지 않습니다.
- 호출자의 Auth access token과 활성·승인 관리자 권한을 다시 검증합니다.
- 관리자 계정은 이 함수로 변경하지 않고, 기존 `내 정보`에서 현재 비밀번호 확인 후 변경합니다.
- `auth.admin.updateUserById`는 Edge Function 내부에서만 실행합니다.
- 감사로그에는 작업 종류, 대상 회원, 실행 관리자, 실행 시각만 기록합니다.
- 새 비밀번호 원문과 인증용 변환값은 로그 또는 데이터베이스 테이블에 저장하지 않습니다.

Supabase Dashboard의 Edge Functions에서 함수 이름을 `reset-member-password`로 만들고 `index.ts` 내용을 배포하세요.
