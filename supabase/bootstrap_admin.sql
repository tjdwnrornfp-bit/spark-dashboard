-- 1) 먼저 앱 회원가입 화면에서 admin 아이디로 가입 신청합니다.
-- 2) 그 다음 이 SQL을 실행합니다.
-- 다른 관리자 아이디를 사용했다면 아래 username_key 값을 수정하세요.

update public.profiles
set role = 'tjdwn',
    approval_status = 'approved',
    active = true,
    price_per_shot = 0,
    approved_at = coalesce(approved_at, now()),
    updated_at = now()
where username_key = 'tjdwn';

-- 적용 결과 확인
select id, username, role, approval_status, active
from public.profiles
where username_key = 'tjdwn';
