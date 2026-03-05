// Chart.js 플러그인 등록
if (typeof ChartDataLabels !== 'undefined') Chart.register(ChartDataLabels);
// datalabels 기본: 모든 차트에서 레이블 숨김 (필요시 개별 차트에서 활성화)
Chart.defaults.set('plugins.datalabels', { display: false });
// zoom 플러그인: 기본 비활성화 (필요시 개별 차트에서 활성화)
if (typeof ChartZoom !== 'undefined') Chart.register(ChartZoom);

class ChartManager {
  constructor() {
    this._charts = {};
    this._chartListeners = {};
    this._hasTippy = typeof tippy !== 'undefined';
    this._setupDefaults();
  }

  // ─── 다크모드 테마 유틸리티 ──────────────────────────────
  _isDark() {
    return document.documentElement.getAttribute('data-theme') === 'dark';
  }
  _gridColor() { return this._isDark() ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)'; }
  _textColor() { return this._isDark() ? '#e0e0e0' : '#5a6178'; }
  _titleColor() { return this._isDark() ? '#f0f0f0' : '#1a1a2e'; }
  _tickColor() { return this._isDark() ? '#9ca3af' : '#8b92a5'; }
  _dataLabelColor() { return this._isDark() ? '#e0e0e0' : '#333'; }

  _zoomConfig(xRange = 0.5, yRange = 0.5) {
    return {
      zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'xy' },
      pan: { enabled: true, mode: 'xy' },
      limits: { x: { minRange: xRange }, y: { minRange: yRange } }
    };
  }

  // ─── Chart.js 글로벌 프리미엄 테마 ────────────────────────
  _setupDefaults() {
    const d = Chart.defaults;
    // 폰트
    d.font.family = "'Noto Sans KR', 'Inter', system-ui, sans-serif";
    d.font.size = 12;
    d.color = '#5a6178';
    // 플러그인
    d.plugins.title.font = { size: 14, weight: '600', family: d.font.family };
    d.plugins.title.color = '#1a1a2e';
    d.plugins.title.padding = { top: 4, bottom: 16 };
    d.plugins.legend.labels.usePointStyle = true;
    d.plugins.legend.labels.pointStyle = 'circle';
    d.plugins.legend.labels.padding = 16;
    d.plugins.legend.labels.font = { size: 11.5, family: d.font.family };
    d.plugins.tooltip.backgroundColor = 'rgba(15,43,71,0.92)';
    d.plugins.tooltip.titleFont = { size: 12, weight: '600', family: d.font.family };
    d.plugins.tooltip.bodyFont = { size: 11.5, family: d.font.family };
    d.plugins.tooltip.padding = { top: 10, bottom: 10, left: 14, right: 14 };
    d.plugins.tooltip.cornerRadius = 8;
    d.plugins.tooltip.displayColors = true;
    d.plugins.tooltip.boxPadding = 4;
    // 그리드
    d.scale.grid = d.scale.grid || {};
    d.scale.grid.color = 'rgba(0,0,0,0.05)';
    d.scale.grid.drawBorder = false;
    d.scale.ticks = d.scale.ticks || {};
    d.scale.ticks.font = { size: 11, family: d.font.family };
    d.scale.ticks.color = '#8b92a5';
    // 요소
    d.elements.point.hoverRadius = 7;
    d.elements.point.hoverBorderWidth = 2;
    d.elements.point.hoverBorderColor = '#fff';
    d.elements.bar.borderRadius = 4;
    d.elements.bar.borderSkipped = false;
    d.elements.line.borderWidth = 2.5;
    // 애니메이션
    d.animation.duration = 600;
    d.animation.easing = 'easeOutQuart';
    // layout
    d.layout.padding = { top: 4, bottom: 4, left: 4, right: 4 };
  }

  // ─── 공통 캔버스 초기화 ────────────────────────────────────
  _initCanvas(canvasId) {
    this._destroy(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas) return null;
    this._show(canvasId);
    return canvas;
  }

  // ─── Tippy.js 차트 포인트 툴팁 ──────────────────────────
  _bindTippyTooltip(canvasId, contentFn) {
    if (!this._hasTippy) return;
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    let tippyInstance = null;
    const onMove = (e) => {
      const chart = this._charts[canvasId];
      if (!chart) return;
      const elements = chart.getElementsAtEventForMode(e, 'nearest', { intersect: true }, false);
      if (elements.length > 0 && elements[0].datasetIndex === 0) {
        const idx = elements[0].index;
        const content = contentFn(idx);
        if (!content) return;
        if (tippyInstance) { tippyInstance.destroy(); tippyInstance = null; }
        tippyInstance = tippy(canvas, {
          content, allowHTML: true, trigger: 'manual', placement: 'top', showOnCreate: true,
          getReferenceClientRect: () => {
            const pt = elements[0].element;
            const rect = canvas.getBoundingClientRect();
            return { width: 0, height: 0, top: rect.top + pt.y, bottom: rect.top + pt.y, left: rect.left + pt.x, right: rect.left + pt.x };
          }
        });
      } else if (tippyInstance) {
        tippyInstance.destroy(); tippyInstance = null;
      }
    };
    const onLeave = () => {
      if (tippyInstance) { tippyInstance.destroy(); tippyInstance = null; }
    };
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseleave', onLeave);
    this._chartListeners[canvasId] = { canvas, onMove, onLeave };
  }

  // ─── 프리미엄 색상 팔레트 ──────────────────────────────────
  _colors(n) {
    const palette = [
      '#3b82f6', // blue
      '#ef4444', // red
      '#10b981', // emerald
      '#f59e0b', // amber
      '#8b5cf6', // violet
      '#06b6d4', // cyan
      '#f97316', // orange
    ];
    return Array.from({length: n}, (_, i) => palette[i % palette.length]);
  }

  _gradient(ctx, color, height = 300) {
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, color + '40');
    grad.addColorStop(0.7, color + '08');
    grad.addColorStop(1, color + '00');
    return grad;
  }

  _destroy(id) {
    if (this._charts[id]) {
      this._charts[id].destroy();
      delete this._charts[id];
    }
    // Chart.js 전역 레지스트리에서도 제거
    const el = document.getElementById(id);
    if (el) {
      const existing = Chart.getChart(el);
      if (existing) existing.destroy();
    }
    // 이벤트 리스너 정리
    if (this._chartListeners[id]) {
      const { canvas, onMove, onLeave } = this._chartListeners[id];
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('mouseleave', onLeave);
      delete this._chartListeners[id];
    }
    if (el) { el.width = 0; el.height = 0; el.style.display = 'none'; }
    const empty = document.getElementById(id + '-empty');
    if (empty) empty.style.display = 'none';
    const resetBtn = document.getElementById(id + '-zoom-reset');
    if (resetBtn) resetBtn.remove();
  }

  _addZoomResetBtn(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    let btn = document.getElementById(canvasId + '-zoom-reset');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = canvasId + '-zoom-reset';
      btn.className = 'zoom-reset-btn';
      btn.textContent = '줌 리셋';
      btn.title = '차트 확대/축소를 초기화합니다 (더블클릭도 가능)';
      canvas.parentNode.insertBefore(btn, canvas);
    }
    btn.onclick = () => this._charts[canvasId]?.resetZoom();
    if (typeof tippy !== 'undefined') {
      tippy(btn, { content: '차트 줌/팬 초기화', placement: 'left' });
    }
  }

  _show(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = '';
    const empty = document.getElementById(id + '-empty');
    if (empty) empty.style.display = 'none';
  }

  _showEmpty(canvasId, message = '표시할 데이터가 없습니다') {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    canvas.style.display = 'none';
    let existing = document.getElementById(canvasId + '-empty');
    if (existing) {
      existing.querySelector('.empty-state-text').textContent = message;
      existing.style.display = '';
      return;
    }
    const div = document.createElement('div');
    div.id = canvasId + '-empty';
    div.className = 'chart-empty-state';
    div.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📉</div><div class="empty-state-text">${message}</div></div>`;
    canvas.parentNode.insertBefore(div, canvas.nextSibling);
  }

  // ─── 기록 추이 (라인) ─────────────────────────────────────
  renderTrendChart(canvasId, trendData, playerName) {
    const canvas = this._initCanvas(canvasId);
    if (!canvas) return;
    if (trendData.length === 0) { this._showEmpty(canvasId, '기록 추이 데이터가 없습니다'); return; }
    const ctx = canvas.getContext('2d');
    const labels = trendData.map(d => d.date);
    const values = trendData.map(d => d.finish);
    const w = 5, ma = [];
    let sum = 0, cnt = 0;
    for (let i = 0; i < values.length; i++) {
      sum += values[i]; cnt++;
      if (i >= w) { sum -= values[i - w]; cnt--; }
      ma.push(sum / cnt);
    }

    // 평균값 계산
    const avgValue = values.reduce((s, v) => s + v, 0) / values.length;

    this._charts[canvasId] = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: '기록',
            data: values,
            borderColor: '#3b82f6',
            backgroundColor: this._gradient(ctx, '#3b82f6'),
            pointRadius: 4,
            pointBackgroundColor: '#3b82f6',
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
            tension: 0.3,
            fill: true,
          },
          {
            label: '이동평균(5)',
            data: ma,
            borderColor: '#f59e0b',
            borderDash: [6, 4],
            pointRadius: 0,
            tension: 0.4,
            borderWidth: 2,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          title: { display: true, text: `${playerName} 기록 추이`, color: this._titleColor() },
          annotation: {
            annotations: {
              avgLine: {
                type: 'line',
                yMin: avgValue,
                yMax: avgValue,
                borderColor: 'rgba(255, 99, 132, 0.6)',
                borderWidth: 2,
                borderDash: [6, 4],
                label: {
                  display: true,
                  content: '평균: ' + avgValue.toFixed(2) + '초',
                  position: 'end'
                }
              }
            }
          },
          zoom: this._zoomConfig()
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: this._tickColor() } },
          y: { title: { display: true, text: 'Finish (초)', color: this._textColor() }, grid: { color: this._gridColor() }, ticks: { color: this._tickColor() } },
        },
      },
    });
    canvas.ondblclick = () => this._charts[canvasId]?.resetZoom();
    this._addZoomResetBtn(canvasId);
    // Tippy.js 풍부한 데이터포인트 툴팁
    this._bindTippyTooltip(canvasId, (idx) => {
      const d = trendData[idx];
      if (!d) return null;
      const dateFmt = typeof UIController !== 'undefined' ? UIController.fmtDate(d.date) : d.date;
      const rel = typeof UIController !== 'undefined' ? UIController.fmtDateRelative(d.date) : '';
      return `<strong>${dateFmt}</strong>${rel ? ' <span style="opacity:0.7">(' + rel + ')</span>' : ''}<br>Finish: <strong>${d.finish.toFixed(3)}초</strong>${d.session ? '<br>세션: ' + d.session : ''}${d.run ? ' · Run ' + d.run : ''}`;
    });
    this._show(canvasId);
  }

  // ─── 구간별 분할 시간 (바) ────────────────────────────────
  renderSplitChart(canvasId, splitStats) {
    const canvas = this._initCanvas(canvasId);
    if (!canvas) return;
    if (!splitStats) { this._showEmpty(canvasId, '구간 분할 데이터가 없습니다'); return; }
    const valid = splitStats.filter(s => s.avg != null);
    const colors = this._colors(valid.length);

    this._charts[canvasId] = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: valid.map(s => s.label),
        datasets: [{
          label: '평균 분할 시간(초)',
          data: valid.map(s => s.avg),
          backgroundColor: colors.map(c => c + 'cc'),
          borderColor: colors,
          borderWidth: 1.5,
          hoverBackgroundColor: colors,
        }],
      },
      options: {
        responsive: true,
        plugins: { title: { display: true, text: '구간별 평균 분할 시간', color: this._titleColor() } },
        scales: {
          x: { grid: { display: false }, ticks: { color: this._tickColor() } },
          y: { title: { display: true, text: '시간(초)', color: this._textColor() }, beginAtZero: true, grid: { color: this._gridColor() }, ticks: { color: this._tickColor() } },
        },
      },
    });
    this._show(canvasId);
  }

  // ─── 레이더 비교 ──────────────────────────────────────────
  renderRadarChart(canvasId, compareData) {
    const canvas = this._initCanvas(canvasId);
    if (!canvas || compareData.length === 0) return;
    const labels = ['Start', 'Start→Int.1', 'Int.1→2', 'Int.2→3', 'Int.3→4', 'Int.4→F'];
    const colors = this._colors(compareData.length);
    const datasets = compareData.map((d, i) => {
      const vals = d.splitStats
        ? d.splitStats.map(s => s.avg).filter(v => v != null)
        : [];
      return {
        label: d.name,
        data: vals.slice(0, 6),
        borderColor: colors[i],
        backgroundColor: colors[i] + '20',
        pointBackgroundColor: colors[i],
        pointBorderColor: '#fff',
        pointBorderWidth: 1.5,
        pointRadius: 4,
        borderWidth: 2.5,
      };
    });

    this._charts[canvasId] = new Chart(canvas, {
      type: 'radar',
      data: { labels, datasets },
      options: {
        responsive: true,
        plugins: {
          title: { display: true, text: '구간별 비교 (낮을수록 빠름)', color: this._titleColor() },
          datalabels: {
            display: true,
            font: { size: 9 },
            formatter: function(v) { return typeof v === 'number' && isFinite(v) ? v.toFixed(1) : ''; },
            color: this._dataLabelColor(),
            anchor: 'end',
            align: 'end',
            offset: 2
          }
        },
        scales: {
          r: {
            grid: { color: this._gridColor() },
            angleLines: { color: this._gridColor() },
            ticks: { color: this._tickColor(), backdropColor: this._isDark() ? '#1e2433' : '#fff' },
            pointLabels: { font: { size: 11.5, weight: '500' }, color: this._textColor() },
          },
        },
      },
    });
    this._show(canvasId);
  }

  // ─── 선수별 비교 바 ──────────────────────────────────────
  renderCompareBarChart(canvasId, compareData) {
    const canvas = this._initCanvas(canvasId);
    if (!canvas || compareData.length === 0) return;
    const names = compareData.map(d => d.name);
    const avgs = compareData.map(d => d.stats ? d.stats.avg : null);
    const bests = compareData.map(d => d.stats ? d.stats.best : null);

    this._charts[canvasId] = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: names,
        datasets: [
          {
            label: '평균 Finish',
            data: avgs,
            backgroundColor: '#3b82f6cc',
            borderColor: '#3b82f6',
            borderWidth: 1.5,
            hoverBackgroundColor: '#3b82f6',
          },
          {
            label: '최고 Finish',
            data: bests,
            backgroundColor: '#f59e0bcc',
            borderColor: '#f59e0b',
            borderWidth: 1.5,
            hoverBackgroundColor: '#f59e0b',
          },
        ],
      },
      options: {
        responsive: true,
        plugins: { title: { display: true, text: '선수별 기록 비교 (낮을수록 빠름)', color: this._titleColor() } },
        scales: {
          x: { grid: { display: false }, ticks: { color: this._tickColor() } },
          y: { title: { display: true, text: 'Finish (초)', color: this._textColor() }, grid: { color: this._gridColor() }, ticks: { color: this._tickColor() } },
        },
      },
    });
    this._show(canvasId);
  }

  // ─── 단순 선형 예측 산점도 ────────────────────────────────
  renderPredictionChart(canvasId, records, prediction, startInput) {
    const canvas = this._initCanvas(canvasId);
    if (!canvas) return;
    const points = records
      .filter(r => r.start_time != null && r.finish != null)
      .map(r => ({ x: parseFloat(r.start_time), y: parseFloat(r.finish) }));
    if (points.length === 0) return;
    const xs = points.map(p => p.x);
    const minX = Math.min(...xs, startInput) - 0.2;
    const maxX = Math.max(...xs, startInput) + 0.2;
    const { a, b } = prediction.getCoefficients();
    const lineData = [];
    for (let x = minX; x <= maxX; x += 0.1) {
      lineData.push({ x: Math.round(x*100)/100, y: Math.round((a*x+b)*100)/100 });
    }

    // 95% 신뢰구간 밴드 (simple-statistics)
    const ciUpper = [];
    const ciLower = [];
    const residualStd = prediction.residualStd || 0;
    const ci95 = residualStd * 1.96;
    for (let x = minX; x <= maxX; x += 0.1) {
      const yHat = a * x + b;
      ciUpper.push({ x: Math.round(x*100)/100, y: Math.round((yHat + ci95)*100)/100 });
      ciLower.push({ x: Math.round(x*100)/100, y: Math.round((yHat - ci95)*100)/100 });
    }

    const datasets = [
      {
        label: '실제 기록',
        data: points,
        backgroundColor: '#3b82f6',
        pointRadius: 6,
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
        pointHoverRadius: 8,
        datalabels: {
          display: function(ctx) {
            return ctx.datasetIndex === 0;
          },
          anchor: 'end',
          align: 'top',
          font: { size: 10, weight: '600' },
          formatter: function(v) {
            if (v && typeof v === 'object' && typeof v.y === 'number') return v.y.toFixed(2);
            if (typeof v === 'number' && isFinite(v)) return v.toFixed(2);
            return '';
          },
          color: this._dataLabelColor()
        },
      },
      {
        label: '회귀선',
        data: lineData,
        type: 'line',
        borderColor: '#f59e0b',
        borderWidth: 2.5,
        pointRadius: 0,
        tension: 0,
        fill: false,
      },
    ];

    // 95% 신뢰구간 밴드 추가
    if (ci95 > 0) {
      datasets.push({
        label: '95% 신뢰구간 상한',
        data: ciUpper,
        type: 'line',
        borderColor: 'rgba(239,68,68,0.3)',
        borderWidth: 1,
        borderDash: [4, 4],
        pointRadius: 0,
        fill: false,
      });
      datasets.push({
        label: '95% 신뢰구간 하한',
        data: ciLower,
        type: 'line',
        borderColor: 'rgba(239,68,68,0.3)',
        borderWidth: 1,
        borderDash: [4, 4],
        pointRadius: 0,
        fill: '-1',
        backgroundColor: 'rgba(239,68,68,0.06)',
      });
    }

    datasets.push({
      label: '예측값',
      data: [{ x: startInput, y: prediction.predicted }],
      backgroundColor: '#ef4444',
      pointRadius: 12,
      pointStyle: 'star',
      pointBorderColor: '#fff',
      pointBorderWidth: 2,
    });

    this._charts[canvasId] = new Chart(canvas, {
      type: 'scatter',
      data: { datasets },
      options: {
        responsive: true,
        plugins: {
          title: { display: true, text: `단순 선형: Start Time → Finish (R²=${(prediction.r2||0).toFixed(3)})`, color: this._titleColor() },
          tooltip: {
            callbacks: {
              label: (item) => {
                const ds = item.dataset.label;
                return `${ds}: (${item.parsed.x.toFixed(3)}, ${item.parsed.y.toFixed(3)})`;
              },
            },
          },
          datalabels: {
            display: function(ctx) {
              return ctx.datasetIndex === 0;
            },
            anchor: 'end',
            align: 'top',
            font: { size: 10, weight: '600' },
            formatter: function(v) { return typeof v === 'number' && isFinite(v) ? v.toFixed(2) : ''; },
            color: this._dataLabelColor()
          },
          zoom: this._zoomConfig(0.1, 0.5)
        },
        scales: {
          x: { title: { display: true, text: 'Start Time (초)', color: this._textColor() }, grid: { color: this._gridColor() }, ticks: { color: this._tickColor() } },
          y: { title: { display: true, text: 'Finish (초)', color: this._textColor() }, grid: { color: this._gridColor() }, ticks: { color: this._tickColor() } },
        },
      },
    });
    canvas.ondblclick = () => this._charts[canvasId]?.resetZoom();
    this._addZoomResetBtn(canvasId);
    this._show(canvasId);
  }

  // ─── 다중 선형 회귀: 실측 vs 예측 산점도 ───────────────────
  renderMultiPredChart(canvasId, records, predModel, predResult) {
    const canvas = this._initCanvas(canvasId);
    if (!canvas) return;
    const multiCoeffs = predModel.getMultiCoeffs();
    if (!multiCoeffs) return;

    const points = records
      .filter(r => r.status === 'OK' && r.finish != null && r.start_time != null
        && r.int1 != null && r.int2 != null && r.int3 != null && r.int4 != null)
      .map(r => {
        const features = [
          parseFloat(r.start_time),
          parseFloat(r.int1) - parseFloat(r.start_time),
          parseFloat(r.int2) - parseFloat(r.int1),
          parseFloat(r.int3) - parseFloat(r.int2),
          parseFloat(r.int4) - parseFloat(r.int3),
        ];
        let predicted = multiCoeffs.coeffs[0];
        for (let i = 0; i < features.length; i++) predicted += multiCoeffs.coeffs[i+1] * features[i];
        return { x: parseFloat(r.finish), y: Math.round(predicted * 1000) / 1000 };
      })
      .filter(p => p.x > 0 && p.y > 0);

    if (points.length === 0) return;
    const allVals = points.flatMap(p => [p.x, p.y]);
    const minV = Math.min(...allVals) - 0.5;
    const maxV = Math.max(...allVals) + 0.5;

    this._charts[canvasId] = new Chart(canvas, {
      type: 'scatter',
      data: {
        datasets: [
          {
            label: '실측 vs 예측',
            data: points,
            backgroundColor: '#3b82f6',
            pointRadius: 6,
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
          },
          {
            label: '완벽예측선 (y=x)',
            data: [{x:minV,y:minV},{x:maxV,y:maxV}],
            type: 'line',
            borderColor: '#f59e0b',
            borderDash: [6, 4],
            borderWidth: 2,
            pointRadius: 0,
            tension: 0,
            fill: false,
          },
          {
            label: '현재 예측',
            data: [{ x: predResult.predicted, y: predResult.predicted }],
            backgroundColor: '#ef4444',
            pointRadius: 14,
            pointStyle: 'star',
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: { title: { display: true, text: `다중 선형: 실측 vs 예측 (R²=${multiCoeffs.r2.toFixed(3)})`, color: this._titleColor() } },
        scales: {
          x: { title: { display: true, text: '실측 Finish (초)', color: this._textColor() }, grid: { color: this._gridColor() }, ticks: { color: this._tickColor() } },
          y: { title: { display: true, text: '예측 Finish (초)', color: this._textColor() }, grid: { color: this._gridColor() }, ticks: { color: this._tickColor() } },
        },
      },
    });
    this._show(canvasId);
  }

  // ─── 범용 다중선형회귀: 실측 vs 예측 산점도 ───────────────
  renderGeneralPredChart(canvasId, records, modelInfo) {
    const canvas = this._initCanvas(canvasId);
    if (!canvas || !modelInfo.actualVsPred) return;

    const points = modelInfo.actualVsPred.map(p => ({ x: p.actual, y: Math.round(p.predicted * 1000) / 1000 }));
    if (points.length === 0) return;

    const allVals = points.flatMap(p => [p.x, p.y]);
    const minV = Math.min(...allVals) - 0.5;
    const maxV = Math.max(...allVals) + 0.5;

    this._charts[canvasId] = new Chart(canvas, {
      type: 'scatter',
      data: {
        datasets: [
          {
            label: '실측 vs 예측',
            data: points,
            backgroundColor: '#3b82f6',
            pointRadius: 4,
            pointBorderColor: '#fff',
            pointBorderWidth: 1,
          },
          {
            label: '완벽예측선 (y=x)',
            data: [{ x: minV, y: minV }, { x: maxV, y: maxV }],
            type: 'line',
            borderColor: '#f59e0b',
            borderDash: [6, 4],
            borderWidth: 2,
            pointRadius: 0,
            tension: 0,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          title: { display: true, text: `다중선형회귀: 실측 vs 예측 (R²=${modelInfo.r2.toFixed(4)}, n=${modelInfo.n})`, color: this._titleColor() },
        },
        scales: {
          x: { title: { display: true, text: '실측 Finish (초)', color: this._textColor() }, grid: { color: this._gridColor() }, ticks: { color: this._tickColor() } },
          y: { title: { display: true, text: '예측 Finish (초)', color: this._textColor() }, grid: { color: this._gridColor() }, ticks: { color: this._tickColor() } },
        },
      },
    });
    this._show(canvasId);
  }

  // ─── 날씨 영향 분석 ──────────────────────────────────────
  renderWeatherChart(canvasId, records, playerName) {
    const canvas = this._initCanvas(canvasId);
    if (!canvas) return;

    const wr = records
      .filter(r => r.status === 'OK' && r.finish != null && r.temp != null)
      .map(r => ({
        finish: parseFloat(r.finish),
        temp: parseFloat(r.temp),
        wind: r.wind != null ? parseFloat(r.wind) : null,
      }));

    if (wr.length < 3) { this._showEmpty(canvasId, '날씨 데이터가 부족합니다 (최소 3개 필요)'); return; }

    const tempPoints = wr.map(r => ({ x: r.temp, y: r.finish }));
    const datasets = [
      {
        label: '기온 vs Finish',
        data: tempPoints,
        backgroundColor: '#3b82f6',
        pointRadius: 7,
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
      },
    ];

    const windRecords = wr.filter(r => r.wind != null);
    if (windRecords.length >= 3) {
      const highWind = windRecords.filter(r => r.wind >= 3).map(r => ({ x: r.temp, y: r.finish }));
      const lowWind = windRecords.filter(r => r.wind < 3).map(r => ({ x: r.temp, y: r.finish }));
      datasets.length = 0;
      datasets.push(
        {
          label: '약풍 (<3m/s)',
          data: lowWind,
          backgroundColor: '#10b981',
          pointRadius: 7,
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
        },
        {
          label: '강풍 (≥3m/s)',
          data: highWind,
          backgroundColor: '#ef4444',
          pointRadius: 7,
          pointStyle: 'triangle',
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
        },
      );
    }

    this._charts[canvasId] = new Chart(canvas, {
      type: 'scatter',
      data: { datasets },
      options: {
        responsive: true,
        plugins: {
          title: { display: true, text: `${playerName} — 기온 vs 기록 (날씨 영향 분석)`, color: this._titleColor() },
          tooltip: {
            callbacks: {
              label: (item) => `기온 ${item.parsed.x}°C → ${item.parsed.y.toFixed(3)}초`,
            },
          },
        },
        scales: {
          x: { title: { display: true, text: '기온 (°C)', color: this._textColor() }, grid: { color: this._gridColor() }, ticks: { color: this._tickColor() } },
          y: { title: { display: true, text: 'Finish (초)', color: this._textColor() }, grid: { color: this._gridColor() }, ticks: { color: this._tickColor() } },
        },
      },
    });
    this._show(canvasId);
  }

  // ─── 박스플롯 (구간별 분포) ───────────────────────────────
  renderBoxPlot(canvasId, splitStats, playerName) {
    const canvas = this._initCanvas(canvasId);
    if (!canvas) return;
    if (!splitStats || splitStats.length === 0) { this._showEmpty(canvasId, '박스플롯 데이터가 없습니다'); return; }

    const valid = splitStats.filter(s => s.avg != null && s.count >= 3);
    if (valid.length === 0) { this._showEmpty(canvasId, '박스플롯에 필요한 데이터가 부족합니다 (최소 3개)'); return; }

    const labels = valid.map(s => s.label);
    const colors = this._colors(valid.length);

    // 박스플롯 데이터: min(best), Q1(avg-stddev), median(avg), Q3(avg+stddev), max(worst)
    // floating bar로 구현: 하단=Q1, 상단=Q3, 위스커=min~max
    const boxData = valid.map(s => [
      Math.max(0, s.avg - s.stddev),  // Q1 (하단)
      s.avg + s.stddev                 // Q3 (상단)
    ]);
    const medianData = valid.map(s => s.avg);
    const minData = valid.map(s => s.best);
    const maxData = valid.map(s => s.worst);

    // 위스커 (min~Q1, Q3~max) 라인 플러그인
    const whiskerPlugin = {
      id: 'whiskerPlugin',
      afterDatasetsDraw(chart) {
        const ctx = chart.ctx;
        const meta = chart.getDatasetMeta(0);
        if (!meta || !meta.data) return;
        meta.data.forEach((bar, i) => {
          if (!bar) return;
          const x = bar.x;
          const yMin = chart.scales.y.getPixelForValue(minData[i]);
          const yMax = chart.scales.y.getPixelForValue(maxData[i]);
          const yMed = chart.scales.y.getPixelForValue(medianData[i]);
          const halfW = bar.width ? bar.width / 4 : 8;

          ctx.save();
          ctx.strokeStyle = colors[i] || '#666';
          ctx.lineWidth = 2;
          ctx.setLineDash([4, 3]);
          // 하단 위스커
          ctx.beginPath();
          ctx.moveTo(x, bar.y);
          ctx.lineTo(x, yMin);
          ctx.stroke();
          // 상단 위스커
          ctx.beginPath();
          ctx.moveTo(x, bar.base);
          ctx.lineTo(x, yMax);
          ctx.stroke();
          ctx.setLineDash([]);
          // 위스커 캡
          ctx.beginPath();
          ctx.moveTo(x - halfW, yMin); ctx.lineTo(x + halfW, yMin);
          ctx.moveTo(x - halfW, yMax); ctx.lineTo(x + halfW, yMax);
          ctx.stroke();
          // 중앙값 선
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(bar.x - bar.width / 2 + 2, yMed);
          ctx.lineTo(bar.x + bar.width / 2 - 2, yMed);
          ctx.stroke();
          ctx.restore();
        });
      }
    };

    this._charts[canvasId] = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: '분포 (Q1~Q3)',
          data: boxData,
          backgroundColor: colors.map(c => c + 'aa'),
          borderColor: colors,
          borderWidth: 2,
          borderRadius: 4,
          barPercentage: 0.5,
        }],
      },
      options: {
        responsive: true,
        indexAxis: 'x',
        plugins: {
          title: { display: true, text: `${playerName} — 구간별 기록 분포 (박스플롯)`, color: this._titleColor() },
          tooltip: {
            callbacks: {
              label: (item) => {
                const idx = item.dataIndex;
                const s = valid[idx];
                return [
                  `최고: ${s.best.toFixed(3)}초`,
                  `Q1: ${(s.avg - s.stddev).toFixed(3)}초`,
                  `평균: ${s.avg.toFixed(3)}초`,
                  `Q3: ${(s.avg + s.stddev).toFixed(3)}초`,
                  `최저: ${s.worst.toFixed(3)}초`,
                  `σ: ${s.stddev.toFixed(3)} (n=${s.count})`,
                ];
              },
            },
          },
          datalabels: { display: false },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: this._tickColor() } },
          y: { title: { display: true, text: '시간 (초)', color: this._textColor() }, grid: { color: this._gridColor() }, ticks: { color: this._tickColor() } },
        },
      },
      plugins: [whiskerPlugin],
    });
    this._show(canvasId);
  }

  // ─── 2차 다항 회귀 차트 ─────────────────────────────────
  renderPolyChart(canvasId, records, predModel, startInput) {
    const canvas = this._initCanvas(canvasId);
    if (!canvas) return;
    const polyCoeffs = predModel.getPolyCoeffs();
    if (!polyCoeffs) return;

    const points = records
      .filter(r => r.start_time != null && r.finish != null)
      .map(r => ({ x: parseFloat(r.start_time), y: parseFloat(r.finish) }))
      .filter(p => p.x > 0 && p.y > 0);
    if (points.length === 0) return;

    const xs = points.map(p => p.x);
    const minX = Math.min(...xs, startInput) - 0.3;
    const maxX = Math.max(...xs, startInput) + 0.3;
    const { coeffs } = polyCoeffs;

    // 2차 곡선 데이터
    const curveData = [];
    for (let x = minX; x <= maxX; x += 0.05) {
      const y = coeffs[0] + coeffs[1] * x + coeffs[2] * x * x;
      curveData.push({ x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 });
    }

    // 단순 선형 비교선
    const simpleCoeffs = predModel.getCoefficients();
    const lineData = [];
    for (let x = minX; x <= maxX; x += 0.1) {
      lineData.push({ x: Math.round(x * 100) / 100, y: Math.round((simpleCoeffs.a * x + simpleCoeffs.b) * 100) / 100 });
    }

    const pred = predModel.predictPoly(startInput);

    const datasets = [
      {
        label: '실제 기록',
        data: points,
        backgroundColor: '#3b82f6',
        pointRadius: 5,
        pointBorderColor: '#fff',
        pointBorderWidth: 1.5,
      },
      {
        label: '2차 다항 곡선',
        data: curveData,
        type: 'line',
        borderColor: '#8b5cf6',
        borderWidth: 2.5,
        pointRadius: 0,
        tension: 0.4,
        fill: false,
      },
      {
        label: '단순 선형 (비교)',
        data: lineData,
        type: 'line',
        borderColor: '#f59e0b',
        borderWidth: 1.5,
        borderDash: [6, 3],
        pointRadius: 0,
        fill: false,
      },
      {
        label: '예측값',
        data: [{ x: startInput, y: pred.predicted }],
        backgroundColor: '#ef4444',
        pointRadius: 12,
        pointStyle: 'star',
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
      },
    ];

    this._charts[canvasId] = new Chart(canvas, {
      type: 'scatter',
      data: { datasets },
      options: {
        responsive: true,
        plugins: {
          title: { display: true, text: `2차 다항: Start → Finish (R²=${polyCoeffs.r2.toFixed(3)})`, color: this._titleColor() },
          zoom: this._zoomConfig(0.1, 0.5)
        },
        scales: {
          x: { title: { display: true, text: 'Start Time (초)', color: this._textColor() }, grid: { color: this._gridColor() }, ticks: { color: this._tickColor() } },
          y: { title: { display: true, text: 'Finish (초)', color: this._textColor() }, grid: { color: this._gridColor() }, ticks: { color: this._tickColor() } },
        },
      },
    });
    canvas.ondblclick = () => this._charts[canvasId]?.resetZoom();
    this._addZoomResetBtn(canvasId);
    this._show(canvasId);
  }

  // ─── 구간별 가중 히스토그램 ───────────────────────────────
  renderSegmentChart(canvasId, records, segType, segVal, predResult) {
    const canvas = this._initCanvas(canvasId);
    if (!canvas) return;

    const intField = { fromInt4: 'int4', fromInt3: 'int3', fromInt2: 'int2', fromInt1: 'int1' }[segType];
    const remainders = records
      .filter(r => r.status === 'OK' && r.finish != null && r[intField] != null)
      .map(r => parseFloat(r.finish) - parseFloat(r[intField]))
      .filter(v => v > 0 && v < 30);

    if (remainders.length === 0) return;

    const minR = Math.floor(Math.min(...remainders) * 10) / 10;
    const maxR = Math.ceil(Math.max(...remainders) * 10) / 10;
    const binSize = 0.2;
    const bins = [];
    const labels = [];
    for (let b = minR; b < maxR; b += binSize) {
      const count = remainders.filter(v => v >= b && v < b + binSize).length;
      bins.push(count);
      labels.push(b.toFixed(1));
    }

    const predRemainder = predResult.predicted - segVal;
    const predBinIdx = Math.floor((predRemainder - minR) / binSize);
    const bgColors = bins.map((_, i) => i === predBinIdx ? '#ef4444' : '#3b82f6cc');
    const borderColors = bins.map((_, i) => i === predBinIdx ? '#ef4444' : '#3b82f6');

    const segLabels = { fromInt4: 'Int.4→Finish', fromInt3: 'Int.3→Finish', fromInt2: 'Int.2→Finish', fromInt1: 'Int.1→Finish' };

    this._charts[canvasId] = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: `${segLabels[segType]} 잔여 시간 분포`,
          data: bins,
          backgroundColor: bgColors,
          borderColor: borderColors,
          borderWidth: 1.5,
        }],
      },
      options: {
        responsive: true,
        plugins: {
          title: { display: true, text: `구간별 가중: ${segLabels[segType]} 분포 (빨강=예측 위치)`, color: this._titleColor() },
        },
        scales: {
          x: { title: { display: true, text: '잔여 시간 (초)', color: this._textColor() }, grid: { display: false }, ticks: { color: this._tickColor() } },
          y: { title: { display: true, text: '빈도', color: this._textColor() }, beginAtZero: true, grid: { color: this._gridColor() }, ticks: { color: this._tickColor() } },
        },
      },
    });
    this._show(canvasId);
  }
}
