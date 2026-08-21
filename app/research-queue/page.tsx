import Link from "next/link";
import Script from "next/script";
import { requireChatGPTUser } from "../chatgpt-auth";
import { deepAnalysisCounts, listDeepAnalysisRequests } from "../lib/deep-analysis";
import { listResearchRequests, researchRequestCounts } from "../lib/research-requests";

export const dynamic = "force-dynamic";

async function ResearchQueueContent() {
  const user = await requireChatGPTUser("/research-queue");
  const [items, counts, analysisItems, analysisCounts] = await Promise.all([
    listResearchRequests(),
    researchRequestCounts(),
    listDeepAnalysisRequests(),
    deepAnalysisCounts(),
  ]);

  return (
    <>
      <a className="skip-link ko" href="#researchQueueMain">본문으로 이동</a>
      <header className="app-header admin-header">
        <div className="header-inner">
          <nav className="primary-nav" aria-label="조사 대기열">
            <Link className="nav-item" href="/">기술 데이터</Link>
            <span className="nav-item is-active">조사 대기열</span>
          </nav>
          <div className="admin-identity">
            <span className="mono">OWNER ONLY</span>
            <span className="ko">{user.displayName}</span>
          </div>
        </div>
      </header>

      <main id="researchQueueMain" className="admin-main" tabIndex={-1}>
        <div className="page-shell">
          <header className="page-head research-queue-head">
            <div>
              <p className="mono admin-eyebrow">GPT RESEARCH INTAKE / VERIFIED SOURCES ONLY</p>
              <h1>기술 조사 대기열</h1>
              <p>검색에서 접수된 기술명입니다. 다음 ChatGPT 예약 작업이 공식 원출처를 조사하고, 사실·관계·병목·다음 확인 지점을 갖춘 경우에만 기존 사이트에 추가합니다.</p>
            </div>
            <div className="page-head-meta">
              <div className="head-stat"><strong className="mono">{counts.pending}</strong><span>조사 대기</span></div>
              <div className="head-stat"><strong className="mono">{counts.researching}</strong><span>조사 중</span></div>
              <div className="head-stat"><strong className="mono">{counts.needs_review}</strong><span>추가 검증</span></div>
            </div>
          </header>

          <section className="research-queue-list" aria-label="미처리 기술 조사 요청">
            <div className="research-queue-table-head" aria-hidden="true">
              <span>요청 기술</span><span>상태</span><span>접수 시각</span><span>예약 조사 처리</span>
            </div>
            {items.length ? items.map((item) => (
              <article className="research-queue-row" key={item.id} data-research-request={item.id}>
                <div><strong>{item.query}</strong><span className="mono">{item.id}</span></div>
                <span className="mono" data-request-status>{item.status}</span>
                <time className="mono">{item.requestedAt}</time>
                <div className="research-queue-actions">
                  <button className="button" data-request-action="researching">조사 시작</button>
                  <button className="button" data-request-action="needs_review">추가 검증</button>
                  <button className="button button-dark" data-request-action="added">목록 반영 완료</button>
                </div>
              </article>
            )) : (
              <div className="empty-state"><strong>현재 조사 요청이 없습니다.</strong><p>검색에 없는 기술을 조사 요청하면 여기에 표시됩니다.</p></div>
            )}
          </section>

          <section className="admin-section deep-analysis-queue-section" aria-labelledby="deepAnalysisQueueTitle">
            <div className="section-head">
              <div>
                <span className="section-kicker">ON-DEMAND / SOURCE-BOUNDED</span>
                <h2 id="deepAnalysisQueueTitle">심층 기술 분석 대기열</h2>
              </div>
              <div className="queue-inline-stats mono">
                <span>대기 {analysisCounts.pending}</span>
                <span>분석 중 {analysisCounts.researching}</span>
                <span>추가 검증 {analysisCounts.needs_review}</span>
              </div>
            </div>
            <p className="section-disclaimer">기술 상세에서 펼친 심층 분석 요청입니다. 기존 요약을 재배열하지 않고 원출처 대조, 작동 구조, 근거 해석, 병목의 인과관계, 다음 조사 질문과 기술별 조건 기반 전망을 새로 작성합니다.</p>
            <div className="research-queue-list" aria-label="미처리 심층 분석 요청">
              <div className="research-queue-table-head" aria-hidden="true">
                <span>분석 기술</span><span>상태</span><span>접수 시각</span><span>예약 분석 처리</span>
              </div>
              {analysisItems.length ? analysisItems.map((item) => (
                <article className="research-queue-row" key={item.id} data-deep-analysis-request={item.id}>
                  <div><strong>{item.technologyName}</strong><span className="mono">{item.technologyId}</span></div>
                  <span className="mono" data-deep-analysis-status>{item.status}</span>
                  <time className="mono">{item.requestedAt}</time>
                  <div className="research-queue-actions">
                    <button className="button" data-deep-analysis-action="researching">분석 시작</button>
                    <button className="button" data-deep-analysis-action="needs_review">추가 검증</button>
                    <details className="deep-analysis-publish">
                      <summary>검증 결과 입력</summary>
                      <label><span>근거 확인 기준일</span><input type="date" data-deep-analysis-verified /></label>
                      <label><span>실행 모델 표기</span><input type="text" data-deep-analysis-model defaultValue="CHATGPT SCHEDULED ANALYSIS" maxLength={120} /></label>
                      <label><span>심층 분석 JSON</span><textarea data-deep-analysis-result rows={18} spellCheck={false} /></label>
                      <button className="button button-dark" data-deep-analysis-publish>검증 후 완료 저장</button>
                    </details>
                  </div>
                </article>
              )) : (
                <div className="empty-state"><strong>현재 심층 분석 요청이 없습니다.</strong><p>기술 상세에서 심층 분석을 펼치면 요청이 접수됩니다.</p></div>
              )}
            </div>
          </section>

          <section className="research-queue-policy">
            <span className="mono">AUTOMATION CONTRACT</span>
            <p>회당 신규 검색 요청은 최대 3개, 심층 분석은 최대 2개만 처리합니다. 원출처가 부족하면 추가하거나 완료하지 않고 <span className="mono">NEEDS_REVIEW</span>로 남깁니다. 주가 움직임·요약 기사·검색 결과만으로 기술 상태나 분석 결론을 만들지 않습니다.</p>
          </section>
        </div>
      </main>
      <Script src="/assets/research-queue.js" strategy="afterInteractive" />
    </>
  );
}

export default function ResearchQueuePage() {
  return <ResearchQueueContent />;
}
