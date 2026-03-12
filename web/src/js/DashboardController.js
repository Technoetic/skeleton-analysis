class DashboardController {
  constructor(dataStore, predModel, chartManager, trackMap) {
    this.ds = dataStore;
    this.predModel = predModel;
    this.charts = chartManager;
    this.trackMap = trackMap;
    this._outlierFilter = true;
  }

  init() {
    this.#bindEvents();
    this.#populateSelectors();
    this.#renderTrackMap();
    this.#fetchWeather();
  }

  #renderTrackMap() {
    if (this.trackMap && document.getElementById('dash-track-container')) {
      try {
        this.trackMap.render('dash-track-container');
      } catch (e) { /* ignore */ }
    }
  }

  #el(id) { return document.getElementById(id); }

  #bindEvents() {
    const btn = this.#el('dash-predict-btn');
    if (btn) btn.addEventListener('click', () => this.#runPrediction());

    const player = this.#el('dash-player');
    if (player) player.addEventListener('change', () => this.#onPlayerChange());
  }

  #populateSelectors() {
    const playerEl = this.#el('dash-player');
    if (!playerEl) return;
    const athletes = typeof ATHLETES !== 'undefined' ? ATHLETES : [];
    const sorted = [...athletes].sort((a, b) => a.athlete_id.localeCompare(b.athlete_id));
    playerEl.innerHTML = '<option value="">선수 선택</option>' + sorted.map(a =>
      `<option value="${a.name}">${a.athlete_id}</option>`
    ).join('');
  }

  #onPlayerChange() {
    const name = this.#el('dash-player')?.value;
    const profileEl = this.#el('dash-profile-info');
    if (!profileEl) return;

    if (!name) { profileEl.innerHTML = ''; return; }

    const allRecords = this.ds.getAllRecords ? this.ds.getAllRecords() : this.ds.records || [];
    const playerRecords = allRecords.filter(r => r.name === name && r.status === 'OK' && r.finish);
    const finishes = playerRecords.map(r => parseFloat(r.finish)).filter(v => v > 0);
    const starts = playerRecords.map(r => parseFloat(r.start_time)).filter(v => v > 0);

    // ATHLETES DB에서 프로필 조회
    const ath = (typeof ATHLETES !== 'undefined' ? ATHLETES : []).find(a => a.name === name);

    if (finishes.length === 0 && !ath) { profileEl.innerHTML = '<span style="color:#666">기록 없음</span>'; return; }

    const best = finishes.length ? Math.min(...finishes).toFixed(3) : '—';
    const avgStart = starts.length ? (starts.reduce((s, v) => s + v, 0) / starts.length).toFixed(3) : '—';

    let html = '';
    if (ath) {
      html += `<div class="dash-env-row"><span>ID:</span> <span class="dash-env-val">${ath.athlete_id}</span></div>`;
      if (ath.height_cm) html += `<div class="dash-env-row"><span>키:</span> <span class="dash-env-val">${ath.height_cm}cm</span></div>`;
      if (ath.weight_kg) html += `<div class="dash-env-row"><span>체중:</span> <span class="dash-env-val">${ath.weight_kg}kg</span></div>`;
    }
    html += `<div class="dash-env-row"><span>기록 수:</span> <span class="dash-env-val">${finishes.length}건</span></div>`;
    html += `<div class="dash-env-row"><span>최고 기록:</span> <span class="dash-env-val">${best}초</span></div>`;
    html += `<div class="dash-env-row"><span>평균 스타트:</span> <span class="dash-env-val">${avgStart}초</span></div>`;
    profileEl.innerHTML = html;

    // 키/체중 자동 입력 (예측 모델용)
    if (ath) {
      const hEl = this.#el('pred-height');
      const wEl = this.#el('pred-weight');
      if (hEl && ath.height_cm) hEl.value = ath.height_cm;
      if (wEl && ath.weight_kg) wEl.value = ath.weight_kg;
    }

    // 목표 스타트 자동 설정
    const targetEl = this.#el('dash-target-start');
    if (targetEl && !targetEl.value && avgStart !== '—') targetEl.value = avgStart;
  }

  async #fetchWeather() {
    // 기상청 API허브 — 대관령(100) AWS 1분 관측
    const KMA_KEY = 'ncpn3dPgT5OKZ93T4D-TJw';
    const now = new Date();
    // KST 기준 현재 분 (1분 단위 관측, 2분 여유)
    const kst = new Date(now.getTime() + 9 * 3600000 - 2 * 60000);
    const tm2 = kst.toISOString().replace(/[-T:]/g, '').slice(0, 12);
    const url = `https://apihub.kma.go.kr/api/typ01/cgi-bin/url/nph-aws2_min?tm2=${tm2}&stn=100&disp=0&help=0&authKey=${KMA_KEY}`;
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(resp.status);
      const text = await resp.text();
      const dataLine = text.split('\n').find(l => l.trim() && !l.startsWith('#'));
      if (!dataLine) throw new Error('No data line');
      const cols = dataLine.trim().split(/\s+/);
      // AWS cols: [0]=YYMMDDHHMI [1]=STN [2]=WD1 [3]=WS1 [4]=WDS [5]=WSS
      //           [6]=WD10 [7]=WS10 [8]=TA [9]=RE [10]=RN-15m [11]=RN-60m
      //           [12]=RN-12H [13]=RN-DAY [14]=HM [15]=PA [16]=PS [17]=TD
      const valid = v => { const n = parseFloat(v); return (!isNaN(n) && n > -50) ? n : NaN; };
      const ta = valid(cols[8]);   // 기온
      const hm = valid(cols[14]);  // 습도
      const pa = valid(cols[15]);  // 현지기압
      const td = valid(cols[17]);  // 이슬점
      const wd = valid(cols[2]);   // 1분 평균 풍향
      const ws = valid(cols[3]);   // 1분 평균 풍속
      const wss = valid(cols[5]);  // 최대순간풍속
      const airEl = this.#el('dash-airtemp');
      const humEl = this.#el('dash-humidity');
      const presEl = this.#el('dash-pressure');
      const wdEl = this.#el('dash-winddir');
      const wsEl = this.#el('dash-windspd');
      const wgEl = this.#el('dash-windgust');
      if (airEl && !isNaN(ta)) { airEl.value = ta; airEl.readOnly = true; }
      if (humEl && !isNaN(hm)) { humEl.value = hm; humEl.readOnly = true; }
      if (presEl && !isNaN(pa)) { presEl.value = pa; presEl.readOnly = true; }
      if (wdEl && !isNaN(wd)) { wdEl.value = wd; wdEl.readOnly = true; }
      if (wsEl && !isNaN(ws)) { wsEl.value = ws; wsEl.readOnly = true; }
      if (wgEl && !isNaN(wss)) { wgEl.value = wss; wgEl.readOnly = true; }
      // 관측 시각 표시
      const obsTime = cols[0];
      const h4 = this.#el('dash-airtemp')?.closest('.dash-card')?.querySelector('h4');
      if (h4) {
        const hh = obsTime.slice(8, 10), mm = obsTime.slice(10, 12);
        h4.querySelector('.weather-time')?.remove();
        const span = document.createElement('span');
        span.className = 'weather-time';
        span.style.cssText = 'font-size:0.65rem;color:#4caf50;margin-left:6px;font-weight:400;text-transform:none;letter-spacing:0;';
        span.textContent = `${hh}:${mm} KST`;
        h4.appendChild(span);
      }
      this.#updateCalc();
    } catch (e) {
      console.warn('KMA AWS fetch failed, falling back to Open-Meteo:', e);
      await this.#fetchWeatherFallback();
    }
  }

  async #fetchWeatherFallback() {
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=37.6584&longitude=128.7253&current=temperature_2m,relative_humidity_2m,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m&timezone=Asia/Seoul';
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(resp.status);
      const data = await resp.json();
      const c = data.current;
      const airEl = this.#el('dash-airtemp');
      const humEl = this.#el('dash-humidity');
      const presEl = this.#el('dash-pressure');
      const wdEl = this.#el('dash-winddir');
      const wsEl = this.#el('dash-windspd');
      const wgEl = this.#el('dash-windgust');
      if (airEl) { airEl.value = c.temperature_2m; airEl.readOnly = true; }
      if (humEl) { humEl.value = c.relative_humidity_2m; humEl.readOnly = true; }
      if (presEl) { presEl.value = c.surface_pressure; presEl.readOnly = true; }
      if (wdEl && c.wind_direction_10m != null) { wdEl.value = c.wind_direction_10m; wdEl.readOnly = true; }
      if (wsEl && c.wind_speed_10m != null) { wsEl.value = (c.wind_speed_10m / 3.6).toFixed(1); wsEl.readOnly = true; }
      if (wgEl && c.wind_gusts_10m != null) { wgEl.value = (c.wind_gusts_10m / 3.6).toFixed(1); wgEl.readOnly = true; }
      this.#updateCalc();
    } catch (e) {
      console.warn('Weather fallback also failed:', e);
    }
  }

  #updateCalc() {
    const airTemp = parseFloat(this.#el('dash-airtemp')?.value);
    const humidity = parseFloat(this.#el('dash-humidity')?.value);
    const pressure = parseFloat(this.#el('dash-pressure')?.value);
    const calcEl = this.#el('dash-calc-values');
    if (!calcEl) return;

    if (isNaN(airTemp) || isNaN(humidity) || isNaN(pressure)) {
      calcEl.innerHTML = '<div class="dash-calc-row"><span>입력 대기 중...</span></div>';
      return;
    }

    const density = PredictionModel.calcAirDensity(airTemp, humidity, pressure);
    const dewPoint = PredictionModel.calcDewPoint(airTemp, humidity);
    const iceTemp = parseFloat(this.#el('dash-icetemp')?.value) || -7;
    const frostRisk = dewPoint > iceTemp;

    calcEl.innerHTML = `
      <div class="dash-calc-row"><span>공기밀도</span> <span class="val">${density.toFixed(4)} kg/m³</span></div>
      <div class="dash-calc-row"><span>이슬점</span> <span class="val">${dewPoint.toFixed(1)}°C</span></div>
      <div class="dash-calc-row"><span>서리 위험</span> <span class="val" style="color:${frostRisk ? '#f44336' : '#4caf50'}">${frostRisk ? '⚠ 있음' : '✓ 없음'}</span></div>
    `;
  }

  #getInputs() {
    const playerName = this.#el('dash-player')?.value || '';
    const ath = (typeof ATHLETES !== 'undefined' ? ATHLETES : []).find(a => a.name === playerName);
    return {
      gender: ath ? ath.gender : '',
      player: playerName,
      startTime: parseFloat(this.#el('dash-target-start')?.value) || 0,
      airTemp: parseFloat(this.#el('dash-airtemp')?.value) || 5,
      humidity: parseFloat(this.#el('dash-humidity')?.value) || 60,
      pressure: parseFloat(this.#el('dash-pressure')?.value) || 935,
      iceTemp: parseFloat(this.#el('dash-icetemp')?.value) || -7,
      windSpeed: parseFloat(this.#el('dash-windspd')?.value) || 0,
      height: parseFloat(this.#el('pred-height')?.value) || null,
      weight: parseFloat(this.#el('pred-weight')?.value) || null,
    };
  }

  #runPrediction() {
    const inp = this.#getInputs();
    const resultEl = this.#el('dash-prediction-result');
    const coachEl = this.#el('dash-coaching-tips');
    if (!resultEl) return;

    if (!inp.player) {
      resultEl.innerHTML = '<div style="text-align:center;color:#f44336;padding:1rem">선수를 선택해주세요</div>';
      return;
    }
    if (!inp.startTime || inp.startTime < 3 || inp.startTime > 8) {
      resultEl.innerHTML = '<div style="text-align:center;color:#f44336;padding:1rem">목표 스타트 시간을 입력해주세요 (3~8초)</div>';
      return;
    }

    const allRecords = this.ds.getAllRecords ? this.ds.getAllRecords() : this.ds.records || [];
    const okRecords = allRecords.filter(r => r.gender === inp.gender && r.status === 'OK' && r.finish);

    if (okRecords.length < 5) {
      resultEl.innerHTML = '<div style="text-align:center;color:#f44336;padding:1rem">데이터 부족</div>';
      return;
    }

    // XGBoost 출발 전 예측
    let xgbPredicted = null;
    let xgbModel = null;
    if (typeof XGB_MODELS !== 'undefined' && XGB_MODELS.pre) {
      const dewPoint = PredictionModel.calcDewPoint(inp.airTemp, inp.humidity);
      const isFemale = inp.gender === 'W' ? 1 : 0;
      const features = [inp.startTime, inp.iceTemp, inp.airTemp, inp.humidity, inp.pressure, dewPoint, 2.0, isFemale];
      xgbPredicted = xgbPredict(XGB_MODELS.pre, features);
      xgbModel = XGB_MODELS.pre;
    }

    // MLR 예측
    let mlrResult = null;
    try {
      this.predModel.trainAll(okRecords);
      mlrResult = this.predModel.trainGeneralMLR(okRecords, {
        startTime: inp.startTime,
        iceTemp: inp.iceTemp,
        airTemp: inp.airTemp,
        humidity: inp.humidity,
        pressure: inp.pressure,
        height: inp.height,
        weight: inp.weight,
      });
    } catch (e) { /* ignore */ }

    // 최종 예측값 (XGBoost 우선)
    const predicted = xgbPredicted || (mlrResult ? mlrResult.prediction.predicted : null);
    if (!predicted) {
      resultEl.innerHTML = '<div style="text-align:center;color:#f44336;padding:1rem">예측 실패</div>';
      return;
    }

    const modelName = xgbPredicted ? 'XGBoost' : 'MLR';
    const cvR2 = xgbPredicted ? (xgbModel.cv || 0.60) : (mlrResult ? mlrResult.modelInfo.r2 : 0);
    const accuracy = (cvR2 * 100).toFixed(1);

    // 결과 렌더링
    resultEl.innerHTML = `
      <div class="dash-big-number">
        <div class="sub">최종 예상 기록</div>
        <div class="number" data-countup="${predicted.toFixed(2)}">${predicted.toFixed(2)}<span class="unit">s</span></div>
      </div>
      <div class="dash-model-badge">
        모델: <strong>${modelName}</strong> | 정확도: <span class="dash-accuracy">${accuracy}%</span>
      </div>
    `;

    // 분포 차트
    const finishes = okRecords.map(r => parseFloat(r.finish)).filter(v => v > 0 && v < 65);
    this.#renderDistChart(finishes, predicted);

    // 코칭 팁
    if (coachEl) coachEl.innerHTML = this.#generateTips(inp, predicted, mlrResult);

    // 필터 상태 업데이트
    this.#updateFilterStatus(okRecords);

    // countUp 애니메이션
    if (typeof UIController !== 'undefined' && UIController.animateCountUp) {
      UIController.animateCountUp(resultEl);
    }
  }

  #renderDistChart(finishes, predicted) {
    const canvas = this.#el('dash-dist-chart');
    if (!canvas || !finishes.length) return;
    canvas.style.display = 'block';

    // 히스토그램 빈 계산
    const min = Math.floor(Math.min(...finishes));
    const max = Math.ceil(Math.max(...finishes));
    const binSize = 0.5;
    const bins = [];
    const labels = [];
    for (let b = min; b < max; b += binSize) {
      labels.push(b.toFixed(1));
      bins.push(finishes.filter(v => v >= b && v < b + binSize).length);
    }

    if (this._distChart) this._distChart.destroy();
    this._distChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data: bins,
          backgroundColor: labels.map(l => Math.abs(parseFloat(l) - predicted) < binSize ? 'rgba(0,229,255,0.6)' : 'rgba(100,150,200,0.3)'),
          borderRadius: 3,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          annotation: {
            annotations: {
              predLine: {
                type: 'line',
                xMin: ((predicted - min) / binSize).toFixed(1),
                xMax: ((predicted - min) / binSize).toFixed(1),
                borderColor: '#00e5ff',
                borderWidth: 2,
                borderDash: [4, 4],
                label: { display: true, content: `${predicted.toFixed(2)}s`, position: 'start', backgroundColor: 'rgba(0,229,255,0.8)', color: '#fff', font: { size: 10 } }
              }
            }
          }
        },
        scales: {
          x: { display: false },
          y: { display: false }
        }
      }
    });
  }

  #generateTips(inp, predicted, mlrResult) {
    const tips = [];

    // 스타트 영향
    const startImpact = -2.49; // MLR 계수 기반
    tips.push({
      type: 'good',
      title: '스타트 시간 영향',
      text: `스타트 0.1초 단축 시 피니시 약 ${Math.abs(startImpact * 0.1).toFixed(2)}초 단축. 현재 목표: ${inp.startTime}초`
    });

    // 환경 보정
    const density = PredictionModel.calcAirDensity(inp.airTemp, inp.humidity, inp.pressure);
    const refDensity = 1.20;
    const densityDiff = ((density - refDensity) / refDensity * 100).toFixed(1);
    if (Math.abs(densityDiff) > 1) {
      tips.push({
        type: densityDiff > 0 ? 'warn' : 'good',
        title: '공기밀도 보정',
        text: `공기밀도 ${density.toFixed(4)} kg/m³ (기준 대비 ${densityDiff > 0 ? '+' : ''}${densityDiff}%) → 항력 ${densityDiff > 0 ? '증가' : '감소'}`
      });
    }

    // 서리 위험
    const dewPoint = PredictionModel.calcDewPoint(inp.airTemp, inp.humidity);
    if (dewPoint > inp.iceTemp) {
      tips.push({
        type: 'danger',
        title: '서리 위험 경고',
        text: `이슬점(${dewPoint.toFixed(1)}°C) > 빙면(${inp.iceTemp}°C) → 서리로 마찰 증가 가능 (+0.1~0.3초)`
      });
    }

    // 최적화 목표
    tips.push({
      type: 'good',
      title: '최적화 목표',
      text: 'Int.4(15번 커브)가 피니시 예측의 52.3%를 결정. Turn 13 진입 속도 최적화 권장.'
    });

    // MLR 분석
    if (mlrResult) {
      tips.push({
        type: 'good',
        title: 'MLR 분석',
        text: `MLR 예측: ${mlrResult.prediction.predicted.toFixed(3)}초 (R²=${mlrResult.modelInfo.r2.toFixed(4)})`
      });
    }

    return tips.map(t => `
      <div class="dash-tip ${t.type}">
        <div class="tip-title">${t.type === 'danger' ? '🔴' : t.type === 'warn' ? '🟡' : '🟢'} ${t.title}</div>
        ${t.text}
      </div>
    `).join('');
  }

  #updateFilterStatus(okRecords) {
    const el = this.#el('dash-filter-status');
    if (!el) return;
    el.innerHTML = `<span class="dash-badge active">활성</span> <span style="font-size:0.75rem;color:#7a9ab5;margin-left:0.3rem">학습 데이터: ${okRecords.length}건</span>`;
  }
}
