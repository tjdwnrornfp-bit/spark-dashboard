# SPARK 작업 접수 대시보드 v5

Figma 없이 React + TypeScript로 구현한 작업 접수·회원 승인·정산 관리 대시보드입니다.

## v5 변경 사항

- 접수 완료창에서 접수번호 제거
- 접수 완료창에서 오전 9시 자동 구동 안내 제거
- 작업접수 목록을 오래된 순서로 표시해 신규 접수가 맨 아래에 추가
- CSV 대신 실제 `.xlsx` 파일 다운로드
- 엑셀 열 너비 지정
- 대행사·총판 접수 현황에서 `예상 진행률`, `예상 완료시간` 문구 제거
- 진행률을 5초마다 갱신하고 소수점 2자리로 표시
- 100타와 300타 이상의 진행 속도 차이 확대
- Supabase Publishable key 환경 변수 지원
- 종료일 경과 자동 만료 Cron을 5분 간격으로 보강
- Supabase 설치 점검 SQL 추가

## 실행

```bash
npm install
npm run dev
```

Node.js 20.19 이상 또는 22.12 이상을 사용하세요.

## 실행 모드

### 데모 모드

Supabase 환경 변수가 없으면 브라우저 `localStorage`를 사용합니다.

### 서버 동기화 모드

프로젝트 루트에 `.env.local`을 생성합니다.

```env
VITE_SUPABASE_URL=https://프로젝트참조.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_실제키
```

서버 모드에서는 Supabase Auth, Postgres, Realtime, Cron을 사용합니다.

## 엑셀 다운로드

관리자 작업접수 화면에서 행을 선택한 뒤 **엑셀** 버튼을 누르면 `.xlsx` 파일이 생성됩니다.

포함 열:

```text
등록자
상호명
대표키워드
플레이스URL
MID값
일일수량
구동일수
시작일
종료일
```

상호명·키워드·URL 열은 넓게 설정되어 Excel에서 데이터가 잘리지 않게 표시됩니다.

## 서버 배포

조직 생성 이후 Supabase 프로젝트 생성부터 관리자 등록, Cron, GitHub, Vercel 배포까지 다음 문서에 순서대로 정리했습니다.

- `DEPLOYMENT.md`
- `supabase/schema.sql`
- `supabase/bootstrap_admin.sql`
- `supabase/cron.sql`
- `supabase/verify_setup.sql`

## 주요 업무 규칙

- 회원가입: 아이디·비밀번호·비밀번호 확인
- 아이디 및 비밀번호: 문자 종류와 관계없이 4자 이상
- 가입 후 관리자 승인 필요
- 승인 시 대행사·총판과 회원별 1타 단가 지정
- 주문 금액: `일일수량 × 구동일수 × 1타 단가 + VAT`
- 주문 상태 변경: 관리자만 가능
- 입금완료 작업: 시작일 오전 9시 이후 자동 구동중
- 종료일 경과: 입금완료·구동중·정지 작업 자동 만료
- 정지 기간은 보존하지 않으며 종료일 연장 없음
- 대행사·총판은 본인 주문만 조회

## 진행률

진행률은 화면 시연용 시뮬레이션입니다.

- 오전 9시부터 증가
- 주문번호와 날짜 기준의 안정적인 난수
- 새로고침해도 같은 시점에는 동일한 값
- 5초마다 화면 갱신
- 소수점 1자리 표시
- 일일 수량이 많을수록 진행 속도가 느림
- 같은 타수도 주문별 속도가 다름
- 23:45까지 100% 도달

실제 작업 서버 데이터가 연결되면 `src/lib/progress.ts`를 실제 완료 수량 API로 교체해야 합니다.

## 보안

- 비밀번호 평문 DB 저장 없음
- Supabase Auth 사용
- 브라우저에는 Publishable key만 사용
- RLS로 사용자별 데이터 접근 제한
- 관리자 작업은 DB 함수에서 관리자 권한 재검사
- Secret key와 service_role key는 프런트엔드에 사용하지 않음
