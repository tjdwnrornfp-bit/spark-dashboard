# v9.3.2 적용

패치의 다음 파일을 기존 프로젝트에 덮어씁니다.

- `src/features/OrdersPage.tsx`
- `package.json`

Supabase SQL 실행은 필요 없습니다.

```cmd
npm run build
git add src/features/OrdersPage.tsx package.json
git commit -m "Remove won suffix from Excel unit prices"
git pull --rebase origin main
git push origin main
```
