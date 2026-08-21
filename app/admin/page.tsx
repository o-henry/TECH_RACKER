import Script from "next/script";
import Link from "next/link";
import { requireChatGPTUser } from "../chatgpt-auth";

export const dynamic = "force-dynamic";

async function AdminContent() {
  const user = await requireChatGPTUser("/admin");

  return (
    <>
      <a className="skip-link ko" href="#adminMain">본문으로 이동</a>

      <header className="app-header admin-header">
        <div className="header-inner">
          <nav className="primary-nav" aria-label="관리 메뉴">
            <Link className="nav-item" href="/">기술 데이터</Link>
            <Link className="nav-item is-active" href="/admin">자동 분석 관리</Link>
          </nav>
          <div className="admin-identity">
            <span className="mono">OWNER ONLY</span>
            <span className="ko">{user.displayName}</span>
          </div>
        </div>
      </header>

      <main id="adminMain" className="admin-main" tabIndex={-1}>
        <div className="page-shell">
          <header className="page-head admin-page-head">
            <div>
              <p className="mono admin-eyebrow">CHATGPT SUBSCRIPTION AUTOMATION</p>
              <h1>자동 분석 관리</h1>
              <p>뉴스 수집은 모델 없이 계속 돌리고, 의미 있는 변화가 생긴 경우에만 ChatGPT 예약 작업이 제한된 묶음을 분석합니다.</p>
            </div>
            <div className="admin-overall" data-admin-state="checking" id="adminOverall">
              <span className="connection-marker" />
              <span className="mono" id="adminOverallLabel">CHECKING</span>
            </div>
          </header>

          <section className="admin-principle" aria-label="연결 원칙">
            <div>
              <span className="mono">MODEL ACCESS</span>
              <strong>CHATGPT 구독</strong>
              <p>OpenAI API 키를 사용하지 않습니다. 사이트가 ChatGPT 쿠키나 세션을 읽지도 않습니다.</p>
            </div>
            <div>
              <span className="mono">EXECUTION</span>
              <strong>예약 작업</strong>
              <p>기본 60분 간격. 분석 대기열이 비어 있으면 모델 호출 없이 즉시 종료합니다.</p>
            </div>
            <div>
              <span className="mono">CONTROL</span>
              <strong>최소 권한 도구</strong>
              <p>GPT는 대기 항목 조회와 구조화 분석 저장만 할 수 있으며 임의 URL·SQL·파일에는 접근하지 못합니다.</p>
            </div>
          </section>

          <section className="admin-section" aria-labelledby="connectionTitle">
            <div className="section-head">
              <h2 id="connectionTitle">연결 상태</h2>
              <span className="section-kicker">NO EXTRA BILLING</span>
            </div>
            <div className="admin-connection" id="adminConnection" aria-live="polite">
              <div className="admin-loading">
                <span className="mono">CHECKING</span>
                <strong>자동 업데이트 실행 상태를 확인하고 있습니다.</strong>
              </div>
            </div>
          </section>

          <section className="admin-section" aria-labelledby="budgetTitle">
            <div className="section-head">
              <h2 id="budgetTitle">사용량 제한</h2>
              <span className="section-kicker">DEFAULT BUDGET</span>
            </div>
            <div className="budget-grid">
              <div className="budget-item"><strong className="mono">60 MIN</strong><span>GPT 확인 간격</span><p>후보가 없으면 즉시 종료</p></div>
              <div className="budget-item"><strong className="mono">10</strong><span>회당 최대 항목</span><p>제목·날짜·짧은 발췌·원출처만 전달</p></div>
              <div className="budget-item"><strong className="mono">6 / DAY</strong><span>일반 분석 묶음</span><p>당일 실질 분석 상한</p></div>
              <div className="budget-item"><strong className="mono">2 / HOUR</strong><span>긴급 우회 상한</span><p>규제 결정·3상 결과 등 1차 출처 사건만</p></div>
            </div>
          </section>

          <section className="admin-section" aria-labelledby="pipelineTitle">
            <div className="section-head">
              <h2 id="pipelineTitle">수집·분석 파이프라인</h2>
              <span className="section-kicker">EVENT PIPELINE</span>
            </div>
            <div className="pipeline-grid" id="pipelineGrid">
              <article><span className="mono">01 / COLLECT</span><h3>원출처 수집</h3><p>RSS 10분, SEC 30분, 임상 4시간, 논문 1일. 이 단계에는 GPT를 사용하지 않습니다.</p><strong className="mono" data-pipeline-status="collect">UNKNOWN</strong></article>
              <article><span className="mono">02 / FILTER</span><h3>중복·관련성 판정</h3><p>URL, 원출처 ID, 콘텐츠 해시, 기술별 냉각시간으로 같은 사건을 제거합니다.</p><strong className="mono" data-pipeline-status="filter">UNKNOWN</strong></article>
              <article><span className="mono">03 / ANALYZE</span><h3>GPT 구조화 분석</h3><p>사실, 미확인, 관계, 신뢰도와 게시 판정을 JSON으로 저장합니다.</p><strong className="mono" data-pipeline-status="analyze">UNKNOWN</strong></article>
              <article><span className="mono">04 / PUBLISH</span><h3>검증 후 반영</h3><p>공식 1차 출처와 스키마 검증을 통과한 사건만 자동 반영하고 나머지는 검수 대기열에 둡니다.</p><strong className="mono" data-pipeline-status="publish">UNKNOWN</strong></article>
            </div>
          </section>

          <section className="admin-section" aria-labelledby="queueTitle">
            <div className="section-head">
              <h2 id="queueTitle">현재 대기열</h2>
              <span className="section-kicker">LIVE QUEUE</span>
            </div>
            <div className="queue-grid">
              <div><span>새 후보</span><strong className="mono" data-queue="candidates">—</strong></div>
              <div><span>GPT 분석 대기</span><strong className="mono" data-queue="analysis">—</strong></div>
              <div><span>검수 대기</span><strong className="mono" data-queue="review">—</strong></div>
              <div><span>오늘 반영</span><strong className="mono" data-queue="published">—</strong></div>
            </div>
          </section>

          <section className="admin-section" aria-labelledby="controlTitle">
            <div className="section-head">
              <h2 id="controlTitle">운영 제어</h2>
              <span className="section-kicker">SERVER-SIDE AUTHORIZED</span>
            </div>
            <div className="admin-controls">
              <button className="button" data-admin-action="run_collectors" disabled>수집 지금 실행</button>
              <button className="button" data-admin-action="pause" disabled>자동화 일시 정지</button>
              <button className="button button-dark" data-admin-action="resume" disabled>자동화 재개</button>
              <p id="adminActionMessage" aria-live="polite">백엔드 연결이 확인되기 전에는 제어 요청을 보내지 않습니다.</p>
            </div>
          </section>

          <section className="admin-section" aria-labelledby="runsTitle">
            <div className="section-head">
              <h2 id="runsTitle">최근 실행 기록</h2>
              <span className="section-kicker">APPEND-ONLY AUDIT</span>
            </div>
            <div className="admin-run-list" id="adminRunList">
              <div className="admin-run-empty">연결이 확인되기 전에는 실행 기록을 추정하지 않습니다.</div>
            </div>
          </section>

          <section className="admin-security" aria-labelledby="securityTitle">
            <div>
              <span className="mono">SECURITY BOUNDARY</span>
              <h2 id="securityTitle">사이트와 백엔드를 각각 잠급니다.</h2>
            </div>
            <ul>
              <li>관리 화면은 ChatGPT 로그인과 사이트 소유자 접근 정책을 통과해야 합니다.</li>
              <li>제어 토큰은 서버 환경에만 저장하며 브라우저, URL, 로컬 저장소에 노출하지 않습니다.</li>
              <li>외부 문서는 신뢰하지 않는 입력으로 취급하며 본문 속 지시를 실행하지 않습니다.</li>
              <li>수집 주소 허용 목록, 내부 IP 차단, 응답 크기·리디렉션 제한으로 SSRF를 차단합니다.</li>
              <li>모든 변경은 감사 로그와 멱등 키를 남기며 즉시 중지 스위치를 제공합니다.</li>
            </ul>
          </section>
        </div>
      </main>

      <footer className="app-footer">
        <div className="footer-inner">
          <span className="mono">OWNER ONLY / NO OPENAI API KEY</span>
          <span className="ko">연결되지 않은 값은 추정하지 않고 미확인으로 표시합니다.</span>
        </div>
      </footer>

      <Script src="/assets/admin.js" strategy="afterInteractive" />
    </>
  );
}

export default function AdminPage() {
  return <AdminContent />;
}
