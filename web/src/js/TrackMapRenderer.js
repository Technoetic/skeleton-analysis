class TrackMapRenderer {
  constructor(dataStore, playerAnalyzer) {
    this.ds = dataStore;
    this.analyzer = playerAnalyzer;
    this._containerId = 'track-map-container';
    this._selectedPlayer = '';
    this._selectedRun = null;
    this._highlightedSegment = null;
    this._svgEl = null;
    this._containerEl = null;
    this._zoomG = null;
    this._animating = false;
    this._cachedSplitStats = null;
    this._tmData = typeof TRACKMAP_DATA !== 'undefined' ? TRACKMAP_DATA : null;
    this._sectionStations = [
      {from:0, to:215}, {from:215, to:425}, {from:425, to:730}, {from:730, to:920}, {from:920, to:1200}
    ];
    this._sectionColors = ['#3b82f6','#8b5cf6','#ec4899','#f97316','#10b981'];
    this._sectionLabels = ['Start\u2192Int.1','Int.1\u2192Int.2','Int.2\u2192Int.3','Int.3\u2192Int.4','Int.4\u2192Finish'];
    this._heatGood = '#10b981'; this._heatMid = '#eab308'; this._heatBad = '#ef4444';

    this._sensorPositions = {
      start:  { label: 'Start', color: '#2e7d32', station: 0 },
      int1:   { label: 'Int.1 (C4)', color: '#1565c0', station: 215 },
      int2:   { label: 'Int.2 (C7)', color: '#6a1b9a', station: 425 },
      int3:   { label: 'Int.3 (C12)', color: '#e65100', station: 730 },
      int4:   { label: 'Int.4 (C15)', color: '#c62828', station: 920 },
      finish: { label: 'Finish', color: '#f57f17', station: 1200 },
    };
    this._segments = [
      { from: 'start', to: 'int1', label: 'Start \u2192 Int.1', color: '#2e7d32' },
      { from: 'int1', to: 'int2', label: 'Int.1 \u2192 Int.2', color: '#1565c0' },
      { from: 'int2', to: 'int3', label: 'Int.2 \u2192 Int.3', color: '#6a1b9a' },
      { from: 'int3', to: 'int4', label: 'Int.3 \u2192 Int.4', color: '#e65100' },
      { from: 'int4', to: 'finish', label: 'Int.4 \u2192 Finish', color: '#c62828' },
    ];
    this._lineGen = null;
    this._trackPoints = null;
    this._trackPointsFull = null;
    this._sensorSvgPts = {};
    this._vbW = 786;
    this._vbH = 700;
  }

  _projectStations() {
    if (!this._tmData || !this._tmData.track) return;
    const stations = this._tmData.track.stations;
    const xs = stations.map(s => s.x), ys = stations.map(s => s.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const pad = 40, vbW = this._vbW, vbH = this._vbH;
    const scale = Math.min((vbW - 2*pad) / (maxX - minX), (vbH - 2*pad) / (maxY - minY));
    const offsetX = pad + (vbW - 2*pad - (maxX - minX)*scale) / 2;
    const offsetY = pad + (vbH - 2*pad - (maxY - minY)*scale) / 2;
    this._trackPointsFull = stations.map(s => ({
      x: offsetX + (s.x - minX) * scale,
      y: vbH - (offsetY + (s.y - minY) * scale),
      dist: s.dist
    }));
    if (this._trackPointsFull.length > 200) {
      const step = Math.ceil(this._trackPointsFull.length / 200);
      const thinned = this._trackPointsFull.filter((_, i) => i % step === 0);
      if (thinned[thinned.length-1] !== this._trackPointsFull[this._trackPointsFull.length-1])
        thinned.push(this._trackPointsFull[this._trackPointsFull.length-1]);
      this._trackPoints = thinned;
    } else {
      this._trackPoints = this._trackPointsFull;
    }
    Object.entries(this._sensorPositions).forEach(([key, sensor]) => {
      let closest = this._trackPointsFull[0], minDiff = Math.abs(this._trackPointsFull[0].dist - sensor.station);
      for (const pt of this._trackPointsFull) {
        const diff = Math.abs(pt.dist - sensor.station);
        if (diff < minDiff) { minDiff = diff; closest = pt; }
      }
      this._sensorSvgPts[key] = { x: closest.x, y: closest.y };
    });
  }

  _getSegmentPoints(segIdx) {
    const sec = this._sectionStations[segIdx];
    return this._trackPointsFull.filter(p => p.dist >= sec.from && p.dist <= sec.to);
  }

  render(containerId) {
    if (typeof d3 === 'undefined') { this._renderFallback(containerId); return; }

    // 기존 리사이즈 핸들러 정리
    if (this._resizeHandler) {
      window.removeEventListener('resize', this._resizeHandler);
      this._resizeHandler = null;
    }

    this._containerId = containerId || this._containerId;
    const container = document.getElementById(this._containerId);
    if (!container) return;
    container.innerHTML = '';
    container.style.position = 'relative';

    // 이전 렌더링에서 panel에 추가된 컨트롤 wrap 제거
    if (this._ctrlWrap && this._ctrlWrap.parentNode) {
      this._ctrlWrap.parentNode.removeChild(this._ctrlWrap);
      this._ctrlWrap = null;
    }
    this._containerEl = container;

    // D3 line generator (catmull-rom 곡선)
    this._lineGen = d3.line()
      .x(d => d.x).y(d => d.y)
      .curve(d3.curveCatmullRom.alpha(0.5));

    // 실좌표 → SVG 좌표 투영
    this._projectStations();

    // SVG 생성 — 컨테이너 너비 기준 높이 직접 계산
    const vbX = 0, vbY = 0, vbW = this._vbW, vbH = this._vbH;
    const cW = container.getBoundingClientRect().width || 800;
    const svgH = Math.round(cW * vbH / vbW);
    const svg = d3.select(container).append('svg')
      .attr('viewBox', `${vbX} ${vbY} ${vbW} ${vbH}`)
      .attr('preserveAspectRatio', 'none')
      .attr('width', '100%')
      .attr('height', svgH)
      .style('border-radius', '8px')
      .attr('id', 'track-svg');

    this._svgEl = svg.node();

    // defs: 그라데이션 + 필터 + 마커
    const defs = svg.append('defs');

    // 배경 그라데이션
    const bgGrad = defs.append('linearGradient')
      .attr('id', 'bg-grad').attr('x1', '0').attr('y1', '0').attr('x2', '0').attr('y2', '1');
    bgGrad.append('stop').attr('offset', '0%').attr('stop-color', '#e8f0fe');
    bgGrad.append('stop').attr('offset', '100%').attr('stop-color', '#f5f7fa');

    // 글로우 필터 (강화: stdDeviation 3→5, 이중 블러)
    const glow = defs.append('filter').attr('id', 'glow')
      .attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%');
    glow.append('feGaussianBlur').attr('stdDeviation', '5').attr('result', 'coloredBlur');
    const feMerge = glow.append('feMerge');
    feMerge.append('feMergeNode').attr('in', 'coloredBlur');
    feMerge.append('feMergeNode').attr('in', 'coloredBlur');
    feMerge.append('feMergeNode').attr('in', 'SourceGraphic');

    // 슬레드 그라데이션 (애니메이션 마커용)
    const sledGrad = defs.append('radialGradient').attr('id', 'sled-grad');
    sledGrad.append('stop').attr('offset', '0%').attr('stop-color', '#FFD700');
    sledGrad.append('stop').attr('offset', '100%').attr('stop-color', '#FF8C00');

    // 슬레드 궤적 속도 그라데이션 (시작=파랑, 가속=노랑, 최고속=빨강)
    const trailGrad = defs.append('linearGradient').attr('id', 'trail-speed-grad')
      .attr('gradientUnits', 'userSpaceOnUse');
    trailGrad.append('stop').attr('offset', '0%').attr('stop-color', '#3b82f6').attr('stop-opacity', 0.3);
    trailGrad.append('stop').attr('offset', '25%').attr('stop-color', '#22d3ee').attr('stop-opacity', 0.6);
    trailGrad.append('stop').attr('offset', '50%').attr('stop-color', '#facc15').attr('stop-opacity', 0.8);
    trailGrad.append('stop').attr('offset', '75%').attr('stop-color', '#f97316').attr('stop-opacity', 0.9);
    trailGrad.append('stop').attr('offset', '100%').attr('stop-color', '#ef4444').attr('stop-opacity', 1);

    // 슬레드 모션 블러 필터
    const motionBlur = defs.append('filter').attr('id', 'motion-blur');
    motionBlur.append('feGaussianBlur').attr('in', 'SourceGraphic').attr('stdDeviation', '3 0');

    // 세그먼트별 그라데이션
    this._segments.forEach((seg, i) => {
      const s = this._sensorSvgPts[seg.from], e = this._sensorSvgPts[seg.to];
      if (!s || !e) return;
      const grad = defs.append('linearGradient')
        .attr('id', `seg-grad-${i}`)
        .attr('gradientUnits', 'userSpaceOnUse')
        .attr('x1', s.x).attr('y1', s.y)
        .attr('x2', e.x).attr('y2', e.y);
      grad.append('stop').attr('offset', '0%').attr('stop-color', seg.color).attr('stop-opacity', 0.5);
      grad.append('stop').attr('offset', '100%').attr('stop-color', seg.color).attr('stop-opacity', 1);
    });

    // 줌/팬 그룹
    const zoomG = svg.append('g').attr('class', 'zoom-group');
    this._zoomG = zoomG;

    // D3 zoom
    const self = this;
    const zoom = d3.zoom()
      .scaleExtent([0.5, 5])
      .on('zoom', (event) => {
        zoomG.attr('transform', event.transform);
        self._onZoomForMinimap(event);
      });
    svg.call(zoom);
    this._zoom = zoom;

    // 배경
    zoomG.append('rect')
      .attr('x', 0).attr('y', 0)
      .attr('width', this._vbW).attr('height', this._vbH)
      .attr('fill', 'url(#bg-grad)');

    // 전체 트랙 배경 경로
    zoomG.append('path')
      .attr('d', this._lineGen(this._trackPoints))
      .attr('fill', 'none')
      .attr('stroke', '#d0d5dd')
      .attr('stroke-width', 12)
      .attr('stroke-linecap', 'round')
      .attr('stroke-linejoin', 'round');

    // 세그먼트별 컬러 경로
    const segGroup = zoomG.append('g').attr('class', 'segments');
    this._segments.forEach((seg, idx) => {
      const pts = this._getSegmentPoints(idx);
      segGroup.append('path')
        .attr('d', this._lineGen(pts))
        .attr('fill', 'none')
        .attr('stroke', `url(#seg-grad-${idx})`)
        .attr('stroke-width', 8)
        .attr('stroke-linecap', 'round')
        .attr('stroke-linejoin', 'round')
        .attr('opacity', 0.85)
        .attr('data-segment', idx)
        .attr('data-color', `url(#seg-grad-${idx})`)
        .attr('class', 'track-segment')
        .on('mouseenter', (e) => this._onSegmentHover(e, seg, idx))
        .on('mouseleave', () => this._hideTooltip())
        .on('click', () => this._onSegmentClick(idx));
    });

    // 커브 번호 마커
    if (this._tmData && this._tmData.track && this._tmData.track.curves) {
      const curveG = zoomG.append('g').attr('class', 'curves');
      this._tmData.track.curves.forEach(c => {
        const xs = this._tmData.track.stations.map(s => s.x), ys = this._tmData.track.stations.map(s => s.y);
        const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
        const pad = 40, scale = Math.min((this._vbW - 2*pad) / (maxX - minX), (this._vbH - 2*pad) / (maxY - minY));
        const offsetX = pad + (this._vbW - 2*pad - (maxX - minX)*scale) / 2;
        const offsetY = pad + (this._vbH - 2*pad - (maxY - minY)*scale) / 2;
        const cx = offsetX + (c.x - minX) * scale;
        const cy = this._vbH - (offsetY + (c.y - minY) * scale);
        curveG.append('circle')
          .attr('cx', cx).attr('cy', cy).attr('r', 8)
          .attr('fill', 'white').attr('stroke', '#888').attr('stroke-width', 1.5);
        curveG.append('text')
          .attr('x', cx).attr('y', cy + 4)
          .attr('text-anchor', 'middle')
          .attr('font-size', 9).attr('font-weight', 600).attr('fill', '#555')
          .text(c.name.replace('C', ''));
      });
    }

    // 센서 마커
    const sensorG = zoomG.append('g').attr('class', 'sensors');
    Object.entries(this._sensorPositions).forEach(([key, sensor]) => {
      const pt = this._sensorSvgPts[key];
      if (!pt) return;
      const g = sensorG.append('g')
        .attr('class', 'sensor-marker')
        .attr('data-sensor', key);

      // 외곽 원 (펄스 애니메이션)
      g.append('circle')
        .attr('cx', pt.x).attr('cy', pt.y).attr('r', 14)
        .attr('fill', sensor.color).attr('opacity', 0.25)
        .attr('class', 'sensor-pulse');

      // 내부 원
      g.append('circle')
        .attr('cx', pt.x).attr('cy', pt.y).attr('r', 9)
        .attr('fill', sensor.color).attr('stroke', 'white').attr('stroke-width', 2);

      // 라벨 배경 + 텍스트
      const labelY = key === 'finish' ? pt.y + 28 : pt.y - 22;
      const textLen = sensor.label.length * 6.5;
      g.append('rect')
        .attr('x', pt.x - textLen / 2 - 4).attr('y', labelY - 10)
        .attr('width', textLen + 8).attr('height', 15)
        .attr('rx', 3).attr('fill', 'white').attr('opacity', 0.85);
      g.append('text')
        .attr('x', pt.x).attr('y', labelY)
        .attr('text-anchor', 'middle')
        .attr('font-size', 11).attr('font-weight', 700).attr('fill', sensor.color)
        .text(sensor.label);

      g.on('mouseenter', (e) => this._onSensorHover(e, key, sensor))
       .on('mouseleave', () => this._hideTooltip());
    });

    // 데이터 오버레이 그룹 (선수 데이터 표시용)
    zoomG.append('g').attr('class', 'data-overlay');
    // 슬레드 애니메이션 그룹
    zoomG.append('g').attr('class', 'sled-group');

    // 툴팁 요소 (HTML)
    const tooltip = document.createElement('div');
    tooltip.id = 'track-map-tooltip';
    tooltip.className = 'track-tooltip';
    tooltip.style.cssText = 'display:none;position:absolute;pointer-events:none;background:white;border:1px solid #dde1e7;border-radius:8px;padding:0.8rem 1rem;box-shadow:0 4px 16px rgba(0,0,0,0.15);z-index:50;font-size:0.85rem;max-width:280px;line-height:1.5;';
    container.appendChild(tooltip);
    this._tooltipEl = tooltip;

    // 컨트롤 버튼들 (줌 리셋, 애니메이션)
    this._renderControls(container, svg);

    // 미니맵 오버레이
    this._renderMinimap(container, svg, zoom);

    // 반응형 max-height 조정
    this._updateSvgHeight();
    this._resizeTimer = null;
    this._resizeHandler = () => {
      clearTimeout(this._resizeTimer);
      this._resizeTimer = setTimeout(() => this._updateSvgHeight(), 150);
    };
    window.addEventListener('resize', this._resizeHandler, { passive: true });

    // 사이드 패널 탭 바인딩 + 초기 분석
    window._trackMapRenderer = this;
    this._bindSideTabs();
    this._updateAnalysis('');
  }

  // ─── 반응형 조정 ─────────────────────────────────────────
  _updateSvgHeight() {
    if (!this._svgEl) return;
    // SVG 높이를 컨테이너 너비 비율에 맞춤
    if (this._containerEl) {
      const cW = this._containerEl.getBoundingClientRect().width || 800;
      this._svgEl.setAttribute('height', Math.round(cW * this._vbH / this._vbW));
    }
    const w = window.innerWidth;
    // 미니맵 모바일에서 축소
    if (this._minimapEl) {
      if (w <= 480) {
        this._minimapEl.style.width = '100px';
        this._minimapEl.style.height = '70px';
      } else {
        this._minimapEl.style.width = '160px';
        this._minimapEl.style.height = '110px';
      }
    }
  }

  // ─── 컨트롤 버튼 ──────────────────────────────────────────
  _renderControls(container, svg) {
    // h4 헤더를 찾아서 flex 행으로 변환, 범례+버튼을 h4 행에 합침
    const card = container.closest('.dash-card') || container.parentNode;
    const h4 = card.querySelector('h4');

    if (h4) {
      h4.style.cssText += 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;';

      // 범례
      const legend = document.createElement('span');
      legend.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px 10px;font-size:0.65rem;color:#7a9ab5;margin-left:auto;font-weight:400;text-transform:none;letter-spacing:0;';
      this._segments.forEach(seg => {
        const item = document.createElement('span');
        item.style.cssText = 'display:inline-flex;align-items:center;gap:3px;white-space:nowrap;';
        item.innerHTML = `<span style="display:inline-block;width:12px;height:5px;border-radius:2px;background:${seg.color}"></span>${seg.label}`;
        legend.appendChild(item);
      });
      h4.appendChild(legend);

      // 버튼
      const btns = document.createElement('span');
      btns.style.cssText = 'display:flex;gap:4px;flex-shrink:0;';

      const resetBtn = document.createElement('button');
      resetBtn.className = 'track-ctrl-btn';
      resetBtn.innerHTML = '🔄';
      resetBtn.title = '줌/팬 초기화';
      resetBtn.onclick = () => svg.transition().duration(400).call(this._zoom.transform, d3.zoomIdentity);
      btns.appendChild(resetBtn);

      const zoomInBtn = document.createElement('button');
      zoomInBtn.className = 'track-ctrl-btn';
      zoomInBtn.innerHTML = '➕';
      zoomInBtn.title = '확대';
      zoomInBtn.onclick = () => svg.transition().duration(300).call(this._zoom.scaleBy, 1.5);
      btns.appendChild(zoomInBtn);

      const zoomOutBtn = document.createElement('button');
      zoomOutBtn.className = 'track-ctrl-btn';
      zoomOutBtn.innerHTML = '➖';
      zoomOutBtn.title = '축소';
      zoomOutBtn.onclick = () => svg.transition().duration(300).call(this._zoom.scaleBy, 0.67);
      btns.appendChild(zoomOutBtn);

      const animBtn = document.createElement('button');
      animBtn.className = 'track-ctrl-btn track-anim-btn';
      animBtn.innerHTML = '🛷';
      animBtn.title = '슬레드 주행 애니메이션';
      animBtn.onclick = () => this._runSledAnimation();
      this._animBtn = animBtn;
      btns.appendChild(animBtn);

      h4.appendChild(btns);
    }

    this._ctrlWrap = h4;
  }

  // ─── 슬레드 주행 애니메이션 ────────────────────────────────
  _runSledAnimation() {
    if (this._animating || typeof d3 === 'undefined') return;
    this._animating = true;
    this._animBtn.classList.add('active');
    // 애니메이션 중 세그먼트 클릭 비활성화
    if (this._svgEl) d3.select(this._svgEl).selectAll('.track-segment').style('pointer-events', 'none');

    const svg = d3.select(this._svgEl);
    const sledG = svg.select('.sled-group');
    // 진행 중 트랜지션 취소 후 정리
    sledG.interrupt();
    sledG.selectAll('*').interrupt();
    sledG.selectAll('*').remove();

    // 전체 트랙 경로
    const pathD = this._lineGen(this._trackPoints);
    const tempPath = sledG.append('path')
      .attr('d', pathD).attr('fill', 'none').attr('stroke', 'none');
    const pathNode = tempPath.node();
    const totalLength = pathNode.getTotalLength();

    // 슬레드 마커
    const sled = sledG.append('g').attr('class', 'sled-marker');
    sled.append('circle').attr('r', 10).attr('fill', 'url(#sled-grad)')
      .attr('stroke', '#FF6B00').attr('stroke-width', 2);
    sled.append('text').attr('y', 4).attr('text-anchor', 'middle')
      .attr('font-size', 11).text('🛷');

    // 모션 블러 후광
    sled.append('circle').attr('r', 14)
      .attr('fill', '#FFD700').attr('opacity', 0.3)
      .attr('filter', 'url(#motion-blur)');

    // 궤적 선 (속도 그라데이션 적용)
    // gradientUnits=userSpaceOnUse 좌표 업데이트
    const svg2 = d3.select(this._svgEl);
    const startPt = pathNode.getPointAtLength(0);
    const endPt = pathNode.getPointAtLength(totalLength);
    svg2.select('#trail-speed-grad')
      .attr('x1', startPt.x).attr('y1', startPt.y)
      .attr('x2', endPt.x).attr('y2', endPt.y);

    const trail = sledG.append('path')
      .attr('fill', 'none')
      .attr('stroke', 'url(#trail-speed-grad)')
      .attr('stroke-width', 3.5)
      .attr('stroke-linecap', 'round')
      .attr('opacity', 0.8);

    // 애니메이션 duration (선수 데이터 있으면 비례, 없으면 4초)
    const dur = this._selectedRun?.finish ? parseFloat(this._selectedRun.finish) * 80 : 4000;

    // D3 transition
    const trailPoints = [];
    const self = this;
    d3.select({}).transition().duration(dur).ease(d3.easeLinear)
      .tween('sled', function() {
        return function(t) {
          const pt = pathNode.getPointAtLength(t * totalLength);
          sled.attr('transform', `translate(${pt.x},${pt.y})`);
          trailPoints.push([pt.x, pt.y]);
          if (trailPoints.length > 500) trailPoints.shift();
          if (trailPoints.length > 1) {
            trail.attr('d', self._lineGen(trailPoints));
          }
        };
      })
      .on('end', () => {
        // 페이드 아웃
        sledG.transition().duration(800).attr('opacity', 0)
          .on('end', () => {
            sledG.selectAll('*').remove();
            sledG.attr('opacity', 1);
            self._animating = false;
            self._animBtn.classList.remove('active');
            // 세그먼트 클릭 복원
            if (self._svgEl) d3.select(self._svgEl).selectAll('.track-segment').style('pointer-events', null);
          });
      });
  }

  // ─── 선수 데이터 업데이트 ──────────────────────────────────
  updateWithPlayer(playerName, runData) {
    this._selectedPlayer = playerName;
    this._selectedRun = runData;
    this._cachedSplitStats = this.analyzer.getSplitStats(playerName);
    this._updateSensorValues();
    this._updateAnalysis(playerName);
  }

  clearPlayerData() {
    this._selectedPlayer = '';
    this._selectedRun = null;
    this._highlightedSegment = null;
    this._cachedSplitStats = null;
    this._clearSensorValues();
    this._updateAnalysis('');
  }

  // ─── 센서 값 표시 (D3) ────────────────────────────────────
  _updateSensorValues() {
    const run = this._selectedRun;
    if (!run || typeof d3 === 'undefined') return;

    const svg = d3.select(this._svgEl);
    const overlay = svg.select('.data-overlay');
    overlay.selectAll('*').remove();

    const values = {
      start: run.start_time,
      int1: run.int1,
      int2: run.int2,
      int3: run.int3,
      int4: run.int4,
      finish: run.finish,
    };

    Object.entries(values).forEach(([key, val]) => {
      if (val == null) return;
      const sensor = this._sensorPositions[key];
      const pt = this._sensorSvgPts[key];
      if (!pt) return;

      const valStr = parseFloat(val).toFixed(3) + 's';
      const boxWidth = valStr.length * 7 + 12;
      const boxY = key === 'finish' ? pt.y + 38 : pt.y + 16;

      const g = overlay.append('g').attr('class', 'val-label');

      // 배경 (라운드 사각형)
      g.append('rect')
        .attr('x', pt.x - boxWidth / 2).attr('y', boxY)
        .attr('width', boxWidth).attr('height', 20)
        .attr('rx', 4).attr('fill', sensor.color).attr('opacity', 0);

      // 텍스트
      g.append('text')
        .attr('x', pt.x).attr('y', boxY + 14)
        .attr('text-anchor', 'middle')
        .attr('font-size', 11).attr('font-weight', 700).attr('fill', 'white')
        .text(valStr).attr('opacity', 0);

      // 등장 애니메이션
      g.selectAll('rect').transition().duration(400).delay(100).attr('opacity', 0.9);
      g.selectAll('text').transition().duration(400).delay(100).attr('opacity', 1);
    });

    // 구간 소요 시간 표시
    this._updateSegmentTimes(run);
  }

  _updateSegmentTimes(run) {
    if (typeof d3 === 'undefined') return;
    const svg = d3.select(this._svgEl);
    const overlay = svg.select('.data-overlay');

    // 기존 세그먼트 시간 제거 (val-label은 유지)
    overlay.selectAll('.seg-time').remove();

    const cumulative = [
      run.start_time, run.int1, run.int2, run.int3, run.int4, run.finish
    ].map(v => v != null ? parseFloat(v) : null);

    // 구간 시간 계산 (속도 그라데이션 용)
    const segTimes = this._segments.map((seg, idx) => {
      const from = cumulative[idx];
      const to = cumulative[idx + 1];
      return (from != null && to != null) ? to - from : null;
    });
    const validTimes = segTimes.filter(t => t != null);
    const minT = Math.min(...validTimes);
    const maxT = Math.max(...validTimes);

    this._segments.forEach((seg, idx) => {
      const diff = segTimes[idx];
      if (diff == null) return;

      const secSta = this._sectionStations[idx];
      const midDist = (secSta.from + secSta.to) / 2;
      let midPt = this._sensorSvgPts[seg.from], minD = Infinity;
      for (const pt of this._trackPointsFull) {
        const d = Math.abs(pt.dist - midDist);
        if (d < minD) { minD = d; midPt = pt; }
      }
      if (!midPt) return;

      // 속도 기반 색상 (빠르면 진한, 느리면 연한)
      const ratio = maxT > minT ? (diff - minT) / (maxT - minT) : 0.5;

      const g = overlay.append('g').attr('class', 'seg-time');

      const diffStr = diff.toFixed(3);
      const boxWidth = (diffStr.length + 1) * 7 + 8;

      g.append('rect')
        .attr('x', midPt.x - boxWidth / 2).attr('y', midPt.y - 28)
        .attr('width', boxWidth).attr('height', 18)
        .attr('rx', 4).attr('fill', seg.color).attr('opacity', 0);

      g.append('text')
        .attr('x', midPt.x).attr('y', midPt.y - 14)
        .attr('text-anchor', 'middle')
        .attr('font-size', 10).attr('font-weight', 700).attr('fill', 'white')
        .text(diffStr + 's').attr('opacity', 0);

      // 등장 애니메이션
      g.selectAll('rect').transition().duration(300).delay(idx * 80).attr('opacity', 0.85);
      g.selectAll('text').transition().duration(300).delay(idx * 80).attr('opacity', 1);

      // 세그먼트 경로 두께로 속도 표현 (빠른 구간 = 두꺼운 선)
      const segPath = d3.select(this._svgEl).select(`[data-segment="${idx}"]`);
      if (segPath.node()) {
        const strokeW = 6 + (1 - ratio) * 6; // 빠를수록 두꺼움
        segPath.transition().duration(500).attr('stroke-width', strokeW);
      }
    });
  }

  _clearSensorValues() {
    if (typeof d3 === 'undefined' || !this._svgEl) return;
    const svg = d3.select(this._svgEl);
    svg.select('.data-overlay').selectAll('*').remove();

    // 세그먼트 두께 리셋
    svg.selectAll('.track-segment')
      .transition().duration(300)
      .attr('stroke-width', 8);
  }

  // ─── 이벤트 핸들러 ──────────────────────────────────────────
  _onSegmentHover(event, seg, idx) {
    let html = `<strong style="color:${seg.color}">${seg.label}</strong>`;

    if (this._selectedRun) {
      const run = this._selectedRun;
      const cumulative = [
        run.start_time, run.int1, run.int2, run.int3, run.int4, run.finish
      ].map(v => v != null ? parseFloat(v) : null);
      const from = cumulative[idx];
      const to = cumulative[idx + 1];
      if (from != null && to != null) {
        html += `<br>소요 시간: <strong>${(to - from).toFixed(3)}초</strong>`;
        html += `<br>누적: ${from.toFixed(3)} → ${to.toFixed(3)}초`;
      }
    }

    if (this._selectedPlayer) {
      const splitStats = this._cachedSplitStats;
      if (splitStats && splitStats[idx + 1]) {
        const s = splitStats[idx + 1];
        if (s.avg != null) {
          html += `<br><span style="color:#666">평균: ${s.avg.toFixed(3)}초 | 최고: ${s.best.toFixed(3)}초</span>`;
        }
      }
    }

    this._showTooltip(event, html);

    // 세그먼트 하이라이트
    if (typeof d3 !== 'undefined' && this._svgEl) {
      d3.select(this._svgEl).selectAll('.track-segment')
        .transition().duration(150)
        .attr('opacity', 0.3).attr('stroke-width', function() {
          return +d3.select(this).attr('data-segment') === idx ? 12 : 6;
        });
      d3.select(this._svgEl).select(`[data-segment="${idx}"]`)
        .transition().duration(150)
        .attr('opacity', 1).attr('stroke-width', 12)
        .attr('filter', 'url(#glow)')
        .attr('stroke', '#e8a820');
    }
  }

  _onSensorHover(event, key, sensor) {
    let html = `<strong style="color:${sensor.color}">${sensor.label}</strong>`;
    const courseInfo = {
      start: '출발 후 20~50m 구간 (첫 계측)',
      int1: '4번 커브 입구 (누적 시간)',
      int2: '7번 커브 입구 (누적 시간)',
      int3: '12번 커브 입구 (누적 시간)',
      int4: '15번 커브 입구 (누적 시간)',
      finish: '피니시 라인 (총 주행 시간)',
    };
    html += `<br><span style="color:#888">${courseInfo[key]}</span>`;

    if (this._selectedRun) {
      const val = this._selectedRun[key === 'start' ? 'start_time' : key];
      if (val != null) {
        html += `<br>측정값: <strong>${parseFloat(val).toFixed(3)}초</strong>`;
      }
    }
    this._showTooltip(event, html);
  }

  _onSegmentClick(idx) {
    this._highlightedSegment = this._highlightedSegment === idx ? null : idx;
    if (typeof d3 === 'undefined' || !this._svgEl) return;

    const svg = d3.select(this._svgEl);
    svg.selectAll('.track-segment').each(function() {
      const el = d3.select(this);
      el.transition().duration(200)
        .attr('opacity', 0.85).attr('stroke-width', 8)
        .attr('filter', null)
        .attr('stroke', el.attr('data-color') || el.attr('stroke'));
    });

    if (this._highlightedSegment != null) {
      svg.selectAll('.track-segment')
        .transition().duration(200)
        .attr('opacity', 0.3);
      svg.select(`[data-segment="${this._highlightedSegment}"]`)
        .transition().duration(200)
        .attr('opacity', 1).attr('stroke-width', 12)
        .attr('filter', 'url(#glow)')
        .attr('stroke', '#e8a820');
    }
  }

  _showTooltip(event, html) {
    const tooltip = this._tooltipEl;
    if (!tooltip) return;
    tooltip.innerHTML = html;
    tooltip.style.display = 'block';

    const container = this._containerEl;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const x = (event.clientX || event.pageX) - rect.left + 15;
    const y = (event.clientY || event.pageY) - rect.top - 10;
    tooltip.style.left = x + 'px';
    tooltip.style.top = y + 'px';
  }

  _hideTooltip() {
    if (this._tooltipEl) this._tooltipEl.style.display = 'none';

    // 하이라이트 리셋 (클릭 고정이 아닌 경우)
    if (this._highlightedSegment == null && typeof d3 !== 'undefined' && this._svgEl) {
      d3.select(this._svgEl).selectAll('.track-segment')
        .transition().duration(200)
        .attr('opacity', 0.85).attr('stroke-width', 8)
        .attr('filter', null);
    }
  }

  // ─── 줌→미니맵 연동 ──────────────────────────────────────
  _onZoomForMinimap(event) {
    if (!this._minimapViewport || !this._minimapWrap) return;
    const t = event.transform;
    const vx = -t.x / t.k;
    const vy = -t.y / t.k;
    const vw = 786 / t.k;
    const vh = 550 / t.k;
    this._minimapViewport.attr('x', vx).attr('y', vy).attr('width', vw).attr('height', vh);
    this._minimapWrap.style.opacity = t.k > 1.05 || Math.abs(t.x) > 5 || Math.abs(t.y) > 5 ? '1' : '0.4';
  }

  // ─── 미니맵 오버레이 ─────────────────────────────────────
  _renderMinimap(container, mainSvg, zoom) {
    const wrap = document.createElement('div');
    wrap.className = 'track-minimap';
    wrap.style.cssText = 'position:absolute;bottom:12px;right:12px;width:160px;height:110px;background:rgba(255,255,255,0.92);border:1px solid #dde1e8;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.12);overflow:hidden;z-index:10;';

    const miniSvg = d3.select(wrap).append('svg')
      .attr('viewBox', '0 0 900 600')
      .attr('width', '100%').attr('height', '100%')
      .style('pointer-events', 'none');

    // 배경
    miniSvg.append('rect').attr('width', 900).attr('height', 600).attr('fill', '#f5f7fa');

    // 트랙 경로
    miniSvg.append('path')
      .attr('d', this._lineGen(this._trackPoints))
      .attr('fill', 'none').attr('stroke', '#888').attr('stroke-width', 4)
      .attr('stroke-linecap', 'round');

    // 센서 마커 (간략)
    Object.entries(this._sensorPositions).forEach(([k, sensor]) => {
      const pt = this._sensorSvgPts[k];
      if (pt) miniSvg.append('circle').attr('cx', pt.x).attr('cy', pt.y).attr('r', 5).attr('fill', sensor.color);
    });

    // 뷰포트 사각형 (현재 보이는 영역)
    const viewport = miniSvg.append('rect')
      .attr('class', 'minimap-viewport')
      .attr('fill', 'rgba(59,130,246,0.15)')
      .attr('stroke', '#3b82f6').attr('stroke-width', 3)
      .attr('rx', 4)
      .attr('x', 0).attr('y', 0).attr('width', 900).attr('height', 600);

    // _onZoomForMinimap에서 사용할 참조 저장
    this._minimapViewport = viewport;
    this._minimapWrap = wrap;

    // 초기 상태 (줌 안 된 경우 반투명)
    wrap.style.opacity = '0.4';
    wrap.style.transition = 'opacity 0.3s';

    container.appendChild(wrap);
    this._minimapEl = wrap;
  }

  // ─── Fallback (D3 없는 경우) ──────────────────────────────
  _renderFallback(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '<div style="text-align:center;padding:2rem;color:#888">D3.js 라이브러리가 로드되지 않았습니다.</div>';
  }

  // ─── 사이드 패널: 탭 바인딩 ─────────────────────────────
  _bindSideTabs() {
    document.querySelectorAll('.tm-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tm-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tm-tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        const target = document.getElementById('tmtab-' + tab.dataset.tmtab);
        if (target) target.classList.add('active');
      });
    });
  }

  // ─── 사이드 패널: 통합 업데이트 ─────────────────────────
  _updateAnalysis(playerName) {
    this._updateSectionCards(playerName);
    this._updateInsights(playerName);
    this._updateCurveAnalysis();
    this._updateTempAnalysis(playerName);
  }

  // ─── 구간별 스플릿 카드 ─────────────────────────────────
  _updateSectionCards(playerName) {
    const container = document.getElementById('tm-section-cards');
    if (!container) return;
    const stats = this._getGlobalStats();
    const playerSplits = playerName ? this._getPlayerSplits(playerName) : null;
    let html = '<div class="tm-panel-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>구간별 스플릿 분석</div>';
    this._sectionLabels.forEach((label, i) => {
      const sec = 'sec' + (i + 1);
      const stat = stats[sec];
      if (!stat) return;
      const playerTime = playerSplits ? playerSplits.avg[sec] : stat.mean;
      const pbTime = playerSplits ? playerSplits.best[sec] : stat.min;
      const diff = playerSplits ? (playerTime - stat.mean) : 0;
      const pct = stat.max > stat.min ? ((playerTime - stat.min) / (stat.max - stat.min)) * 100 : 50;
      const diffStr = diff > 0 ? '+' + diff.toFixed(3) : diff.toFixed(3);
      const diffClass = diff < -0.05 ? 'tm-delta-pos' : diff > 0.05 ? 'tm-delta-neg' : 'tm-delta-neutral';
      const ratio = stat.std > 0 ? (playerTime - stat.mean) / stat.std : 0;
      let barColor = this._sectionColors[i];
      if (playerSplits) barColor = ratio < -0.5 ? this._heatGood : ratio > 0.5 ? this._heatBad : this._heatMid;
      html += '<div class="tm-section-card" data-section="' + i + '" onclick="window._trackMapRenderer&&window._trackMapRenderer._highlightSection(' + i + ')">'
        + '<div class="tm-sec-name" style="color:' + this._sectionColors[i] + '">' + label + '</div>'
        + '<div class="tm-sec-time">' + (playerTime ? playerTime.toFixed(3) : '-') + 's</div>'
        + '<div class="tm-sec-detail"><span>PB: ' + (pbTime ? pbTime.toFixed(2) : '-') + 's</span>'
        + '<span class="' + diffClass + '">vs 평균: ' + (playerSplits ? diffStr + 's' : '-') + '</span></div>'
        + '<div class="tm-sec-detail"><span>전체 평균: ' + stat.mean.toFixed(3) + 's</span>'
        + '<span>범위: ' + stat.min.toFixed(2) + '~' + stat.max.toFixed(2) + 's</span></div>'
        + '<div class="tm-sec-bar"><div class="tm-sec-bar-fill" style="width:' + Math.min(100, pct) + '%;background:' + barColor + '"></div></div></div>';
    });
    container.innerHTML = html;
  }

  // ─── 인사이트 카드 ──────────────────────────────────────
  _updateInsights(playerName) {
    const container = document.getElementById('tm-insight-cards');
    if (!container) return;
    const stats = this._getGlobalStats();
    const playerSplits = playerName ? this._getPlayerSplits(playerName) : null;
    let html = '<div class="tm-panel-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>기록 단축 인사이트</div>';
    if (playerSplits) {
      let worstSec = null, worstDiff = -Infinity, bestSec = null, bestDiff = Infinity;
      for (let i = 1; i <= 5; i++) {
        const sec = 'sec' + i;
        if (playerSplits.avg[sec] != null && stats[sec]) {
          const d = (playerSplits.avg[sec] - stats[sec].mean) / (stats[sec].std || 1);
          if (d > worstDiff) { worstDiff = d; worstSec = i; }
          if (d < bestDiff) { bestDiff = d; bestSec = i; }
        }
      }
      let improvable = 0;
      for (let i = 1; i <= 5; i++) {
        const sec = 'sec' + i;
        if (playerSplits.avg[sec] != null && stats[sec]) {
          const gap = playerSplits.avg[sec] - stats[sec].p25;
          if (gap > 0) improvable += gap;
        }
      }
      const pb = this.analyzer.getStats(playerName);
      if (worstSec) {
        const sn = this._sectionLabels[worstSec - 1];
        const gap = (playerSplits.avg['sec' + worstSec] - stats['sec' + worstSec].mean).toFixed(3);
        html += '<div class="tm-insight"><span class="tm-insight-icon">\uD83C\uDFAF</span><span class="tm-insight-text"><b>최우선 개선 구간:</b> <span style="color:' + this._sectionColors[worstSec - 1] + '">' + sn + '</span><br>평균 대비 <span class="tm-delta-neg">+' + gap + 's</span> 느림</span></div>';
      }
      if (bestSec) {
        const sn = this._sectionLabels[bestSec - 1];
        html += '<div class="tm-insight"><span class="tm-insight-icon">\uD83D\uDCAA</span><span class="tm-insight-text"><b>강점 구간:</b> <span style="color:' + this._sectionColors[bestSec - 1] + '">' + sn + '</span><br>전체 평균 대비 우수</span></div>';
      }
      if (pb) {
        html += '<div class="tm-insight"><span class="tm-insight-icon">\u23F1\uFE0F</span><span class="tm-insight-text"><b>총 개선 가능:</b> 모든 구간을 상위 25%로 끌어올리면<br><span class="tm-insight-value">' + improvable.toFixed(2) + '초</span> 단축 가능 (PB: ' + pb.best.toFixed(2) + 's \u2192 ' + (pb.best - improvable).toFixed(2) + 's)</span></div>';
      }
      const startGap = playerSplits.avg.sec1 ? (playerSplits.avg.sec1 - (stats.sec1.p25 || stats.sec1.mean)) : 0;
      if (startGap > 0.05) {
        html += '<div class="tm-insight"><span class="tm-insight-icon">\uD83D\uDE80</span><span class="tm-insight-text"><b>출발 개선 효과:</b> Start\u2192Int.1 구간 <span class="tm-delta-neg">' + startGap.toFixed(2) + 's</span> 개선 시,<br>피니시에서 약 <span class="tm-insight-value">' + (startGap * 3).toFixed(2) + '초</span> 단축 기대 (3배 증폭)</span></div>';
      }
    } else {
      html += '<div class="tm-insight"><span class="tm-insight-icon">\uD83D\uDCCA</span><span class="tm-insight-text">선수를 선택하면 개인 맞춤 기록 단축 전략이 표시됩니다.<br><br><b>트랙 특성:</b><br>\u2022 총 길이 약 1,200m, 커브 16개<br>\u2022 고도차 118m (930.5m \u2192 812.2m)<br>\u2022 가장 급한 커브: C2, C4 (R=17m)<br>\u2022 가장 완만한 커브: C10 (R=400m), C11 (R=500m)</span></div>';
      let maxStd = 0, maxSec = 1;
      for (let i = 1; i <= 5; i++) {
        if (stats['sec' + i] && stats['sec' + i].std > maxStd) { maxStd = stats['sec' + i].std; maxSec = i; }
      }
      html += '<div class="tm-insight"><span class="tm-insight-icon">\uD83D\uDCC8</span><span class="tm-insight-text"><b>가장 변동 큰 구간:</b> <span style="color:' + this._sectionColors[maxSec - 1] + '">' + this._sectionLabels[maxSec - 1] + '</span> (표준편차 ' + maxStd.toFixed(3) + 's)</span></div>';
    }
    container.innerHTML = html;
  }

  // ─── 커브 난이도 분석 ───────────────────────────────────
  _updateCurveAnalysis() {
    const container = document.getElementById('tm-curve-analysis');
    if (!container) return;
    const curves = [
      { name: 'C1', radius: 24 }, { name: 'C2', radius: 17 }, { name: 'C3', radius: 22 },
      { name: 'C4', radius: 17 }, { name: 'C5', radius: 20 }, { name: 'C6', radius: 38 },
      { name: 'C7', radius: 29 }, { name: 'C8', radius: 24 }, { name: 'C9', radius: 24 },
      { name: 'C10', radius: 400 }, { name: 'C11', radius: 500 }, { name: 'C12', radius: 29.5 },
      { name: 'C13', radius: 26 }, { name: 'C14', radius: 24 }, { name: 'C15', radius: 22 },
      { name: 'C16', radius: 30 },
    ];
    let html = '<div class="tm-panel-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>커브 난이도 (반경 기준)</div>';
    const maxR = 60;
    curves.forEach(c => {
      const r = c.radius, displayR = Math.min(r, maxR);
      const difficulty = r <= 20 ? '#ef4444' : r <= 30 ? '#f97316' : r <= 40 ? '#eab308' : '#10b981';
      const pct = ((maxR - displayR) / maxR) * 100;
      html += '<div class="tm-curve-row"><span class="tm-curve-name">' + c.name + '</span><div class="tm-curve-bar-bg"><div class="tm-curve-bar" style="width:' + pct + '%;background:' + difficulty + '"></div></div><span class="tm-curve-val" style="color:' + difficulty + '">' + r + 'm</span></div>';
    });
    html += '<div style="margin-top:10px;font-size:0.7rem;color:var(--c-text-muted,#666)">'
      + '<div style="margin-bottom:3px"><span style="color:#ef4444">\u25A0</span> R\u226420m: 급커브</div>'
      + '<div style="margin-bottom:3px"><span style="color:#f97316">\u25A0</span> R 21~30m: 중급</div>'
      + '<div style="margin-bottom:3px"><span style="color:#eab308">\u25A0</span> R 31~40m: 보통</div>'
      + '<div><span style="color:#10b981">\u25A0</span> R>40m: 완만</div></div>';
    html += '<div class="tm-insight" style="margin-top:10px"><span class="tm-insight-icon">\u26A1</span><span class="tm-insight-text"><b>핵심 커브:</b> C2(17m), C4(17m)가 가장 급함.<br>Int.1(C4 입구)에서의 진입 각도가 기록에 큰 영향.<br><br><b>C12(29.5m):</b> Int.3 계측점. 하반부 기록의 핵심 구간.</span></div>';
    container.innerHTML = html;
  }

  // ─── 온도 영향 분석 ─────────────────────────────────────
  _updateTempAnalysis(playerName) {
    const container = document.getElementById('tm-temp-analysis');
    if (!container) return;
    // 선수별 또는 전체 데이터에서 온도-기록 쌍 추출
    const records = playerName ? this.ds.getPlayerRecords(playerName) : this.ds.data;
    const tempRuns = records
      .filter(r => r.status === 'OK' && r.finish != null && r.temp_avg != null)
      .map(r => [parseFloat(r.temp_avg), parseFloat(r.finish)])
      .filter(d => !isNaN(d[0]) && !isNaN(d[1]));
    let html = '<div class="tm-panel-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"/></svg>트랙 온도 vs 기록</div>';
    if (tempRuns.length < 3) {
      html += '<div style="color:var(--c-text-muted);font-size:0.75rem;padding:8px">온도 데이터가 부족합니다.</div>';
      html += '<div class="tm-insight"><span class="tm-insight-icon">\uD83C\uDF21\uFE0F</span><span class="tm-insight-text"><b>온도 영향:</b> 트랙 온도가 낮을수록 얼음이 단단함 \u2192 마찰 감소 \u2192 기록 향상<br><br>\u2022 적정 온도: -9~-7\u00B0C</span></div>';
      container.innerHTML = html;
      return;
    }
    html += '<div id="tm-temp-chart"></div>';
    html += '<div class="tm-insight" style="margin-top:10px"><span class="tm-insight-icon">\uD83C\uDF21\uFE0F</span><span class="tm-insight-text"><b>온도 영향:</b> 트랙 온도가 낮을수록 얼음이 단단함 \u2192 마찰 감소 \u2192 기록 향상<br><br>\u2022 적정 온도: -9~-7\u00B0C</span></div>';
    container.innerHTML = html;
    // D3 scatter plot
    if (typeof d3 === 'undefined') return;
    const chartW = 300, chartH = 170, margin = { top: 10, right: 15, bottom: 28, left: 38 };
    const iW = chartW - margin.left - margin.right, iH = chartH - margin.top - margin.bottom;
    const chartSvg = d3.select('#tm-temp-chart').append('svg').attr('width', chartW).attr('height', chartH);
    const cg = chartSvg.append('g').attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');
    const temps = tempRuns.map(d => d[0]), fins = tempRuns.map(d => d[1]);
    const xScale = d3.scaleLinear().domain([d3.min(temps) - 0.5, d3.max(temps) + 0.5]).range([0, iW]);
    const yScale = d3.scaleLinear().domain([d3.min(fins) - 0.5, d3.max(fins) + 0.5]).range([iH, 0]);
    cg.append('g').attr('class', 'tm-temp-axis').attr('transform', 'translate(0,' + iH + ')').call(d3.axisBottom(xScale).ticks(5).tickFormat(d => d + '\u00B0C'));
    cg.append('g').attr('class', 'tm-temp-axis').call(d3.axisLeft(yScale).ticks(5).tickFormat(d => d + 's'));
    const self2 = this;
    cg.selectAll('.tm-temp-dot').data(tempRuns).join('circle')
      .attr('class', 'tm-temp-dot').attr('cx', d => xScale(d[0])).attr('cy', d => yScale(d[1]))
      .attr('r', 3).attr('fill', '#3b82f6').attr('opacity', 0.7)
      .on('mouseover', function (e, d) { d3.select(this).attr('r', 6).attr('opacity', 1); self2._showTooltip(e, '<b>' + d[0].toFixed(1) + '\u00B0C</b> \u2192 ' + d[1].toFixed(2) + 's'); })
      .on('mouseout', function () { d3.select(this).attr('r', 3).attr('opacity', 0.7); self2._hideTooltip(); });
    // trend line
    const n = temps.length, meanX = d3.mean(temps), meanY = d3.mean(fins);
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) { num += (temps[i] - meanX) * (fins[i] - meanY); den += (temps[i] - meanX) ** 2; }
    const slope = den ? num / den : 0, intercept = meanY - slope * meanX;
    const x1 = d3.min(temps), x2 = d3.max(temps);
    cg.append('line').attr('x1', xScale(x1)).attr('y1', yScale(slope * x1 + intercept))
      .attr('x2', xScale(x2)).attr('y2', yScale(slope * x2 + intercept))
      .attr('stroke', '#e8463a').attr('stroke-width', 1.5).attr('stroke-dasharray', '4,4').attr('opacity', 0.7);
  }

  // ─── 구간 하이라이트 ────────────────────────────────────
  _highlightSection(idx) {
    document.querySelectorAll('.tm-section-card').forEach((c, i) => { c.classList.toggle('highlight', i === idx); });
    this._onSegmentClick(idx);
  }

  // ─── 전체 통계 (캐시) ───────────────────────────────────
  _getGlobalStats() {
    if (this._globalStatsCache) return this._globalStatsCache;
    const players = this.ds.getPlayers();
    const allSplits = { sec1: [], sec2: [], sec3: [], sec4: [], sec5: [] };
    for (const p of players) {
      const ss = this.analyzer.getSplitStats(p.name);
      if (!ss) continue;
      // splitStats: [{label, avg, best, worst, ...}, ...]  index 1~5 = sec1~5
      for (let i = 1; i <= 5; i++) {
        if (ss[i] && ss[i].avg != null) allSplits['sec' + i].push(ss[i].avg);
      }
    }
    const result = {};
    for (let i = 1; i <= 5; i++) {
      const vals = allSplits['sec' + i].sort((a, b) => a - b);
      if (vals.length === 0) continue;
      const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
      const std = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
      const p25idx = Math.floor(vals.length * 0.25);
      result['sec' + i] = {
        mean, std,
        min: vals[0], max: vals[vals.length - 1],
        p25: vals[p25idx] || vals[0],
      };
    }
    this._globalStatsCache = result;
    return result;
  }

  // ─── 선수별 구간 스플릿 ─────────────────────────────────
  _getPlayerSplits(playerName) {
    const ss = this.analyzer.getSplitStats(playerName);
    if (!ss) return null;
    const avg = {}, best = {};
    for (let i = 1; i <= 5; i++) {
      if (ss[i]) {
        avg['sec' + i] = ss[i].avg;
        best['sec' + i] = ss[i].best;
      }
    }
    return { avg, best };
  }
}
