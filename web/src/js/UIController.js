class UIController {
  static VALIDATION = {
    START_MIN: 3, START_MAX: 10,
    SEG_MIN: 0.1, SEG_MAX: 30,
    FINISH_MIN: 5, FINISH_MAX: 70,
  };
  static TIMING = {
    TOAST: 3000, DEBOUNCE: 300, SCROLL_RESTORE: 0,
    ANIMATION: 500,
  };
  static MAX_COMPARE = 7;
  static TAB_KEYS = { '1': 'dashboard', '2': 'prediction', '3': 'analysis', '4': 'compare', '5': 'explore', '6': 'trackmap' };

  constructor() {
    this.ds = new DataStore(RAW_DATA);
    this.analyzer = new PlayerAnalyzer(this.ds);
    this.predModel = new PredictionModel();
    this.charts = new ChartManager();
    this.table = new TableRenderer(this.ds);
    this.trackMap = new TrackMapRenderer(this.ds, this.analyzer);

    this._explorePage = 1;
    this._exploreSortBy = 'date';
    this._exploreSortOrder = 'desc';
    this._selectedModel = 'simple';
    this._lazyLoaded = {};
    this._elCache = {};
    this._tabScrollPos = {};
  }

  // ─── Luxon 날짜 포맷 ──────────────────────────────────────
  static fmtDate(d) {
    if (!d || d === 'unknown') return '-';
    if (typeof luxon !== 'undefined') {
      // 25.01.26 → 2025년 1월 26일
      const dt = luxon.DateTime.fromFormat(d, 'yy.MM.dd');
      if (dt.isValid) return dt.toFormat('yyyy년 M월 d일');
      // ISO 형식 시도
      const dt2 = luxon.DateTime.fromISO(d);
      if (dt2.isValid) return dt2.toFormat('yyyy년 M월 d일');
    }
    return d;
  }

  static fmtDateShort(d) {
    if (!d || d === 'unknown') return '-';
    if (typeof luxon !== 'undefined') {
      const dt = luxon.DateTime.fromFormat(d, 'yy.MM.dd');
      if (dt.isValid) return dt.toFormat('M/d');
    }
    return d;
  }

  static fmtDateRelative(d) {
    if (!d || d === 'unknown') return '';
    if (typeof luxon !== 'undefined') {
      const dt = luxon.DateTime.fromFormat(d, 'yy.MM.dd');
      if (dt.isValid) return dt.toRelative({ locale: 'ko' }) || '';
    }
    return '';
  }

  static errorHTML(title, msg) {
    return `<div class="error-box"><span class="error-icon">⚠️</span><div><strong>${title}</strong><br>${msg}</div></div>`;
  }

  // ─── Lazy loading 유틸 ────────────────────────────────────
  async #loadScript(name, src) {
    if (this._lazyLoaded[name]) return;
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = () => { this._lazyLoaded[name] = true; resolve(); };
      script.onerror = () => {
        // _lazyLoaded 플래그 미설정 → 재시도 가능
        script.remove();
        reject(new Error('Failed to load ' + src));
      };
      document.head.appendChild(script);
    });
  }

  async #ensureCaptureLibs() {
    if (typeof html2canvas === 'undefined') await this.#loadScript('html2canvas', 'js/html2canvas.min.js');
    if (typeof window.jspdf === 'undefined') await this.#loadScript('jspdf', 'js/jspdf.umd.min.js');
  }

  #el(id) {
    if (!this._elCache[id]) {
      this._elCache[id] = document.getElementById(id);
    }
    return this._elCache[id];
  }

  #populatePlayerSelect(selectId, genderFilter, natFilter) {
    const sel = this.#el(selectId);
    if (!sel) return;
    const players = this.ds.getPlayersFiltered(genderFilter || '', natFilter || '');
    const prev = sel.value;
    const { sortedNats, groups } = this.ds.groupByNat(players);

    let html = `<option value="">선수 선택</option>`;
    for (const nat of sortedNats) {
      html += `<optgroup label="\u25CF ${nat} \u2014 ${groups[nat].length}명">`;
      html += groups[nat].map(p => {
        return `<option value="${p.name}">${p.name}</option>`;
      }).join('');
      html += '</optgroup>';
    }
    sel.innerHTML = html;
    if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;
  }

  #populateFilterDropdowns(prefix) {
    const genderSel = this.#el(`${prefix}-gender-filter`);
    const natSel = this.#el(`${prefix}-nat-filter`);
    const genderLabels = { M: '남자', F: '여자', MF: '혼성' };

    if (genderSel) {
      const genders = this.ds.getGenderList();
      genderSel.innerHTML = '<option value="">전체 성별</option>' +
        genders.map(g => {
          const cnt = this.ds.getPlayersFiltered(g, '').length;
          return `<option value="${g}">${genderLabels[g] || g} (${cnt})</option>`;
        }).join('');
    }

    if (natSel) {
      const nats = this.ds.getNatList();
      natSel.innerHTML = '<option value="">전체 국가</option>' +
        nats.map(n => {
          const cnt = this.ds.getPlayersFiltered('', n).length;
          return `<option value="${n}">${n} (${cnt})</option>`;
        }).join('');
    }
  }

  #bindPlayerFilterEvents(prefix) {
    const genderSel = this.#el(`${prefix}-gender-filter`);
    const natSel = this.#el(`${prefix}-nat-filter`);

    const refresh = () => {
      const g = genderSel ? genderSel.value : '';
      const n = natSel ? natSel.value : '';
      this.#populatePlayerSelect(`${prefix}-player-select`, g, n);
      // 필터 상태 저장
      try { sessionStorage.setItem(`skel-filter-${prefix}`, JSON.stringify({ g, n })); } catch(e) {}
    };

    if (genderSel) genderSel.addEventListener('change', refresh);
    if (natSel) natSel.addEventListener('change', refresh);
  }

  #restoreFilters() {
    for (const prefix of ['analysis', 'trackmap']) {
      try {
        const saved = sessionStorage.getItem(`skel-filter-${prefix}`);
        if (!saved) continue;
        const { g, n } = JSON.parse(saved);
        const genderSel = this.#el(`${prefix}-gender-filter`);
        const natSel = this.#el(`${prefix}-nat-filter`);
        if (genderSel && g) genderSel.value = g;
        if (natSel && n) natSel.value = n;
        this.#populatePlayerSelect(`${prefix}-player-select`, g || '', n || '');
      } catch(e) {}
    }
  }

  init() {
    // Notyf 토스트 알림 초기화
    if (typeof Notyf !== 'undefined') {
      this.notyf = new Notyf({ duration: UIController.TIMING.TOAST, position: { x: 'right', y: 'top' }, dismissible: true, ripple: true });
    }
    for (const prefix of ['analysis', 'trackmap']) {
      this.#populateFilterDropdowns(prefix);
      this.#populatePlayerSelect(`${prefix}-player-select`);
      this.#bindPlayerFilterEvents(prefix);
    }
    // 필터 상태 복원
    this.#restoreFilters();
    this.#populateExploreFilters();

    this.#bindTabEvents();
    this.#bindPredictionEvents();
    this.#bindAnalysisEvents();
    this.#bindCompareEvents();
    this.#bindExploreEvents();
    this.#bindTrackMapEvents();

    this.#toggleModelInputs();
    this.#renderPredictionTab();
    this.#renderCompareTab();
    this.#renderExploreTab();
    this._trackMapRendered = false;

    // 스크롤 시 헤더 그림자 강화
    const header = document.querySelector('header');
    if (header) {
      window.addEventListener('scroll', () => {
        header.classList.toggle('scrolled', window.scrollY > 10);
      }, { passive: true });
    }


    // 키보드 단축키 시스템
    document.addEventListener('keydown', (e) => {
      // 입력 필드에서는 단축키 무시
      const tag = e.target.tagName;
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable;

      // Esc: 모달/도움말 닫기 (항상 동작)
      if (e.key === 'Escape') {
        const helpModal = document.getElementById('shortcut-help-modal');
        if (helpModal && !helpModal.classList.contains('hidden')) {
          UIController.closeModal(helpModal, document.getElementById('shortcut-help-overlay'));
          return;
        }
        const modal = document.getElementById('explore-modal');
        const overlay = document.getElementById('explore-overlay');
        if (modal && !modal.classList.contains('hidden')) {
          UIController.closeModal(modal, overlay);
        }
        return;
      }

      // 좌우 화살표: 탭 전환 (포커스가 탭 버튼일 때)
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && e.target.classList.contains('tab-btn')) {
        const tabs = [...document.querySelectorAll('.tab-btn')];
        const idx = tabs.indexOf(e.target);
        const next = e.key === 'ArrowRight' ? (idx + 1) % tabs.length : (idx - 1 + tabs.length) % tabs.length;
        tabs[next].focus();
        tabs[next].click();
        return;
      }

      if (isInput) return; // 입력 필드에선 이하 단축키 무시

      // ? : 단축키 도움말 토글
      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault();
        this.#toggleShortcutHelp();
        return;
      }

      // 1~5: 탭 전환
      const tabKeys = UIController.TAB_KEYS;
      if (tabKeys[e.key]) {
        e.preventDefault();
        const btn = document.querySelector(`.tab-btn[data-tab="${tabKeys[e.key]}"]`);
        if (btn) btn.click();
        return;
      }


      // Ctrl+E: CSV 내보내기
      if (e.ctrlKey && (e.key === 'e' || e.key === 'E')) {
        e.preventDefault();
        this.exportCSV();
        return;
      }

      // Ctrl+Shift+E: XLSX 내보내기
      if (e.ctrlKey && e.shiftKey && (e.key === 'e' || e.key === 'E')) {
        e.preventDefault();
        this.exportXLSX();
        return;
      }

      // J: JSON 내보내기
      if (e.key === 'j' || e.key === 'J') {
        e.preventDefault();
        this.exportJSON();
        return;
      }

      // R: 예측 실행 (예측 탭 활성 시)
      if ((e.key === 'r' || e.key === 'R') && document.getElementById('tab-prediction')?.classList.contains('active')) {
        e.preventDefault();
        document.getElementById('pred-run-btn')?.click();
        return;
      }
    });

    // URL 해시 상태 복원/저장
    this.#restoreTabState();

    // html2canvas 캡처 버튼
    this.#bindCaptureButtons();
    // jsPDF PDF 내보내기
    this.#bindPdfButtons();
    // Tippy.js 툴팁 초기화
    this.#initTippy();

    // Service Worker 등록 (PWA)
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }

    window._ui = this;
  }


  // ─── Tab 전환 ──────────────────────────────────────────────
  #bindTabEvents() {
    const tabOrder = ['prediction', 'analysis', 'compare', 'explore', 'trackmap'];
    let prevTabIdx = 0;

    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        // 이미 활성 탭이면 아무것도 하지 않음
        if (btn.classList.contains('active')) return;
        const newIdx = tabOrder.indexOf(tab);
        // 현재 탭 스크롤 위치 저장
        const currentTab = document.querySelector('.tab-btn.active');
        if (currentTab) this._tabScrollPos[currentTab.dataset.tab] = window.scrollY;
        document.querySelectorAll('.tab-btn').forEach(b => {
          b.classList.remove('active');
          b.setAttribute('aria-selected', 'false');
        });
        document.querySelectorAll('.tab-content').forEach(s => {
          s.classList.remove('active');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
        // 비활성 탭 차트 메모리 정리
        this.#destroyInactiveCharts(tab);
        const section = document.getElementById(`tab-${tab}`);
        if (section) {
          section.classList.add('active');
          // 스크롤 위치 복원
          const savedScroll = this._tabScrollPos[tab] || 0;
          requestAnimationFrame(() => window.scrollTo(0, savedScroll));
          // 트랙맵 탭 전환 시 초기 렌더링 또는 SVG 높이 재계산
          if (tab === 'trackmap' && this.trackMap) {
            if (!this._trackMapRendered) {
              requestAnimationFrame(() => {
                this.trackMap.render('track-map-container');
                this._trackMapRendered = true;
              });
            } else {
              requestAnimationFrame(() => this.trackMap._updateSvgHeight());
            }
          }
        }
        prevTabIdx = newIdx >= 0 ? newIdx : 0;
        this.#saveTabState();
      });
    });
  }

  // ─── Tab 1: 예측 모델 ────────────────────────────────────
  #renderPredictionTab() {
    const resultEl = this.#el('pred-result');
    const compareEl = document.getElementById('pred-model-compare');

    // 성별 변경 시 기존 결과만 초기화, 예측 실행 버튼을 눌러야 결과 표시
    if (compareEl) compareEl.style.display = 'none';
    if (resultEl) resultEl.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🛷</div><div class="empty-state-text">성별을 선택하고 Start Time을 입력한 뒤 예측 실행 버튼을 누르세요</div></div>';
  }

  #renderModelCard(model, type) {
    const cls = this._selectedModel === type ? 'model-card-active' : 'model-card-inactive';
    const r2Display = model.r2 != null ? model.r2.toFixed(3) : '-';
    const badge = model.reliable
      ? '<span style="color:#2e7d32;font-size:0.8em">✅ 신뢰</span>'
      : '<span style="color:#c62828;font-size:0.8em">⚠️ 부족</span>';

    if (type === 'segment') {
      const segN = model.n || 0;
      return `
        <div class="stat-card ${cls}">
          <div class="stat-value" style="font-size:1em">${_esc(model.name)}</div>
          <div class="stat-label">${_esc(model.desc)}</div>
          <div style="margin-top:0.3rem">데이터: ${segN}개 ${badge}</div>
        </div>
      `;
    }

    const cvLine = model.cv
      ? `<div style="font-size:0.75em;color:var(--c-text-muted)">CV: MAE=${model.cv.cvMAE.toFixed(3)} | RMSE=${model.cv.cvRMSE.toFixed(3)} | R²=${model.cv.cvR2.toFixed(3)}</div>`
      : '';

    return `
      <div class="stat-card ${cls}">
        <div class="stat-value" style="font-size:1em">${_esc(model.name)}</div>
        <div class="stat-label">${_esc(model.desc)}</div>
        <div style="margin-top:0.3rem">R² = <strong>${r2Display}</strong> | n=${model.n} ${badge}</div>
        <div style="font-size:0.75em;color:var(--c-text-muted)">오차범위: ±${(model.residualStd||0).toFixed(3)}초</div>
        ${cvLine}
      </div>
    `;
  }

  #toggleModelInputs() {
    const panels = [
      { el: document.getElementById('pred-simple-inputs'), model: 'simple' },
      { el: document.getElementById('pred-poly-inputs'), model: 'poly' },
      { el: document.getElementById('pred-multi-inputs'), model: 'multi' },
      { el: document.getElementById('pred-segment-inputs'), model: 'segment' },
      { el: document.getElementById('pred-ensemble-inputs'), model: 'ensemble' },
      { el: document.getElementById('pred-general-inputs'), model: 'general' },
      { el: document.getElementById('pred-xgb-pre-inputs'), model: 'xgb_pre' },
      { el: document.getElementById('pred-xgb-live-inputs'), model: 'xgb_live' },
    ];

    for (const { el, model } of panels) {
      if (!el) continue;
      if (this._selectedModel === model) {
        el.classList.remove('hidden');
      } else {
        el.classList.add('hidden');
      }
    }
  }

  #bindPredictionEvents() {
    const btn = document.getElementById('pred-run-btn');
    if (btn) btn.addEventListener('click', () => this.#onPredictRun());

    // 성별 변경 시 탭 갱신
    const genderSel = document.getElementById('pred-gender-filter');
    if (genderSel) genderSel.addEventListener('change', () => this.#renderPredictionTab());

    // 모델 드롭다운 전환
    const modelSel = document.getElementById('pred-model-select');
    if (modelSel) modelSel.addEventListener('change', (e) => {
      this._selectedModel = e.target.value;
      this.#toggleModelInputs();
      this.#clearPredictionResult();
      this.#renderPredictionTab();
    });
  }

  #clearPredictionResult() {
    if (this.charts) this.charts._destroy('pred-chart');
    const chartEl = document.getElementById('pred-chart');
    if (chartEl) chartEl.style.display = 'none';
    const resultEl = document.getElementById('pred-result');
    if (resultEl) resultEl.innerHTML = '';
  }

  #onPredictRun() {
    const resultEl = this.#el('pred-result');
    if (!resultEl) return;

    const gender = this.#el('pred-gender-filter')?.value || '';
    if (!gender) {
      resultEl.innerHTML = UIController.errorHTML('성별 미선택', '성별을 선택해주세요.');
      return;
    }

    const allRecords = this.ds.getAllRecords ? this.ds.getAllRecords() : this.ds.records || [];
    const filtered = allRecords.filter(r => r.gender === gender);
    const okRecords = filtered.filter(r => r.status === 'OK' && r.finish != null);

    if (okRecords.length < 3) {
      resultEl.innerHTML = UIController.errorHTML('데이터 부족', '해당 성별의 데이터가 부족합니다.');
      return;
    }

    this.predModel.trainAll(okRecords);

    // 통계 요약 (선수 대신 전체)
    const finishes = okRecords.map(r => parseFloat(r.finish)).filter(v => v > 0);
    const stats = {
      count: okRecords.length,
      best: finishes.length ? Math.min(...finishes) : 0,
      avg: finishes.length ? finishes.reduce((s, v) => s + v, 0) / finishes.length : 0,
    };

    switch (this._selectedModel) {
      case 'simple':
        this.#runSimplePrediction(okRecords, stats, resultEl);
        break;
      case 'multi':
        this.#runMultiPrediction(okRecords, resultEl, null);
        break;
      case 'segment':
        this.#runSegmentPrediction(okRecords, resultEl);
        break;
      case 'general':
        this.#runGeneralMLR(okRecords, resultEl);
        break;
      case 'xgb_pre':
        this.#runXGBoostPre(okRecords, resultEl);
        break;
      case 'xgb_live':
        this.#runXGBoostLive(okRecords, resultEl);
        break;
      default:
        this.#runSimplePrediction(okRecords, stats, resultEl);
    }

    // 트랙 인사이트 추가
    const insightHTML = this.#getTrackInsightHTML(okRecords);
    if (insightHTML) resultEl.insertAdjacentHTML('beforeend', insightHTML);

    if (this.notyf && resultEl.querySelector('.stat-card')) this.notyf.success('예측 완료');
    resultEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  #getTrackInsightHTML(okRecords) {
    // 구간 시간 계산 (누적 → 구간별)
    const sectionLabels = ['Start→Int.1', 'Int.1→Int.2', 'Int.2→Int.3', 'Int.3→Int.4', 'Int.4→Finish'];
    const sectionData = [[], [], [], [], []];

    for (const r of okRecords) {
      const st = parseFloat(r.start_time);
      const i1 = parseFloat(r.int1);
      const i2 = parseFloat(r.int2);
      const i3 = parseFloat(r.int3);
      const i4 = parseFloat(r.int4);
      const fin = parseFloat(r.finish);
      if ([st, i1, i2, i3, i4, fin].some(v => !(v > 0))) continue;
      const secs = [i1 - st, i2 - i1, i3 - i2, i4 - i3, fin - i4];
      if (secs.some(v => v <= 0 || v > 20)) continue;
      secs.forEach((v, idx) => sectionData[idx].push(v));
    }

    if (sectionData.every(d => d.length < 3)) return '';

    // 각 구간 통계
    const secStats = sectionData.map((vals, idx) => {
      if (vals.length < 3) return null;
      const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
      const std = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
      return { label: sectionLabels[idx], mean, std, n: vals.length };
    });

    // 가장 변동 큰 구간
    let maxStdSec = null;
    for (const s of secStats) {
      if (s && (!maxStdSec || s.std > maxStdSec.std)) maxStdSec = s;
    }

    let html = '<div class="track-insight-panel" style="margin-top:1.2rem;padding:1rem;background:var(--c-surface,#f8f9fa);border-radius:12px;border:1px solid var(--c-border,#e0e0e0)">';
    html += '<h4 style="margin:0 0 0.8rem 0;font-size:0.95rem">🏔️ 트랙 인사이트</h4>';

    // 트랙 특성
    html += '<div style="font-size:0.82rem;color:var(--c-text-muted,#666);margin-bottom:0.8rem;line-height:1.6">';
    html += '<strong>트랙 특성:</strong><br>';
    html += '• 총 길이 약 1,200m, 커브 16개<br>';
    html += '• 고도차 118m (930.5m → 812.2m)<br>';
    html += '• 가장 급한 커브: C2, C4 (R=17m)<br>';
    html += '• 가장 완만한 커브: C10 (R=400m), C11 (R=500m)';
    html += '</div>';

    // 가장 변동 큰 구간
    if (maxStdSec) {
      html += '<div style="font-size:0.82rem;padding:0.6rem;background:var(--c-primary-50,#e3f2fd);border-radius:8px;margin-bottom:0.6rem">';
      html += `📈 <strong>가장 변동 큰 구간:</strong> ${maxStdSec.label} (표준편차 ${maxStdSec.std.toFixed(3)}s)`;
      html += '</div>';
    }

    // 구간별 평균 요약
    html += '<details style="font-size:0.8rem;margin-top:0.4rem"><summary style="cursor:pointer;font-weight:600">구간별 평균 시간</summary>';
    html += '<table style="width:100%;margin-top:0.4rem;font-size:0.78rem;border-collapse:collapse">';
    html += '<thead><tr><th style="text-align:left;padding:3px 6px">구간</th><th>평균</th><th>표준편차</th><th>데이터</th></tr></thead><tbody>';
    for (const s of secStats) {
      if (!s) continue;
      const isMax = s === maxStdSec;
      html += `<tr${isMax ? ' style="background:var(--c-primary-50,#e3f2fd);font-weight:600"' : ''}>`;
      html += `<td style="padding:3px 6px">${s.label}</td>`;
      html += `<td style="text-align:center">${s.mean.toFixed(3)}s</td>`;
      html += `<td style="text-align:center">±${s.std.toFixed(3)}s</td>`;
      html += `<td style="text-align:center">${s.n}</td></tr>`;
    }
    html += '</tbody></table></details>';
    html += '</div>';
    return html;
  }

  #runSimplePrediction(okRecords, stats, resultEl) {
    const input = document.getElementById('pred-start-input');
    const startVal = input ? parseFloat(input.value) : NaN;

    if (isNaN(startVal)) {
      resultEl.innerHTML = UIController.errorHTML('Start Time 입력 필요', '스타트 시간을 입력해주세요.');
      return;
    }
    if (startVal < UIController.VALIDATION.START_MIN || startVal > UIController.VALIDATION.START_MAX) {
      resultEl.innerHTML = UIController.errorHTML('Start Time 범위 초과', `입력값: ${startVal.toFixed(3)}초<br>올바른 범위: 3.0 ~ 10.0초`);
      return;
    }

    if (!this.predModel.isReliable()) {
      resultEl.innerHTML = '<p class="text-danger">⚠️ 단순 선형 모델: 데이터 부족 또는 낮은 상관관계</p>';
      return;
    }

    const pred = this.predModel.predict(startVal);
    const bs = this.predModel.bootstrapPredict(okRecords, 'simple', { startTime: startVal });
    resultEl.innerHTML = `
      <h3>📈 단순 선형 회귀 결과</h3>
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-value">${stats ? stats.count : '-'}</div><div class="stat-label">기록수</div></div>
        <div class="stat-card"><div class="stat-value">${stats ? stats.best.toFixed(3) : '-'}</div><div class="stat-label">최고(초)</div></div>
        <div class="stat-card"><div class="stat-value">${(this.predModel.getR2() || 0).toFixed(3)}</div><div class="stat-label">R²</div></div>
        ${pred.leverage != null ? `<div class="stat-card"><div class="stat-value">${pred.leverage.toFixed(3)}</div><div class="stat-label">Leverage</div></div>` : ''}
      </div>
      <div class="result-highlight">
        <p>스타트 시간 <strong>${startVal.toFixed(3)}초</strong> 입력 시</p>
        <p class="pred-value">예측 Finish: <strong>${pred.predicted.toFixed(3)}초</strong></p>
        <p style="color:var(--c-text-muted)">Leverage CI: ${pred.lower.toFixed(3)} ~ ${pred.upper.toFixed(3)}초</p>
        ${bs ? `<p style="color:var(--c-text-muted)">Bootstrap 95% CI: ${bs.ci95Lower.toFixed(3)} ~ ${bs.ci95Upper.toFixed(3)}초 (${bs.nSuccess}/${bs.nTotal}회)</p>` : ''}
        <p class="confidence-hint">${this.#getConfidenceHint(this.predModel.getR2(), stats.count)}</p>
      </div>
    `;
    UIController.animateCountUp(resultEl);
    this.charts.renderPredictionChart('pred-chart', okRecords, this.predModel, startVal);
  }

  #runMultiPrediction(okRecords, resultEl, playerName) {
    const s = parseFloat(document.getElementById('pred-m-start')?.value);
    const s1 = parseFloat(document.getElementById('pred-m-seg1')?.value);
    const s2 = parseFloat(document.getElementById('pred-m-seg2')?.value);
    const s3 = parseFloat(document.getElementById('pred-m-seg3')?.value);
    const s4 = parseFloat(document.getElementById('pred-m-seg4')?.value);

    if ([s, s1, s2, s3, s4].some(v => isNaN(v))) {
      resultEl.innerHTML = UIController.errorHTML('입력값 누락', '모든 구간 시간을 입력해주세요. (Start, 구간1~4)');
      return;
    }

    if (s < UIController.VALIDATION.START_MIN || s > UIController.VALIDATION.START_MAX) {
      resultEl.innerHTML = UIController.errorHTML('Start Time 범위 초과', `입력값: ${s.toFixed(3)}초<br>올바른 범위: 3.0 ~ 10.0초`);
      return;
    }

    const segments = [
      { name: '구간1', value: s1 },
      { name: '구간2', value: s2 },
      { name: '구간3', value: s3 },
      { name: '구간4', value: s4 }
    ];
    for (const seg of segments) {
      if (seg.value < UIController.VALIDATION.SEG_MIN || seg.value > UIController.VALIDATION.SEG_MAX) {
        resultEl.innerHTML = UIController.errorHTML(`${seg.name} 범위 초과`, `입력값: ${seg.value.toFixed(3)}초<br>올바른 범위: 0.1 ~ 30.0초`);
        return;
      }
    }

    if (!this.predModel.isMultiReliable()) {
      resultEl.innerHTML = '<p class="text-danger">⚠️ 다중 회귀 모델: 구간 데이터가 충분한 기록이 부족합니다.</p>';
      return;
    }

    const interaction = s * s1;
    const features = [s, s1, s2, s3, s4, -7, interaction];
    const pred = this.predModel.predictMulti(features, playerName);
    const multiInfo = this.predModel.getMultiCoeffs();
    const coeffLabels = ['절편', 'Start', '구간1', '구간2', '구간3', '구간4', '트랙온도', 'Start×구간1'];
    const cv = this.predModel.getCVResults();
    const cvMulti = cv ? cv.multi : null;
    const offset = pred.playerOffset || 0;
    const bs = this.predModel.bootstrapPredict(okRecords, 'multi', { features, playerName });

    resultEl.innerHTML = `
      <h3>📊 다중 선형 회귀 결과</h3>
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-value">${multiInfo.n}</div><div class="stat-label">학습 데이터</div></div>
        <div class="stat-card"><div class="stat-value">${multiInfo.r2.toFixed(3)}</div><div class="stat-label">R² (학습)</div></div>
        ${cvMulti ? `<div class="stat-card"><div class="stat-value">${cvMulti.cvR2.toFixed(3)}</div><div class="stat-label">R² (CV)</div></div>` : ''}
        <div class="stat-card"><div class="stat-value">±${multiInfo.residualStd.toFixed(3)}</div><div class="stat-label">오차범위(초)</div></div>
        ${cvMulti ? `<div class="stat-card"><div class="stat-value">±${cvMulti.cvMAE.toFixed(3)}</div><div class="stat-label">CV MAE(초)</div></div>` : ''}
        ${pred.leverage != null ? `<div class="stat-card"><div class="stat-value">${pred.leverage.toFixed(3)}</div><div class="stat-label">Leverage</div></div>` : ''}
      </div>
      <div class="result-highlight">
        <p>입력: Start=${s.toFixed(3)} | 구간1=${s1.toFixed(3)} | 구간2=${s2.toFixed(3)} | 구간3=${s3.toFixed(3)} | 구간4=${s4.toFixed(3)}</p>
        <p class="pred-value">예측 Finish: <strong>${pred.predicted.toFixed(3)}초</strong></p>
        <p style="color:var(--c-text-muted)">Leverage CI: ${pred.lower.toFixed(3)} ~ ${pred.upper.toFixed(3)}초</p>
        ${bs ? `<p style="color:var(--c-text-muted)">Bootstrap 95% CI: ${bs.ci95Lower.toFixed(3)} ~ ${bs.ci95Upper.toFixed(3)}초</p>` : ''}
        <p class="confidence-hint">${this.#getConfidenceHint(multiInfo.r2, multiInfo.n)}</p>
      </div>
      <details>
        <summary>회귀 계수 + 진단 지표</summary>
        <table>
          <thead><tr><th>변수</th><th>계수</th>${multiInfo.vifs ? '<th>VIF</th>' : ''}</tr></thead>
          <tbody>
          ${multiInfo.coeffs.map((c, i) => `
            <tr><td>${coeffLabels[i]}</td><td>${c.toFixed(4)}</td>${multiInfo.vifs && i > 0 ? `<td${multiInfo.vifs[i-1] > 10 ? ' style="color:red;font-weight:bold"' : ''}>${multiInfo.vifs[i-1].toFixed(1)}</td>` : (i === 0 && multiInfo.vifs ? '<td>-</td>' : '')}</tr>
          `).join('')}
          </tbody>
        </table>
        ${multiInfo.durbinWatson != null ? `<p style="margin-top:0.5rem;font-size:0.85em">Durbin-Watson: <strong>${multiInfo.durbinWatson.toFixed(3)}</strong> ${multiInfo.durbinWatson < 1.5 ? '⚠️ 양의 자기상관' : multiInfo.durbinWatson > 2.5 ? '⚠️ 음의 자기상관' : '✅ 정상'} | Ridge λ=${multiInfo.ridgeLambda || 0}</p>` : ''}
        ${multiInfo.vifs && multiInfo.vifs.some(v => v > 10) ? '<p style="color:red;font-size:0.85em">⚠️ VIF > 10: 다중공선성 높음</p>' : ''}
      </details>
    `;
    UIController.animateCountUp(resultEl);
    this.charts.renderMultiPredChart('pred-chart', okRecords, this.predModel, pred);
  }

  // ─── XGBoost 출발 전 예측 ───
  #runXGBoostPre(okRecords, resultEl) {
    if (typeof XGB_MODELS === 'undefined' || !XGB_MODELS.pre) {
      resultEl.innerHTML = UIController.errorHTML('모델 없음', 'XGBoost 모델 파일이 로드되지 않았습니다.');
      return;
    }
    const startTime = parseFloat(this.#el('pred-xp-start')?.value);
    if (!startTime || startTime < 3 || startTime > 8) {
      resultEl.innerHTML = UIController.errorHTML('입력 오류', '스타트 시간을 입력해주세요 (3~8초).');
      return;
    }
    const gender = this.#el('pred-gender-filter')?.value || '';
    const iceTemp = parseFloat(this.#el('pred-xp-icetemp')?.value) || -7;
    const airTemp = parseFloat(this.#el('pred-xp-airtemp')?.value) || 5;
    const humidity = parseFloat(this.#el('pred-xp-humidity')?.value) || 60;
    const pressure = parseFloat(this.#el('pred-xp-pressure')?.value) || 935;

    const dewPoint = PredictionModel.calcDewPoint(airTemp, humidity);
    const airDensity = PredictionModel.calcAirDensity(airTemp, humidity, pressure);
    const windSpeed = 2.0; // 기본값
    const isFemale = gender === 'F' ? 1 : 0;

    // features: [start_time, temp_avg, air_temp, humidity, pressure, dewpoint, wind_speed, is_female]
    const features = [startTime, iceTemp, airTemp, humidity, pressure, dewPoint, windSpeed, isFemale];
    const predicted = xgbPredict(XGB_MODELS.pre, features);
    const m = XGB_MODELS.pre;

    // Feature importance 차트 데이터
    const impEntries = Object.entries(m.imp).sort((a, b) => b[1] - a[1]);

    resultEl.innerHTML = `
      <div class="stat-card accent" style="text-align:center;padding:1.5rem">
        <div style="font-size:0.85em;color:#aaa;margin-bottom:0.3rem">XGBoost 출발 전 예측</div>
        <div style="font-size:2.8em;font-weight:800;color:#00e5ff;line-height:1.1" data-countup="${predicted.toFixed(3)}">${predicted.toFixed(3)}<span style="font-size:0.4em">초</span></div>
        <div style="font-size:0.8em;color:#aaa;margin-top:0.5rem">스타트 ${startTime}초 | ${gender === 'F' ? '여자' : '남자'}</div>
      </div>
      <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:0.5rem;margin-top:0.5rem">
        <div class="stat-card"><div class="stat-label">학습 데이터</div><div class="stat-value">${m.n}건</div></div>
        <div class="stat-card"><div class="stat-label">Train R²</div><div class="stat-value">${m.r2}</div></div>
        <div class="stat-card"><div class="stat-label">5-Fold CV R²</div><div class="stat-value">${m.cv} ± ${(m.cvStd||0.053).toFixed(3)}</div></div>
        <div class="stat-card"><div class="stat-label">RMSE</div><div class="stat-value">${m.rmse}초</div></div>
        <div class="stat-card"><div class="stat-label">MAE</div><div class="stat-value">${m.mae}초</div></div>
        <div class="stat-card"><div class="stat-label">Trees</div><div class="stat-value">${m.t.length}개</div></div>
      </div>
      <details style="margin-top:0.8rem" open>
        <summary style="cursor:pointer;font-weight:600">🌡️ 환경 변수</summary>
        <table class="mini-table" style="margin-top:0.5rem;width:100%">
          <tr><td>얼음 온도</td><td><strong>${iceTemp}°C</strong></td></tr>
          <tr><td>기온</td><td><strong>${airTemp}°C</strong></td></tr>
          <tr><td>습도</td><td><strong>${humidity}%</strong></td></tr>
          <tr><td>기압</td><td><strong>${pressure} hPa</strong></td></tr>
          <tr><td>이슬점 (계산)</td><td><strong>${dewPoint.toFixed(1)}°C</strong></td></tr>
          <tr><td>공기밀도 (계산)</td><td><strong>${airDensity.toFixed(4)} kg/m³</strong></td></tr>
        </table>
      </details>
      <details style="margin-top:0.8rem" open>
        <summary style="cursor:pointer;font-weight:600">📊 Feature Importance</summary>
        <div style="margin-top:0.5rem">
          ${impEntries.map(([name, val]) => {
            const label = {start_time:'스타트',temp_avg:'얼음온도','기상청_기온평균_C':'기온','기상청_습도평균_pct':'습도','기상청_현지기압_hPa':'기압','기상청_이슬점평균_C':'이슬점','기상청_풍속평균_ms':'풍속',is_female:'성별'}[name] || name;
            const pct = (val * 100).toFixed(1);
            return `<div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.3rem">
              <span style="width:60px;font-size:0.85em;text-align:right">${label}</span>
              <div style="flex:1;background:#1a2a3a;border-radius:3px;height:18px;overflow:hidden">
                <div style="width:${pct}%;background:linear-gradient(90deg,#00e5ff,#2979ff);height:100%;border-radius:3px;transition:width 0.5s"></div>
              </div>
              <span style="width:45px;font-size:0.8em;color:#aaa">${pct}%</span>
            </div>`;
          }).join('')}
        </div>
      </details>
      <div style="margin-top:0.8rem;padding:0.8rem;background:#1a2a3a;border-radius:8px;border-left:3px solid #ff9800">
        <div style="font-weight:600;color:#ff9800;margin-bottom:0.3rem">⚠️ 모델 특성</div>
        <div style="font-size:0.85em;color:#ccc;line-height:1.5">
          출발 전 예측은 <strong>구간 기록 없이</strong> 환경변수만으로 예측하므로 정밀도가 제한적입니다 (CV R² ≈ 0.60).<br>
          주행이 시작되면 <strong>XGBoost 주행 중 예측</strong> 모델로 전환하면 CV R² ≈ 0.97의 고정밀 예측이 가능합니다.
        </div>
      </div>
    `;
    UIController.animateCountUp(resultEl);
  }

  // ─── XGBoost 주행 중 예측 ───
  #runXGBoostLive(okRecords, resultEl) {
    if (typeof XGB_MODELS === 'undefined' || !XGB_MODELS.live) {
      resultEl.innerHTML = UIController.errorHTML('모델 없음', 'XGBoost 모델 파일이 로드되지 않았습니다.');
      return;
    }
    const startTime = parseFloat(this.#el('pred-xl-start')?.value);
    const int1 = parseFloat(this.#el('pred-xl-int1')?.value);
    const int2 = parseFloat(this.#el('pred-xl-int2')?.value);
    const int3 = parseFloat(this.#el('pred-xl-int3')?.value);
    const int4 = parseFloat(this.#el('pred-xl-int4')?.value);

    if (!startTime || startTime < 3 || startTime > 8) {
      resultEl.innerHTML = UIController.errorHTML('입력 오류', '스타트 시간을 입력해주세요.');
      return;
    }
    if (!int4) {
      resultEl.innerHTML = UIController.errorHTML('입력 오류', '구간 기록(Int.1~Int.4)을 모두 입력해주세요. 누적 시간으로 입력합니다.');
      return;
    }

    const gender = this.#el('pred-gender-filter')?.value || '';
    const iceTemp = parseFloat(this.#el('pred-xl-icetemp')?.value) || -7;
    const airTemp = parseFloat(this.#el('pred-xl-airtemp')?.value) || 5;
    const humidity = parseFloat(this.#el('pred-xl-humidity')?.value) || 60;
    const pressure = parseFloat(this.#el('pred-xl-pressure')?.value) || 935;

    const dewPoint = PredictionModel.calcDewPoint(airTemp, humidity);
    const airDensity = PredictionModel.calcAirDensity(airTemp, humidity, pressure);
    const windSpeed = 2.0;
    const isFemale = gender === 'F' ? 1 : 0;

    // features: [start_time, int1, int2, int3, int4, temp_avg, air_temp, humidity, pressure, dewpoint, wind_speed, is_female]
    const features = [startTime, int1, int2, int3, int4, iceTemp, airTemp, humidity, pressure, dewPoint, windSpeed, isFemale];
    const predicted = xgbPredict(XGB_MODELS.live, features);
    const m = XGB_MODELS.live;

    // 구간 분석
    const seg1 = int1 - startTime;
    const seg2 = int2 - int1;
    const seg3 = int3 - int2;
    const seg4 = int4 - int3;
    const segFinish = predicted - int4;
    const sections = [
      { name: 'Start→Int.1', time: seg1 },
      { name: 'Int.1→Int.2', time: seg2 },
      { name: 'Int.2→Int.3', time: seg3 },
      { name: 'Int.3→Int.4', time: seg4 },
      { name: 'Int.4→Finish', time: segFinish },
    ];
    const fastest = Math.min(...sections.map(s => s.time));
    const slowest = Math.max(...sections.map(s => s.time));

    // MLR 비교 예측 (있으면)
    let mlrPred = null;
    try {
      const mlrResult = this.predModel.trainGeneralMLR(okRecords, {
        startTime, iceTemp, airTemp, humidity, pressure,
        height: parseFloat(this.#el('pred-height')?.value) || null,
        weight: parseFloat(this.#el('pred-weight')?.value) || null,
      });
      if (mlrResult) mlrPred = mlrResult.prediction.predicted;
    } catch (e) { /* ignore */ }

    resultEl.innerHTML = `
      <div class="stat-card accent" style="text-align:center;padding:1.5rem">
        <div style="font-size:0.85em;color:#aaa;margin-bottom:0.3rem">XGBoost 주행 중 예측</div>
        <div style="font-size:2.8em;font-weight:800;color:#00e5ff;line-height:1.1" data-countup="${predicted.toFixed(3)}">${predicted.toFixed(3)}<span style="font-size:0.4em">초</span></div>
        <div style="font-size:0.8em;color:#aaa;margin-top:0.5rem">
          스타트 ${startTime}초 → Int.4 ${int4}초 | ${gender === 'F' ? '여자' : '남자'}
          ${mlrPred ? `<br>MLR 예측: ${mlrPred.toFixed(3)}초 (차이: ${Math.abs(predicted - mlrPred).toFixed(3)}초)` : ''}
        </div>
      </div>
      <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:0.5rem;margin-top:0.5rem">
        <div class="stat-card"><div class="stat-label">학습 데이터</div><div class="stat-value">${m.n}건</div></div>
        <div class="stat-card"><div class="stat-label">Train R²</div><div class="stat-value">${m.r2}</div></div>
        <div class="stat-card"><div class="stat-label">5-Fold CV R²</div><div class="stat-value">${m.cv} ± ${(m.cvStd||0.010).toFixed(3)}</div></div>
        <div class="stat-card"><div class="stat-label">RMSE</div><div class="stat-value">${m.rmse}초</div></div>
        <div class="stat-card"><div class="stat-label">MAE</div><div class="stat-value">${m.mae}초</div></div>
        <div class="stat-card"><div class="stat-label">Trees</div><div class="stat-value">${m.t.length}개</div></div>
      </div>
      <details style="margin-top:0.8rem" open>
        <summary style="cursor:pointer;font-weight:600">🏁 구간 분석</summary>
        <table class="mini-table" style="margin-top:0.5rem;width:100%">
          <thead><tr><th>구간</th><th>소요 시간</th><th>비고</th></tr></thead>
          <tbody>
            ${sections.map(s => `<tr>
              <td>${s.name}</td>
              <td><strong>${s.time.toFixed(3)}초</strong></td>
              <td>${s.time === fastest ? '🟢 최고' : s.time === slowest ? '🔴 개선 필요' : ''}</td>
            </tr>`).join('')}
            <tr style="border-top:2px solid #334;font-weight:600">
              <td>TOTAL</td><td>${predicted.toFixed(3)}초</td><td></td>
            </tr>
          </tbody>
        </table>
      </details>
      <details style="margin-top:0.8rem">
        <summary style="cursor:pointer;font-weight:600">🌡️ 환경 변수</summary>
        <table class="mini-table" style="margin-top:0.5rem;width:100%">
          <tr><td>얼음 온도</td><td><strong>${iceTemp}°C</strong></td></tr>
          <tr><td>기온</td><td><strong>${airTemp}°C</strong></td></tr>
          <tr><td>습도</td><td><strong>${humidity}%</strong></td></tr>
          <tr><td>기압</td><td><strong>${pressure} hPa</strong></td></tr>
          <tr><td>이슬점 (계산)</td><td><strong>${dewPoint.toFixed(1)}°C</strong></td></tr>
          <tr><td>공기밀도 (계산)</td><td><strong>${airDensity.toFixed(4)} kg/m³</strong></td></tr>
        </table>
      </details>
      <div style="margin-top:0.8rem;padding:0.8rem;background:#0d2818;border-radius:8px;border-left:3px solid #4caf50">
        <div style="font-weight:600;color:#4caf50;margin-bottom:0.3rem">✅ 고정밀 예측</div>
        <div style="font-size:0.85em;color:#ccc;line-height:1.5">
          XGBoost 주행 중 모델은 구간 기록(Int.1~Int.4)을 활용하여 <strong>CV R² = ${m.cv}</strong>의 정밀도를 달성합니다.<br>
          Int.4(15번 커브)가 전체 예측의 <strong>52.3%</strong>, Int.3(12번 커브)가 <strong>36.2%</strong>를 설명합니다.
        </div>
      </div>
    `;
    UIController.animateCountUp(resultEl);
  }

  #runGeneralMLR(okRecords, resultEl) {
    const startTime = parseFloat(document.getElementById('pred-g-start')?.value);
    const height = parseFloat(document.getElementById('pred-height')?.value);
    const weight = parseFloat(document.getElementById('pred-weight')?.value);
    const iceTemp = parseFloat(document.getElementById('pred-g-icetemp')?.value);
    const airTemp = parseFloat(document.getElementById('pred-g-airtemp')?.value);
    const humidity = parseFloat(document.getElementById('pred-g-humidity')?.value);
    const pressure = parseFloat(document.getElementById('pred-g-pressure')?.value);

    if (isNaN(startTime)) {
      resultEl.innerHTML = UIController.errorHTML('스타트 시간 필요', '스타트 시간(초)을 입력해주세요.');
      return;
    }
    if (startTime < UIController.VALIDATION.START_MIN || startTime > UIController.VALIDATION.START_MAX) {
      resultEl.innerHTML = UIController.errorHTML('Start Time 범위 초과', `입력값: ${startTime.toFixed(3)}초<br>올바른 범위: 3.0 ~ 10.0초`);
      return;
    }

    const input = {
      startTime,
      height: isNaN(height) ? null : height,
      weight: isNaN(weight) ? null : weight,
      iceTemp: isNaN(iceTemp) ? -7 : iceTemp,
      airTemp: isNaN(airTemp) ? 5 : airTemp,
      humidity: isNaN(humidity) ? 60 : humidity,
      pressure: isNaN(pressure) ? 1013 : pressure,
    };

    const result = this.predModel.trainGeneralMLR(okRecords, input);
    if (!result) {
      resultEl.innerHTML = UIController.errorHTML('데이터 부족', '범용 MLR 모델 학습에 충분한 데이터가 없습니다 (최소 10건).');
      return;
    }

    const { prediction, modelInfo, environment } = result;
    const env = environment;
    const mi = modelInfo;

    // 보정 내역 테이블
    let corrHTML = '';
    if (prediction.corrections.length > 0) {
      corrHTML = `
        <details open>
          <summary>물리적 보정 내역 (선행연구 기반)</summary>
          <table>
            <thead><tr><th>보정 항목</th><th>보정값(초)</th><th>근거</th></tr></thead>
            <tbody>
            ${prediction.corrections.map(c => `
              <tr><td>${c.name}</td><td>${c.value > 0 ? '+' : ''}${c.value.toFixed(3)}</td><td style="font-size:0.85em">${c.detail}</td></tr>
            `).join('')}
            <tr style="font-weight:bold;border-top:2px solid var(--c-border)"><td>합계</td><td>${prediction.totalCorrection > 0 ? '+' : ''}${prediction.totalCorrection.toFixed(3)}</td><td></td></tr>
            </tbody>
          </table>
        </details>`;
    }

    // 환경 정보
    const envHTML = `
      <details>
        <summary>환경 변수 계산 결과</summary>
        <div class="stats-grid" style="margin-top:0.5rem">
          <div class="stat-card"><div class="stat-value">${env.airDensity}</div><div class="stat-label">공기밀도 (kg/m³)</div></div>
          <div class="stat-card"><div class="stat-value">${env.dewPoint != null ? env.dewPoint + '°C' : '-'}</div><div class="stat-label">이슬점</div></div>
          <div class="stat-card"><div class="stat-value">${env.iceTemp}°C</div><div class="stat-label">빙면 온도</div></div>
          <div class="stat-card"><div class="stat-value">${env.frostRisk ? '⚠️ 위험' : '✅ 정상'}</div><div class="stat-label">서리 위험</div></div>
        </div>
      </details>`;

    // 상관관계 행렬
    const corrMatHTML = mi.corrMatrix ? `
      <details>
        <summary>상관관계 행렬 (Pearson r)</summary>
        <table style="font-size:0.85em">
          <thead><tr><th></th>${mi.corrLabels.map(l => `<th>${l}</th>`).join('')}</tr></thead>
          <tbody>
          ${mi.corrLabels.map((label, i) => `
            <tr><td><strong>${label}</strong></td>${mi.corrMatrix[i].map((v, j) => {
              const abs = Math.abs(v);
              const color = i === j ? '' : abs > 0.7 ? 'color:#e74c3c;font-weight:bold' : abs > 0.4 ? 'color:#f39c12' : '';
              return `<td style="${color}">${v.toFixed(3)}</td>`;
            }).join('')}</tr>
          `).join('')}
          </tbody>
        </table>
      </details>` : '';

    // 회귀 계수 상세
    const coeffHTML = `
      <details>
        <summary>회귀 계수 + 진단 지표</summary>
        <table style="font-size:0.85em">
          <thead><tr><th>변수</th><th>B</th><th>β</th><th>t</th><th>p</th><th>VIF</th></tr></thead>
          <tbody>
          ${mi.coeffDetails.map(c => {
            const pStar = c.p < 0.001 ? '***' : c.p < 0.01 ? '**' : c.p < 0.05 ? '*' : '';
            return `<tr>
              <td>${c.name}</td>
              <td>${c.B.toFixed(4)}</td>
              <td>${c.beta != null ? c.beta.toFixed(4) : '-'}</td>
              <td>${c.t.toFixed(3)}</td>
              <td>${c.p < 0.001 ? '< .001' : c.p.toFixed(3)}${pStar}</td>
              <td>${c.vif != null ? (c.vif > 10 ? `<span style="color:red;font-weight:bold">${c.vif}</span>` : c.vif.toFixed(2)) : '-'}</td>
            </tr>`;
          }).join('')}
          </tbody>
        </table>
        ${mi.durbinWatson != null ? `<p style="margin-top:0.5rem;font-size:0.85em">Durbin-Watson: <strong>${mi.durbinWatson.toFixed(3)}</strong> ${mi.durbinWatson < 1.5 ? '⚠️ 양의 자기상관' : mi.durbinWatson > 2.5 ? '⚠️ 음의 자기상관' : '✅ 정상'}</p>` : ''}
        <p style="font-size:0.85em;color:var(--c-text-muted)">데이터 전처리: 전체 ${mi.preprocessing.initial}건 → 이상치 ${mi.preprocessing.outlierRemoved}건 제거 → 최종 ${mi.preprocessing.final}건</p>
      </details>`;

    // 기술 통계량
    const descHTML = mi.descriptive ? `
      <details>
        <summary>기술 통계량</summary>
        <table style="font-size:0.85em">
          <thead><tr><th>변수</th><th>M</th><th>SD</th><th>Min</th><th>Max</th></tr></thead>
          <tbody>
          ${mi.descriptive.map(d => `
            <tr><td>${d.name}</td><td>${d.mean.toFixed(3)}</td><td>${d.std.toFixed(3)}</td><td>${d.min.toFixed(3)}</td><td>${d.max.toFixed(3)}</td></tr>
          `).join('')}
          </tbody>
        </table>
      </details>` : '';

    // 입력 요약
    const inputParts = [`Start=${startTime.toFixed(3)}`];
    if (input.height) inputParts.push(`키=${input.height}cm`);
    if (input.weight) inputParts.push(`몸무게=${input.weight}kg`);
    inputParts.push(`기온=${input.airTemp}°C`, `습도=${input.humidity}%`, `기압=${input.pressure}hPa`, `빙면=${input.iceTemp}°C`);

    resultEl.innerHTML = `
      <h3>📊 범용 MLR 예측 결과 (논문용)</h3>
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-value">${mi.n}</div><div class="stat-label">학습 데이터</div></div>
        <div class="stat-card"><div class="stat-value">${mi.r2.toFixed(3)}</div><div class="stat-label">R²</div></div>
        <div class="stat-card"><div class="stat-value">${mi.adjR2.toFixed(3)}</div><div class="stat-label">Adj R²</div></div>
        <div class="stat-card"><div class="stat-value">±${mi.rmse.toFixed(3)}</div><div class="stat-label">RMSE(초)</div></div>
        <div class="stat-card"><div class="stat-value">±${mi.mae.toFixed(3)}</div><div class="stat-label">MAE(초)</div></div>
      </div>
      <div class="result-highlight">
        <p style="font-size:0.85em">${inputParts.join(' | ')}</p>
        <p class="pred-value">기본 예측: <strong>${prediction.basePredicted.toFixed(3)}초</strong></p>
        ${prediction.totalCorrection !== 0 ? `<p class="pred-value">보정 후 예측: <strong>${prediction.predicted.toFixed(3)}초</strong> (${prediction.totalCorrection > 0 ? '+' : ''}${prediction.totalCorrection.toFixed(3)})</p>` : ''}
        <p style="color:var(--c-text-muted)">95% 신뢰구간: ${prediction.lower.toFixed(3)} ~ ${prediction.upper.toFixed(3)}초</p>
        <p class="confidence-hint">${this.#getConfidenceHint(mi.r2, mi.n)}</p>
      </div>
      ${corrHTML}
      ${envHTML}
      ${coeffHTML}
      ${corrMatHTML}
      ${descHTML}
    `;
    UIController.animateCountUp(resultEl);
  }

  #runSegmentPrediction(okRecords, resultEl) {
    const segType = document.getElementById('pred-seg-type')?.value || 'fromInt4';
    const segVal = parseFloat(document.getElementById('pred-seg-value')?.value);

    if (isNaN(segVal)) {
      resultEl.innerHTML = UIController.errorHTML('누적 시간 입력 필요', '기준 구간까지의 실측 누적 시간을 입력해주세요.');
      return;
    }

    if (segVal < UIController.VALIDATION.FINISH_MIN || segVal > UIController.VALIDATION.FINISH_MAX) {
      resultEl.innerHTML = UIController.errorHTML('누적 시간 범위 초과', `입력값: ${segVal.toFixed(3)}초<br>올바른 범위: 5.0 ~ 70.0초`);
      return;
    }

    if (!this.predModel.isSegmentReliable()) {
      resultEl.innerHTML = '<p class="text-danger">⚠️ 구간별 모델: 데이터가 부족합니다.</p>';
      return;
    }

    const pred = this.predModel.predictFromSegment(segVal, segType);
    if (!pred) {
      resultEl.innerHTML = '<p class="text-danger">⚠️ 예측할 수 없습니다.</p>';
      return;
    }

    const segLabels = {
      fromInt4: 'Int.4 (15번 커브)',
      fromInt3: 'Int.3 (12번 커브)',
      fromInt2: 'Int.2 (7번 커브)',
      fromInt1: 'Int.1 (4번 커브)',
    };
    const allSegs = this.predModel.getSegmentStats();

    resultEl.innerHTML = `
      <h3>🎯 구간별 가중 예측 결과</h3>
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-value">${pred.n}</div><div class="stat-label">학습 데이터</div></div>
        <div class="stat-card"><div class="stat-value">${pred.segmentAvg.toFixed(3)}</div><div class="stat-label">잔여 구간 평균(초)</div></div>
        <div class="stat-card"><div class="stat-value">±${pred.segmentStd.toFixed(3)}</div><div class="stat-label">오차범위(초)</div></div>
      </div>
      <div class="result-highlight">
        <p>기준: <strong>${segLabels[segType]}</strong> = ${segVal.toFixed(3)}초</p>
        <p class="pred-value">예측 Finish: <strong>${pred.predicted.toFixed(3)}초</strong></p>
        <p style="color:var(--c-text-muted)">예측 범위: ${pred.lower.toFixed(3)} ~ ${pred.upper.toFixed(3)}초 (±1σ)</p>
        <p class="confidence-hint">${this.#getConfidenceHint(pred.r2 || 0, pred.n, pred.method)}</p>
      </div>
      <details>
        <summary>모든 기준 구간별 잔여 시간 통계</summary>
        <table>
          <thead><tr><th>기준</th><th>잔여 평균</th><th>표준편차</th><th>데이터수</th></tr></thead>
          <tbody>
          ${allSegs ? Object.entries(allSegs).map(([k, v]) => `
            <tr${k === segType ? ' style="background:var(--c-primary-50);font-weight:600"' : ''}>
              <td>${segLabels[k]}</td>
              <td>${v.avg.toFixed(3)}초</td>
              <td>±${v.std.toFixed(3)}초</td>
              <td>${v.n}</td></tr>
          `).join('') : ''}
          </tbody>
        </table>
      </details>
    `;
    UIController.animateCountUp(resultEl);
    this.charts.renderSegmentChart('pred-chart', okRecords, segType, segVal, pred);
  }

  // ─── Tab 2: 선수 분석 ──────────────────────────────────────
  #bindAnalysisEvents() {
    const sel = this.#el('analysis-player-select');
    if (sel) sel.addEventListener('change', () => {
      this.#renderAnalysisTab(sel.value);
    });
  }

  #renderAnalysisTab(name) {
    const statsEl = this.#el('analysis-stats');
    const tableEl = this.#el('analysis-table');
    if (!name) {
      if (statsEl) statsEl.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📊</div><div class="empty-state-text">선수를 선택하면 상세 분석을 확인할 수 있습니다</div></div>';
      if (tableEl) tableEl.innerHTML = '';
      return;
    }

    if (statsEl) statsEl.innerHTML = '<div class="empty-state"><div class="empty-state-icon"><div class="loading-spinner"></div></div><div class="empty-state-text">분석 중...</div></div>';

    const stats = this.analyzer.getStats(name);
    const trend = this.analyzer.getTrend(name);
    const splitStats = this.analyzer.getSplitStats(name);
    const records = this.ds.getPlayerRecords(name);

    // 백분위수, 시즌 추이, 구간 상관관계
    const pct = this.analyzer.getPercentiles(name);
    const seasonTrend = this.analyzer.getSeasonTrend(name);
    const segCorr = this.analyzer.getSegmentCorrelation(name);

    if (statsEl && stats) {
      const trendBadge = seasonTrend ? (() => {
        const colors = { improving: '#16a34a', declining: '#dc2626', stable: '#2563eb', insufficient: '#8b92a5' };
        const icons = { improving: '📈', declining: '📉', stable: '➡️', insufficient: '❓' };
        return `<div class="stat-card"><div class="stat-value" style="font-size:1.4rem">${icons[seasonTrend.direction]}</div><div class="stat-label" style="color:${colors[seasonTrend.direction]}">${seasonTrend.label}</div></div>`;
      })() : '';

      statsEl.innerHTML = `
        <div class="stat-card"><div class="stat-value">${stats.count}</div><div class="stat-label">기록수</div></div>
        <div class="stat-card"><div class="stat-value">${stats.best.toFixed(3)}</div><div class="stat-label">최고(초)</div></div>
        <div class="stat-card"><div class="stat-value">${stats.worst.toFixed(3)}</div><div class="stat-label">최저(초)</div></div>
        <div class="stat-card"><div class="stat-value">${stats.avg.toFixed(3)}</div><div class="stat-label">평균(초)</div></div>
        <div class="stat-card"><div class="stat-value">${stats.stddev.toFixed(3)}</div><div class="stat-label">표준편차</div></div>
        <div class="stat-card"><div class="stat-value">${(stats.consistency * 100).toFixed(1)}%</div><div class="stat-label">일관성</div></div>
        ${trendBadge}
        ${pct ? `<div class="stat-card"><div class="stat-value">${pct.p50.toFixed(3)}</div><div class="stat-label">중앙값 P50</div></div>` : ''}
      `;

      // simple-statistics 고급 통계 카드 추가
      const okFinishes = records.filter(r => r.status === 'OK' && r.finish != null).map(r => parseFloat(r.finish));
      const adv = this.#getAdvancedStats(okFinishes);
      if (adv) {
        statsEl.insertAdjacentHTML('beforeend', `
          <div class="stat-card"><div class="stat-value">${adv.iqr.toFixed(3)}</div><div class="stat-label">IQR (사분위범위)</div></div>
          <div class="stat-card"><div class="stat-value">${adv.cv.toFixed(1)}%</div><div class="stat-label">CV (변동계수)</div></div>
          <div class="stat-card"><div class="stat-value">${adv.skewness.toFixed(2)}</div><div class="stat-label">왜도 (Skewness)</div></div>
        `);
      }

      UIController.animateCountUp(statsEl);
    }

    this.charts.renderTrendChart('analysis-trend-chart', trend, name);
    this.charts.renderSplitChart('analysis-split-chart', splitStats);
    this.charts.renderWeatherChart('analysis-weather-chart', records, name);
    this.charts.renderBoxPlot('analysis-boxplot-chart', splitStats, name);

    // 백분위수 + 구간 상관관계 상세 표시
    let extraHTML = '';
    if (!pct && stats && stats.count < 3) {
      extraHTML += `
        <div class="result-panel" style="margin-bottom:var(--sp-5)">
          <div class="info-hint" style="padding:var(--sp-4)">
            <span style="font-size:1.2rem">📊</span>
            <span>백분위수 분석에는 최소 3개의 유효 기록이 필요합니다. 현재 <strong>${stats.count}개</strong>의 기록이 있습니다.</span>
          </div>
        </div>`;
    }
    if (pct) {
      extraHTML += `
        <div class="result-panel" style="margin-bottom:var(--sp-5)">
          <h3>백분위수 분포</h3>
          <div class="stats-grid">
            <div class="stat-card"><div class="stat-value">${pct.p10.toFixed(3)}</div><div class="stat-label">P10 (상위 10%)</div></div>
            <div class="stat-card"><div class="stat-value">${pct.p25.toFixed(3)}</div><div class="stat-label">P25</div></div>
            <div class="stat-card"><div class="stat-value">${pct.p50.toFixed(3)}</div><div class="stat-label">P50 (중앙값)</div></div>
            <div class="stat-card"><div class="stat-value">${pct.p75.toFixed(3)}</div><div class="stat-label">P75</div></div>
            <div class="stat-card"><div class="stat-value">${pct.p90.toFixed(3)}</div><div class="stat-label">P90</div></div>
            <div class="stat-card"><div class="stat-value">${pct.p95.toFixed(3)}</div><div class="stat-label">P95 (하위 5%)</div></div>
          </div>
        </div>`;
    }
    if (segCorr) {
      const impactColors = { high: '#dc2626', medium: '#f59e0b', low: '#6b7280' };
      const impactLabels = { high: '높음', medium: '보통', low: '낮음' };
      extraHTML += `
        <div class="result-panel" style="margin-bottom:var(--sp-5)">
          <h3>구간별 Finish 영향도 (상관관계)</h3>
          <table style="width:100%">
            <thead><tr><th>구간</th><th style="text-align:right">상관계수</th><th style="text-align:center">영향도</th></tr></thead>
            <tbody>
            ${segCorr.map(s => `
              <tr>
                <td style="font-weight:600">${_esc(s.segment)}</td>
                <td style="text-align:right;font-variant-numeric:tabular-nums">${s.correlation.toFixed(3)}</td>
                <td style="text-align:center"><span style="color:${impactColors[s.impact]};font-weight:600">${impactLabels[s.impact]}</span></td>
              </tr>
            `).join('')}
            </tbody>
          </table>
          <p style="font-size:0.8em;color:var(--c-text-muted);margin-top:var(--sp-2)">※ 상관계수 1.0에 가까울수록 해당 구간이 최종 기록에 큰 영향</p>
        </div>`;
    }

    const extraEl = this.#el('analysis-extra');
    if (extraEl) extraEl.innerHTML = extraHTML;
    if (tableEl) this.table.renderSessionTable('analysis-table', records);
  }

  // ─── Tab 3: 선수 비교 ──────────────────────────────────────
  #bindCompareEvents() {
    // 비교 탭은 renderCompareTab에서 동적으로 체크박스 생성
  }

  #renderCompareTab() {
    const container = document.getElementById('compare-player-checkboxes');
    if (!container) return;

    const players = this.ds.getPlayers();

    // 현재 체크된 선수 유지
    const checked = new Set([...document.querySelectorAll('.compare-chk:checked')].map(c => c.value));

    const { sortedNats, groups } = this.ds.groupByNat(players);

    // 선택된 선수 칩
    const selectedChips = checked.size > 0
      ? `<div class="compare-selected-chips">${[...checked].map(name =>
          `<span class="compare-chip" onclick="window._ui && window._ui.compareToggle('${name.replace(/'/g, "\\'")}')">${_esc(name)} <span class="chip-x">\u00d7</span></span>`
        ).join('')}</div>`
      : '';

    // 그룹별 체크박스 생성
    let groupsHTML = '';
    for (const nat of sortedNats) {
      groupsHTML += `<div class="compare-group-label">\u25CF ${_esc(nat)} \u2014 ${groups[nat].length}명</div>`;
      groupsHTML += groups[nat].map(p => {
        return `
        <label>
          <input type="checkbox" class="compare-chk" value="${_esc(p.name)}"${checked.has(p.name) ? ' checked' : ''} aria-label="${_esc(p.name)} 선택">
          ${_esc(p.name)}
        </label>`;
      }).join('');
    }

    const checkedCount = checked.size;
    container.innerHTML = `
      <div class="compare-header">
        <strong>선수 선택 <span style="color:${checkedCount >= 2 ? 'var(--c-success)' : 'var(--c-text-muted)'}">(${checkedCount}/${UIController.MAX_COMPARE})</span></strong>
        <button onclick="window._ui && window._ui.compareRun()" class="primary-btn">비교 실행</button>
        <button onclick="window._ui && window._ui.compareReset()" class="secondary-btn">초기화</button>
      </div>
      <div id="compare-msg-inner" style="flex-basis:100%"></div>
      ${selectedChips}
      ${groupsHTML}
    `;

    // 이벤트 위임: 컨테이너 1개 리스너로 모든 체크박스 처리
    if (!container._delegated) {
      container.addEventListener('change', (e) => {
        if (!e.target.classList.contains('compare-chk')) return;
        const checkedCount = container.querySelectorAll('.compare-chk:checked').length;
        if (e.target.checked && checkedCount > UIController.MAX_COMPARE) {
          e.target.checked = false;
          const msgEl = document.getElementById('compare-msg-inner') || document.getElementById('compare-msg');
          if (msgEl) {
            msgEl.textContent = `최대 ${UIController.MAX_COMPARE}명까지 선택 가능합니다.`;
            setTimeout(() => { msgEl.textContent = ''; }, 2000);
          }
          return;
        }
        this.#updateCompareCount();
      });
      container._delegated = true;
    }
  }

  #updateCompareCount() {
    const checked = [...document.querySelectorAll('.compare-chk:checked')].map(c => c.value);
    const count = checked.length;

    // 카운터 텍스트 업데이트
    const header = document.querySelector('.compare-header strong');
    if (header) {
      let color = 'var(--c-text-muted)';
      if (count >= 2 && count <= UIController.MAX_COMPARE) color = 'var(--c-success)';
      header.innerHTML = `선수 선택 <span style="color:${color}">(${count}/${UIController.MAX_COMPARE})</span>`;
    }

    // 선택 칩 업데이트
    let chipsEl = document.querySelector('.compare-selected-chips');
    if (count > 0) {
      const html = checked.map(name =>
        `<span class="compare-chip" onclick="window._ui && window._ui.compareToggle('${name.replace(/'/g, "\\'")}')">${_esc(name)} <span class="chip-x">\u00d7</span></span>`
      ).join('');
      if (!chipsEl) {
        chipsEl = document.createElement('div');
        chipsEl.className = 'compare-selected-chips';
        const headerEl = document.querySelector('.compare-header');
        if (headerEl) headerEl.after(chipsEl);
      }
      chipsEl.innerHTML = html;
    } else if (chipsEl) {
      chipsEl.remove();
    }
  }

  compareToggle(name) {
    const chk = [...document.querySelectorAll('.compare-chk')].find(c => c.value === name);
    if (chk) chk.checked = !chk.checked;
    this.#renderCompareTab();
  }

  compareRun() {
    const checked = [...document.querySelectorAll('.compare-chk:checked')].map(c => c.value);
    const msgEl = document.getElementById('compare-msg-inner') || document.getElementById('compare-msg');
    if (checked.length < 2) {
      if (msgEl) {
        msgEl.innerHTML = '<div class="compare-warning">선수를 2명 이상 선택해주세요</div>';
      }
      return;
    }
    if (checked.length > UIController.MAX_COMPARE) {
      if (msgEl) {
        msgEl.innerHTML = `<div class="compare-warning">최대 ${UIController.MAX_COMPARE}명까지 선택 가능합니다</div>`;
      }
      return;
    }
    if (msgEl) msgEl.innerHTML = '';

    const compareData = this.analyzer.compareMultiple(checked);
    this.charts.renderCompareBarChart('compare-bar-chart', compareData);
    this.charts.renderRadarChart('compare-radar-chart', compareData);
    this.table.renderCompareTable('compare-table', compareData);

    // simple-statistics: 비교 선수들 간 고급 통계 요약
    if (typeof ss !== 'undefined' && compareData.length >= 2) {
      const tableEl = document.getElementById('compare-table');
      if (tableEl) {
        const avgs = compareData.map(d => d.stats?.avg).filter(v => v != null);
        const bests = compareData.map(d => d.stats?.best).filter(v => v != null);
        if (avgs.length >= 2) {
          const avgSpread = ss.max(avgs) - ss.min(avgs);
          const bestSpread = ss.max(bests) - ss.min(bests);
          tableEl.insertAdjacentHTML('beforeend', `
            <div class="result-panel" style="margin-top:var(--sp-4)">
              <h4 style="margin:0 0 0.5rem">비교 요약 (simple-statistics)</h4>
              <div class="stats-grid">
                <div class="stat-card"><div class="stat-value">${avgSpread.toFixed(3)}</div><div class="stat-label">평균 기록 격차(초)</div></div>
                <div class="stat-card"><div class="stat-value">${bestSpread.toFixed(3)}</div><div class="stat-label">최고 기록 격차(초)</div></div>
                <div class="stat-card"><div class="stat-value">${ss.standardDeviation(avgs).toFixed(3)}</div><div class="stat-label">평균의 표준편차</div></div>
              </div>
            </div>
          `);
        }
      }
    }


    // SortableJS: 비교 테이블 행 드래그
    if (typeof Sortable !== 'undefined') {
      const tableEl = document.getElementById('compare-table');
      const tbody = tableEl?.querySelector('tbody');
      if (tbody && !tbody._sortable) {
        Sortable.create(tbody, {
          animation: 150,
          handle: 'td:first-child',
          ghostClass: 'sortable-ghost'
        });
        tbody._sortable = true;
      }
    }
  }

  compareReset() {
    document.querySelectorAll('.compare-chk').forEach(c => c.checked = false);
    this.#updateCompareCount();
    const barCanvas = document.getElementById('compare-bar-chart');
    const radarCanvas = document.getElementById('compare-radar-chart');
    if (barCanvas) this.charts._destroy('compare-bar-chart');
    if (radarCanvas) this.charts._destroy('compare-radar-chart');
    const tableEl = document.getElementById('compare-table');
    if (tableEl) tableEl.innerHTML = '';
  }

  // ─── Tab 4: 데이터 탐색 ────────────────────────────────────
  #populateExploreFilters() {
    this.#populateFilterDropdowns('explore');
    this.#populateExplorePlayerFilter();

    const sessionSel = document.getElementById('explore-session-filter');
    const statusSel = document.getElementById('explore-status-filter');

    if (sessionSel) {
      const sessions = this.ds.getSessionList();
      sessionSel.innerHTML = '<option value="">전체 세션</option>' +
        sessions.map(s => `<option value="${s.id}">${s.label} (${s.count})</option>`).join('');
    }

    if (statusSel) {
      statusSel.innerHTML = `
        <option value="">전체 상태</option>
        <option value="OK">OK (완주)</option>
        <option value="DNS">DNS</option>
        <option value="DNF">DNF</option>
      `;
    }
  }

  #populateExplorePlayerFilter() {
    const genderSel = document.getElementById('explore-gender-filter');
    const natSel = document.getElementById('explore-nat-filter');
    const g = genderSel ? genderSel.value : '';
    const n = natSel ? natSel.value : '';
    this.#populatePlayerSelect('explore-player-filter', g, n);
  }

  #bindExploreEvents() {
    const playerSel = document.getElementById('explore-player-filter');
    const sessionSel = document.getElementById('explore-session-filter');
    const statusSel = document.getElementById('explore-status-filter');
    const genderSel = document.getElementById('explore-gender-filter');
    const natSel = document.getElementById('explore-nat-filter');

    let _debounce = null;
    const onChange = (immediate = false) => {
      clearTimeout(_debounce);
      _debounce = setTimeout(() => {
        this._explorePage = 1;
        this.#renderExploreTab();
      }, immediate ? 0 : UIController.TIMING.DEBOUNCE);
    };

    if (playerSel) playerSel.addEventListener('change', () => onChange(true));
    if (sessionSel) sessionSel.addEventListener('change', () => onChange(true));
    if (statusSel) statusSel.addEventListener('change', () => onChange(true));
    if (genderSel) {
      genderSel.addEventListener('change', () => {
        this.#populateExplorePlayerFilter();
        onChange(true);
      });
    }
    if (natSel) {
      natSel.addEventListener('change', () => {
        this.#populateExplorePlayerFilter();
        onChange(true);
      });
    }

    // 모달 오버레이 클릭 닫기
    const overlay = document.getElementById('explore-overlay');
    if (overlay) overlay.addEventListener('click', () => {
      UIController.closeModal(
        document.getElementById('explore-modal'),
        overlay
      );
    });



  }

  #renderExploreTab() {
    const playerSel = this.#el('explore-player-filter');
    const sessionSel = this.#el('explore-session-filter');
    const statusSel = this.#el('explore-status-filter');
    const genderSel = this.#el('explore-gender-filter');
    const natSel = this.#el('explore-nat-filter');

    const filters = {
      name: playerSel ? playerSel.value : '',
      session: sessionSel ? sessionSel.value : '',
      status: statusSel ? statusSel.value : '',
      gender: genderSel ? genderSel.value : '',
      nat: natSel ? natSel.value : '',
    };

    // 활성 필터 칩 표시
    this.#renderFilterChips(filters);

    const records = this.ds.getFilteredRecords(filters);
    // Tabulator 사용 시 자체 정렬/페이징, 아닐 때만 수동 옵션 전달
    if (typeof Tabulator !== 'undefined') {
      this.table.renderExploreTable('explore-table', records);
    } else {
      this.table.renderExploreTable('explore-table', records, {
        page: this._explorePage,
        pageSize: 20,
        sortBy: this._exploreSortBy,
        sortOrder: this._exploreSortOrder,
      });
    }
  }

  #renderFilterChips(filters) {
    let chipContainer = document.getElementById('explore-filter-chips');
    if (!chipContainer) {
      chipContainer = document.createElement('div');
      chipContainer.id = 'explore-filter-chips';
      chipContainer.className = 'filter-chips';
      const exploreTab = document.getElementById('tab-explore');
      const filterPanel = exploreTab ? exploreTab.querySelector('.panel') : null;
      if (filterPanel) filterPanel.parentNode.insertBefore(chipContainer, filterPanel.nextSibling);
    }

    const chips = [];
    if (filters.name) {
      chips.push(`<span class="filter-chip" onclick="window._ui && window._ui.clearFilter('name')">🔍 ${_esc(filters.name)} <span class="chip-x">×</span></span>`);
    }
    if (filters.session) {
      const sessionSel = document.getElementById('explore-session-filter');
      const label = sessionSel ? sessionSel.options[sessionSel.selectedIndex]?.text : filters.session;
      chips.push(`<span class="filter-chip" onclick="window._ui && window._ui.clearFilter('session')">📋 ${_esc(label)} <span class="chip-x">×</span></span>`);
    }
    if (filters.status) {
      const map = { OK: '✅ OK', DNS: '⛔ DNS', DNF: '❌ DNF' };
      chips.push(`<span class="filter-chip" onclick="window._ui && window._ui.clearFilter('status')">${map[filters.status] || filters.status} <span class="chip-x">×</span></span>`);
    }
    if (filters.gender) {
      const gMap = { M: '남자', F: '여자', MF: '혼성' };
      chips.push(`<span class="filter-chip" onclick="window._ui && window._ui.clearFilter('gender')">👤 ${gMap[filters.gender] || filters.gender} <span class="chip-x">×</span></span>`);
    }
    if (filters.nat) {
      chips.push(`<span class="filter-chip" onclick="window._ui && window._ui.clearFilter('nat')">🌐 ${_esc(filters.nat)} <span class="chip-x">×</span></span>`);
    }

    // 매칭 건수 계산
    const records = this.ds.getFilteredRecords(filters);
    const countBadge = `<span class="filter-count-badge">${records.length}건 매칭</span>`;

    if (chips.length === 0) {
      chipContainer.innerHTML = '';
      chipContainer.style.display = 'none';
    } else {
      chipContainer.style.display = '';
      chipContainer.innerHTML = chips.join('') +
        `<span class="filter-chip filter-chip-clear" onclick="window._ui && window._ui.clearFilter('all')">전체 해제</span>` +
        countBadge;
    }
  }

  clearFilter(type) {
    const filterMap = {
      name: 'explore-player-filter',
      session: 'explore-session-filter',
      status: 'explore-status-filter',
      gender: 'explore-gender-filter',
      nat: 'explore-nat-filter',
    };
    for (const [key, id] of Object.entries(filterMap)) {
      if (type === key || type === 'all') {
        const el = document.getElementById(id);
        if (el) el.value = '';
      }
    }
    this._explorePage = 1;
    this.#renderExploreTab();
  }

  exploreGoPage(page) {
    this._explorePage = page;
    this.#renderExploreTab();
  }

  exploreSort(field) {
    if (this._exploreSortBy === field) {
      this._exploreSortOrder = this._exploreSortOrder === 'asc' ? 'desc' : 'asc';
    } else {
      this._exploreSortBy = field;
      this._exploreSortOrder = field === 'date' ? 'desc' : 'asc';
    }
    this._explorePage = 1;
    this.#renderExploreTab();
  }

  // ─── Tab 5: 트랙 맵 ──────────────────────────────────────────
  #bindTrackMapEvents() {
    const playerSel = document.getElementById('trackmap-player-select');
    const runSel = document.getElementById('trackmap-run-select');
    if (playerSel) {
      playerSel.addEventListener('change', () => {
        const name = playerSel.value;
        this.#populateTrackMapRuns(name);
        this.trackMap.clearPlayerData();
        this.#hideTrackMapStats();
      });
    }

    if (runSel) {
      runSel.addEventListener('change', () => {
        const name = playerSel ? playerSel.value : '';
        const runIdx = runSel.value;
        if (!name || runIdx === '') {
          this.trackMap.clearPlayerData();
          this.#hideTrackMapStats();
          return;
        }
        const records = this.ds.getPlayerRecords(name)
          .filter(r => r.status === 'OK' && r.finish != null);
        const run = records[parseInt(runIdx)];
        if (run) {
          this.trackMap.updateWithPlayer(name, run);
          this.#renderTrackMapStats(name, run);
        }
      });
    }

  }

  #populateTrackMapRuns(name, runSelectId = 'trackmap-run-select') {
    const runSel = document.getElementById(runSelectId);
    if (!runSel) return;

    const placeholder = '-- 기록 선택 --';
    if (!name) {
      runSel.innerHTML = `<option value="">${placeholder}</option>`;
      runSel.disabled = true;
      return;
    }

    const records = this.ds.getPlayerRecords(name)
      .filter(r => r.status === 'OK' && r.finish != null);

    runSel.innerHTML = `<option value="">${placeholder}</option>` +
      records.map((r, i) => {
        const dateStr = r.date && r.date !== 'unknown' ? r.date : '날짜미상';
        const finishStr = r.finish != null ? parseFloat(r.finish).toFixed(3) : '-';
        return `<option value="${i}">${dateStr} Run${r.run} - ${finishStr}초</option>`;
      }).join('');
    runSel.disabled = false;
  }

  #renderTrackMapStats(name, run) {
    const el = this.#el('trackmap-segment-stats');
    if (!el) return;
    const hintEl = this.#el('trackmap-empty-hint');
    if (hintEl) hintEl.style.display = 'none';

    const splitStats = this.analyzer.getSplitStats(name);
    const cumulative = [
      run.start_time, run.int1, run.int2, run.int3, run.int4, run.finish
    ].map(v => v != null ? parseFloat(v) : null);

    const segLabels = ['Start', 'Start→Int.1', 'Int.1→2', 'Int.2→3', 'Int.3→4', 'Int.4→F'];
    const segColors = ['#2e7d32', '#2e7d32', '#1565c0', '#6a1b9a', '#e65100', '#c62828'];

    let rows = '';
    for (let i = 0; i < 6; i++) {
      let segTime = '-';
      let vsAvg = '';
      if (i === 0 && cumulative[0] != null) {
        segTime = cumulative[0].toFixed(3);
      } else if (i > 0 && cumulative[i - 1] != null && cumulative[i] != null) {
        segTime = (cumulative[i] - cumulative[i - 1]).toFixed(3);
      }

      if (splitStats && splitStats[i] && splitStats[i].avg != null && segTime !== '-') {
        const diff = parseFloat(segTime) - splitStats[i].avg;
        const sign = diff >= 0 ? '+' : '';
        const color = diff <= 0 ? '#2e7d32' : '#c62828';
        vsAvg = `<span style="color:${color};font-weight:600">${sign}${diff.toFixed(3)}</span>`;
      }

      const avgStr = splitStats && splitStats[i] && splitStats[i].avg != null
        ? splitStats[i].avg.toFixed(3) : '-';
      const bestStr = splitStats && splitStats[i] && splitStats[i].best != null
        ? splitStats[i].best.toFixed(3) : '-';

      rows += `
        <tr>
          <td style="font-weight:600;color:${segColors[i]}">${segLabels[i]}</td>
          <td style="text-align:right;font-weight:700">${segTime}초</td>
          <td style="text-align:right">${avgStr}초</td>
          <td style="text-align:right">${bestStr}초</td>
          <td style="text-align:right">${vsAvg}</td>
        </tr>
      `;
    }

    el.style.display = '';
    el.innerHTML = `
      <h3 style="margin-top:0">구간별 상세 분석 — ${_esc(name)}</h3>
      <table style="width:100%">
        <thead>
          <tr>
            <th>구간</th>
            <th style="text-align:right">이번 기록</th>
            <th style="text-align:right">평균</th>
            <th style="text-align:right">최고</th>
            <th style="text-align:right">vs 평균</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="font-size:0.8em;color:var(--c-text-muted);margin-top:0.5rem">
        Finish: <strong>${run.finish != null ? parseFloat(run.finish).toFixed(3) : '-'}초</strong>
        ${run.speed != null ? ' | 속도: ' + parseFloat(run.speed).toFixed(1) + ' km/h' : ''}
      </p>
      ${run.temp != null ? `
      <div style="margin-top:0.6rem;padding:0.6rem 1rem;background:#e8f4fd;border-radius:6px;font-size:0.85em">
        <strong>당일 날씨</strong>:
        기온 <strong>${parseFloat(run.temp).toFixed(1)}°C</strong>
        ${run.wind != null ? ' | 풍속 <strong>' + parseFloat(run.wind).toFixed(1) + ' m/s</strong>' : ''}
        ${run.humidity != null ? ' | 습도 <strong>' + parseFloat(run.humidity).toFixed(0) + '%</strong>' : ''}
      </div>` : ''}
    `;
  }

  #hideTrackMapStats() {
    const el = this.#el('trackmap-segment-stats');
    if (el) el.style.display = 'none';
    const hintEl = this.#el('trackmap-empty-hint');
    if (hintEl) hintEl.style.display = '';
  }

  // ─── 탭 상태 저장/복원 (sessionStorage 기반) ─────────────────
  #saveTabState() {
    const activeTab = document.querySelector('.tab-btn.active');
    const tab = activeTab ? activeTab.dataset.tab : 'prediction';
    const state = { tab };
    // 현재 탭의 선수 선택 저장
    const selectors = {
      analysis: 'analysis-player-select',
      trackmap: 'trackmap-player-select',
    };
    if (selectors[tab]) {
      const sel = document.getElementById(selectors[tab]);
      if (sel && sel.value) state.player = sel.value;
    }
    // 비교 탭 선수 목록 저장
    if (tab === 'compare') {
      const checked = [...document.querySelectorAll('.compare-chk:checked')].map(c => c.value);
      if (checked.length > 0) state.compare = checked;
    }
    try { sessionStorage.setItem('skel-tab-state', JSON.stringify(state)); } catch(e) {}
  }

  #restoreTabState() {
    let raw;
    try { raw = sessionStorage.getItem('skel-tab-state'); } catch(e) {}
    if (!raw) return;
    try {
      const state = JSON.parse(raw);
      const tab = state.tab;
      if (tab) {
        const btn = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
        if (btn) btn.click();
      }
      if (state.player && tab) {
        const selectors = {
          analysis: 'analysis-player-select',
          trackmap: 'trackmap-player-select',
        };
        if (selectors[tab]) {
          const sel = document.getElementById(selectors[tab]);
          if (sel) {
            sel.value = state.player;
            sel.dispatchEvent(new Event('change'));
          }
        }
      }
      // 비교 선수 복원
      if (state.compare && tab === 'compare') {
        setTimeout(() => {
          state.compare.forEach(name => {
            const chk = [...document.querySelectorAll('.compare-chk')].find(c => c.value === name);
            if (chk) chk.checked = true;
          });
          this.#updateCompareCount();
        }, 100);
      }
    } catch (e) { /* ignore bad state */ }
  }

  exportCSV() {
    const filters = {
      name: this.#el('explore-player-filter')?.value || '',
      session: this.#el('explore-session-filter')?.value || '',
      status: this.#el('explore-status-filter')?.value || '',
      gender: this.#el('explore-gender-filter')?.value || '',
      nat: this.#el('explore-nat-filter')?.value || '',
    };
    const records = this.ds.getFilteredRecords(filters);
    const headers = ['date','name','session','nat','gender','status','start_time','int1','int2','int3','int4','finish','speed','temp','humidity','wind'];
    const csvRows = [headers.join(',')];
    for (const r of records) {
      csvRows.push(headers.map(h => {
        const v = r[h];
        if (v == null) return '';
        const s = String(v);
        return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(','));
    }
    const blob = new Blob(['\uFEFF' + csvRows.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `skeleton_records_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    if (this.notyf) this.notyf.success('CSV 파일이 다운로드되었습니다');
  }

  // ─── JSON 내보내기 ──────────────────────────────────────
  exportJSON() {
    const filters = {
      name: this.#el('explore-player-filter')?.value || '',
      session: this.#el('explore-session-filter')?.value || '',
      status: this.#el('explore-status-filter')?.value || '',
      gender: this.#el('explore-gender-filter')?.value || '',
      nat: this.#el('explore-nat-filter')?.value || '',
    };
    const records = this.ds.getFilteredRecords(filters);
    const fields = ['date','name','session','nat','gender','status','start_time','int1','int2','int3','int4','finish','speed','temp','humidity','wind'];
    const clean = records.map(r => {
      const obj = {};
      for (const f of fields) { if (r[f] != null) obj[f] = r[f]; }
      return obj;
    });
    const json = JSON.stringify({ exportDate: new Date().toISOString(), count: clean.length, filters, records: clean }, null, 2);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `skeleton_records_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    if (this.notyf) this.notyf.success('JSON 파일이 다운로드되었습니다');
  }


  #getActivePlayerName() {
    const activeTab = document.querySelector('.tab-btn.active');
    const tab = activeTab ? activeTab.dataset.tab : '';
    const selMap = {
      analysis: 'analysis-player-select',
      trackmap: 'trackmap-player-select',
    };
    if (selMap[tab]) {
      const sel = document.getElementById(selMap[tab]);
      if (sel && sel.value) return sel.value;
    }
    return '';
  }

  // ─── html2canvas 캡처 (lazy loading) ─────────────────────
  #bindCaptureButtons() {
    document.querySelectorAll('.capture-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const targetId = btn.dataset.target;
        const target = document.getElementById(targetId);
        if (!target) return;
        btn.disabled = true;
        btn.textContent = '로딩 중...';
        try {
          await this.#ensureCaptureLibs();
          btn.textContent = '캡처 중...';
          const canvas = await html2canvas(target, {
            backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--c-bg').trim() || '#ffffff',
            scale: 2,
            useCORS: true
          });
          const link = document.createElement('a');
          const activePlayer = this.#getActivePlayerName().replace(/[^\w\u3131-\uD79D]/g, '');
          const fileName = activePlayer
            ? `skeleton_${activePlayer}_${targetId}_${new Date().toISOString().slice(0,10)}`
            : `skeleton_${targetId}_${new Date().toISOString().slice(0,10)}`;
          link.download = fileName + '.png';
          link.href = canvas.toDataURL('image/png');
          link.click();
          if (this.notyf) this.notyf.success('이미지가 저장되었습니다');
        } catch (e) {
          if (this.notyf) this.notyf.error('이미지 저장 중 오류 발생');
        }
        btn.disabled = false;
        btn.textContent = '이미지로 저장';
      });
    });
  }

  // ─── jsPDF PDF 내보내기 (lazy loading) ────────────────────
  #bindPdfButtons() {
    document.querySelectorAll('.pdf-export-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const targetId = btn.dataset.target;
        const target = document.getElementById(targetId);
        if (!target) return;
        btn.disabled = true;
        btn.textContent = '로딩 중...';
        try {
          await this.#ensureCaptureLibs();
          btn.textContent = 'PDF 생성 중...';
          const canvas = await html2canvas(target, {
            backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--c-bg').trim() || '#ffffff',
            scale: 2,
            useCORS: true
          });
          const imgData = canvas.toDataURL('image/png');
          const { jsPDF } = window.jspdf;
          const pdf = new jsPDF({
            orientation: canvas.width > canvas.height ? 'l' : 'p',
            unit: 'px',
            format: [canvas.width, canvas.height]
          });
          pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height);
          const activePlayer = this.#getActivePlayerName().replace(/[^\w\u3131-\uD79D]/g, '');
          const fileName = activePlayer
            ? `skeleton_${activePlayer}_${targetId}_${new Date().toISOString().slice(0,10)}`
            : `skeleton_${targetId}_${new Date().toISOString().slice(0,10)}`;
          pdf.save(fileName + '.pdf');
          if (this.notyf) this.notyf.success('PDF가 저장되었습니다');
        } catch (e) {
          if (this.notyf) this.notyf.error('PDF 저장 중 오류 발생');
        }
        btn.disabled = false;
        btn.textContent = 'PDF 저장';
      });
    });
  }


  // ─── Tippy.js 툴팁 ───────────────────────────────────────
  #initTippy() {
    if (typeof tippy === 'undefined') return;
    tippy('#pred-run-btn', { content: '입력한 조건으로 피니시 시간을 예측합니다', placement: 'bottom' });
    tippy('.capture-btn', { content: '현재 영역을 PNG 이미지로 저장', placement: 'top' });
    tippy('.pdf-export-btn', { content: '현재 영역을 PDF로 저장', placement: 'top' });
    // 탭 버튼 툴팁
    const tabDescriptions = {
      prediction: '스타트 시간으로 피니시 예측',
      analysis: '개인 기록 추이·구간·날씨 분석',
      compare: `최대 ${UIController.MAX_COMPARE}명 선수 비교`,
      explore: '전체 데이터 검색·필터·정렬',
      trackmap: '구간별 시각적 비교 분석'
    };
    document.querySelectorAll('.tab-btn').forEach(btn => {
      const desc = tabDescriptions[btn.dataset.tab];
      if (desc) tippy(btn, { content: desc, placement: 'bottom', delay: [500, 0] });
    });
  }

  // ─── 단축키 도움말 토글 ──────────────────────────────────
  #toggleShortcutHelp() {
    let modal = document.getElementById('shortcut-help-modal');
    let overlay = document.getElementById('shortcut-help-overlay');
    if (!modal) {
      overlay = document.createElement('div');
      overlay.id = 'shortcut-help-overlay';
      overlay.className = 'modal-overlay hidden';
      overlay.addEventListener('click', () => {
        UIController.closeModal(modal, overlay);
      });
      document.body.appendChild(overlay);

      modal = document.createElement('div');
      modal.id = 'shortcut-help-modal';
      modal.className = 'modal hidden shortcut-help';
      modal.innerHTML = `
        <h3 style="margin:0 0 1rem">⌨️ 키보드 단축키</h3>
        <table class="shortcut-table">
          <thead><tr><th>키</th><th>동작</th></tr></thead>
          <tbody>
            <tr><td><kbd>1</kbd>~<kbd>5</kbd></td><td>탭 전환 (예측/분석/비교/탐색/트랙맵)</td></tr>
            <tr><td><kbd>D</kbd></td><td>다크 모드 전환</td></tr>
            <tr><td><kbd>R</kbd></td><td>예측 실행 (예측 탭)</td></tr>
            <tr><td><kbd>Ctrl</kbd>+<kbd>E</kbd></td><td>CSV 내보내기</td></tr>
            <tr><td><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>E</kbd></td><td>XLSX 내보내기</td></tr>
            <tr><td><kbd>J</kbd></td><td>JSON 내보내기</td></tr>
            <tr><td><kbd>?</kbd></td><td>이 도움말 열기/닫기</td></tr>
            <tr><td><kbd>Esc</kbd></td><td>모달/도움말 닫기</td></tr>
            <tr><td><kbd>←</kbd><kbd>→</kbd></td><td>탭 버튼 포커스 시 전환</td></tr>
          </tbody>
        </table>
        <button onclick="UIController.closeModal(document.getElementById('shortcut-help-modal'),document.getElementById('shortcut-help-overlay'))" class="modal-close-btn">닫기</button>
      `;
      document.body.appendChild(modal);
    }
    const isVisible = !modal.classList.contains('hidden');
    if (isVisible) {
      UIController.closeModal(modal, overlay);
    } else {
      modal.classList.remove('hidden');
      overlay.classList.remove('hidden');
    }
  }

  // ─── XLSX 내보내기 ──────────────────────────────────────
  async exportXLSX() {
    if (typeof XLSX === 'undefined') {
      try {
        await this.#loadScript('xlsx', 'js/xlsx.min.js');
      } catch(e) {
        if (this.notyf) this.notyf.error('XLSX 라이브러리를 로드할 수 없습니다');
        return;
      }
    }
    const records = this.table._exploreRecords || this.ds.getAllRecords();
    const headers = ['날짜', '선수명', '국가', '세션', '상태', 'Start(초)', 'Int.1', 'Int.2', 'Int.3', 'Int.4', 'Finish(초)', 'km/h', '기온(°C)', '풍속(m/s)'];
    const rows = records.map(r => [
      r.date || '', r.name || '', r.nat || '', r.session || '', r.status || '',
      r.start_time != null ? parseFloat(r.start_time) : '',
      r.int1 != null ? parseFloat(r.int1) : '',
      r.int2 != null ? parseFloat(r.int2) : '',
      r.int3 != null ? parseFloat(r.int3) : '',
      r.int4 != null ? parseFloat(r.int4) : '',
      r.finish != null ? parseFloat(r.finish) : '',
      r.speed != null ? parseFloat(r.speed) : '',
      r.temp != null ? parseFloat(r.temp) : '',
      r.wind != null ? parseFloat(r.wind) : '',
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    // 열 너비 자동 조정
    ws['!cols'] = headers.map((h, i) => ({ wch: Math.max(h.length + 2, 10) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '경기기록');
    XLSX.writeFile(wb, `skeleton_records_${new Date().toISOString().slice(0,10)}.xlsx`);
    if (this.notyf) this.notyf.success('XLSX 파일 내보내기 완료');
  }

  // ─── 예측 신뢰도 해석 힌트 ───────────────────────────────
  #getConfidenceHint(r2, n, method) {
    if (method === 'average') {
      return n >= 10
        ? '📊 평균 기반 예측 · 데이터 충분 · 참고용으로 적합'
        : `📊 평균 기반 예측 · 데이터 ${n}개 · 더 많은 기록 시 정확도 향상`;
    }
    let level, icon, desc;
    if (r2 >= 0.9) { level = '매우 높음'; icon = '🟢'; desc = '예측 모델이 실제 데이터를 잘 설명합니다'; }
    else if (r2 >= 0.7) { level = '높음'; icon = '🟡'; desc = '양호한 예측력이지만 일부 변동성이 있습니다'; }
    else if (r2 >= 0.5) { level = '보통'; icon = '🟠'; desc = '참고용으로 활용하세요. 다른 모델도 비교해 보세요'; }
    else { level = '낮음'; icon = '🔴'; desc = '예측력이 낮습니다. 구간별 가중 모델을 추천합니다'; }
    const dataNote = n < 10 ? ` · 데이터 ${n}개 (10개 이상 권장)` : '';
    return `${icon} 신뢰도 ${level} (R²=${r2.toFixed(3)})${dataNote} — ${desc}`;
  }

  // ─── simple-statistics 고급 통계 ────────────────────────
  #getAdvancedStats(finishes) {
    if (typeof ss === 'undefined' || finishes.length < 3) return null;
    return {
      median: ss.median(finishes),
      iqr: ss.interquartileRange(finishes),
      skewness: ss.sampleSkewness(finishes),
      kurtosis: finishes.length >= 4 ? ss.sampleKurtosis(finishes) : null,
      cv: ss.standardDeviation(finishes) / ss.mean(finishes) * 100,
    };
  }

  // ─── Chart.js 테마 동기화 ────────────────────────────────
  #syncChartTheme(isDark) {
    if (typeof Chart === 'undefined') return;
    const d = Chart.defaults;
    if (isDark) {
      d.color = '#a0aab8';
      d.plugins.title.color = '#e4e8f0';
      d.scale.ticks.color = '#6b7280';
      d.scale.grid.color = 'rgba(255,255,255,0.06)';
    } else {
      d.color = '#5a6178';
      d.plugins.title.color = '#1a1a2e';
      d.scale.ticks.color = '#8b92a5';
      d.scale.grid.color = 'rgba(0,0,0,0.05)';
    }
    // 활성 차트 갱신
    Object.values(this.charts._charts).forEach(chart => {
      if (chart && typeof chart.update === 'function') {
        chart.update('none');
      }
    });
  }

  // ─── 비활성 탭 차트 메모리 정리 ──────────────────────────
  #destroyInactiveCharts(activeTab) {
    const tabCharts = {
      prediction: ['pred-chart'],
      analysis: ['analysis-trend-chart', 'analysis-split-chart', 'analysis-weather-chart', 'analysis-boxplot-chart'],
      compare: ['compare-bar-chart', 'compare-radar-chart'],
    };
    for (const [tab, chartIds] of Object.entries(tabCharts)) {
      if (tab === activeTab) continue;
      for (const id of chartIds) {
        if (this.charts._charts[id]) {
          this.charts._destroy(id);
        }
      }
    }
  }

  // ─── 숫자 카운트업 애니메이션 ─────────────────────────────
  // ─── 모달 닫힘 애니메이션 ──────────────────────────────────
  static closeModal(modalEl, overlayEl) {
    if (!modalEl || modalEl.classList.contains('hidden')) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      modalEl.classList.add('hidden');
      if (overlayEl) overlayEl.classList.add('hidden');
      return;
    }
    modalEl.classList.add('closing');
    if (overlayEl) overlayEl.classList.add('closing');
    modalEl.addEventListener('animationend', () => {
      modalEl.classList.remove('closing');
      modalEl.classList.add('hidden');
      if (overlayEl) {
        overlayEl.classList.remove('closing');
        overlayEl.classList.add('hidden');
      }
    }, { once: true });
  }

  static animateCountUp(container) {
    if (!container) return;
    const els = container.querySelectorAll('.stat-value');
    els.forEach(el => {
      const text = el.textContent.trim();
      const num = parseFloat(text);
      if (isNaN(num) || num === 0) return;

      // 정수인지 소수인지 판별
      const decimals = text.includes('.') ? (text.split('.')[1] || '').replace(/[^0-9]/g, '').length : 0;
      const suffix = text.replace(/[\d.,\-]/g, '').trim(); // %, 초 등
      const start = 0;
      const duration = 500;
      const startTime = performance.now();

      const tick = (now) => {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        // easeOutQuart
        const eased = 1 - Math.pow(1 - progress, 4);
        const current = start + (num - start) * eased;
        el.textContent = current.toFixed(decimals) + suffix;
        if (progress < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  // ─── 인스턴스 정리 ───────────────────────────────────────
  destroy() {
    // Chart 인스턴스 정리
    Object.values(this.charts._charts).forEach(chart => {
      if (chart && typeof chart.destroy === 'function') chart.destroy();
    });
    this.charts._charts = {};
    // Tabulator 인스턴스 정리
    if (this.table._tabulatorInstance) {
      this.table._tabulatorInstance.destroy();
      this.table._tabulatorInstance = null;
    }
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  await _supabaseReady;
  const ui = new UIController();
  ui.init();
  const dash = new DashboardController(ui.ds, ui.predModel, ui.charts, ui.trackMap);
  dash.init();
});
