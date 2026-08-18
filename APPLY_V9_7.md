# SPARK v9.7 적용

이번 버전은 UI 전용 업데이트입니다. Supabase SQL을 실행하지 않습니다.

교체 파일:

- `src/features/SettlementPage.tsx`
- `src/styles.css`
- `package.json`

적용 후:

```cmd
npm run build
git add .
git commit -m "Compact admin settlement cards"
git pull --rebase origin main
git push origin main
```
