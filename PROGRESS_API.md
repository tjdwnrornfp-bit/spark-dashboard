# SPARK 금일 진행률 API

연동 계정: `copy`. 해당 계정 명의로 등록된 작업만 조회할 수 있습니다. 하위 회원·다른 회원의 작업, 정산·입금 정보는 제공하지 않습니다.

## 요청

`POST https://aoiqdvxrimopmodojcza.supabase.co/functions/v1/order-progress`

발급받은 전용 키를 연동 서버의 비밀 환경변수 `SPARK_PROGRESS_API_KEY`에 저장하세요. 브라우저 코드·모바일 앱·공개 저장소·URL에 키를 넣지 마세요. 서버에서 조회한 결과를 자체 UI에 전달하면 됩니다.

```js
const response = await fetch(
  'https://aoiqdvxrimopmodojcza.supabase.co/functions/v1/order-progress',
  {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.SPARK_PROGRESS_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ order_numbers: ['SPK-작업번호'] }),
  },
)
if (!response.ok) {
  // 429·503일 때는 Retry-After(초)를 기다린 뒤 재시도합니다.
  throw new Error(`SPARK API ${response.status}`)
}
const result = await response.json()
```

`order_numbers`에는 SPARK에서 확인한 실제 작업번호를 입력합니다. 한 번에 중복 없이 1~100개, 영문·숫자·하이픈·밑줄만 허용하며 각 번호는 80자 이내입니다. 다른 필드나 URL 쿼리 매개변수는 허용하지 않습니다. 본문 한도는 16 KiB입니다.

## 응답 예시

```json
{
  "date": "2026-10-08",
  "as_of": "2026-10-08T04:00:00.000Z",
  "time_zone": "Asia/Seoul",
  "items": [
    { "order_number": "SPK-001", "status": "구동중", "progress_percent": 54.12 },
    { "order_number": "SPK-002", "status": "정지", "progress_percent": null },
    { "order_number": "SPK-003", "error": "not_found" }
  ]
}
```

- `date`: 한국 시간 기준 날짜. `as_of`: 응답 계산 기준 시각.
- `progress_percent`: SPARK의 금일 진행률과 같은 계산 기준의 0~100 수치. `%`를 붙여 표시하면 됩니다.
- 구동중인 SPARK·SPARK+ 작업에 진행률을 제공합니다. 그 외 상태, 보관된 작업, SPARK S·SPARK S+는 `null`이며 자체 UI에서는 `—` 등으로 표시할 수 있습니다.
- `status`: `입금대기`, `입금완료`, `구동중`, `정지`, `만료`, `보관`.
- 없는 번호와 조회 권한이 없는 번호는 모두 `not_found`입니다. 응답 순서는 요청 순서와 같습니다.
- 주문 목록 검색·다운로드, 등록·수정·삭제·정산 기능은 없습니다.

## 호출 간격과 오류

30~60초 간격으로 필요한 작업을 묶어서 조회하는 방식을 권장합니다. 계정별 분당 30회, 한국 날짜 기준 하루 10,000회까지이며 키를 교체해도 사용량은 유지됩니다. `X-RateLimit-Remaining`은 현재 분의 남은 횟수입니다.

| HTTP | error | 처리 |
| --- | --- | --- |
| 400 | invalid_request | 번호·본문 형식을 확인 |
| 401 | unauthorized | 키·만료·계정 상태 확인 |
| 403 | server_to_server_only | 브라우저 대신 연동 서버에서 호출 |
| 405 | method_not_allowed | POST 사용 |
| 413 | payload_too_large | 본문 크기 축소 |
| 415 | json_required | Content-Type 확인 |
| 429 | rate_limited | Retry-After 초 이후 재시도 |
| 503 | temporarily_unavailable | Retry-After 초 이후 재시도 |

키 유출이 의심되거나 연동을 중단할 때 SPARK 관리자에게 키 폐기를 요청하세요. 새 키를 발급하면 기존 키는 중지됩니다. 키 만료일은 별도로 제공하는 접근 정보에 기록되어 있습니다.

## 운영자 유지보수

운영 배포 순서: v10.15 마이그레이션 적용 → `order-progress` Edge Function 배포 → 승인된 관리자 권한으로 키 발급 → 본인/타인 작업 조회 검증. 기존 함수와 정산 정책은 변경하지 않습니다.

키는 `spk_progress_` 뒤에 암호학적 난수 32바이트의 소문자 hex 64자를 붙입니다. 전체 문자열의 SHA-256 hex만 DB에 전달합니다. 원문은 안전한 별도 경로로 전달하며 감사 기록·배포 코드·문서에 저장하지 않습니다.

- `issue_progress_api_key_v1015(p_key_id, p_member_id, p_token_hash, p_label, p_expires_at)`: 승인된 활성 관리자만 호출할 수 있습니다. UUID인 `p_key_id`는 발급 요청마다 새로 생성하며 응답 유실 시 같은 인자로 재시도합니다. 새 발급은 해당 회원의 기존 키를 중지합니다. 만료일은 1시간 이후~366일 이내입니다.
- `revoke_progress_api_key_v1015(p_key_id, p_reason)`: 승인된 활성 관리자만 호출할 수 있습니다. 폐기는 즉시 적용되며 사유는 2~500자입니다. 이미 완료된 요청은 `false`를 반환합니다.
- 키 발급·폐기는 회원 감사 로그에 남습니다. 비활성·승인 취소·운영관리자 전환 계정의 키는 사용할 수 없습니다.
- 외부 API에는 Supabase 프로젝트 키가 필요하지 않습니다. 프로젝트의 관리자 키를 파트너에게 제공해서는 안 됩니다.
- 원문 키를 분실한 경우 복구 대신 새로 발급합니다. 운영 중단은 키 폐기로 처리할 수 있으며 마이그레이션을 되돌릴 필요가 없습니다.

검증: `npm run test:progress-api`는 기존 계산식과 12,000개 조건 비교, 계정 격리, 입력·HTTP 오류, 키 수명, 호출 제한, 감사 실패 원복을 확인합니다. `Member progress API integration` CI는 실제 PostgreSQL 동시 호출과 Deno 타입 검사를 추가합니다.
