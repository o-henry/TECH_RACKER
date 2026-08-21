(() => {
  'use strict';

  let technologies = Array.isArray(window.TECHNOLOGIES) ? window.TECHNOLOGIES : [];
  const editorialRelationships = Array.isArray(window.TECHNOLOGY_RELATIONSHIPS) ? window.TECHNOLOGY_RELATIONSHIPS : [];
  let relationships = [...editorialRelationships];
  const editorialSnapshot = [...technologies];
  let ingestionStatus = {};
  let ingestionRuns = [];
  let backendConnected = false;
  let backendState = 'checking';
  let apiBaseURL = '';
  let pendingResearchCount = null;
  const deepAnalysisCache = new Map();
  const deepAnalysisPollTimers = new Map();
  const main = document.querySelector('#main');
  const searchLayer = document.querySelector('#searchLayer');
  const globalSearch = document.querySelector('#globalSearch');
  const searchResults = document.querySelector('#searchResults');
  const compareDock = document.querySelector('#compareDock');
  const compareCount = document.querySelector('#compareCount');
  const headerCompareCount = document.querySelector('#headerCompareCount');
  const compareSelection = document.querySelector('#compareSelection');
  const messages = {
    homeTitle: '기술 데이터', tracked: '추적 기술', sources: '고유 원출처', fields: '상위 분야', queue: '조사 대기',
    groups: '기술군', autoEvidence: '자동 수집 근거', unknownAxes: '미확인 축', filters: '기술 필터',
    all: '전체', medical: '의료·생명과학', ai: 'AI·소프트웨어', energy: '에너지·기후', computing: '컴퓨팅·로봇', semiconductors: '반도체·첨단소재', manufacturing: '식품·제조', space: '우주·인프라', other: '기타',
    regulatory: '규제·운영', clinical: '임상', fieldManufacturing: '현장·제조', researchDesign: '연구·설계',
    papers: '논문', trials: '임상시험', sec: 'SEC 공시', searchCurrent: '현재 목록에서 검색', sort: '정렬',
    recentFirst: '최근 확인순', nameFirst: '이름순', statusFirst: '상태군순', sourcesFirst: '출처 많은순',
    technology: '기술', currentStatus: '현재 상태', recentCheck: '최근 확인', nextCheck: '다음 확인',
    noFilter: '필터 조건에 맞는 기술이 없습니다.', changeFilter: '필터를 변경하십시오.',
    unknown: '미확인', undecided: '미정', noRecent: '최근 사건 미확인', noNext: '다음 확인 지점 미확인',
    unlisted: '등록되지 않은 기술입니다. GPT가 공식 원출처를 조사하도록 요청할 수 있습니다.',
    requestReceived: '조사 요청이 접수되었습니다. 다음 시간당 GPT 조사에서 원출처를 확인합니다.',
    alreadyAdded: '이미 검증되어 기술 목록에 반영된 요청입니다.', researchRequest: '조사 요청', noResults: '검색 결과가 없습니다.',
    requestRule: '즉시 사실로 추가하지 않습니다. 공식 기관·임상·논문·기업 공시를 교차 확인하고, 근거가 충분할 때만 기존 목록과 관계 지도에 반영합니다.',
    requestPending: '조사 대기 중', listAdded: '목록 반영됨', requestGPT: 'GPT 조사 요청', minQuery: '기술명을 2자 이상 입력', saving: '요청 저장 중',
    updatesTitle: '변경 기록', mapTitle: '자동 관계 지도', report: '기술 보고서', evidence: '자동 수집 근거',
    relationships: '자동 관계', facts: '확인된 수치와 조건', matrix: '분야별 상태', eventLedger: '변경 기록', sourcesTitle: '원출처',
    backAll: '전체 기술로 돌아가기', notFound: '기술을 찾을 수 없음', noTech: '요청한 기술 데이터가 없습니다.'
  };

  function t(key) {
    return messages[key] || key;
  }

  function techName(tech) {
    return tech.name;
  }

  const GROUP_LABEL_KEYS = {
    '전체': 'all', '의료·생명과학': 'medical', '에너지·기후': 'energy',
    'AI·소프트웨어': 'ai', '컴퓨팅·로봇': 'computing', '반도체·첨단소재': 'semiconductors',
    '식품·제조': 'manufacturing', '우주·인프라': 'space', '기타': 'other'
  };
  const STATUS_LABEL_KEYS = {
    '전체': 'all', '규제·운영': 'regulatory', '임상': 'clinical',
    '현장·제조': 'fieldManufacturing', '연구·설계': 'researchDesign'
  };
  const EVIDENCE_LABEL_KEYS = { '전체': 'all', '논문': 'papers', '임상시험': 'trials', 'SEC 공시': 'sec' };

  function groupLabel(value) { return t(GROUP_LABEL_KEYS[value] || 'other'); }
  function statusLabel(value) { return t(STATUS_LABEL_KEYS[value] || value); }
  function evidenceLabel(value) { return t(EVIDENCE_LABEL_KEYS[value] || value); }
  function updatedLabel(value) { return value === '전체' ? t('all') : value; }

  const GROUPS = ['전체', '의료·생명과학', 'AI·소프트웨어', '에너지·기후', '컴퓨팅·로봇', '반도체·첨단소재', '식품·제조', '우주·인프라'];
  const STATUS_FILTERS = ['전체', '규제·운영', '임상', '현장·제조', '연구·설계'];
  const EVIDENCE_FILTERS = ['전체', '논문', '임상시험', 'SEC 공시'];
  const UPDATED_FILTERS = ['전체', '7일', '30일', '90일'];
  const UPDATE_FILTERS = ['전체', '진전·운영', '후퇴·정체', '검증·기준', '목표·조달'];

  const state = {
    query: '',
    group: '전체',
    status: '전체',
    evidence: '전체',
    updated: '전체',
    sort: 'verified-desc',
    compare: [],
    compareMode: false,
    networkFocus: 'personalized-cancer-vaccine',
    updateFilter: '전체',
    searchIndex: 0,
    searchMatches: [],
    researchRequest: { query: '', status: 'idle', message: '' }
  };

  function escapeHTML(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function safeURL(value) {
    try {
      const parsed = new URL(String(value || ''), window.location.href);
      return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '#';
    } catch {
      return '#';
    }
  }

  function normalize(value) {
    return String(value ?? '').toLocaleLowerCase('ko-KR').replace(/\s+/g, ' ').trim();
  }

  function parseLooseDate(value) {
    const matched = String(value || '').match(/(20\d{2})(?:[.\-/](\d{1,2}))?(?:[.\-/](\d{1,2}))?/);
    if (!matched) return 0;
    return Number(matched[1]) * 10000 + Number(matched[2] || 0) * 100 + Number(matched[3] || 0);
  }

  function parseDateValue(value) {
    const matched = String(value || '').match(/(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
    if (!matched) return null;
    const parsed = new Date(`${matched[1]}-${String(matched[2]).padStart(2, '0')}-${String(matched[3]).padStart(2, '0')}T00:00:00Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function withinUpdatedWindow(tech, filter) {
    if (filter === '전체') return true;
    const days = Number.parseInt(filter, 10);
    const date = parseDateValue(tech.latest?.date) || parseDateValue(tech.verifiedAt);
    if (!date || !Number.isFinite(days)) return false;
    const diff = Date.now() - date.getTime();
    return diff >= 0 && diff <= days * 86400000;
  }

  function evidenceFamilyMatch(tech, filter) {
    if (filter === '전체') return true;
    const liveTypes = (tech.liveEvidence || []).map(item => item.sourceType);
    const sourceTypes = (tech.sources || []).map(item => `${item.type || ''} ${item.publisher || ''}`);
    if (filter === '논문') return liveTypes.includes('openalex') || sourceTypes.some(value => /논문|저널|학술/.test(value));
    if (filter === '임상시험') return liveTypes.includes('clinicaltrials') || sourceTypes.some(value => /임상|시험 등록/.test(value));
    if (filter === 'SEC 공시') return liveTypes.includes('sec') || sourceTypes.some(value => /SEC|회사 공시|기업 공시/.test(value));
    return true;
  }

  function groupOf(tech) {
    const category = tech.category || '';
    if (/^의료/.test(category)) return '의료·생명과학';
    if (/^AI/.test(category)) return 'AI·소프트웨어';
    if (/^(에너지|기후)/.test(category)) return '에너지·기후';
    if (/^(컴퓨팅|로봇|모빌리티)/.test(category)) return '컴퓨팅·로봇';
    if (/^반도체/.test(category)) return '반도체·첨단소재';
    if (/^(식품|제조)/.test(category)) return '식품·제조';
    if (/^우주/.test(category)) return '우주·인프라';
    return '기타';
  }

  function statusFamily(tech) {
    if (['regulated', 'operational', 'limited'].includes(tech.statusKey)) return '규제·운영';
    if (['phase3', 'phase1'].includes(tech.statusKey)) return '임상';
    if (['field', 'pilot'].includes(tech.statusKey)) return '현장·제조';
    return '연구·설계';
  }

  function updateFamily(kind) {
    const value = String(kind || '');
    if (/(후퇴|정체|중단|일정 변경)/.test(value)) return '후퇴·정체';
    if (/(검증|기준|데이터 구축|규제 변경)/.test(value)) return '검증·기준';
    if (/(예정|목표|조달|기업 계획)/.test(value)) return '목표·조달';
    return '진전·운영';
  }

  function findTech(id) {
    return technologies.find(item => item.id === id);
  }

  function syncAIRelationships() {
    const aiEdges = technologies.flatMap(tech => Array.isArray(tech.aiRelationships) ? tech.aiRelationships : []);
    const seen = new Set();
    relationships = [...editorialRelationships, ...aiEdges].filter(edge => {
      const pair = [edge.from, edge.to].sort().join('::');
      const key = `${pair}::${edge.kind || 'inferred'}::${edge.type || ''}`;
      if (!edge.from || !edge.to || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function loadCompare() {
    try {
      const value = JSON.parse(localStorage.getItem('technology-compare-v2') || '[]');
      if (!Array.isArray(value)) return [];
      return value.filter(id => technologies.some(item => item.id === id)).slice(0, 3);
    } catch {
      return [];
    }
  }

  function saveCompare() {
    try {
      localStorage.setItem('technology-compare-v2', JSON.stringify(state.compare));
    } catch {
      // Storage can be unavailable in embedded previews; comparison still works for the current session.
    }
  }

  function allSearchText(tech) {
    return normalize([
      tech.name,
      tech.nameEn,
      techName(tech),
      tech.category,
      groupOf(tech),
      tech.status,
      tech.trajectoryLabel,
      tech.summary,
      tech.currentState,
      tech.access,
      tech.latest?.title,
      tech.latest?.text,
      tech.next?.text,
      ...(tech.constraints || []),
      ...(tech.unknowns || []),
      ...(tech.dimensions || []).flatMap(item => [item.label, item.stateLabel, item.value, item.note]),
      ...(tech.sources || []).flatMap(item => [item.publisher, item.title, item.type]),
      ...(tech.liveEvidence || []).flatMap(item => [item.sourceLabel, item.publisher, item.title, ...(item.matchedTerms || [])])
    ].join(' '));
  }

  function uniqueSourceCount() {
    return new Set(technologies.flatMap(tech => [
      ...(tech.sources || []).map(source => source.url),
      ...(tech.liveEvidence || []).map(source => source.url)
    ])).size;
  }

  function knownGroupCount() {
    return new Set(technologies.map(groupOf).filter(group => group !== '기타')).size;
  }

  function syncStatusText() {
    if (backendState === 'checking') return '스냅샷 확인 중';
    if (backendState === 'unconfigured') return '오늘 검증 완료';
    if (backendState === 'error') return '오늘 검증 스냅샷';
    if (!backendConnected) return '편집 스냅샷';
    const runs = Object.values(ingestionStatus || {});
    if (!runs.length) return '수집 대기';
    const failed = runs.some(run => run.status === 'failed');
    const partial = runs.some(run => run.status === 'partial');
    return failed ? '일부 실패' : partial ? '일부 오류' : '자동 갱신 연결';
  }

  function datasetModeText() {
    if (backendState === 'live') return '외부 API 연결됨 · 자동 수집 근거와 편집 판정을 분리';
    if (backendState === 'error') return '외부 연결 없이 2026-08-21 원출처 검증 스냅샷을 표시 중';
    if (backendState === 'unconfigured') return 'GPT WORK가 2026-08-21 원출처를 조사해 저장한 검증 스냅샷';
    return '저장된 2026-08-21 검증 스냅샷을 불러오는 중';
  }

  function routeFromHash() {
    const raw = location.hash.replace(/^#\/?/, '');
    if (!raw) return { name: 'home' };
    const [name, id] = raw.split('/');
    if (name === 'tech' && id) return { name: 'detail', id };
    if (['home', 'updates', 'ingestion', 'network'].includes(name)) return { name };
    return { name: 'home' };
  }

  function navigate(route, id = '') {
    const hash = route === 'home' ? '#/' : route === 'detail' ? `#/tech/${id}` : `#/${route}`;
    if (location.hash === hash) renderRoute();
    else location.hash = hash;
  }

  function setActiveNav(route) {
    const active = route === 'detail' ? 'home' : route;
    document.querySelectorAll('[data-route]').forEach(button => {
      button.classList.toggle('is-active', button.dataset.route === active);
    });
  }

  function pageHead(title, description = '', stats = []) {
    return `
      <header class="page-head">
        <div>
          <h1>${escapeHTML(title)}</h1>
          ${description ? `<p>${escapeHTML(description)}</p>` : ''}
        </div>
        ${stats.length ? `<div class="page-head-meta">${stats.map(stat => `
          <div class="head-stat">
            <strong class="mono">${escapeHTML(stat.value)}</strong>
            <span>${escapeHTML(stat.label)}</span>
          </div>`).join('')}</div>` : ''}
      </header>`;
  }

  function renderRoute() {
    const route = routeFromHash();
    setActiveNav(route.name);
    closeMobileNav();

    if (route.name === 'detail') {
      const tech = findTech(route.id);
      if (tech) renderDetail(tech);
      else renderNotFound();
    } else if (route.name === 'updates') {
      renderUpdates();
    } else if (route.name === 'ingestion') {
      renderIngestion();
    } else if (route.name === 'network') {
      renderNetwork();
    } else {
      renderHome();
    }

    updateCompareUI();
    window.scrollTo({ top: 0, behavior: 'auto' });
    requestAnimationFrame(() => main.focus({ preventScroll: true }));
  }

  function renderHome() {
    const query = normalize(state.query);
    let list = technologies.filter(tech => {
      const groupMatch = state.group === '전체' || groupOf(tech) === state.group;
      const statusMatch = state.status === '전체' || statusFamily(tech) === state.status;
      const evidenceMatch = evidenceFamilyMatch(tech, state.evidence);
      const updatedMatch = withinUpdatedWindow(tech, state.updated);
      const queryMatch = !query || allSearchText(tech).includes(query);
      return groupMatch && statusMatch && evidenceMatch && updatedMatch && queryMatch;
    });

    list = [...list].sort((a, b) => {
      if (state.sort === 'name') return techName(a).localeCompare(techName(b), 'ko');
      if (state.sort === 'status') return statusFamily(a).localeCompare(statusFamily(b), 'ko') || techName(a).localeCompare(techName(b), 'ko');
      if (state.sort === 'source-desc') return (b.sources?.length || 0) - (a.sources?.length || 0) || techName(a).localeCompare(techName(b), 'ko');
      return parseLooseDate(b.latest?.date || b.verifiedAt) - parseLooseDate(a.latest?.date || a.verifiedAt) || techName(a).localeCompare(techName(b), 'ko');
    });

    main.innerHTML = `
      <div class="page-shell">
        ${pageHead(t('homeTitle'), '', [
          { value: technologies.length, label: t('tracked') },
          { value: uniqueSourceCount(), label: t('sources') },
          { value: knownGroupCount(), label: t('fields') },
          { value: pendingResearchCount === null ? '—' : pendingResearchCount, label: t('queue') }
        ])}

        <section class="dataset-strip" aria-label="${escapeHTML(t('homeTitle'))}" data-connection="${escapeHTML(backendState)}">
          <div class="dataset-note"><span class="mono">${escapeHTML(syncStatusText().toUpperCase())}</span><span>${escapeHTML(datasetModeText())}</span></div>
        </section>

        <section class="explorer-grid">
          <aside class="filter-rail" aria-label="${escapeHTML(t('filters'))}">
            <div class="rail-block">
              <h2 class="rail-title">FIELD</h2>
              <div class="rail-list">
                ${GROUPS.map(group => {
                  const count = group === '전체' ? technologies.length : technologies.filter(tech => groupOf(tech) === group).length;
                  return `<button class="rail-button ${state.group === group ? 'is-active' : ''}" data-group="${escapeHTML(group)}"><span>${escapeHTML(groupLabel(group))}</span><span class="mono">${count}</span></button>`;
                }).join('')}
              </div>
            </div>
            <div class="rail-block">
              <h2 class="rail-title">STATE</h2>
              <div class="rail-list">
                ${STATUS_FILTERS.map(status => {
                  const count = status === '전체' ? technologies.length : technologies.filter(tech => statusFamily(tech) === status).length;
                  return `<button class="rail-button ${state.status === status ? 'is-active' : ''}" data-status-filter="${escapeHTML(status)}"><span>${escapeHTML(statusLabel(status))}</span><span class="mono">${count}</span></button>`;
                }).join('')}
              </div>
            </div>
            <div class="rail-block">
              <h2 class="rail-title">EVIDENCE</h2>
              <div class="rail-list">
                ${EVIDENCE_FILTERS.map(filter => {
                  const count = technologies.filter(tech => evidenceFamilyMatch(tech, filter)).length;
                  return `<button class="rail-button ${state.evidence === filter ? 'is-active' : ''}" data-evidence-filter="${escapeHTML(filter)}"><span>${escapeHTML(evidenceLabel(filter))}</span><span class="mono">${count}</span></button>`;
                }).join('')}
              </div>
            </div>
            <div class="rail-block">
              <h2 class="rail-title">UPDATED</h2>
              <div class="rail-list">
                ${UPDATED_FILTERS.map(filter => {
                  const count = technologies.filter(tech => withinUpdatedWindow(tech, filter)).length;
                  return `<button class="rail-button ${state.updated === filter ? 'is-active' : ''}" data-updated-filter="${escapeHTML(filter)}"><span>${escapeHTML(updatedLabel(filter))}</span><span class="mono">${count}</span></button>`;
                }).join('')}
              </div>
            </div>
          </aside>

          <div class="index-main">
            <div class="index-toolbar">
              <label class="inline-search">
                <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.4"></circle><path d="m15.6 15.6 4.2 4.2"></path></svg>
                <input id="inlineSearch" type="search" autocomplete="off" spellcheck="false" value="${escapeHTML(state.query)}" placeholder="${escapeHTML(t('searchCurrent'))}" />
              </label>
              <span class="result-count mono">${list.length} / ${technologies.length}</span>
              <select class="sort-select" id="sortSelect" aria-label="${escapeHTML(t('sort'))}">
                <option value="verified-desc" ${state.sort === 'verified-desc' ? 'selected' : ''}>${escapeHTML(t('recentFirst'))}</option>
                <option value="name" ${state.sort === 'name' ? 'selected' : ''}>${escapeHTML(t('nameFirst'))}</option>
                <option value="status" ${state.sort === 'status' ? 'selected' : ''}>${escapeHTML(t('statusFirst'))}</option>
                <option value="source-desc" ${state.sort === 'source-desc' ? 'selected' : ''}>${escapeHTML(t('sourcesFirst'))}</option>
              </select>
            </div>

            <div class="tech-table" aria-label="${escapeHTML(t('homeTitle'))}">
              <div class="tech-table-head" aria-hidden="true">
                <span>${escapeHTML(t('technology'))}</span><span>${escapeHTML(t('currentStatus'))}</span><span>${escapeHTML(t('recentCheck'))}</span><span>${escapeHTML(t('nextCheck'))}</span>
              </div>
              ${list.length
                ? list.map(renderTechRow).join('')
                : normalize(state.query)
                  ? renderResearchRequestPanel(state.query, 'inline')
                  : `<div class="empty-state"><strong>${escapeHTML(t('noFilter'))}</strong><p>${escapeHTML(t('changeFilter'))}</p></div>`}
            </div>
          </div>
        </section>
      </div>`;
  }

  function renderTechRow(tech) {
    return `
      <article class="tech-row">
        <button class="tech-name-button" data-open-tech="${escapeHTML(tech.id)}">
          <span class="tech-name">${escapeHTML(techName(tech))}</span>
          <span class="tech-en mono">${escapeHTML(tech.nameEn)}</span>
          <span class="tech-category">${escapeHTML(groupLabel(groupOf(tech)))} / ${escapeHTML(tech.category)}</span>
        </button>
        <div class="tech-state">
          <div class="state-line"><span class="state-primary">${escapeHTML(tech.status)}</span></div>
          <span class="state-secondary">${escapeHTML(tech.trajectoryLabel)} · ${escapeHTML(tech.access)}</span>
        </div>
        <div class="event-cell latest-cell">
          <div class="event-meta">
            <time class="event-date mono">${escapeHTML(tech.latest?.date || t('unknown'))}</time>
            <span class="event-verification mono">VERIFIED ${escapeHTML(tech.verifiedAt || t('unknown'))} · ${escapeHTML(String(tech.sources?.length || 0))} SOURCES</span>
          </div>
          <span class="event-title">${escapeHTML(tech.latest?.title || t('noRecent'))}</span>
          <span class="event-copy">${escapeHTML(tech.latest?.text || '')}</span>
        </div>
        <div class="event-cell next-cell">
          <time class="event-date mono">${escapeHTML(tech.next?.date || t('undecided'))}</time>
          <span class="event-title">${escapeHTML(tech.next?.text || t('noNext'))}</span>
        </div>
      </article>`;
  }


  function evidenceDate(item) {
    return String(item.sourceUpdatedAt || item.publishedAt || item.retrievedAt || '미확인').slice(0, 10);
  }

  function evidenceMetaLine(item) {
    const meta = item.metadata || {};
    if (item.sourceType === 'openalex') {
      return [meta.venue, meta.work_type, Number.isFinite(meta.cited_by_count) ? `CITED ${meta.cited_by_count}` : ''].filter(Boolean).join(' / ');
    }
    if (item.sourceType === 'clinicaltrials') {
      return [meta.nct_id, meta.overall_status, ...(meta.phases || []), meta.enrollment ? `N ${meta.enrollment}` : ''].filter(Boolean).join(' / ');
    }
    if (item.sourceType === 'sec') {
      return [meta.ticker, meta.form, meta.filing_date].filter(Boolean).join(' / ');
    }
    return '';
  }

  function renderLiveEvidence(tech) {
    const items = tech.liveEvidence || [];
    if (!items.length) {
      return `
        <section class="detail-section live-evidence-section">
          <div class="section-head"><h2>${escapeHTML(t('evidence'))}</h2><span class="section-kicker">LIVE EVIDENCE / 0</span></div>
          <div class="live-evidence-empty">
            <strong>${backendConnected ? '현재 연결된 새 근거가 없습니다.' : '서버 연결 전 정적 스냅샷입니다.'}</strong>
            <p>자동 수집 결과는 논문·임상·공시 원문 메타데이터로 표시되며 기존 편집 판정을 자동으로 변경하지 않습니다.</p>
          </div>
        </section>`;
    }
    const groups = ['openalex', 'clinicaltrials', 'sec'].map(sourceType => ({
      sourceType,
      items: items.filter(item => item.sourceType === sourceType)
    })).filter(group => group.items.length);
    return `
      <section class="detail-section live-evidence-section">
        <div class="section-head"><h2>${escapeHTML(t('evidence'))}</h2><span class="section-kicker">LIVE EVIDENCE / ${items.length}</span></div>
        <p class="live-evidence-disclaimer">검색식과 키워드 규칙으로 연결된 원자료입니다. 편집 판정이나 기술 진전 확정으로 간주하지 않습니다.</p>
        <div class="live-evidence-groups">
          ${groups.map(group => `
            <section class="live-evidence-group">
              <header><span>${escapeHTML(group.items[0]?.sourceLabel || group.sourceType)}</span><strong class="mono">${group.items.length}</strong></header>
              <div class="live-evidence-list">
                ${group.items.map(item => `
                  <article class="live-evidence-row">
                    <time class="mono">${escapeHTML(evidenceDate(item))}</time>
                    <div class="live-evidence-content">
                      <a href="${escapeHTML(safeURL(item.url))}" target="_blank" rel="noopener noreferrer">${escapeHTML(item.title)}</a>
                      <span>${escapeHTML(item.publisher || item.sourceLabel)}</span>
                      ${evidenceMetaLine(item) ? `<span class="mono live-evidence-meta">${escapeHTML(evidenceMetaLine(item))}</span>` : ''}
                      ${item.metadata?.snippet ? `<p>${escapeHTML(item.metadata.snippet)}</p>` : ''}
                      <dl class="evidence-provenance">
                        <div><dt>원출처 유형</dt><dd>${escapeHTML(item.sourceLabel || item.sourceType || '미확인')}</dd></div>
                        <div><dt>외부 식별자</dt><dd class="mono">${escapeHTML(item.externalId || '미확인')}</dd></div>
                        <div><dt>원문 갱신</dt><dd class="mono">${escapeHTML(item.sourceUpdatedAt || '미확인')}</dd></div>
                        <div><dt>수집 시각</dt><dd class="mono">${escapeHTML(item.retrievedAt || '미확인')}</dd></div>
                      </dl>
                    </div>
                    <div class="live-evidence-match">${(item.matchedTerms || []).slice(0, 4).map(term => `<span>${escapeHTML(term)}</span>`).join('')}</div>
                  </article>`).join('')}
              </div>
            </section>`).join('')}
        </div>
      </section>`;
  }

  function relatedEdges(id) {
    return relationships.filter(edge => edge.from === id || edge.to === id);
  }

  function otherTechForEdge(edge, id) {
    return findTech(edge.from === id ? edge.to : edge.from);
  }

  function relationKindLabel(kind) {
    return kind === 'observed' ? '직접 관찰' : kind === 'system' ? '시스템 연결' : '추론 연결';
  }

  function relationStrengthLabel(strength) {
    return Number(strength) >= 3 ? '강함' : Number(strength) === 2 ? '중간' : '약함';
  }

  function firstSentence(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    const matched = text.match(/^.*?[.!?](?:\s|$)/);
    return (matched ? matched[0] : text).trim();
  }

  function plainLanguageSummary(tech) {
    const description = firstSentence(tech.summary) || `${tech.name}의 현재 개발·도입 상태를 추적하는 기술이다.`;
    return `${description} 현재 판정은 ${tech.status}이며, 이용 가능 범위는 ${tech.access}로 기록돼 있다.`;
  }

  function renderTechnologyReport(tech) {
    const edges = relatedEdges(tech.id);
    return `
      <section class="detail-section technology-report-section">
        <div class="section-head"><h2>${escapeHTML(t('report'))}</h2><span class="section-kicker">TECHNOLOGY BRIEF / VERIFIED ONLY</span></div>
        <div class="technology-report">
          <article class="report-row">
            <h3>현재 무엇이 진행 중인가</h3>
            <div class="report-copy">
              <strong>${escapeHTML(tech.currentState)}</strong>
              <p>${escapeHTML(tech.latest?.title || '최근 사건 미확인')} — ${escapeHTML(tech.latest?.text || '확인된 최신 설명이 없습니다.')}</p>
            </div>
          </article>
          <article class="report-row">
            <h3>어떤 기술과 어떻게 연결되는가</h3>
            <div class="report-copy">
              ${edges.length ? `<div class="report-relations">${edges.map(edge => {
                const other = otherTechForEdge(edge, tech.id);
                if (!other) return '';
                return `<article>
                  <button data-open-tech="${escapeHTML(other.id)}">${escapeHTML(techName(other))}</button>
                  <span class="mono">${escapeHTML(relationKindLabel(edge.kind))} / ${escapeHTML(relationStrengthLabel(edge.strength))}</span>
                  <strong>${escapeHTML(edge.type)}</strong>
                  <p>${escapeHTML(edge.basis)}</p>
                  <small>${escapeHTML(edge.evidence)}</small>
                </article>`;
              }).join('')}</div>` : '<p>현재 원출처로 방어할 수 있는 연결은 확인되지 않았다. 약한 연상은 관계로 추가하지 않는다.</p>'}
            </div>
          </article>
          <article class="report-row">
            <h3>현재 한계와 병목</h3>
            <div class="report-copy">
              ${(tech.constraints || []).length ? `<ul>${tech.constraints.map(item => `<li>${escapeHTML(item)}</li>`).join('')}</ul>` : '<p>공개 근거에서 별도 병목을 확인하지 못했다.</p>'}
            </div>
          </article>
          <article class="report-row">
            <h3>앞으로 확인하고 해야 할 일</h3>
            <div class="report-copy">
              <strong>${escapeHTML(tech.next?.text || '다음 공식 확인 지점 미확인')}</strong>
              ${(tech.unknowns || []).length ? `<ul>${tech.unknowns.map(item => `<li>${escapeHTML(item)}</li>`).join('')}</ul>` : ''}
            </div>
          </article>
        </div>
      </section>`;
  }

  function renderDeepAnalysis(tech) {
    return `
      <section class="detail-section deep-analysis-section">
        <details class="deep-analysis" data-deep-analysis="${escapeHTML(tech.id)}">
          <summary>
            <span><strong>심층 기술 분석 요청</strong><small>펼칠 때 원출처 조사와 구조 분석을 시작하며, 완료된 결과만 표시합니다.</small></span>
            <span class="section-kicker">ON-DEMAND / NOT PREWRITTEN</span>
          </summary>
          <div class="deep-analysis-body" data-deep-analysis-body="${escapeHTML(tech.id)}" aria-live="polite">
            <div class="deep-analysis-idle">
              <span class="mono">LAZY ANALYSIS</span>
              <p>이 영역의 분석 내용은 기술 데이터에 미리 작성되어 있지 않습니다. 펼치면 소유자 전용 분석 대기열에 요청을 저장합니다.</p>
            </div>
          </div>
        </details>
      </section>`;
  }

  function analysisStatusLabel(status) {
    return {
      pending: '분석 대기',
      researching: '원출처 조사·근거 대조 중',
      completed: '분석 완료',
      needs_review: '추가 검증 필요',
      failed: '분석 실패'
    }[status] || '상태 미확인';
  }

  function deepAnalysisSourceLinks(urls) {
    return (urls || []).map((url, index) => `
      <a href="${escapeHTML(safeURL(url))}" target="_blank" rel="noopener noreferrer">SOURCE ${String(index + 1).padStart(2, '0')} ↗</a>
    `).join('');
  }

  function renderDeepAnalysisResult(item) {
    const result = item.result;
    if (!result) return '<div class="deep-analysis-error"><strong>완료 결과를 검증하지 못했습니다.</strong><p>필수 분석 필드 또는 원출처가 누락되어 추가 검증이 필요합니다.</p></div>';
    return `
      <div class="deep-analysis-meta">
        <span class="mono">${escapeHTML(item.analysisModel || 'CHATGPT SCHEDULED ANALYSIS')}</span>
        <dl>
          <div><dt>근거 확인 기준일</dt><dd class="mono">${escapeHTML(item.verifiedThrough || '미확인')}</dd></div>
          <div><dt>완료 시각</dt><dd class="mono">${escapeHTML(item.updatedAt || '미확인')}</dd></div>
          <div><dt>원출처</dt><dd class="mono">${escapeHTML(String(item.sourceCount || result.citations?.length || 0))}</dd></div>
        </dl>
      </div>
      <article class="deep-analysis-lead">
        <span class="mono">ANALYTICAL JUDGMENT</span>
        <h3>핵심 기술 판단</h3>
        <p>${escapeHTML(result.executiveJudgment)}</p>
      </article>
      <article class="deep-analysis-model">
        <header><span class="mono">TECHNICAL MODEL</span><h3>작동 구조와 실패 전파 경로</h3></header>
        <p class="deep-analysis-boundary">${escapeHTML(result.technicalModel.systemBoundary)}</p>
        <ol class="causal-chain">
          ${(result.technicalModel.causalChain || []).map((stage, index) => `
            <li>
              <span class="mono">${String(index + 1).padStart(2, '0')}</span>
              <div><strong>${escapeHTML(stage.stage)}</strong><p>${escapeHTML(stage.mechanism)}</p><small>실패 지점 — ${escapeHTML(stage.failureMode)}</small></div>
            </li>`).join('')}
        </ol>
      </article>
      <article class="deep-analysis-evidence">
        <header><span class="mono">EVIDENCE INTERPRETATION</span><h3>근거가 실제로 의미하는 범위</h3></header>
        <div class="evidence-interpretation-list">
          ${(result.evidenceInterpretation || []).map((entry, index) => `
            <section>
              <span class="mono">E${String(index + 1).padStart(2, '0')}</span>
              <h4>${escapeHTML(entry.finding)}</h4>
              <dl><div><dt>해석</dt><dd>${escapeHTML(entry.interpretation)}</dd></div><div><dt>해석 한계</dt><dd>${escapeHTML(entry.limitation)}</dd></div></dl>
              <div class="deep-analysis-links">${deepAnalysisSourceLinks(entry.sourceUrls)}</div>
            </section>`).join('')}
        </div>
      </article>
      <article class="deep-analysis-bottlenecks">
        <header><span class="mono">BOTTLENECK CAUSALITY</span><h3>병목이 묶여 있는 방식</h3></header>
        <div class="bottleneck-analysis-list">
          ${(result.bottleneckAnalysis || []).map((entry, index) => `
            <section>
              <span class="mono">B${String(index + 1).padStart(2, '0')}</span>
              <h4>${escapeHTML(entry.name)}</h4>
              <p>${escapeHTML(entry.whyBinding)}</p>
              <div><strong>연쇄 영향</strong><ul>${(entry.downstreamEffects || []).map(value => `<li>${escapeHTML(value)}</li>`).join('')}</ul></div>
              <div><strong>해소를 입증할 자료</strong><ul>${(entry.evidenceToResolve || []).map(value => `<li>${escapeHTML(value)}</li>`).join('')}</ul></div>
            </section>`).join('')}
        </div>
      </article>
      ${(result.relationshipAnalysis || []).length ? `
        <article class="deep-analysis-relations">
          <header><span class="mono">DEPENDENCY ANALYSIS</span><h3>다른 기술과의 실질적 의존 관계</h3></header>
          <div class="deep-relation-list">
            ${result.relationshipAnalysis.map(entry => {
              const related = findTech(entry.technologyId);
              return `<section>
                <div>${related ? `<button data-open-tech="${escapeHTML(related.id)}">${escapeHTML(techName(related))}</button>` : `<strong>${escapeHTML(entry.technologyId)}</strong>`}<span>${escapeHTML(entry.relationship)}</span></div>
                <p>${escapeHTML(entry.dependency)}</p>
                <small>전이 한계 — ${escapeHTML(entry.transferLimit)}</small>
              </section>`;
            }).join('')}
          </div>
        </article>` : ''}
      <article class="deep-analysis-agenda">
        <header><span class="mono">RESEARCH AGENDA</span><h3>다음 조사에서 답해야 할 질문</h3></header>
        <ol>
          ${(result.researchAgenda || []).map(entry => `
            <li>
              <span class="mono">${escapeHTML(entry.priority)}</span>
              <div><strong>${escapeHTML(entry.question)}</strong><p>필요 근거 — ${escapeHTML(entry.requiredEvidence)}</p><small>판정 영향 — ${escapeHTML(entry.decisionImpact)}</small></div>
            </li>`).join('')}
        </ol>
      </article>
      <article class="deep-analysis-citations">
        <header><span class="mono">SOURCE LEDGER</span><h3>분석에 사용된 원출처</h3></header>
        <div>
          ${(result.citations || []).map((source, index) => `
            <a href="${escapeHTML(safeURL(source.url))}" target="_blank" rel="noopener noreferrer">
              <span class="mono">${String(index + 1).padStart(2, '0')}</span>
              <strong>${escapeHTML(source.title)}</strong>
              <small>${escapeHTML(source.publisher)} · 사건 ${escapeHTML(source.eventDate)} · 게시 ${escapeHTML(source.publishedDate)}</small>
            </a>`).join('')}
        </div>
      </article>`;
  }

  function renderDeepAnalysisState(tech, item, detail = '') {
    const container = document.querySelector(`[data-deep-analysis-body="${tech.id}"]`);
    if (!container) return;
    if (item?.status === 'completed') {
      container.innerHTML = renderDeepAnalysisResult(item);
      return;
    }
    const status = item?.status || 'pending';
    container.innerHTML = `
      <div class="deep-analysis-progress" data-status="${escapeHTML(status)}">
        <span class="analysis-activity" aria-hidden="true"></span>
        <div>
          <span class="mono">${escapeHTML(status.toUpperCase())}</span>
          <strong>${escapeHTML(analysisStatusLabel(status))}</strong>
          <p>${escapeHTML(detail || item?.resolutionNote || (status === 'pending'
            ? '요청이 저장되었습니다. 다음 예약 실행에서 원출처 조사와 근거 대조를 시작합니다. 이 페이지를 닫아도 요청은 유지됩니다.'
            : status === 'researching'
              ? '요약문을 반복하지 않고, 기술 구조·근거의 의미·병목의 인과관계·다음 조사 질문을 작성하고 있습니다.'
              : '근거가 부족하거나 결과 형식이 검증을 통과하지 못했습니다.'))}</p>
          <small>가짜 진행률은 표시하지 않습니다. 상태가 바뀌면 이 영역이 자동으로 갱신됩니다.</small>
        </div>
      </div>`;
  }

  function scheduleDeepAnalysisPoll(tech) {
    const current = deepAnalysisPollTimers.get(tech.id);
    if (current) window.clearTimeout(current);
    const timer = window.setTimeout(() => {
      deepAnalysisPollTimers.delete(tech.id);
      if (document.querySelector(`[data-deep-analysis="${tech.id}"][open]`)) loadDeepAnalysis(tech, false);
    }, 30000);
    deepAnalysisPollTimers.set(tech.id, timer);
  }

  async function deepAnalysisRequest(url, options = {}) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, { cache: 'no-store', signal: controller.signal, ...options });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || `HTTP ${response.status}`);
      return payload;
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function loadDeepAnalysis(tech, createIfMissing = true) {
    const cached = deepAnalysisCache.get(tech.id);
    if (cached?.status === 'completed') {
      renderDeepAnalysisState(tech, cached);
      return;
    }
    renderDeepAnalysisState(tech, cached || { status: 'pending' }, cached ? '' : '저장된 분석 결과를 확인하고 있습니다.');
    try {
      let payload = await deepAnalysisRequest(`/api/deep-analysis?technologyId=${encodeURIComponent(tech.id)}`);
      if (!payload.item && createIfMissing) {
        payload = await deepAnalysisRequest('/api/deep-analysis', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Tracker-Deep-Analysis': '1'
          },
          body: JSON.stringify({ technologyId: tech.id, technologyName: techName(tech) })
        });
      }
      if (!payload.item) {
        renderDeepAnalysisState(tech, { status: 'needs_review' }, '분석 요청을 찾지 못했습니다. 영역을 닫았다가 다시 열어 요청하십시오.');
        return;
      }
      deepAnalysisCache.set(tech.id, payload.item);
      renderDeepAnalysisState(tech, payload.item, payload.detail || '');
      if (['pending', 'researching'].includes(payload.item.status)) scheduleDeepAnalysisPoll(tech);
    } catch (error) {
      renderDeepAnalysisState(tech, { status: 'failed' }, error instanceof Error ? error.message : '심층 분석 상태를 불러오지 못했습니다.');
    }
  }

  function renderRelationshipSection(tech) {
    const edges = relatedEdges(tech.id);
    return `
      <section class="detail-section relationship-detail-section">
        <div class="section-head"><h2>${escapeHTML(t('relationships'))}</h2><span class="section-kicker">GPT MAPPED / ${edges.length}</span></div>
        <p class="section-disclaimer">사용자가 비교 대상을 고르지 않아도 원출처·기술 의존성·운영 시스템을 기준으로 연결합니다. 추론 연결은 관찰된 사실과 구분합니다.</p>
        ${edges.length ? `<div class="relation-detail-list">${edges.map(edge => {
          const other = otherTechForEdge(edge, tech.id);
          if (!other) return '';
          return `<article class="relation-detail-row">
            <div class="relation-meta mono"><span>${escapeHTML(relationKindLabel(edge.kind))}</span><span>${escapeHTML(relationStrengthLabel(edge.strength))}</span></div>
            <button data-open-tech="${escapeHTML(other.id)}"><strong>${escapeHTML(techName(other))}</strong><span class="mono">${escapeHTML(other.nameEn)}</span></button>
            <div><strong>${escapeHTML(edge.type)}</strong><p>${escapeHTML(edge.basis)}</p><small>${escapeHTML(edge.evidence)}</small></div>
          </article>`;
        }).join('')}</div>` : `<div class="relation-empty">현재 원출처로 방어할 수 있는 자동 연결을 만들지 않았습니다. 약한 연상을 관계로 채우지 않습니다.</div>`}
      </section>`;
  }

  function renderNetwork() {
    const focus = findTech(state.networkFocus) || technologies[0];
    if (!focus) return;
    const edges = relatedEdges(focus.id);
    const connectedIds = new Set(edges.flatMap(edge => [edge.from, edge.to]));
    const groups = GROUPS.slice(1).map(group => ({
      name: group,
      items: technologies.filter(tech => groupOf(tech) === group)
    })).filter(group => group.items.length);

    main.innerHTML = `
      <div class="page-shell relationship-page">
        ${pageHead(t('mapTitle'), 'GPT가 원출처와 기술·운영 의존성을 바탕으로 관계를 자동 매핑합니다.', [
          { value: technologies.length, label: '기술 노드' },
          { value: relationships.length, label: '검증 관계' },
          { value: window.SNAPSHOT_VERIFIED_AT || '미확인', label: '검증일' }
        ])}

        <section class="relation-legend" aria-label="관계 판정 범례">
          <div><span class="relation-dot observed"></span><strong>직접 관찰</strong><p>제품·프로세스의 명시적 기술 의존</p></div>
          <div><span class="relation-dot system"></span><strong>시스템 연결</strong><p>공통 운영·제조·인프라 병목</p></div>
          <div><span class="relation-dot inferred"></span><strong>추론 연결</strong><p>조건부 가능성, 성과 전이 금지</p></div>
        </section>

        <section class="relation-treemap" aria-label="분야별 기술 트리맵">
          ${groups.map(group => `<section class="treemap-group">
            <header><span>${escapeHTML(group.name)}</span><strong class="mono">${group.items.length}</strong></header>
            <div>${group.items.map(tech => `<button class="treemap-node ${tech.id === focus.id ? 'is-focus' : ''} ${connectedIds.has(tech.id) && tech.id !== focus.id ? 'is-connected' : ''}" data-network-focus="${escapeHTML(tech.id)}"><strong>${escapeHTML(techName(tech))}</strong><span class="mono">${escapeHTML(tech.nameEn)}</span></button>`).join('')}</div>
          </section>`).join('')}
        </section>

        <section class="relation-network" aria-live="polite">
          <div class="relation-focus-card">
            <span class="mono">SELECTED NODE / ${escapeHTML(groupOf(focus))}</span>
            <h2>${escapeHTML(techName(focus))}</h2>
            <p class="mono">${escapeHTML(focus.nameEn)}</p>
            <strong>${escapeHTML(focus.status)}</strong>
            <small class="mono">VERIFIED ${escapeHTML(focus.verifiedAt)}</small>
          </div>
          <div class="relation-branches" style="--edge-count:${Math.max(edges.length, 1)}">
            ${edges.length ? edges.map(edge => {
              const other = otherTechForEdge(edge, focus.id);
              if (!other) return '';
              return `<article class="relation-branch ${escapeHTML(edge.kind)}">
                <div class="branch-line" aria-hidden="true"></div>
                <button data-network-focus="${escapeHTML(other.id)}"><strong>${escapeHTML(techName(other))}</strong><span class="mono">${escapeHTML(other.nameEn)}</span></button>
                <div class="branch-copy">
                  <header><span>${escapeHTML(edge.type)}</span><span class="mono">${escapeHTML(relationKindLabel(edge.kind))} / ${escapeHTML(relationStrengthLabel(edge.strength))}</span></header>
                  <p>${escapeHTML(edge.basis)}</p>
                  <small>${escapeHTML(edge.evidence)}</small>
                </div>
              </article>`;
            }).join('') : `<div class="relation-empty">현재 근거로 방어할 수 있는 연결이 없습니다. 관계가 없는 상태도 데이터로 남깁니다.</div>`}
          </div>
        </section>
      </div>`;
  }

  function renderDetail(tech) {
    const unknownCount = (tech.dimensions || []).filter(item => item.state === 'unknown').length;

    main.innerHTML = `
      <div class="page-shell">
        <section class="detail-hero">
          <div class="detail-crumb mono"><button data-route="home">ALL TECHNOLOGIES</button><span>/</span><span>${escapeHTML(tech.id.toUpperCase())}</span></div>
          <div class="detail-data-notice" data-connection="${escapeHTML(backendState)}">
            <span class="mono">${backendConnected ? 'LIVE API + EDITORIAL ASSESSMENT' : 'EDITORIAL SNAPSHOT'}</span>
            <span>${escapeHTML(datasetModeText())}</span>
          </div>
          <div class="detail-title-row">
            <div>
              <h1 class="detail-title">${escapeHTML(techName(tech))}</h1>
              <p class="detail-en mono">${escapeHTML(tech.nameEn)}</p>
            </div>
          </div>
          <div class="detail-intro-grid">
            <div class="detail-intro-block">
              <span class="mono">TECHNICAL DESCRIPTION</span>
              <h2>기술 설명</h2>
              <p>${escapeHTML(tech.summary)}</p>
            </div>
            <div class="detail-intro-block detail-intro-plain">
              <span class="mono">PLAIN LANGUAGE</span>
              <h2>쉽게 말하면</h2>
              <p>${escapeHTML(plainLanguageSummary(tech))}</p>
            </div>
          </div>
          <div class="detail-meta">
            <div class="detail-meta-item"><span>현재 상태</span><strong>${escapeHTML(tech.status)}</strong></div>
            <div class="detail-meta-item"><span>변화 방향</span><strong>${escapeHTML(tech.trajectoryLabel)}</strong></div>
            <div class="detail-meta-item"><span>접근 범위</span><strong>${escapeHTML(tech.access)}</strong></div>
            <div class="detail-meta-item"><span>마지막 검증</span><strong class="mono">${escapeHTML(tech.verifiedAt)}</strong></div>
          </div>
        </section>

        <div class="detail-layout">
          <div class="detail-main">
            ${renderTechnologyReport(tech)}

            <section class="detail-section">
              <div class="section-head"><h2>현재 판정</h2><span class="section-kicker">CURRENT ASSESSMENT</span></div>
              <div class="current-state">
                <div class="current-state-label">관찰된 현재 상태</div>
                <div class="current-state-value">${escapeHTML(tech.currentState)}</div>
              </div>
              <div class="latest-event">
                <time class="mono">${escapeHTML(tech.latest?.date || '미확인')}</time>
                <div>
                  <h3>${escapeHTML(tech.latest?.title || '최근 사건 미확인')}</h3>
                  <p>${escapeHTML(tech.latest?.text || '')}</p>
                  ${tech.latest?.url ? `<a class="mono" href="${escapeHTML(safeURL(tech.latest.url))}" target="_blank" rel="noopener noreferrer">OPEN PRIMARY SOURCE ↗</a>` : ''}
                </div>
              </div>
            </section>

            <section class="detail-section">
              <div class="section-head"><h2>${escapeHTML(t('facts'))}</h2><span class="section-kicker">VERIFIED FACTS</span></div>
              <div class="fact-grid facts-${Math.min(4, Math.max(1, tech.facts?.length || 1))}">
                ${(tech.facts || []).map(fact => `
                  <div class="fact-item">
                    <strong class="fact-value mono">${escapeHTML(fact.value)}</strong>
                    <span class="fact-label">${escapeHTML(fact.label)}</span>
                    <span class="fact-note">${escapeHTML(fact.note)}</span>
                  </div>`).join('')}
              </div>
            </section>

            ${renderRelationshipSection(tech)}

            <section class="detail-section">
              <div class="section-head"><h2>${escapeHTML(t('matrix'))}</h2><span class="section-kicker">EVIDENCE MATRIX</span></div>
              <div class="matrix">
                ${(tech.dimensions || []).map(item => `
                  <div class="matrix-row">
                    <div class="matrix-label">${escapeHTML(item.label)}</div>
                    <div class="matrix-status"><span>${escapeHTML(item.stateLabel)}</span></div>
                    <div class="matrix-value">${escapeHTML(item.value)}</div>
                    <div class="matrix-note">${escapeHTML(item.note)}</div>
                  </div>`).join('')}
              </div>
            </section>

            <section class="detail-section">
              <div class="section-head"><h2>${escapeHTML(t('eventLedger'))}</h2><span class="section-kicker">EVENT LEDGER</span></div>
              <div class="timeline">
                ${(tech.timeline || []).slice().sort((a, b) => parseLooseDate(b.date) - parseLooseDate(a.date)).map(event => `
                  <div class="timeline-row">
                    <time class="timeline-date mono">${escapeHTML(event.date)}</time>
                    <div class="timeline-kind">${escapeHTML(event.kind)}</div>
                    <div class="timeline-content">
                      <h3>${escapeHTML(event.title)}</h3>
                      <p>${escapeHTML(event.text)}</p>
                      ${event.url ? `<a class="mono" href="${escapeHTML(safeURL(event.url))}" target="_blank" rel="noopener noreferrer">${escapeHTML(event.source || 'SOURCE')} ↗</a>` : ''}
                    </div>
                  </div>`).join('')}
              </div>
            </section>

            ${renderLiveEvidence(tech)}

            <section class="detail-section">
              <div class="section-head"><h2>${escapeHTML(t('sourcesTitle'))}</h2><span class="section-kicker">SOURCE LEDGER / ${escapeHTML(String(tech.sources?.length || 0))}</span></div>
              <div class="source-ledger">
                ${(tech.sources || []).map(source => `
                  <div class="source-row">
                    <div class="source-type">${escapeHTML(source.type)}</div>
                    <div class="source-publisher">${escapeHTML(source.publisher)}</div>
                    <div class="source-title">${escapeHTML(source.title)}</div>
                    <div class="source-date mono">${escapeHTML(source.date)}</div>
                    <a href="${escapeHTML(safeURL(source.url))}" target="_blank" rel="noopener noreferrer" aria-label="원출처 새 창에서 열기">↗</a>
                  </div>`).join('')}
              </div>
            </section>

            ${renderDeepAnalysis(tech)}
          </div>

          <aside class="detail-side">
            <section class="side-block">
              <h2>다음 확인 지점</h2>
              <span class="side-date mono">${escapeHTML(tech.next?.date || '미정')}</span>
              <p class="side-primary">${escapeHTML(tech.next?.text || '미확인')}</p>
            </section>
            <section class="side-block">
              <h2>핵심 병목</h2>
              <ul class="side-list">${(tech.constraints || []).map(item => `<li>${escapeHTML(item)}</li>`).join('')}</ul>
            </section>
            <section class="side-block">
              <h2>아직 확인되지 않은 것</h2>
              <ul class="side-list">${(tech.unknowns || []).map(item => `<li>${escapeHTML(item)}</li>`).join('')}</ul>
            </section>
            <section class="side-block">
              <h2>데이터 범위</h2>
              <dl class="coverage-grid">
                <dt>상위 분야</dt><dd>${escapeHTML(groupOf(tech))}</dd>
                <dt>세부 분야</dt><dd>${escapeHTML(tech.category)}</dd>
                <dt>원출처</dt><dd class="mono">${escapeHTML(String(tech.sources?.length || 0))}</dd>
                <dt>기록 사건</dt><dd class="mono">${escapeHTML(String(tech.timeline?.length || 0))}</dd>
                <dt>미확인 축</dt><dd class="mono">${escapeHTML(String(unknownCount))}</dd>
              </dl>
            </section>
          </aside>
        </div>
      </div>`;
  }

  function allEvents() {
    return technologies.flatMap(tech => (tech.timeline || []).map(event => ({ ...event, techId: tech.id, techName: tech.name, category: tech.category })))
      .sort((a, b) => parseLooseDate(b.date) - parseLooseDate(a.date) || a.techName.localeCompare(b.techName, 'ko'));
  }

  function renderUpdates() {
    const events = allEvents();
    const filtered = state.updateFilter === '전체' ? events : events.filter(event => updateFamily(event.kind) === state.updateFilter);

    main.innerHTML = `
      <div class="page-shell">
        ${pageHead(t('updatesTitle'), '', [
          { value: events.length, label: '전체 사건' },
          { value: events.filter(event => /^2026/.test(event.date)).length, label: '2026 사건' },
          { value: technologies.length, label: '연결 기술' }
        ])}
        <div class="update-controls" aria-label="변경 기록 필터">
          ${UPDATE_FILTERS.map(filter => `<button class="update-filter ${state.updateFilter === filter ? 'is-active' : ''}" data-update-filter="${escapeHTML(filter)}">${escapeHTML(filter)}</button>`).join('')}
        </div>
        <section class="update-list">
          ${filtered.map(event => `
            <article class="update-row">
              <time class="update-date mono">${escapeHTML(event.date)}</time>
              <div class="update-tech"><button data-open-tech="${escapeHTML(event.techId)}">${escapeHTML(event.techName)}</button></div>
              <div class="update-kind">${escapeHTML(event.kind)}</div>
              <div class="update-content"><h2>${escapeHTML(event.title)}</h2><p>${escapeHTML(event.text)}</p></div>
              <div class="update-source">${event.url ? `<a class="mono" href="${escapeHTML(safeURL(event.url))}" target="_blank" rel="noopener noreferrer">${escapeHTML(event.source || 'SOURCE')} ↗</a>` : ''}</div>
            </article>`).join('')}
        </section>
      </div>`;
  }

  function sourceLabel(sourceType) {
    return {
      rss: 'RSS FEEDS',
      openalex: 'OpenAlex',
      clinicaltrials: 'ClinicalTrials.gov',
      sec: 'SEC EDGAR'
    }[sourceType] || sourceType || '미확인';
  }

  function formatDateTime(value) {
    if (!value) return '미확인';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return String(value);
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(parsed);
  }

  function latestRun(sourceType) {
    return ingestionRuns.find(run => run.sourceType === sourceType) || ingestionStatus[sourceType] || null;
  }

  function lastSuccessfulRun(sourceType) {
    return ingestionRuns.find(run => run.sourceType === sourceType && run.status === 'completed') || null;
  }

  function runStatusLabel(status) {
    return {
      completed: '성공',
      partial: '일부 오류',
      failed: '실패',
      running: '실행 중',
      skipped_locked: '중복 실행 건너뜀'
    }[status] || (status ? String(status) : '기록 없음');
  }

  function runMetric(run, key) {
    if (!run) return '—';
    return run[key] === null || run[key] === undefined ? '미확인' : String(run[key]);
  }

  function renderIngestion() {
    const sourceTypes = ['rss', 'openalex', 'clinicaltrials', 'sec'];
    const totalErrors = ingestionRuns.reduce((sum, run) => sum + Number(run.errorCount || 0), 0);
    const connectionTitle = backendState === 'live'
      ? '라이브 API가 연결되어 있습니다.'
      : backendState === 'error'
        ? '외부 API에 연결하지 못했습니다.'
        : backendState === 'unconfigured'
          ? '외부 API 주소가 아직 설정되지 않았습니다.'
          : '데이터 연결 상태를 확인하고 있습니다.';
    const connectionCopy = backendState === 'live'
      ? `${apiBaseURL ? new URL(apiBaseURL).host : '외부 API'} · HTTPS 업스트림과 Sites 동일 출처 프록시 응답 확인됨`
      : backendState === 'error'
        ? '편집 스냅샷만 표시 중입니다. API의 HTTPS, 프록시 접근 허용, health 응답을 확인하십시오.'
        : 'PUBLIC_API_BASE_URL을 설정하기 전에는 자동 수집 결과와 마지막 동기화 시각을 표시하지 않습니다.';

    main.innerHTML = `
      <div class="page-shell">
        ${pageHead('수집 상태', '', [
          { value: backendState === 'live' ? sourceTypes.length : 0, label: '연결 소스' },
          { value: ingestionRuns.length, label: '실행 기록' },
          { value: totalErrors, label: '기록 오류' }
        ])}

        <section class="connection-panel" data-connection="${escapeHTML(backendState)}" aria-live="polite">
          <span class="connection-marker" aria-hidden="true"></span>
          <div><strong>${escapeHTML(connectionTitle)}</strong><p>${escapeHTML(connectionCopy)}</p></div>
          <span class="mono">${escapeHTML(syncStatusText().toUpperCase())}</span>
        </section>

        <section class="ingestion-sources" aria-label="수집기별 상태">
          <div class="ingestion-source-head" aria-hidden="true">
            <span>원출처</span><span>현재 상태</span><span>마지막 성공</span><span>삽입</span><span>갱신</span><span>건너뜀</span><span>오류</span>
          </div>
          ${sourceTypes.map(sourceType => {
            const run = backendConnected ? latestRun(sourceType) : null;
            const success = backendConnected ? lastSuccessfulRun(sourceType) : null;
            return `<article class="ingestion-source-row">
              <div><strong>${escapeHTML(sourceLabel(sourceType))}</strong><span class="mono">${escapeHTML(sourceType)}</span></div>
              <div class="run-status status-${escapeHTML(run?.status || 'unknown')}"><strong>${escapeHTML(backendConnected ? runStatusLabel(run?.status) : '데이터 연결 대기')}</strong></div>
              <time class="mono">${escapeHTML(backendConnected ? formatDateTime(success?.finishedAt) : '미확인')}</time>
              <strong class="mono">${escapeHTML(runMetric(run, 'recordsInserted'))}</strong>
              <strong class="mono">${escapeHTML(runMetric(run, 'recordsUpdated'))}</strong>
              <strong class="mono">${escapeHTML(runMetric(run, 'recordsSkipped'))}</strong>
              <strong class="mono">${escapeHTML(runMetric(run, 'errorCount'))}</strong>
            </article>`;
          }).join('')}
        </section>

        <section class="ingestion-ledger">
          <div class="section-head"><h2>최근 실행 기록</h2><span class="section-kicker">INGESTION RUNS / ${ingestionRuns.length}</span></div>
          ${backendConnected && ingestionRuns.length ? `<div class="run-list">${ingestionRuns.map(run => `
            <article class="run-row">
              <time class="mono">${escapeHTML(formatDateTime(run.startedAt))}</time>
              <div><strong>${escapeHTML(sourceLabel(run.sourceType))}</strong><span>${escapeHTML(runStatusLabel(run.status))} · ${escapeHTML(run.trigger || '미확인')}</span></div>
              <dl>
                <div><dt>조회</dt><dd class="mono">${escapeHTML(String(run.recordsSeen ?? 0))}</dd></div>
                <div><dt>삽입</dt><dd class="mono">${escapeHTML(String(run.recordsInserted ?? 0))}</dd></div>
                <div><dt>갱신</dt><dd class="mono">${escapeHTML(String(run.recordsUpdated ?? 0))}</dd></div>
                <div><dt>건너뜀</dt><dd class="mono">${escapeHTML(String(run.recordsSkipped ?? 0))}</dd></div>
                <div><dt>오류</dt><dd class="mono">${escapeHTML(String(run.errorCount ?? 0))}</dd></div>
              </dl>
              ${(run.errors || []).length ? `<ul class="run-errors">${run.errors.slice(0, 3).map(error => `<li>${escapeHTML(error?.message || error?.error || error?.detail || '세부 오류 미제공')}</li>`).join('')}</ul>` : ''}
            </article>`).join('')}</div>` : `
            <div class="ingestion-empty">
              <strong>${backendConnected ? '저장된 수집 실행 기록이 없습니다.' : '라이브 수집 기록을 확인할 수 없습니다.'}</strong>
              <p>${backendConnected ? '수집기가 실행되면 실제 성공·오류 수치가 여기에 기록됩니다.' : '외부 API가 연결되기 전에는 미확인 상태로 남깁니다.'}</p>
            </div>`}
        </section>
      </div>`;
  }

  function renderNotFound() {
    main.innerHTML = `<div class="page-shell">${pageHead(t('notFound'))}<div class="empty-state"><strong>${escapeHTML(t('noTech'))}</strong><p><button class="text-button" data-route="home">${escapeHTML(t('backAll'))}</button></p></div></div>`;
  }

  function toggleCompare(id) {
    const exists = state.compare.includes(id);
    if (exists) state.compare = state.compare.filter(item => item !== id);
    else if (state.compare.length < 3) state.compare = [...state.compare, id];
    else return;
    saveCompare();
    updateCompareUI();
    renderRoute();
  }

  function updateCompareUI() {
    if (!compareDock || !compareSelection) return;
    const countText = `${state.compare.length} / 3`;
    if (compareCount) compareCount.textContent = countText;
    if (headerCompareCount) headerCompareCount.textContent = countText;

    const modeButton = document.querySelector('[data-action="toggle-compare-mode"]');
    if (modeButton) modeButton.setAttribute('aria-pressed', String(state.compareMode));

    const showDock = state.compareMode || state.compare.length > 0;
    compareDock.classList.toggle('is-open', showDock);
    compareDock.setAttribute('aria-hidden', String(!showDock));

    compareSelection.innerHTML = state.compare.map(id => {
      const tech = findTech(id);
      if (!tech) return '';
      return `<div class="compare-chip"><span>${escapeHTML(techName(tech))}</span><button data-remove-compare="${escapeHTML(id)}" aria-label="${escapeHTML(techName(tech))}">×</button></div>`;
    }).join('');

    const openButton = document.querySelector('[data-action="open-compare"]');
    if (openButton) openButton.disabled = state.compare.length < 2;
  }

  function openSearch() {
    state.searchIndex = 0;
    state.searchMatches = technologies.slice(0, 10);
    searchLayer.classList.add('is-open');
    searchLayer.setAttribute('aria-hidden', 'false');
    globalSearch.value = '';
    renderSearchResults();
    requestAnimationFrame(() => globalSearch.focus());
    document.body.style.overflow = 'hidden';
  }

  function closeSearch() {
    searchLayer.classList.remove('is-open');
    searchLayer.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  function updateSearch() {
    const query = normalize(globalSearch.value);
    state.searchIndex = 0;
    state.searchMatches = (query ? technologies.filter(tech => allSearchText(tech).includes(query)) : technologies).slice(0, 12);
    renderSearchResults();
  }

  function researchRequestStateFor(query) {
    return normalize(state.researchRequest.query) === normalize(query)
      ? state.researchRequest
      : { query, status: 'idle', message: '' };
  }

  function renderResearchRequestPanel(query, context) {
    const cleanQuery = String(query || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    const requestState = researchRequestStateFor(cleanQuery);
    const valid = cleanQuery.length >= 2;
    const pending = ['pending', 'researching', 'needs_review'].includes(requestState.status);
    const added = requestState.status === 'added';
    const message = requestState.message || (
      pending
        ? t('requestReceived')
        : added
          ? t('alreadyAdded')
          : t('unlisted')
    );
    return `<div class="research-request-empty" data-research-context="${escapeHTML(context)}">
      <span class="mono">UNLISTED TECHNOLOGY</span>
      <strong>${cleanQuery ? `‘${escapeHTML(cleanQuery)}’ ${escapeHTML(t('researchRequest'))}` : escapeHTML(t('noResults'))}</strong>
      <p>${escapeHTML(message)}</p>
      <p class="research-request-rule">${escapeHTML(t('requestRule'))}</p>
      <button class="button button-dark" data-request-research="${escapeHTML(cleanQuery)}" ${!valid || pending || added ? 'disabled' : ''}>
        ${escapeHTML(pending ? t('requestPending') : added ? t('listAdded') : valid ? t('requestGPT') : t('minQuery'))}
      </button>
      <small class="mono">NO OPENAI API KEY / MAX 5 REQUESTS PER HOUR</small>
    </div>`;
  }

  async function submitResearchRequest(query, button, context) {
    if (!query || button.disabled) return;
    const original = button.textContent;
    button.disabled = true;
    button.textContent = t('saving');
    try {
      const response = await fetch('/api/research-requests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tracker-Research-Request': '1'
        },
        body: JSON.stringify({ query })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || '조사 요청을 저장하지 못했습니다.');
      state.researchRequest = {
        query,
        status: payload.item?.status || 'pending',
        message: payload.detail || '조사 요청이 접수되었습니다.'
      };
      if (payload.created) pendingResearchCount = Number(pendingResearchCount || 0) + 1;
    } catch (error) {
      state.researchRequest = {
        query,
        status: 'error',
        message: error instanceof Error ? error.message : '조사 요청을 저장하지 못했습니다.'
      };
    }
    if (context === 'global') renderSearchResults();
    else {
      renderHome();
      updateCompareUI();
    }
    if (state.researchRequest.status === 'error') {
      const nextButton = document.querySelector(`[data-request-research="${CSS.escape(query)}"]`);
      if (nextButton) {
        nextButton.disabled = false;
        nextButton.textContent = original;
      }
    }
  }

  function renderSearchResults() {
    if (!state.searchMatches.length) {
      searchResults.innerHTML = renderResearchRequestPanel(globalSearch.value, 'global');
      return;
    }
    searchResults.innerHTML = state.searchMatches.map((tech, index) => `
      <button class="search-result ${index === state.searchIndex ? 'is-active' : ''}" data-search-tech="${escapeHTML(tech.id)}">
        <span class="search-result-identity"><strong>${escapeHTML(techName(tech))}</strong><span class="mono">${escapeHTML(tech.nameEn)}</span></span>
        <span class="search-result-category">${escapeHTML(groupLabel(groupOf(tech)))}</span>
        <span class="search-result-meta" title="${escapeHTML(tech.status)}">${escapeHTML(tech.status)}</span>
      </button>`).join('');
  }

  function moveSearch(delta) {
    if (!state.searchMatches.length) return;
    state.searchIndex = (state.searchIndex + delta + state.searchMatches.length) % state.searchMatches.length;
    renderSearchResults();
    searchResults.querySelector('.search-result.is-active')?.scrollIntoView({ block: 'nearest' });
  }

  function closeMobileNav() {
    const nav = document.querySelector('.primary-nav');
    const button = document.querySelector('[data-action="toggle-mobile-nav"]');
    nav?.classList.remove('is-open');
    button?.setAttribute('aria-expanded', 'false');
  }

  document.addEventListener('click', event => {
    const deepAnalysisSummary = event.target.closest('.deep-analysis > summary');
    if (deepAnalysisSummary) {
      window.setTimeout(() => {
        const details = deepAnalysisSummary.parentElement;
        if (!details?.open) return;
        const tech = findTech(details.dataset.deepAnalysis);
        if (tech) loadDeepAnalysis(tech, true);
      }, 0);
      return;
    }

    const routeButton = event.target.closest('[data-route]');
    if (routeButton) {
      navigate(routeButton.dataset.route);
      return;
    }

    const techButton = event.target.closest('[data-open-tech]');
    if (techButton) {
      navigate('detail', techButton.dataset.openTech);
      return;
    }

    const searchTech = event.target.closest('[data-search-tech]');
    if (searchTech) {
      closeSearch();
      navigate('detail', searchTech.dataset.searchTech);
      return;
    }

    const researchButton = event.target.closest('[data-request-research]');
    if (researchButton) {
      submitResearchRequest(
        researchButton.dataset.requestResearch,
        researchButton,
        researchButton.closest('[data-research-context]')?.dataset.researchContext || 'inline'
      );
      return;
    }

    const networkButton = event.target.closest('[data-network-focus]');
    if (networkButton) {
      state.networkFocus = networkButton.dataset.networkFocus;
      renderNetwork();
      return;
    }

    const compareButton = event.target.closest('[data-compare-tech]');
    if (compareButton) {
      toggleCompare(compareButton.dataset.compareTech);
      return;
    }

    const removeCompare = event.target.closest('[data-remove-compare]');
    if (removeCompare) {
      toggleCompare(removeCompare.dataset.removeCompare);
      return;
    }

    const groupButton = event.target.closest('[data-group]');
    if (groupButton) {
      state.group = groupButton.dataset.group;
      renderHome();
      updateCompareUI();
      return;
    }

    const statusButton = event.target.closest('[data-status-filter]');
    if (statusButton) {
      state.status = statusButton.dataset.statusFilter;
      renderHome();
      updateCompareUI();
      return;
    }

    const evidenceButton = event.target.closest('[data-evidence-filter]');
    if (evidenceButton) {
      state.evidence = evidenceButton.dataset.evidenceFilter;
      renderHome();
      updateCompareUI();
      return;
    }

    const updatedButton = event.target.closest('[data-updated-filter]');
    if (updatedButton) {
      state.updated = updatedButton.dataset.updatedFilter;
      renderHome();
      updateCompareUI();
      return;
    }

    const updateButton = event.target.closest('[data-update-filter]');
    if (updateButton) {
      state.updateFilter = updateButton.dataset.updateFilter;
      renderUpdates();
      updateCompareUI();
      return;
    }

    const action = event.target.closest('[data-action]')?.dataset.action;
    if (!action) return;

    if (action === 'open-search') openSearch();
    if (action === 'close-search') closeSearch();
    if (action === 'toggle-compare-mode') {
      state.compareMode = !state.compareMode;
      updateCompareUI();
    }
    if (action === 'clear-compare') {
      state.compare = [];
      saveCompare();
      updateCompareUI();
      renderRoute();
    }
    if (action === 'open-compare') navigate('compare');
    if (action === 'toggle-mobile-nav') {
      const nav = document.querySelector('.primary-nav');
      const button = document.querySelector('[data-action="toggle-mobile-nav"]');
      const open = !nav.classList.contains('is-open');
      nav.classList.toggle('is-open', open);
      button.setAttribute('aria-expanded', String(open));
    }
  });

  document.addEventListener('input', event => {
    if (event.target.id === 'inlineSearch') {
      state.query = event.target.value;
      const position = event.target.selectionStart;
      renderHome();
      updateCompareUI();
      requestAnimationFrame(() => {
        const input = document.querySelector('#inlineSearch');
        if (input) {
          input.focus();
          input.setSelectionRange(position, position);
        }
      });
    }
    if (event.target.id === 'globalSearch') updateSearch();
  });

  document.addEventListener('change', event => {
    if (event.target.id === 'sortSelect') {
      state.sort = event.target.value;
      renderHome();
      updateCompareUI();
    }
  });

  document.addEventListener('keydown', event => {
    const searchOpen = searchLayer.classList.contains('is-open');
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      if (searchOpen) closeSearch();
      else openSearch();
      return;
    }
    if (!searchOpen && event.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) {
      event.preventDefault();
      openSearch();
      return;
    }
    if (!searchOpen && event.key === 'Enter' && event.target.id === 'inlineSearch') {
      const requestButton = document.querySelector('[data-research-context="inline"] [data-request-research]');
      if (requestButton && !requestButton.disabled) {
        event.preventDefault();
        requestButton.click();
      }
      return;
    }
    if (!searchOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeSearch();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveSearch(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveSearch(-1);
    } else if (event.key === 'Enter') {
      const tech = state.searchMatches[state.searchIndex];
      if (tech) {
        event.preventDefault();
        closeSearch();
        navigate('detail', tech.id);
      } else {
        const requestButton = searchResults.querySelector('[data-request-research]');
        if (requestButton && !requestButton.disabled) {
          event.preventDefault();
          requestButton.click();
        }
      }
    }
  });

  searchLayer.addEventListener('click', event => {
    if (event.target === searchLayer) closeSearch();
  });

  window.addEventListener('hashchange', renderRoute);

  async function fetchJSON(url) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function loadResearchSummary() {
    try {
      const payload = await fetchJSON('/api/research-requests');
      pendingResearchCount = Number.isFinite(Number(payload?.active)) ? Number(payload.active) : null;
    } catch {
      pendingResearchCount = null;
    }
  }

  function backendProxyURL(path) {
    const target = new URL('/api/backend', window.location.origin);
    target.searchParams.set('path', path);
    return target.href;
  }

  async function bootstrap() {
    await loadResearchSummary();
    try {
      const runtime = await fetchJSON('/api/runtime-config');
      apiBaseURL = runtime?.configured && typeof runtime.apiBaseUrl === 'string' ? runtime.apiBaseUrl : '';
      if (!apiBaseURL) {
        backendState = 'unconfigured';
        technologies = [...editorialSnapshot];
        return;
      }

      const [health, payload, runsPayload] = await Promise.all([
        fetchJSON(backendProxyURL('/api/v1/health')),
        fetchJSON(backendProxyURL('/api/v1/technologies?include_live=true&limit_per_type=8')),
        fetchJSON(backendProxyURL('/api/v1/ingestion-runs?limit=30'))
      ]);
      if (health?.status !== 'ok' || health?.database !== 'ok') throw new Error('Health check failed');
      if (!Array.isArray(payload?.items) || !Array.isArray(runsPayload?.items)) throw new Error('Unexpected API response');

      technologies = payload.items;
      syncAIRelationships();
      ingestionStatus = payload.ingestion || {};
      ingestionRuns = runsPayload.items;
      backendConnected = true;
      backendState = 'live';
      state.compare = loadCompare();
      const footerStatus = document.querySelector('#footerDataStatus');
      if (footerStatus) footerStatus.textContent = 'LIVE DATABASE / AUTOMATED EVIDENCE';
    } catch (error) {
      backendConnected = false;
      backendState = 'error';
      technologies = [...editorialSnapshot];
      ingestionStatus = {};
      ingestionRuns = [];
      const footerStatus = document.querySelector('#footerDataStatus');
      if (footerStatus) footerStatus.textContent = 'EDITORIAL SNAPSHOT / VERIFIED 2026-08-21';
      console.info('Saved verified snapshot is active.', error);
    } finally {
      if (backendState === 'unconfigured') {
        const footerStatus = document.querySelector('#footerDataStatus');
        if (footerStatus) footerStatus.textContent = 'EDITORIAL SNAPSHOT / VERIFIED 2026-08-21';
      }
      if (!location.hash) history.replaceState(null, '', '#/');
      renderRoute();
    }
  }

  bootstrap();
})();
