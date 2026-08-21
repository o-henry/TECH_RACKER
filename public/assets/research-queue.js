(() => {
  'use strict';

  document.addEventListener('click', async event => {
    const publishButton = event.target.closest('[data-deep-analysis-publish]');
    if (publishButton && !publishButton.disabled) {
      const row = publishButton.closest('[data-deep-analysis-request]');
      if (!row) return;
      const textarea = row.querySelector('[data-deep-analysis-result]');
      const original = publishButton.textContent;
      let result;
      try {
        result = JSON.parse(textarea.value);
      } catch {
        publishButton.textContent = 'JSON 형식 오류';
        window.setTimeout(() => { publishButton.textContent = original; }, 1800);
        return;
      }
      publishButton.disabled = true;
      publishButton.textContent = '검증 중';
      try {
        const response = await fetch('/api/deep-analysis', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'X-Tracker-Deep-Analysis': '1'
          },
          body: JSON.stringify({
            id: row.dataset.deepAnalysisRequest,
            status: 'completed',
            verifiedThrough: row.querySelector('[data-deep-analysis-verified]')?.value || '',
            analysisModel: row.querySelector('[data-deep-analysis-model]')?.value || 'CHATGPT SCHEDULED ANALYSIS',
            result
          })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.detail || '완료 저장 실패');
        row.querySelector('[data-deep-analysis-status]').textContent = 'COMPLETED';
        publishButton.textContent = '저장 완료';
      } catch (error) {
        publishButton.textContent = error instanceof Error ? error.message : '저장 실패';
        window.setTimeout(() => { publishButton.textContent = original; }, 2200);
        return;
      } finally {
        publishButton.disabled = false;
      }
      return;
    }

    const deepButton = event.target.closest('[data-deep-analysis-action]');
    if (deepButton && !deepButton.disabled) {
      const row = deepButton.closest('[data-deep-analysis-request]');
      if (!row) return;
      const original = deepButton.textContent;
      deepButton.disabled = true;
      deepButton.textContent = '처리 중';
      try {
        const response = await fetch('/api/deep-analysis', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'X-Tracker-Deep-Analysis': '1'
          },
          body: JSON.stringify({
            id: row.dataset.deepAnalysisRequest,
            status: deepButton.dataset.deepAnalysisAction
          })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.detail || '상태 변경 실패');
        row.querySelector('[data-deep-analysis-status]').textContent = String(payload.item.status).toUpperCase();
      } catch (error) {
        deepButton.textContent = error instanceof Error ? error.message : '처리 실패';
        window.setTimeout(() => { deepButton.textContent = original; }, 1800);
        return;
      } finally {
        deepButton.disabled = false;
      }
      deepButton.textContent = original;
      return;
    }

    const button = event.target.closest('[data-request-action]');
    if (!button || button.disabled) return;
    const row = button.closest('[data-research-request]');
    if (!row) return;
    const original = button.textContent;
    button.disabled = true;
    button.textContent = '처리 중';
    try {
      const response = await fetch('/api/research-requests', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Tracker-Research-Request': '1'
        },
        body: JSON.stringify({
          id: row.dataset.researchRequest,
          status: button.dataset.requestAction
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || '상태 변경 실패');
      row.querySelector('[data-request-status]').textContent = String(payload.item.status).toUpperCase();
      if (['added', 'rejected'].includes(payload.item.status)) row.remove();
    } catch (error) {
      button.textContent = error instanceof Error ? error.message : '처리 실패';
      window.setTimeout(() => { button.textContent = original; }, 1800);
      return;
    } finally {
      button.disabled = false;
    }
    button.textContent = original;
  });
})();
