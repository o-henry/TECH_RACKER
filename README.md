# Technology Tracker

공식 원출처를 기준으로 기술의 현재 상태, 최근 검증, 연결 관계, 병목과 다음 확인 지점을 추적하는 소유자 전용 사이트입니다.

- Live site: https://technology-tracker-live.hara-no-shinnosuke.chatgpt.site
- Sites slug: `technology-tracker-live`
- Access: owner only
- AI billing: no OpenAI API key and no separate API billing

## What it does

- 기술별 현재 상태와 최근 사건을 원출처 링크와 함께 표시합니다.
- OpenAlex, ClinicalTrials.gov, SEC EDGAR, 정부·규제기관, 기업 IR과 신뢰할 수 있는 보도 자료를 구분합니다.
- GPT가 기술·운영 의존성을 자동 매핑하고 관계 지도로 보여 줍니다.
- 병목, 미확인 값과 다음 확인 지점을 사실과 분리해 표시합니다.
- 각 기술 하단의 심층 분석을 펼치면 D1 대기열에 비동기 요청을 저장하고, 예약 분석이 원출처를 대조한 뒤 작동 구조, 근거 해석, 병목의 인과관계, 기술 의존성과 다음 조사 질문을 반환합니다.
- AI·소프트웨어와 반도체·첨단소재를 포함한 7개 상위 분야를 추적합니다.
- 검색 목록에 없는 기술은 즉시 조사 대기열에 등록할 수 있습니다.
- 인터페이스는 한국어만 제공합니다.

## Search-to-research workflow

검색 결과가 없는 기술은 검색창에서 `Enter`를 누르거나 조사 요청 버튼을 누르면 즉시 D1 조사 대기열에 저장됩니다. 저장과 조사의 의미는 다릅니다.

1. 사이트가 요청을 즉시 저장합니다.
2. ChatGPT 구독 기반 예약 작업이 다음 실행에서 대기 요청을 읽습니다.
3. 공식 1차 출처를 우선해 사실, 날짜, 상태 변화와 관련 기술을 검증합니다.
4. 근거가 충분한 경우에만 기존 사이트에 기술과 관계를 추가합니다.
5. 검증되지 않은 값은 `미확인`으로 남기며 자동으로 만들어내지 않습니다.

웹사이트가 ChatGPT 구독 모델을 API처럼 직접 호출하는 구조는 아닙니다. 따라서 검색 직후 조사가 완료되는 것이 아니라, 요청은 즉시 접수되고 예약된 GPT 작업이 처리합니다.

## On-demand deep analysis

심층 분석 본문은 `data.js`에 미리 작성하지 않습니다.

1. 기술 상세에서 심층 분석을 처음 펼치면 소유자 전용 D1 대기열에 요청이 생성됩니다.
2. 화면은 `pending`, `researching`, `completed`, `needs_review`, `failed` 상태만 표시하며 가짜 진행률을 만들지 않습니다.
3. 예약 분석은 기존 설명을 반복하지 않고 시스템 경계와 인과 사슬, 근거가 의미하는 범위와 한계, 결합된 병목, 다른 기술과의 의존성, 다음 조사 질문을 구조화합니다.
4. 최소 2개 원출처와 필수 분석 필드를 충족한 결과만 `completed`로 저장됩니다.
5. 완료 결과는 기술 상세가 열려 있는 동안 30초 간격으로 확인되어 자동 표시됩니다.

ChatGPT 예약 작업은 구독 플랜 안에서 실행되지만 Pro 모드 모델을 지원하지 않습니다. 따라서 자동 결과의 모델 표시는 실제 실행 모델 또는 `CHATGPT SCHEDULED ANALYSIS`로 저장하며 `GPT PRO`라고 허위 표기하지 않습니다. Pro 모드 심층 분석이 필요한 경우에는 같은 대기 요청을 이 Work 대화에서 수동으로 처리해 결과를 게시해야 합니다.

## Architecture

```text
Owner browser
  -> ChatGPT Sites UI (Vinext / TypeScript)
  -> authenticated research-request and deep-analysis APIs
  -> Cloudflare D1 research and analysis queues
  -> scheduled ChatGPT research and Sites update

Optional external ingestion service
  -> FastAPI + PostgreSQL + APScheduler
  -> OpenAlex / ClinicalTrials.gov / SEC EDGAR / RSS collectors
  -> Sites backend proxy
```

`automation-backend/`는 24시간 수집 서버를 직접 운영하려는 경우에만 사용하는 선택 구성입니다. Sites의 조사 대기열과 ChatGPT 예약 작업에는 별도 Docker 서버나 OpenAI API 키가 필요하지 않습니다.

## Security model

- Sites 접근 정책은 소유자 전용입니다.
- 조사 API는 Sign in with ChatGPT 사용자 확인을 요구합니다.
- 변경 요청은 동일 출처와 전용 헤더를 함께 검증합니다.
- 요청 길이, 시간당 요청 수와 전체 대기열 크기를 제한합니다.
- 서버 비밀값, 인증 토큰, 개인 이메일은 저장소에 커밋하지 않습니다.
- 외부 URL은 `http`와 `https`만 허용하고 외부 링크에 안전 속성을 적용합니다.

## Interface rules

- 제목, 기술명과 상단 탐색의 한글은 ONE Mobile Title을 사용합니다.
- 영문과 숫자는 DM Mono를 사용하고 영문 UI 레이블은 대문자로 표기합니다.
- 배경은 흰색, `border-radius: 0`, 직사각형 스크롤바를 유지합니다.
- 검색 결과의 우측 요약은 한 줄로 표시하고 넘치는 내용은 말줄임표로 처리합니다.

## Local development

Requirements:

- Node.js `>=22.13.0`
- npm
- Linux development environment for the bundled Sites helper scripts

```bash
npm ci
npm run dev
```

Validation:

```bash
npm run lint
npm test
```

The optional collector has its own instructions in [`automation-backend/README.md`](automation-backend/README.md).

## Project map

- `app/`: Sites pages, authenticated API routes and D1 research·deep-analysis logic
- `public/assets/app.js`: tracker interactions, search, filters, relations and detail views
- `public/assets/data.js`: verified editorial snapshot
- `automation-backend/`: optional FastAPI/PostgreSQL/APScheduler collectors
- `docs/`: ChatGPT subscription automation contract and the source-diff, watchlist, coverage and relationship-explanation product roadmap
- `drizzle/`: D1 schema migrations

## Data policy

Source facts and editorial judgments are separate layers. Event date and publication date must be distinguished where available. A market move, press article or search result alone does not prove a clinical, regulatory, production or operating-state change. This project is not medical or investment advice.

## License

The optional automation backend retains the license in `automation-backend/LICENSE`. No separate repository-wide license is declared.
