# v10.15 진행률 API 운영 검증

2026-10-08. 저장소 `tjdwnrornfp-bit/spark-dashboard`, 기존 운영 Supabase 프로젝트 `aoiqdvxrimopmodojcza`에 적용.

- `20261008020740_v10_15_member_progress_api.sql` 적용. `order-progress` Edge Function v1 활성화. 별도 키 인증을 수행하므로 이 신규 함수에만 Supabase JWT 검사를 사용하지 않음.
- 승인된 활성 `copy` 계정에 본인 작업 진행률 조회 권한만 발급. 키 원문은 저장소 밖 접근 제한 파일에 저장하고 DB에는 SHA-256만 저장. 기존 주문·정산 처리와 기존 Edge Function에는 변경 없음.
- 운영 HTTPS 확인: 본인 구동중 작업 2건 200, 응답 기준 시각의 기존 UI 계산식과 정확히 일치. 다른 회원 번호/존재하지 않는 번호 모두 `not_found`. 잘못된 키 401, GET 405, 회원 지정 필드 추가 400, 브라우저 Origin 403.
- 운영 전후 `profiles`, `orders`, `payment_steps`, `settlement_batch_items` 전체 행 지문 일치. 기존 public/private 함수 정의와 RLS 정책 지문 일치. 신규 기록은 API 키·사용량·키 발급 감사 로그뿐.
- 로컬 전체 회귀 검사 및 배포 빌드 통과. 이전 버전 진행률과 12,000개 조건 비교 통과. HTTP 처리기→DB 역할→응답 통합 검사, 키 재발급·폐기·만료·계정 중지, 호출 한도, 감사 실패 원복 검사 통과.
- GitHub `progress-api` CI의 Deno 검사와 PostgreSQL 17 동시성 검사 통과: 40개 동시 호출 중 30개 허용, 10개 제한. 잠금 대기 중 키 폐기 시 대기 요청 4개 모두 거부.
- Supabase 보안 WARN 수는 기존과 동일. 신규 비공개 테이블 2개의 [RLS 정책 없음 INFO](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)는 직접 접근을 차단하는 의도된 구성. 테이블 권한도 회수했고 보호된 함수만 사용함.

외부 연동 계약과 키 폐기·교체 절차는 [PROGRESS_API.md](../PROGRESS_API.md)에 기록. 요청 원문, 키, 회원 개인정보, 금액을 이 문서와 CI 로그에 기록하지 않음.
