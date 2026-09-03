# v10.6.0 적용 및 사용 가이드

## 적용 상태

운영 프로젝트 `aoiqdvxrimopmodojcza`에 신규 v10.6 마이그레이션을 적용했습니다. 기존 migration은 재실행하지 않았습니다.

- 저장소 파일: `supabase/migrations/20260903094128_v10_6_admin_order_assignment.sql`
- 운영 migration 이름: `v10_6_admin_order_assignment`
- 운영 migration 이력 버전: `20260903095441`
- 앱 스키마 버전: `v10.6.0`

MCP 적용 시 이력 타임스탬프가 생성 시각과 다릅니다. 이 파일을 운영에서 다시 실행하거나 전체 과거 migrations를 일괄 push하지 마세요. 다른 v10.5 환경에 적용할 경우 `supabase/preflight_v10_6.sql` → 위 신규 migration만 → `supabase/verify_v10_6.sql` 순서로 진행합니다. 프런트 v10.6 배포 전 DB 적용이 필요합니다.

## 개별 작업 부여

1. 관리자로 로그인하고 원하는 프로그램 접수 탭에서 **작업 부여**를 누릅니다.
2. 그룹 필터 및 회원 아이디 검색으로 대상 회원을 선택합니다. 현재 그룹, 회원 유형, 관리담당, 정산 상위 계정을 확인합니다.
3. 프로그램, 상호명, 대표 키워드, 플레이스 URL, 일일수량, 구동일수, 시작일, 메모를 입력합니다. 시작일은 한국 시간 기준 익일부터입니다.
4. 대상 회원의 적용단가·공급가·부가세·총액을 확인하고 실행합니다. 서버에서 현재 승인 단가와 계정 상태를 다시 검증하므로 화면 이후 변경된 단가가 있다면 서버의 최신 값이 적용됩니다.

일반 회원·중간관리자에게 부여 버튼은 표시되지 않습니다. 대상은 승인된 활성 대행사/총판이며, 중간관리자 계정 자체와 관리자는 제외됩니다. 관리자 부여는 Supabase가 연결된 환경에서 실행합니다.

## 엑셀 일괄 부여

**엑셀 일괄 부여 → 관리자 양식 다운로드 → 작성 → 엑셀 선택 → 미리보기 확인 → 정상 건 부여** 순서입니다.

| 열 | 제목 |
|---|---|
| A | 등록자아이디 |
| B | 프로그램 |
| C | 상호명 |
| D | 대표키워드 |
| E | 플레이스URL |
| F | 일일수량 |
| G | 구동일수 |
| H | 시작일 |
| I | 메모 |

첫 시트를 사용하고 열 제목과 순서를 유지합니다. 프로그램은 `스파크`, `스파크+`, `스파크S`, `스파크S+`입니다. 기존 Excel 라벨과 동일하게 소문자 `s`도 허용합니다. 시작일은 `YYYY-MM-DD` 문자열 또는 Excel 날짜 셀을 사용할 수 있습니다. 메모는 300자, 상호명/키워드는 각 50자 이내입니다.

한 파일에 비어 있지 않은 작업을 최대 500건 입력합니다. 미리보기는 전체/정상/오류 수와 원본 행 번호별 오류를 표시합니다. 정상 행만 실행하며 서버 오류가 발생한 행의 주문·정산·알림·감사 기록은 모두 롤백됩니다. 성공 행은 유지됩니다. 원본 데이터에 오류가 있는 행은 수정한 파일로 다시 업로드합니다.

실행은 50건씩 전송합니다. 연결 오류가 나면 모달의 미완료 건 부여를 사용해 같은 요청을 재확인할 수 있습니다. 같은 요청/행의 완료 주문은 중복 생성되지 않습니다. 새 모달에서 새 파일로 실행하면 별개의 요청이므로 이미 성공한 행은 파일에서 제외해야 합니다.

## 서버 RPC와 정산

- `public.admin_create_order_for_member_v106(p_target_user_id uuid, p_item jsonb, p_request_id uuid)`
- `public.admin_bulk_create_orders_for_members_v106(p_items jsonb, p_request_id uuid)`
- 공통 생성 함수: `spark_private.create_order_for_profile_v106`
- 내부 관리자 검증/일괄 처리: `spark_private.admin_assign_orders_v106`
- 중복 방지 기록: `spark_private.admin_order_assignments_v106`

새 공개 RPC는 `SECURITY DEFINER`, 빈 `search_path`, anonymous 실행 금지를 적용합니다. 내부 함수는 호출자의 실제 `auth.uid()`에 연결된 프로필에서 승인·활성 관리자 여부를 검사합니다. 내부 schema/table/functions는 일반 API 사용자가 직접 접근할 수 없습니다.

`orders.created_by`는 대상 회원 ID입니다. `creator_username`, `creator_group_name`, sponsor snapshot은 생성 시점 대상 프로필 값입니다. 단가는 `spark`, `spark_plus`, `spark_s`, `spark_s_plus` 각각의 대상 회원 현재 승인 단가를 사용하며 0원 이하를 차단합니다. payment_steps는 기존 일반 접수의 sponsor 체인을 사용합니다. 중간관리자 연결은 변경하지 않으며 sponsor가 없는 관리 회원은 기존대로 관리자 직결입니다.

감사 `order.admin_assigned`에는 주문 ID/번호, 대상 회원 ID/아이디/당시 그룹, 프로그램, 단가, 실제 관리자 ID/아이디, `manual`/`excel`, 생성시각, 요청 ID, 원본 행 번호가 저장됩니다. 감사 저장이 실패하면 해당 행 전체가 실패합니다.

## 정렬과 그룹 표시

- 네 프로그램의 관리자 및 일반 회원 본인 목록, 운영/보관함: `createdAt` 내림차순, 동일시각은 주문번호 내림차순.
- 선택/통합 Excel 파일: 기존 오름차순을 유지합니다.
- 관리자 목록·검색, 최근 접수/등록 그룹, 선택/통합 Excel, 정산 표시/그룹 필터/검색/일괄 선택, 업체 현황: 현재 프로필 그룹.
- `Order.creatorGroupName`과 DB `orders.creator_group_name`: 변경하지 않은 과거 스냅샷. 프런트는 별도 `currentCreatorGroupName` 및 `currentGroupNameForOrder`를 사용합니다.
- 정산 v101은 기존 v94를 재사용하므로 현재 그룹 표시가 이어집니다. 확정 정산 이력의 역사 스냅샷은 유지합니다. manager 화면은 기존 현재 회원 기반 조회를 유지합니다.

## 확인 결과와 운영 범위

운영에서 신규 RPC 존재/권한, 관리자 외 호출과 부적절 대상 차단 9개, 정산·업체 현황 현재 그룹 불일치 0건을 확인했습니다. 성공 주문 테스트는 로컬 PostgreSQL에서만 실행했습니다. 운영 주문/정산/회원/감사 건수와 관계 및 그룹 스냅샷 해시는 적용 전후 동일합니다.

상태 변경, 단일/일괄 프로그램 변경, archive/restore, 정산 확정/취소, 관리자 배정, manager 조회, cron의 기존 함수 정의 해시는 그대로입니다. 비밀번호 재설정/회원 삭제 Edge Functions는 변경하지 않았습니다.

진단 도구의 새 SECURITY DEFINER 경고 2건은 관리자 검증을 포함한 의도된 RPC 진입점입니다. 내부 중복 방지 테이블의 RLS 정책 없음 안내는 직접 접근을 금지한 설계입니다. [SECURITY DEFINER 진단 설명](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [RLS 기본 차단 설명](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

현재 주문 화면은 기존 전체 snapshot 방식입니다. 이번 변경은 1,000건 단위 페이지 읽기로 누락을 방지하며, 이후 규모 확대 시 화면/검색/Excel을 서버 cursor pagination으로 분리하는 것이 다음 확장 지점입니다. 기존 manager/정산 서버 pagination은 유지합니다. 기존 Vite 번들 크기 경고는 배포 실패를 의미하지 않습니다.

검증 명령: `npm run typecheck`, `npm run build`, `npm run test:assignment`. 테스트는 로컬 메모리 DB와 코드 내 생성 Excel만 사용합니다.
