# SPARK v9.2.1 적용

교체 파일:

- `src/styles.css`
- `src/features/SettlementPage.tsx`
- `package.json`

Supabase SQL 재실행은 필요하지 않습니다.

```cmd
npm run build
git add src/styles.css src/features/SettlementPage.tsx package.json V9_2_1_CHANGELOG.md APPLY_V9_2_1.md
git commit -m "Fix settlement responsive typography"
git pull --rebase origin main
git push origin main
```
