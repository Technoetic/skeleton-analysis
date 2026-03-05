function _esc(str) {
  if (str == null) return '-';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

class TableRenderer {
  static escape(str) { return _esc(str); }
  static STATUS_MAP = {
    OK: '<span class="status-badge status-ok">✅ 완주</span>',
    DNS: '<span class="status-badge status-dns">⛔ DNS</span>',
    DNF: '<span class="status-badge status-dnf">❌ DNF</span>',
  };
  static fmtNum(val, decimals = 3, fallback = '-') {
    return val != null ? parseFloat(val).toFixed(decimals) : fallback;
  }
  constructor(dataStore) {
    this.ds = dataStore;
    this._explorePage = 1;
    this._explorePageSize = 20;
    this._exploreRecords = [];
    this._exploreSortBy = 'date';
    this._exploreSortOrder = 'desc';
    this._tabulatorInstance = null;
  }

  // ─── Tabulator 기반 고급 탐색 테이블 ────────────────────────
  renderExploreTable(containerId, records, options = {}) {
    this._exploreRecords = records;

    // Tabulator 사용 가능하면 고급 테이블
    if (typeof Tabulator !== 'undefined') {
      return this._renderTabulator(containerId, records);
    }

    // Fallback: 기존 수동 테이블
    return this._renderFallbackTable(containerId, records, options);
  }

  _renderTabulator(containerId, records) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const fmtDate = (d) => typeof UIController !== 'undefined' ? UIController.fmtDate(d) : ((!d || d === 'unknown') ? '-' : d);
    const statusMap = TableRenderer.STATUS_MAP;

    // Tabulator 데이터 변환
    const data = records.map((r, i) => ({
      _idx: i,
      _raw: r,
      date: r.date || '',
      dateFmt: fmtDate(r.date),
      name: r.name || '-',
      session: r.session || '-',
      status: r.status || '-',
      statusFmt: statusMap[r.status] || r.status || '-',
      finish: r.finish != null ? parseFloat(r.finish) : null,
      start_time: r.start_time != null ? parseFloat(r.start_time) : null,
      speed: r.speed != null ? parseFloat(r.speed) : null,
      temp: r.temp != null ? parseFloat(r.temp) : null,
      wind: r.wind != null ? parseFloat(r.wind) : null,
    }));

    // 기존 인스턴스 파괴
    if (this._tabulatorInstance) {
      try { this._tabulatorInstance.destroy(); } catch(e) {}
      this._tabulatorInstance = null;
    }
    container.innerHTML = '';

    // 다크 모드 여부
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark' ||
                   window.matchMedia('(prefers-color-scheme: dark)').matches;

    // 컬럼 정의
    const columns = [
      {
        title: '날짜', field: 'date', sorter: (a, b) => {
          const aV = a && a !== 'unknown', bV = b && b !== 'unknown';
          if (aV && !bV) return 1; if (!aV && bV) return -1; if (!aV && !bV) return 0;
          return String(a).localeCompare(String(b));
        },
        formatter: (cell) => cell.getData().dateFmt,
        minWidth: 130, hozAlign: 'center', headerHozAlign: 'center'
      },
      { title: '선수명', field: 'name', minWidth: 100, hozAlign: 'center', headerHozAlign: 'center' },
      { title: '세션', field: 'session', minWidth: 110, hozAlign: 'center', headerHozAlign: 'center' },
      {
        title: '상태', field: 'status', minWidth: 80, hozAlign: 'center', headerHozAlign: 'center',
        formatter: function(cell) {
          cell.getElement().innerHTML = cell.getData().statusFmt || '-';
          return '';
        }
      },
      {
        title: 'Finish(초)', field: 'finish', sorter: 'number', hozAlign: 'center', headerHozAlign: 'center', minWidth: 95,
        formatter: (cell) => { const v = cell.getValue(); return v != null && typeof v === 'number' ? v.toFixed(3) : '-'; }
      },
      {
        title: 'Start(초)', field: 'start_time', sorter: 'number', hozAlign: 'center', headerHozAlign: 'center', minWidth: 85,
        formatter: (cell) => { const v = cell.getValue(); return v != null && typeof v === 'number' ? v.toFixed(3) : '-'; }
      },
      {
        title: 'km/h', field: 'speed', sorter: 'number', hozAlign: 'center', headerHozAlign: 'center', minWidth: 70,
        formatter: (cell) => { const v = cell.getValue(); return v != null && typeof v === 'number' ? v.toFixed(1) : '-'; }
      },
      {
        title: '기온(°C)', field: 'temp', sorter: 'number', hozAlign: 'center', headerHozAlign: 'center', minWidth: 75,
        formatter: (cell) => { const v = cell.getValue(); return v != null && typeof v === 'number' ? v.toFixed(1) : '-'; }
      },
      {
        title: '풍속(m/s)', field: 'wind', sorter: 'number', hozAlign: 'center', headerHozAlign: 'center', minWidth: 80,
        formatter: (cell) => { const v = cell.getValue(); return v != null && typeof v === 'number' ? v.toFixed(1) : '-'; }
      },
    ];

    // Cache minimum finish time for highlighting (calculated once, not per-row)
    const allFinishes = records
      .filter(r => r.status === 'OK' && r.finish != null)
      .map(r => parseFloat(r.finish));
    const cachedMinFinish = allFinishes.length > 0 ? Math.min(...allFinishes) : Infinity;

    const self = this;
    requestAnimationFrame(() => { try {
    this._tabulatorInstance = new Tabulator(container, {
      data: data,
      columns: columns,
      layout: 'fitColumns',
      pagination: 'local',
      paginationSize: 25,
      paginationCounter: (pageSize, currentRow, currentPage, totalRows, totalPages) =>
        `총 ${totalRows}개 중 ${currentRow}-${Math.min(currentRow + pageSize - 1, totalRows)}번째 (${totalPages}페이지 중 ${currentPage})`,
      movableColumns: true,
      resizableColumns: true,
      initialSort: [{ column: 'date', dir: 'desc' }],
      placeholder: '<div style="text-align:center;padding:2rem;color:#888">데이터가 없습니다</div>',
      rowClick: function(e, row) {
        const raw = row.getData()._raw;
        if (raw) self.renderDetailModal(raw);
      },
      rowFormatter: function(row) {
        const data = row.getData();
        if (data.status === 'DNS' || data.status === 'DNF') {
          row.getElement().style.opacity = '0.6';
        }
        // 최고 기록 하이라이트 (cached minimum finish time)
        if (data.finish != null && Math.abs(data.finish - cachedMinFinish) < 0.001) {
          row.getElement().style.background = 'linear-gradient(90deg, rgba(232,168,32,0.12), transparent)';
          row.getElement().style.borderLeft = '3px solid #e8a820';
        }
      },
      locale: 'ko',
      langs: {
        'ko': {
          pagination: {
            page_size: '페이지당',
            page_title: '페이지',
            first: '«',
            first_title: '첫 페이지',
            last: '»',
            last_title: '마지막 페이지',
            prev: '‹',
            prev_title: '이전 페이지',
            next: '›',
            next_title: '다음 페이지',
            counter: {
              showing: '',
              of: '/',
              rows: '행',
              pages: '페이지'
            }
          },
          headerFilters: {
            default: '검색...',
          }
        }
      }
    });
    } catch(e) { console.error('Tabulator init error:', e); container.innerHTML = '<p style="color:red;padding:1rem">테이블 렌더링 오류</p>'; }
    }); // rAF end
  }

  // ─── Fallback: 기존 수동 테이블 (Tabulator 미로드 시) ──────
  _renderFallbackTable(containerId, records, options = {}) {
    const { page = 1, pageSize = 20, sortBy = 'date', sortOrder = 'desc' } = options;
    this._explorePage = page;
    this._explorePageSize = pageSize;
    this._exploreSortBy = sortBy;
    this._exploreSortOrder = sortOrder;

    let sorted = [...records];
    sorted.sort((a, b) => {
      let va = a[sortBy] ?? '', vb = b[sortBy] ?? '';
      if (sortBy === 'date') {
        const aValid = va && va !== 'unknown';
        const bValid = vb && vb !== 'unknown';
        if (aValid && !bValid) return -1;
        if (!aValid && bValid) return 1;
        if (!aValid && !bValid) return 0;
      }
      if (typeof va === 'number') return sortOrder === 'asc' ? va - vb : vb - va;
      return sortOrder === 'asc' ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
    });

    const total = sorted.length;
    const start = (page - 1) * pageSize;
    const pageRecords = sorted.slice(start, start + pageSize);

    const container = document.getElementById(containerId);
    if (!container) return;

    const headers = ['날짜', '선수명', '세션', '상태', 'Finish(초)', 'Start(초)', 'km/h', '기온(°C)', '풍속(m/s)'];
    const sortableFields = ['date', 'name', 'session', 'status', 'finish', 'start_time', 'speed', 'temp', 'wind'];
    const fmtDate = (d) => typeof UIController !== 'undefined' ? UIController.fmtDate(d) : ((!d || d === 'unknown') ? '-' : d);
    const rows = pageRecords.map(r => [
      fmtDate(r.date),
      r.name || '-',
      r.session || '-',
      this._statusBadge(r.status),
      r.finish != null ? parseFloat(r.finish).toFixed(3) : '-',
      r.start_time != null ? parseFloat(r.start_time).toFixed(3) : '-',
      r.speed != null ? parseFloat(r.speed).toFixed(1) : '-',
      r.temp != null ? parseFloat(r.temp).toFixed(1) : '-',
      r.wind != null ? parseFloat(r.wind).toFixed(1) : '-',
    ]);

    container.innerHTML = `
      <div style="margin-bottom:0.5rem;color:var(--c-text-muted);font-size:0.84rem">총 <strong style="color:var(--c-text)">${total}</strong>개 중 ${start+1}~${Math.min(start+pageSize,total)}번째 <span style="margin-left:0.5rem;font-size:0.78rem;opacity:0.7">· 행을 클릭하면 상세 기록을 확인할 수 있습니다</span></div>
      ${this.#buildTableHTML(headers, rows, sortableFields)}
      ${this.#buildPagination(total, page, pageSize, containerId)}
    `;

    container.querySelectorAll('tbody tr').forEach((tr, i) => {
      tr.addEventListener('click', () => this.renderDetailModal(pageRecords[i]));
    });
  }

  renderSessionTable(containerId, records) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const valid = records.filter(r => r.status === 'OK' && r.finish != null);
    const headers = ['날짜', 'Run', '세션', 'Start', 'Int.1', 'Int.2', 'Int.3', 'Int.4', 'Finish', 'km/h'];
    const fmtDate = (d) => typeof UIController !== 'undefined' ? UIController.fmtDate(d) : ((!d || d === 'unknown') ? '-' : d);
    const rows = valid.map(r => [
      fmtDate(r.date), r.run || '-', r.session || '-',
      r.start_time != null ? parseFloat(r.start_time).toFixed(2) : '-',
      r.int1 != null ? parseFloat(r.int1).toFixed(2) : '-',
      r.int2 != null ? parseFloat(r.int2).toFixed(2) : '-',
      r.int3 != null ? parseFloat(r.int3).toFixed(2) : '-',
      r.int4 != null ? parseFloat(r.int4).toFixed(2) : '-',
      r.finish != null ? parseFloat(r.finish).toFixed(3) : '-',
      r.speed != null ? parseFloat(r.speed).toFixed(1) : '-',
    ]);
    container.innerHTML = this.#buildTableHTML(headers, rows);
  }

  renderCompareTable(containerId, compareData) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const headers = ['선수명', '기록수', '평균(초)', '최고(초)', '최저(초)', '표준편차', '일관성'];
    const rows = compareData.map(d => {
      const s = d.stats;
      if (!s) return [d.name, '-', '-', '-', '-', '-', '-'];
      return [d.name, s.count, s.avg.toFixed(3), s.best.toFixed(3), s.worst.toFixed(3),
              s.stddev.toFixed(3), (s.consistency * 100).toFixed(1) + '%'];
    });
    container.innerHTML = this.#buildTableHTML(headers, rows);
  }

  renderDetailModal(record) {
    const overlay = document.getElementById('explore-overlay');
    const modal = document.getElementById('explore-modal');
    if (!modal) return;
    modal.innerHTML = `
      <h3 style="margin:0 0 1rem">상세 기록</h3>
      <table style="width:100%">
        <tr><th>선수</th><td>${TableRenderer.escape(record.name)}</td><th>국가</th><td>${TableRenderer.escape(record.nat)}</td></tr>
        <tr><th>날짜</th><td>${TableRenderer.escape(typeof UIController !== 'undefined' ? UIController.fmtDate(record.date) : (record.date && record.date !== 'unknown' ? record.date : '-'))}</td><th>Run</th><td>${TableRenderer.escape(record.run)}</td></tr>
        <tr><th>세션</th><td colspan="3">${TableRenderer.escape(record.session)}</td></tr>
        <tr><th>상태</th><td colspan="3">${TableRenderer.escape(record.status)}</td></tr>
        <tr><th>Start</th><td>${record.start_time != null ? parseFloat(record.start_time).toFixed(3) : '-'}</td>
            <th>km/h</th><td>${record.speed != null ? parseFloat(record.speed).toFixed(1) : '-'}</td></tr>
        <tr><th>Int.1(누적)</th><td>${record.int1 != null ? parseFloat(record.int1).toFixed(3) : '-'}</td>
            <th>Int.2(누적)</th><td>${record.int2 != null ? parseFloat(record.int2).toFixed(3) : '-'}</td></tr>
        <tr><th>Int.3(누적)</th><td>${record.int3 != null ? parseFloat(record.int3).toFixed(3) : '-'}</td>
            <th>Int.4(누적)</th><td>${record.int4 != null ? parseFloat(record.int4).toFixed(3) : '-'}</td></tr>
        <tr><th>Finish</th><td colspan="3"><strong>${record.finish != null ? parseFloat(record.finish).toFixed(3) : '-'}초</strong></td></tr>
        <tr><th>기온</th><td>${record.temp != null ? parseFloat(record.temp).toFixed(1) + '°C' : '-'}</td>
            <th>풍속</th><td>${record.wind != null ? parseFloat(record.wind).toFixed(1) + ' m/s' : '-'}</td></tr>
        <tr><th>습도</th><td colspan="3">${record.humidity != null ? parseFloat(record.humidity).toFixed(0) + '%' : '-'}</td></tr>
      </table>
      <button onclick="UIController.closeModal(document.getElementById('explore-modal'),document.getElementById('explore-overlay'))"
              class="modal-close-btn">닫기</button>
    `;
    modal.classList.remove('hidden');
    if (overlay) overlay.classList.remove('hidden');
  }

  _statusBadge(status) {
    const map = { OK: '✅ 완주', DNS: '⛔ DNS', DNF: '❌ DNF' };
    return map[status] || status;
  }

  #buildTableHTML(headers, rows, sortableFields = null) {
    const thead = `<thead><tr>${headers.map((h, i) => {
      if (sortableFields && sortableFields[i]) {
        const field = sortableFields[i];
        const isActive = this._exploreSortBy === field;
        const arrow = isActive ? (this._exploreSortOrder === 'asc' ? ' ▲' : ' ▼') : '';
        const cls = isActive ? ' class="sorted"' : '';
        return `<th${cls} style="cursor:pointer" onclick="window._ui && window._ui.exploreSort('${field}')">${h}${arrow}</th>`;
      }
      return `<th>${h}</th>`;
    }).join('')}</tr></thead>`;
    const tbody = `<tbody>${rows.map(row =>
      `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`
    ).join('')}</tbody>`;
    return `<table>${thead}${tbody}</table>`;
  }

  #buildPagination(total, page, pageSize, containerId) {
    const totalPages = Math.ceil(total / pageSize);
    if (totalPages <= 1) return '';
    const pages = [];
    for (let p = Math.max(1, page-2); p <= Math.min(totalPages, page+2); p++) {
      pages.push(`<button class="page-btn${p===page?' active':''}" onclick="window._ui && window._ui.exploreGoPage(${p})">${p}</button>`);
    }
    return `<div class="pagination">
      <button class="page-btn" onclick="window._ui && window._ui.exploreGoPage(1)">«</button>
      ${pages.join('')}
      <button class="page-btn" onclick="window._ui && window._ui.exploreGoPage(${totalPages})">»</button>
      <span style="margin-left:1rem;color:var(--c-text-muted)">${totalPages}페이지 중 ${page}</span>
    </div>`;
  }
}
