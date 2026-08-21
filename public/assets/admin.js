(() => {
  'use strict';

  const overall = document.querySelector('#adminOverall');
  const overallLabel = document.querySelector('#adminOverallLabel');
  const connection = document.querySelector('#adminConnection');
  const actionMessage = document.querySelector('#adminActionMessage');
  const runList = document.querySelector('#adminRunList');
  let connected = false;

  function escapeHTML(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function formatDateTime(value) {
    if (!value) return '미확인';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '미확인';
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    }).format(parsed);
  }

  function setOverall(state, label) {
    overall.dataset.adminState = state;
    overallLabel.textContent = label.toUpperCase();
  }

  function setControls(enabled) {
    document.querySelectorAll('[data-admin-action]').forEach(button => {
      button.disabled = !enabled;
    });
  }

  function setQueue(queue = {}) {
    const values = {
      candidates: queue.candidates,
      analysis: queue.analysisPending,
      review: queue.reviewPending,
      published: queue.publishedToday
    };
    Object.entries(values).forEach(([key, value]) => {
      const node = document.querySelector(`[data-queue="${key}"]`);
      node.textContent = Number.isFinite(Number(value)) ? String(value) : '—';
    });
  }

  function setPipeline(pipeline = {}) {
    ['collect', 'filter', 'analyze', 'publish'].forEach(key => {
      const node = document.querySelector(`[data-pipeline-status="${key}"]`);
      const value = String(pipeline[key] || 'unknown').toUpperCase();
      node.textContent = value;
      node.dataset.state = value.toLowerCase();
    });
  }

  function renderRuns(runs = []) {
    if (!Array.isArray(runs) || !runs.length) {
      runList.innerHTML = '<div class="admin-run-empty">저장된 실행 기록이 없습니다.</div>';
      return;
    }
    runList.innerHTML = runs.slice(0, 12).map(run => {
      const details = run.details && typeof run.details === 'object'
        ? Object.entries(run.details).slice(0, 3).map(([key, value]) => `${key} ${String(value)}`).join(' · ')
        : '';
      return `<article class="admin-run-row">
        <time class="mono">${escapeHTML(formatDateTime(run.createdAt))}</time>
        <strong class="mono">${escapeHTML(String(run.action || 'unknown').replaceAll('_', ' '))}</strong>
        <span>${escapeHTML(details || '세부 정보 없음')}</span>
      </article>`;
    }).join('');
  }

  function renderUnconfigured() {
    connected = false;
    setOverall('unconfigured', 'not running');
    setControls(false);
    setQueue();
    setPipeline();
    renderRuns();
    connection.innerHTML = `
      <div class="admin-connection-state" data-state="unconfigured">
        <span class="connection-marker"></span>
        <div>
          <strong>추가 비용이 생기는 외부 서버는 설정하지 않았습니다.</strong>
          <p>현재 추가 과금은 0원이며 사용자가 입력할 API 키도 없습니다. 무료로 실행하려면 본인 컴퓨터가 켜져 있는 동안 로컬 수집기를 사용하고, ChatGPT에서는 전용 도구 연결과 시간당 예약 작업을 한 번만 설정합니다. 컴퓨터가 꺼져 있을 때의 24시간 실행은 보장하지 않습니다.</p>
        </div>
        <span class="mono">₩0 ADD-ON</span>
      </div>`;
    actionMessage.textContent = '비용 승인이 없는 외부 서비스는 연결하지 않습니다.';
  }

  function renderError(detail) {
    connected = false;
    setOverall('error', 'connection error');
    setControls(false);
    setQueue();
    setPipeline();
    renderRuns();
    connection.innerHTML = `
      <div class="admin-connection-state" data-state="error">
        <span class="connection-marker"></span>
        <div><strong>자동화 백엔드 응답을 확인하지 못했습니다.</strong><p>${escapeHTML(detail || '연결, 인증 또는 상태 응답을 확인하십시오.')}</p></div>
        <span class="mono">BLOCKED</span>
      </div>`;
    actionMessage.textContent = '오류가 해소될 때까지 제어 요청이 차단됩니다.';
  }

  function renderLive(result) {
    connected = true;
    const automation = result.automation || {};
    const chatgpt = result.chatgpt || {};
    setOverall(automation.paused ? 'paused' : 'live', automation.paused ? 'paused' : 'connected');
    setControls(true);
    setQueue(result.queue || {});
    setPipeline(result.pipeline || {});
    renderRuns(result.recentRuns || []);
    connection.innerHTML = `
      <div class="admin-connection-state" data-state="${automation.paused ? 'paused' : 'live'}">
        <span class="connection-marker"></span>
        <div>
          <strong>${automation.paused ? '자동화가 일시 정지되어 있습니다.' : '수집 백엔드가 연결되어 있습니다.'}</strong>
          <p>마지막 상태 확인 ${escapeHTML(formatDateTime(result.checkedAt))} · GPT ${chatgpt.connected ? `최근 연결 ${escapeHTML(formatDateTime(chatgpt.lastCheckedAt))}` : '연결 대기'} · 예약 간격 ${escapeHTML(String(chatgpt.cadenceMinutes || 60))}분</p>
        </div>
        <span class="mono">${automation.paused ? 'PAUSED' : 'LIVE'}</span>
      </div>`;
    actionMessage.textContent = '제어 요청은 소유자 인증과 서버 전용 토큰을 모두 통과한 경우에만 실행됩니다.';
  }

  async function refresh() {
    try {
      const response = await fetch('/api/admin', { headers: { Accept: 'application/json' }, cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 503 && payload.configured === false) return renderUnconfigured();
      if (!response.ok || !payload.configured || !payload.result) return renderError(payload.detail);
      renderLive(payload.result);
    } catch {
      renderError('네트워크 또는 응답 형식 오류');
    }
  }

  async function runAction(action, button) {
    if (!connected || button.disabled) return;
    const original = button.textContent;
    button.disabled = true;
    button.textContent = '처리 중';
    actionMessage.textContent = '서버에서 권한과 현재 상태를 확인하고 있습니다.';
    try {
      const response = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Tracker-Admin-Request': '1' },
        body: JSON.stringify({ action })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || '제어 요청 실패');
      actionMessage.textContent = '요청이 접수되었습니다. 최신 상태를 다시 확인합니다.';
      await refresh();
    } catch (error) {
      actionMessage.textContent = error instanceof Error ? error.message : '제어 요청을 완료하지 못했습니다.';
    } finally {
      button.textContent = original;
      button.disabled = !connected;
    }
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-admin-action]');
    if (button) runAction(button.dataset.adminAction, button);
  });

  refresh();
})();
