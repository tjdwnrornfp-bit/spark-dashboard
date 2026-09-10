# v10.8 적용 안내

기준 main: `3018ec1f85446280fae0e347c7f1928b1800438d`. 기준 운영 앱 스키마: `v10.7.0`.
프로젝트: `aoiqdvxrimopmodojcza` (spark-dashboard).

1. `supabase/preflight_v10_8.sql`로 현재 버전, 선행 함수, 기존 함수/RLS 지문 확인.
2. 신규 `supabase/migrations/20260909085400_v10_8_member_edit_selection_managed_filters.sql`만 한 번 적용. 과거 migration 재실행 금지. 로컬 파일 시각과 MCP 운영 migration 기록 시각은 다를 수 있습니다.
3. `supabase/verify_v10_8.sql` 실행. 기존 함수/RLS 지문이 preflight와 같은지 비교.
4. 검증 통과 후 main 배포. 기존 v102 및 관리자 RPC는 그대로 보존하므로 신규 DB 적용이 기존 클라이언트를 깨지 않습니다.

추가 RPC:

- `member_preview_own_order_edit_v108(uuid,integer,jsonb,text)`
- `member_apply_own_order_edit_v108(uuid,integer,jsonb,text)` — 프로그램 변경도 통합 처리
- `member_own_order_edit_eligibility_v108(uuid[])` — RLS로 숨겨지는 단계까지 서버에서 확인; 호출당 500개 제한
- `get_manager_managed_orders_v108(uuid,text,text[],text,text,date,date,integer,integer,text)`

비공개 가격 계산 함수: `spark_private.member_program_price_v108(public.profiles,text)`.
공개 RPC는 anon 실행 금지, authenticated에만 허용하고 내부에서 권한 확인. 빈 search_path 사용. apply는 주문/정산 단계/단가 프로필 잠금 후 preview를 재검증합니다. 동시 정산 처리와 충돌하면 저장하지 않고 새로고침을 안내합니다.

회원 사용: 본인 접수 목록 → 수정 또는 프로그램 변경 → 사유/변경값 → 변경 영향 확인 → 수정 적용. 입금확인 단계가 하나라도 있으면 관리자 요청 안내를 표시합니다. 관리자 고급 보정은 기존 메뉴를 사용합니다.

관리 작업: 업무 우선순위 기본, 같은 상태는 최신 접수순. `진행중(입금대기+입금완료)`는 구동중을 포함하지 않습니다. 페이지 이동은 선택을 초기화하며 전체 범위 내보내기는 필터 전체 엑셀을 사용합니다.

## 운영 반영 기록

2026-09-10 18:13 KST 적용 완료. 운영 migration version: `20260910091314`, name: `v10_8_member_edit_selection_managed_filters`. `app_schema_versions=v10.8.0` 확인. 이미 적용되었으므로 재실행하지 마세요.

운영 verify PASS: RPC 실행권한, 비로그인/중간관리자 수정 차단, composite 필터, 네 가지 서버 정렬. 운영 주문을 수정하는 성공 테스트는 하지 않았으며 로컬 PostgreSQL fixture에서 수행했습니다.

기존 함수 지문 `8d2197de029075637d00848918052d3a`, RLS 정책 지문 `f14769a171748ccc288cb4914df8a5b8`가 전후 동일합니다. 관리자 수정·정산 확인/취소·프로그램 변경·회원관리·기존 관리 작업 함수와 정책 보존.

신규 RPC는 authenticated에만 노출되는 의도된 SECURITY DEFINER 진입점입니다. Supabase의 일반 경고는 내부 권한 검증 및 실행 테스트로 점검했습니다. 신규 anon 실행 허용은 없습니다. 기존 보안 권고의 설정은 이번 범위에서 변경하지 않았습니다. [SECURITY DEFINER 권고](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)

최종 typecheck/build 및 기존 assignment/correction·신규 member-edit/selection 테스트 통과. 501건 필터 전체 export 요청의 조건 유지 확인. 독립 로컬 UI fixture에서 행 클릭·Shift·키보드 선택, 수정 버튼 이벤트 분리, 중간관리자 페이지 이동 시 선택 초기화, 복합 필터/select 동기화 확인.
