# SPARK v9.2.2 적용

교체 파일:

- `src/features/SettlementPage.tsx`
- `src/styles.css`
- `package.json`

Supabase SQL 변경은 없습니다.

```cmd
npm run build
git add src/features/SettlementPage.tsx src/styles.css package.json V9_2_2_CHANGELOG.md APPLY_V9_2_2.md
git commit -m "Simplify batch payment confirmation"
git pull --rebase origin main
git push origin main
```
