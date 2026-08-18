# v9.7.1 적용

이번 업데이트는 UI 파일만 변경합니다. Supabase SQL은 실행하지 않습니다.

변경 파일:
- `src/features/SettlementPage.tsx`
- `src/styles.css`
- `package.json`

적용 후:

```cmd
npm run build
git add .
git commit -m "Restore grouped settlement table layout"
git pull --rebase origin main
git push origin main
```
