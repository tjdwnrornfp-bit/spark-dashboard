# SPARK v9 적용 순서

## 중요

DB를 먼저 적용하고 프런트를 배포합니다. 기존 운영 데이터는 삭제하지 않습니다.

## 1. Supabase 사전 점검

1. SQL Editor에서 `supabase/preflight_v9.sql` 실행
2. 결과 저장
3. 활성 관리자 수와 기존 작업 수 확인

## 2. 안정성 마이그레이션

1. 새 SQL Editor 열기
2. `supabase/update_v9_stability.sql` 전체 실행
3. 일부만 나누어 실행하지 않기
4. 오류 없이 완료된 뒤 `supabase/verify_v9_stability.sql` 실행

## 3. 프런트 파일 교체

기존 프로젝트의 다음 항목은 유지합니다.

```text
.git
.env.local
```

기존 `supabase` 폴더는 `supabase-backup-v8`로 이름을 바꾸고, v9의 `supabase` 폴더를 새로 복사합니다. 이렇게 해야 오래된 실행 SQL이 루트에 남지 않습니다.

나머지 v9 파일을 프로젝트에 덮어씁니다.

## 4. 빌드

```cmd
npm install
npm run build
```

## 5. GitHub·Vercel

```cmd
git add .
git commit -m "Upgrade SPARK dashboard to v9 stability"
git pull --rebase origin main
git push origin main
```

## 6. 배포 후 점검

관리자 로그인 후 `운영기록`에서 다음 값이 0인지 확인합니다.

- 정산 단계 누락
- 정산 상태 불일치
- 비활성 Cron

테스트 작업 1건으로 접수, 입금확인, 상태변경, 보관, 복원을 확인합니다.
