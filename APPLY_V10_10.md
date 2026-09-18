# v10.10 적용

1. 최신 main 및 운영 `app_schema_versions`가 v10.9.0인지 확인합니다. `supabase/preflight_v10_10.sql`의 ready 값과 함수/RLS 기준값을 보관합니다.
2. **새 파일 하나만** 적용합니다: `supabase/migrations/20260916044522_v10_10_grouped_downline_work.sql`. 과거 마이그레이션을 재실행하지 않습니다. 이미 v10.10.0이면 재적용하지 않습니다.
3. `supabase/verify_v10_10.sql`을 운영자 세션에서 실행합니다. repeatable-read/read-only 트랜잭션에서 실제 계정 범위를 대조하며 끝에 rollback합니다. 테스트 사용자나 주문을 만들지 않습니다.
4. preflight의 함수/RLS 기준값을 다시 조회하여 기존 함수 정의·실행 권한·RLS가 동일한지 비교하고 Supabase security advisors를 확인합니다.
5. `npm run typecheck`, `npm run build` 및 package.json의 모든 테스트를 통과한 코드만 main에 반영합니다. DB를 먼저 적용하고 Vercel 자동배포 완료를 확인합니다.

신규 공개 RPC:

- `get_manager_agency_folders_v1010`
- `get_manager_agency_orders_v1010`
- `get_manager_managed_orders_v1010`
- `get_downline_group_overview_v1010`
- `get_downline_agency_overview_v1010`
- `get_downline_orders_v1010`

비공개 helper: `spark_private.downline_members_v1010`. 공개 RPC는 승인/활성/역할 및 요청 대행사 범위를 검사하고 search_path를 비워 두며 anon/PUBLIC execute를 허용하지 않습니다. 일반 계정은 helper를 직접 실행할 수 없습니다. 재귀 UNION으로 cycle을 방어합니다. 삭제된 프로필은 제외되며 비활성 중간 계층 때문에 과거 하위 작업을 잘라내지 않습니다.

롤백이 필요하면 프런트엔드를 이전 커밋으로 되돌릴 수 있습니다. 기존 API와 데이터를 변경하지 않아 이전 버전과 호환됩니다. 데이터나 과거 마이그레이션을 삭제하지 않습니다.

수동 화면 점검: 중간관리자 두 보기, 총판·대행사 하위 그룹/빈 상태, 폴더 펼침과 페이지, 빠른 상태 필터, Shift 및 전체 선택, 그룹·대행사·선택 엑셀, 모바일 카드. 실제 payment-step 확인 작업은 기존 정산 화면에서 기존 정책을 따릅니다.

## 운영 적용 기록

- 2026-09-18 10:46:31 KST, `aoiqdvxrimopmodojcza`에 실제 적용 완료.
- 운영 migration history: `20260918014631_v10_10_grouped_downline_work`; 앱 스키마: `v10.10.0`.
- 운영 read-only 검증: 중간관리자 3명, 대행사·총판 62명. 범위/무권한 ID 차단/페이지/현재 그룹/수령대기 금액/이전 manager 조회와 일치 모두 PASS.
- 기존 공개 함수 정의와 실행 권한 및 RLS 정책의 적용 전후 해시가 동일합니다.
- Security advisors: 새 6개 RPC에 의도된 `authenticated SECURITY DEFINER` 실행 알림이 추가되었습니다. 실제 역할/범위/anon 차단 검증을 통과했으며 기존 경고는 변경하지 않았습니다. [Supabase 설명](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).
- 화면 검증: 그룹/대행사 단계별 lazy-load, Shift 4행 선택, 대행사 53행 전체 선택, 닫기/열기 선택 유지, 모바일 카드, 빈 계정, 중간관리자 메뉴 분리 및 진행중/전체보기 전환 확인.
