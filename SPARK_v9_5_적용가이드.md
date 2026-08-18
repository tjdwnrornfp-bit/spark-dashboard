# SPARK v9.5 미사용 회원 계정 정리 적용 가이드

## 적용 전

`supabase/preflight_v9_5.sql`을 실행하고 기존 회원/주문/정산 건수를 확인합니다.

## DB 업데이트

Supabase SQL Editor의 새 쿼리에서 `supabase/update_v9_5_member_cleanup.sql` 전체를 실행합니다.

이 SQL은 운영 회원이나 주문을 삭제하지 않습니다. 삭제 가능 여부를 검사하는 RPC와 스키마 버전만 추가합니다.

적용 후 `supabase/verify_v9_5.sql`을 실행해 `v9.5.0`과 두 RPC가 존재하는지 확인합니다.

## Edge Function 배포

Supabase Dashboard에서 Edge Functions 메뉴로 이동합니다.

1. 새 함수 생성
2. 함수 이름: `delete-member`
3. `supabase/functions/delete-member/index.ts` 전체 붙여넣기
4. Deploy

호스팅된 Supabase Edge Function에는 `SUPABASE_URL`과 `SUPABASE_SERVICE_ROLE_KEY`가 서버 환경변수로 제공됩니다. service_role 키를 Vercel이나 브라우저 코드에 추가하지 않습니다.

## 프런트 배포

v9.5 패치를 기존 프로젝트에 덮어쓴 뒤:

```cmd
npm run build
```

성공하면:

```cmd
git add .
git commit -m "Add safe member account cleanup"
git pull --rebase origin main
git push origin main
```

## 삭제 정책

미사용 테스트 계정처럼 보존할 업무 이력이 없는 계정만 삭제할 수 있습니다.

작업, 정산, 하위 회원, 공지, 정산 묶음 등 이력이 하나라도 있으면 UI와 서버에서 삭제를 차단합니다.

삭제 성공 시 Supabase Auth 사용자를 hard delete하므로 동일 아이디의 내부 Auth 이메일도 제거되고, 같은 아이디로 다시 가입할 수 있습니다.

## 기존 데이터 영향

기존 주문, 정산, 회원 계층, 프로그램 단가, 게이지, 보관 작업, 공지, 감사 기록은 변경하지 않습니다.

삭제를 실제로 실행한 특정 미사용 회원의 로그인 계정, 프로필, 연락처, 해당 회원 알림만 정리됩니다.
