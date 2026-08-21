import Script from "next/script";

export default function Home() {
  return (
    <>
      <a className="skip-link ko" href="#main">본문으로 이동</a>

      <header className="app-header">
        <div className="header-inner">
          <nav className="primary-nav" aria-label="주요 메뉴">
            <button className="nav-item is-active" data-route="home">전체 기술</button>
            <button className="nav-item" data-route="updates">변경 기록</button>
            <button className="nav-item" data-route="network">관계 지도</button>
          </nav>

          <div className="header-actions">
            <button className="search-button" data-action="open-search" aria-label="전체 기술 검색 열기">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.4" /><path d="m15.6 15.6 4.2 4.2" /></svg>
              <span>검색</span>
            </button>
            <button className="mobile-nav-button" data-action="toggle-mobile-nav" aria-label="메뉴 열기" aria-expanded="false">
              <span /><span />
            </button>
          </div>
        </div>
      </header>

      <main id="main" tabIndex={-1} suppressHydrationWarning>
        <div className="boot-state" role="status" aria-live="polite">
          <span className="mono">EDITORIAL SNAPSHOT</span>
          <strong>검증된 기술 데이터를 불러오고 있습니다.</strong>
        </div>
      </main>

      <footer className="app-footer">
        <div className="footer-inner">
          <span className="mono" id="footerDataStatus">EDITORIAL SNAPSHOT / VERIFIED 2026-08-21</span>
          <span className="ko">수치·단계는 원출처와 편집 판정을 구분해 표시하며, 확인되지 않은 값은 미확인으로 남깁니다.</span>
        </div>
      </footer>

      <div className="search-layer" id="searchLayer" aria-hidden="true">
        <div className="search-dialog" role="dialog" aria-modal="true" aria-labelledby="searchDialogTitle">
          <div className="dialog-head">
            <span id="searchDialogTitle" className="ko">전체 기술 검색</span>
            <button data-action="close-search" aria-label="검색 닫기">닫기</button>
          </div>
          <label className="search-field">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.4" /><path d="m15.6 15.6 4.2 4.2" /></svg>
            <input id="globalSearch" type="search" autoComplete="off" spellCheck="false" placeholder="기술, 분야, 기관, 병목, 다음 사건" />
          </label>
          <div className="search-results" id="searchResults" />
        </div>
      </div>

      <Script src="/assets/data.js" strategy="afterInteractive" />
      <Script src="/assets/app.js" strategy="lazyOnload" />
    </>
  );
}
