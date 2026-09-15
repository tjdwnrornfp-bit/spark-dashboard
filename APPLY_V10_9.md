# v10.9.0 적용 안내

현재 main의 v10.8.0 위에 추가하는 읽기 전용 중간관리자 폴더 화면입니다.

1. `supabase/preflight_v10_9.sql`로 v10.8.0과 기존 함수/RLS 해시를 확인합니다.
2. `supabase/migrations/20260914070835_v10_9_manager_agency_folders.sql` **한 파일만** 적용합니다. 과거 마이그레이션을 재실행하거나 전체 `db push`를 하지 마세요. 이미 v10.9.0이면 중단합니다.
3. `supabase/verify_v10_9.sql`로 v10.9.0, 신규 두 함수의 SECURITY DEFINER / 빈 search_path / STABLE / anon 차단 / authenticated 실행 허용 및 기존 해시 일치를 확인합니다.
4. `supabase/verify_v10_9_readonly_scope.sql`로 승인·활성 중간관리자의 JWT subject를 트랜잭션 로컬 설정으로 지정하고 읽기 전용 RPC를 검증합니다. 실제 사용자·작업·입금 데이터를 변경하지 않습니다.
5. `npm ci`, `npm run typecheck`, `npm run build`, `npm run test:folders`, `npm run test:selection`, 기존 member-edit/correction/assignment 테스트를 실행합니다. 테스트 데이터 쓰기는 격리된 PGlite 메모리 DB에서만 수행합니다.
6. DB 성공 후 main 배포. 기존 v108/v102 RPC가 그대로 남으므로 이전 프런트엔드도 동작합니다. UI 롤백은 이전 프런트엔드 배포로 가능하며 신규 읽기 전용 RPC를 삭제할 필요가 없습니다.

## 조회 규칙

- `get_manager_agency_folders_v109`: 대행사 20개/페이지(최대 50), 서버 검색·필터·정렬·페이지 수 계산.
- `get_manager_agency_orders_v109`: 대행사 ID 필수 검증, 작업 50개/페이지(최대 500). 승인·활성 중간관리자와 **현재** `profiles.manager_id`를 검증합니다.
- 대행사 전체 선택/엑셀은 폴더의 현재 필터로 500건씩 순차 조회합니다. 최초 화면이나 폴더 열기로 전체 작업을 가져오지 않습니다.
- 폴더 요약은 해당 대행사의 보관 제외 전체 작업, 조건 일치는 상단 필터 기준입니다. 정산 금액은 v103 dashboard의 direct payer payment_steps 합계 및 no-step fallback과 같습니다. 정산상태 필터는 v108의 transfer/reversal pending 규칙과 같습니다.
- 초기 보기: `agencyFolders`. 기본 폴더 정렬: 진행중 수 → 정산대기 금액 → 최근 작업 → 아이디. 진행중은 입금대기·입금완료만 포함합니다.
- 여러 폴더를 펼치거나 닫아도 선택을 유지합니다. 상단 필터/폴더별 페이지를 바꿔도 선택을 유지하며, Realtime revision은 캐시와 선택을 초기화해 재배정된 대행사 및 변경된 금액을 남기지 않습니다.
- 폴더 재오픈은 마지막 페이지 cache를 재사용합니다. 상단 조건·Realtime·대행사 페이지 변경 시 새 조회가 필요합니다.
- 대시보드 기존 agencyId/settlementStatus preset을 그대로 받아 대행사 하나를 자동으로 펼칩니다. ‘모든 대행사 보기’로 범위를 해제합니다.
- 토글 전환 시 각 보기 내부 필터·선택 상태는 초기화됩니다. 화면 안에서 선택한 viewMode는 유지됩니다.

## 브라우저 회귀 검증

개발 서버의 `/tests/agency-folders-ui.html`은 합성 작업 62건만 사용하는 로컬 검증 화면입니다. 운영 연결이 없으며 프로덕션 빌드에는 포함되지 않습니다. 폴더 접기, Shift 선택, 페이지 이동, 대행사 간 선택, 검색, quick filter, 전체 작업 보기, Dashboard preset 및 Realtime 초기화 버튼을 검증할 수 있습니다.

운영 로그인 세션을 사용한 브라우저 검증과 별도로, 서버 권한은 운영 DB에서 읽기 전용 impersonation 조회로 확인합니다.

## 실제 운영 적용 기록

- 프로젝트: `aoiqdvxrimopmodojcza` (`spark-dashboard`).
- 작업 시작 main: `c3fdf57a13038020840c595ea207bbb5c3998f95`.
- 적용 전 schema: `v10.8.0`; 적용 후: `v10.9.0`.
- 운영 migration history: `20260915011542_v10_9_manager_agency_folders`. MCP 적용 시점의 history timestamp로 기록되므로 저장소 파일 timestamp와 다릅니다. 재실행하지 마세요.
- 승인·활성 관리자 3명, 현재 소속 대행사 44개: 소속 범위/진행중/대시보드 정산금액/검색/페이지 및 export parity/다른 관리자 접근 차단 PASS.
- 기존 함수 해시 `df83503bc3ebdf9b71cbf34733f9b295`, RLS 해시 `f14769a171748ccc288cb4914df8a5b8`: 전후 동일.
- 두 신규 함수 모두 `STABLE`, `SECURITY DEFINER`, 빈 `search_path`, anon 실행 불가. authenticated 실행 권한은 함수 내부의 승인·활성·현재 manager 소속 검사와 함께 의도된 API 경로입니다.
- 보안 advisor의 [authenticated SECURITY DEFINER 알림](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)은 이 의도된 두 API를 표시합니다. 기존 advisor 항목은 변경하지 않았습니다.
- typecheck/build, folders DB/client/Excel, selection, member-edit, correction, assignment 회귀 검증 PASS. Vite의 큰 번들 경고는 빌드 실패가 아닙니다.
- 브라우저 합성 fixture에서 기본 보기, 폴더 50행, 행/Shift 선택, 접기 후 선택 유지, 여러 폴더 선택 합산, quick filter, 검색 일치 건수, 전체 작업 보기, Dashboard preset, Realtime 초기화, 모바일 390px 표시를 확인했습니다.
