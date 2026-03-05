class PredictionModel {
  constructor() {
    this._a = 0;
    this._b = 0;
    this._r2 = 0;
    this._residualStd = 0;
    this._n = 0;
    // 다중 선형 회귀
    this._multiCoeffs = null;
    // 구간별 가중 예측
    this._segmentModels = null;
    // 2차 다항 회귀
    this._polyCoeffs = null;
    // 선수 개인 보정
    this._playerOffsets = {};
    // 교차 검증 결과
    this._cvResults = null;
    this._activeModel = 'simple';
    // 피처 정규화 파라미터
    this._multiNorm = null;
    // (X'X)⁻¹ for leverage 계산
    this._XtXinv = null;
    this._simpleXtXinv = null;
    this._polyXtXinv = null;
  }

  // ─── 1) 단순 선형 회귀 ──────────────────────────────────────
  train(records) {
    const pairs = records
      .filter(r => r.start_time != null && r.finish != null)
      .map(r => ({ x: parseFloat(r.start_time), y: parseFloat(r.finish), date: r.date }))
      .filter(p => p.x > 0 && p.y > 0);

    if (pairs.length < 3) {
      this._n = pairs.length;
      return false;
    }

    const xArr = pairs.map(p => p.x), yArr = pairs.map(p => p.y);
    const weights = this.#computeTimeWeights(pairs.map(p => p.date));
    const result = this.#weightedSimpleRegression(xArr, yArr, weights || new Array(xArr.length).fill(1));
    this._a = result.a;
    this._b = result.b;
    this._r2 = result.r2;
    this._residualStd = result.residualStd;
    this._simpleXtXinv = result.XtXinv;
    this._n = pairs.length;
    return true;
  }

  predict(startTime) {
    const predicted = this._a * startTime + this._b;
    const xAug = [1, startTime];
    const h = this.#computeLeverage(xAug, this._simpleXtXinv);
    const se = this._residualStd * Math.sqrt(1 + h);
    return {
      predicted: Math.round(predicted * 1000) / 1000,
      lower: Math.round((predicted - se) * 1000) / 1000,
      upper: Math.round((predicted + se) * 1000) / 1000,
      leverage: Math.round(h * 1000) / 1000,
    };
  }

  getR2() { return this._r2; }
  getN() { return this._n; }
  getCoefficients() { return { a: this._a, b: this._b }; }
  isReliable() { return this._r2 > 0.3 && this._n >= 5; }

  // ─── 2) 다중 선형 회귀 (정규화 + 온도 + 상호작용 + WLS + 선수 보정) ─
  trainMulti(records) {
    let rows = records
      .filter(r => r.status === 'OK' && r.finish != null && r.start_time != null
        && r.int1 != null && r.int2 != null && r.int3 != null && r.int4 != null)
      .map(r => {
        const start = parseFloat(r.start_time);
        const s1 = parseFloat(r.int1) - start;
        const s2 = parseFloat(r.int2) - parseFloat(r.int1);
        const s3 = parseFloat(r.int3) - parseFloat(r.int2);
        const s4 = parseFloat(r.int4) - parseFloat(r.int3);
        const temp = r.temp_avg != null ? parseFloat(r.temp_avg) : -7;
        return {
          start, s1, s2, s3, s4, temp,
          interaction: start * s1,
          y: parseFloat(r.finish),
          name: r.name,
          date: r.date,
        };
      })
      .filter(r => r.start > 0 && r.s1 > 0 && r.s2 > 0 && r.s3 > 0 && r.s4 > 0 && r.y > 0);

    if (rows.length < 5) {
      this._multiCoeffs = null;
      return false;
    }

    // 이상치 제거
    rows = this.#filterOutliers(rows,
      r => [r.start, r.s1, r.s2, r.s3, r.s4, r.temp, r.interaction],
      r => r.y);

    if (rows.length < 5) {
      this._multiCoeffs = null;
      return false;
    }

    const X = rows.map(r => [r.start, r.s1, r.s2, r.s3, r.s4, r.temp, r.interaction]);
    const y = rows.map(r => r.y);
    const features = ['start_time', 'seg1', 'seg2', 'seg3', 'seg4', 'temp_avg', 'start×seg1'];

    // 피처 정규화 (Z-score)
    const p = X[0].length;
    const means = new Float64Array(p);
    const stds = new Float64Array(p);
    for (let j = 0; j < p; j++) {
      let sum = 0;
      for (let i = 0; i < X.length; i++) sum += X[i][j];
      means[j] = sum / X.length;
      let ssq = 0;
      for (let i = 0; i < X.length; i++) ssq += (X[i][j] - means[j]) ** 2;
      stds[j] = Math.sqrt(ssq / X.length);
      if (stds[j] < 1e-12) stds[j] = 1; // 상수 컬럼 방지
    }
    const Xn = X.map(row => row.map((v, j) => (v - means[j]) / stds[j]));
    this._multiNorm = { means: Array.from(means), stds: Array.from(stds) };

    // 시계열 가중치
    const weights = this.#computeTimeWeights(rows.map(r => r.date));

    // Ridge λ 자동 선택 (GCV): 데이터/피처 비율 기반
    const ratio = rows.length / p;
    const ridgeLambda = ratio < 5 ? 1.0 : ratio < 10 ? 0.1 : 0.01;
    const result = this.#weightedMultipleLinearRegression(Xn, y, weights, ridgeLambda);

    this._XtXinv = result.XtXinv;

    // 선수 개인 보정 (잔차 기반)
    this._playerOffsets = {};
    const playerResiduals = {};
    for (let i = 0; i < rows.length; i++) {
      let pred = result.coeffs[0];
      for (let j = 0; j < Xn[i].length; j++) pred += result.coeffs[j + 1] * Xn[i][j];
      const residual = y[i] - pred;
      const name = rows[i].name;
      if (!playerResiduals[name]) playerResiduals[name] = [];
      playerResiduals[name].push(residual);
    }
    for (const [name, residuals] of Object.entries(playerResiduals)) {
      if (residuals.length >= 2) {
        this._playerOffsets[name] = Math.round(
          (residuals.reduce((s, v) => s + v, 0) / residuals.length) * 1000) / 1000;
      }
    }

    // 잔차 배열 (진단용)
    const residuals = [];
    for (let i = 0; i < rows.length; i++) {
      let pred = result.coeffs[0];
      for (let j = 0; j < Xn[i].length; j++) pred += result.coeffs[j + 1] * Xn[i][j];
      residuals.push(y[i] - pred);
    }

    // Durbin-Watson 통계량 (자기상관 검정)
    let dwNum = 0, dwDen = 0;
    for (let i = 0; i < residuals.length; i++) {
      dwDen += residuals[i] ** 2;
      if (i > 0) dwNum += (residuals[i] - residuals[i - 1]) ** 2;
    }
    const durbinWatson = dwDen > 0 ? Math.round((dwNum / dwDen) * 1000) / 1000 : 2;

    // VIF 계산 (정규화된 피처 기반)
    const vifs = [];
    for (let j = 0; j < p; j++) {
      const xj = Xn.map(row => row[j]);
      const Xrest = Xn.map(row => row.filter((_, k) => k !== j));
      if (Xrest[0].length === 0) { vifs.push(1); continue; }
      const auxResult = this.#multipleLinearRegression(Xrest, xj);
      const vif = auxResult.r2 < 1 ? 1 / (1 - auxResult.r2) : 999;
      vifs.push(Math.round(vif * 100) / 100);
    }

    this._multiCoeffs = {
      coeffs: result.coeffs,
      r2: result.r2,
      residualStd: result.residualStd,
      n: rows.length,
      features,
      ridgeLambda,
      durbinWatson,
      vifs,
    };
    return true;
  }

  predictMulti(featureValues, playerName) {
    if (!this._multiCoeffs || !this._multiNorm) return null;
    const { coeffs, residualStd } = this._multiCoeffs;
    const { means, stds } = this._multiNorm;

    // 정규화 적용
    const normalized = featureValues.map((v, i) => (v - means[i]) / stds[i]);
    let predicted = coeffs[0];
    for (let i = 0; i < normalized.length; i++) {
      predicted += coeffs[i + 1] * normalized[i];
    }
    const offset = playerName ? (this._playerOffsets[playerName] || 0) : 0;
    predicted += offset;

    // Leverage 기반 가변 신뢰구간
    const xAug = [1, ...normalized];
    const h = this.#computeLeverage(xAug, this._XtXinv);
    const se = residualStd * Math.sqrt(1 + h);

    return {
      predicted: Math.round(predicted * 1000) / 1000,
      lower: Math.round((predicted - se) * 1000) / 1000,
      upper: Math.round((predicted + se) * 1000) / 1000,
      playerOffset: offset,
      leverage: Math.round(h * 1000) / 1000,
    };
  }

  getMultiR2() { return this._multiCoeffs ? this._multiCoeffs.r2 : 0; }
  getMultiN() { return this._multiCoeffs ? this._multiCoeffs.n : 0; }
  getMultiCoeffs() { return this._multiCoeffs; }
  getPlayerOffset(name) { return this._playerOffsets[name] || 0; }

  isMultiReliable() {
    return this._multiCoeffs && this._multiCoeffs.r2 > 0.5 && this._multiCoeffs.n >= 5;
  }

  // ─── 3) 구간별 예측 ────────────────────────────────────────
  trainSegment(records) {
    const rows = records
      .filter(r => r.status === 'OK' && r.finish != null
        && r.int1 != null && r.int2 != null && r.int3 != null && r.int4 != null)
      .map(r => ({
        int1: parseFloat(r.int1),
        int2: parseFloat(r.int2),
        int3: parseFloat(r.int3),
        int4: parseFloat(r.int4),
        finish: parseFloat(r.finish),
      }))
      .filter(r => r.int1 > 0 && r.int2 > 0 && r.int3 > 0 && r.int4 > 0 && r.finish > 0);

    if (rows.length < 3) {
      this._segmentModels = null;
      return false;
    }

    const trainSeg = (xArr, yArr) => {
      const n = xArr.length;
      const result = this.#simpleLinearRegression(xArr, yArr);
      const remain = yArr.map((yi, i) => yi - xArr[i]);
      const avg = remain.reduce((s, v) => s + v, 0) / n;
      const std = Math.sqrt(remain.reduce((s, v) => s + (v - avg) ** 2, 0) / n);
      return {
        a: result.a, b: result.b, r2: result.r2,
        residualStd: result.residualStd,
        avg: Math.round(avg * 1000) / 1000,
        std: Math.round(std * 1000) / 1000,
        n,
      };
    };

    const y = rows.map(r => r.finish);
    this._segmentModels = {
      fromInt4: trainSeg(rows.map(r => r.int4), y),
      fromInt3: trainSeg(rows.map(r => r.int3), y),
      fromInt2: trainSeg(rows.map(r => r.int2), y),
      fromInt1: trainSeg(rows.map(r => r.int1), y),
    };
    return true;
  }

  predictFromSegment(knownIntermediate, segmentKey) {
    if (!this._segmentModels || !this._segmentModels[segmentKey]) return null;
    const seg = this._segmentModels[segmentKey];

    const useRegression = seg.r2 >= 0.5 && seg.n >= 5;
    const predicted = useRegression
      ? seg.a * knownIntermediate + seg.b
      : knownIntermediate + seg.avg;
    const std = useRegression ? seg.residualStd : seg.std;

    return {
      predicted: Math.round(predicted * 1000) / 1000,
      lower: Math.round((predicted - std) * 1000) / 1000,
      upper: Math.round((predicted + std) * 1000) / 1000,
      segmentAvg: seg.avg,
      segmentStd: seg.std,
      r2: seg.r2,
      method: useRegression ? 'regression' : 'average',
      n: seg.n,
    };
  }

  getSegmentStats() {
    if (!this._segmentModels) return null;
    const out = {};
    for (const [k, v] of Object.entries(this._segmentModels)) {
      out[k] = { avg: v.avg, std: v.std, n: v.n, r2: v.r2 };
    }
    return out;
  }

  isSegmentReliable() {
    return this._segmentModels && this._segmentModels.fromInt4.n >= 3;
  }

  // ─── 4) 2차 다항 회귀 (비선형, WLS + leverage) ────────────
  trainPoly(records) {
    const pairs = records
      .filter(r => r.start_time != null && r.finish != null)
      .map(r => ({ x: parseFloat(r.start_time), y: parseFloat(r.finish), date: r.date }))
      .filter(p => p.x > 0 && p.y > 0);

    if (pairs.length < 5) {
      this._polyCoeffs = null;
      return false;
    }

    const X = pairs.map(p => [p.x, p.x * p.x]);
    const y = pairs.map(p => p.y);
    const weights = this.#computeTimeWeights(pairs.map(p => p.date));
    const result = this.#weightedMultipleLinearRegression(X, y, weights);

    this._polyXtXinv = result.XtXinv;
    this._polyCoeffs = {
      coeffs: result.coeffs,
      r2: result.r2,
      residualStd: result.residualStd,
      n: pairs.length,
    };
    return true;
  }

  predictPoly(startTime) {
    if (!this._polyCoeffs) return null;
    const { coeffs, residualStd } = this._polyCoeffs;
    const predicted = coeffs[0] + coeffs[1] * startTime + coeffs[2] * startTime * startTime;
    const xAug = [1, startTime, startTime * startTime];
    const h = this.#computeLeverage(xAug, this._polyXtXinv);
    const se = residualStd * Math.sqrt(1 + h);
    return {
      predicted: Math.round(predicted * 1000) / 1000,
      lower: Math.round((predicted - se) * 1000) / 1000,
      upper: Math.round((predicted + se) * 1000) / 1000,
      leverage: Math.round(h * 1000) / 1000,
    };
  }

  getPolyR2() { return this._polyCoeffs ? this._polyCoeffs.r2 : 0; }
  getPolyN() { return this._polyCoeffs ? this._polyCoeffs.n : 0; }
  getPolyCoeffs() { return this._polyCoeffs; }
  isPolyReliable() { return this._polyCoeffs && this._polyCoeffs.r2 > 0.3 && this._polyCoeffs.n >= 5; }

  // ─── 5) K-Fold 교차 검증 ───────────────────────────────────
  crossValidate(records, k = 5) {
    const rows = records
      .filter(r => r.status === 'OK' && r.finish != null && r.start_time != null
        && r.int1 != null && r.int2 != null && r.int3 != null && r.int4 != null)
      .map(r => {
        const start = parseFloat(r.start_time);
        const s1 = parseFloat(r.int1) - start;
        const s2 = parseFloat(r.int2) - parseFloat(r.int1);
        const s3 = parseFloat(r.int3) - parseFloat(r.int2);
        const s4 = parseFloat(r.int4) - parseFloat(r.int3);
        const temp = r.temp_avg != null ? parseFloat(r.temp_avg) : -7;
        return {
          x: [start, s1, s2, s3, s4, temp, start * s1],
          xSimple: start,
          xPoly: [start, start * start],
          y: parseFloat(r.finish),
        };
      })
      .filter(r => r.x.every(v => v !== 0 || true) && r.y > 0);

    if (rows.length < k * 2) return null;

    // Shuffle (Fisher-Yates)
    const shuffled = [...rows];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const foldSize = Math.floor(shuffled.length / k);
    const results = {
      simple: { maes: [], rmses: [], r2s: [] },
      multi: { maes: [], rmses: [], r2s: [] },
      poly: { maes: [], rmses: [], r2s: [] },
    };

    for (let fold = 0; fold < k; fold++) {
      const testStart = fold * foldSize;
      const testEnd = fold === k - 1 ? shuffled.length : testStart + foldSize;
      const testSet = shuffled.slice(testStart, testEnd);
      const trainSet = [...shuffled.slice(0, testStart), ...shuffled.slice(testEnd)];

      // Simple linear
      const simpleResult = this.#simpleLinearRegression(
        trainSet.map(r => r.xSimple), trainSet.map(r => r.y));
      const simpleErrors = testSet.map(r => r.y - (simpleResult.a * r.xSimple + simpleResult.b));
      this.#collectFoldMetrics(results.simple, simpleErrors, testSet.map(r => r.y));

      // Multi linear (정규화 + Ridge)
      const trainX = trainSet.map(r => r.x);
      const trainY = trainSet.map(r => r.y);
      const np = trainX[0].length;
      const cvMeans = new Float64Array(np);
      const cvStds = new Float64Array(np);
      for (let j = 0; j < np; j++) {
        let sum = 0;
        for (let i = 0; i < trainX.length; i++) sum += trainX[i][j];
        cvMeans[j] = sum / trainX.length;
        let ssq = 0;
        for (let i = 0; i < trainX.length; i++) ssq += (trainX[i][j] - cvMeans[j]) ** 2;
        cvStds[j] = Math.sqrt(ssq / trainX.length);
        if (cvStds[j] < 1e-12) cvStds[j] = 1;
      }
      const trainXn = trainX.map(row => row.map((v, j) => (v - cvMeans[j]) / cvStds[j]));
      const cvRatio = trainX.length / np;
      const cvRidge = cvRatio < 5 ? 1.0 : cvRatio < 10 ? 0.1 : 0.01;
      const multiResult = this.#weightedMultipleLinearRegression(trainXn, trainY, null, cvRidge);
      const multiErrors = testSet.map(r => {
        const xn = r.x.map((v, j) => (v - cvMeans[j]) / cvStds[j]);
        let pred = multiResult.coeffs[0];
        for (let j = 0; j < xn.length; j++) pred += multiResult.coeffs[j + 1] * xn[j];
        return r.y - pred;
      });
      this.#collectFoldMetrics(results.multi, multiErrors, testSet.map(r => r.y));

      // Poly
      const polyResult = this.#multipleLinearRegression(
        trainSet.map(r => r.xPoly), trainSet.map(r => r.y));
      const polyErrors = testSet.map(r => {
        let pred = polyResult.coeffs[0];
        for (let j = 0; j < r.xPoly.length; j++) pred += polyResult.coeffs[j + 1] * r.xPoly[j];
        return r.y - pred;
      });
      this.#collectFoldMetrics(results.poly, polyErrors, testSet.map(r => r.y));
    }

    // Average metrics
    const avg = (arr) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
    this._cvResults = {};
    for (const [model, metrics] of Object.entries(results)) {
      this._cvResults[model] = {
        cvMAE: Math.round(avg(metrics.maes) * 1000) / 1000,
        cvRMSE: Math.round(avg(metrics.rmses) * 1000) / 1000,
        cvR2: Math.round(avg(metrics.r2s) * 1000) / 1000,
        k,
      };
    }
    return this._cvResults;
  }

  #collectFoldMetrics(bucket, errors, actuals) {
    const mae = errors.reduce((s, e) => s + Math.abs(e), 0) / errors.length;
    const rmse = Math.sqrt(errors.reduce((s, e) => s + e * e, 0) / errors.length);
    const meanY = actuals.reduce((s, v) => s + v, 0) / actuals.length;
    const ssTot = actuals.reduce((s, v) => s + (v - meanY) ** 2, 0);
    const ssRes = errors.reduce((s, e) => s + e * e, 0);
    const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
    bucket.maes.push(mae);
    bucket.rmses.push(rmse);
    bucket.r2s.push(r2);
  }

  getCVResults() { return this._cvResults; }

  // ─── 6) 앙상블 예측 (CV R² 가중 평균) ────────────────────────
  predictEnsemble(startTime, multiFeatures, playerName) {
    const cv = this._cvResults;
    if (!cv) return null;

    const models = [];
    // 단순 선형 (데이터 3개 이상이면 포함)
    if (this._n >= 3) {
      const pred = this.predict(startTime);
      models.push({ name: 'simple', pred: pred.predicted, w: Math.max(0, cv.simple?.cvR2 || 0) });
    }
    // 2차 다항
    if (this._polyCoeffs && this._polyCoeffs.n >= 5) {
      const pred = this.predictPoly(startTime);
      models.push({ name: 'poly', pred: pred.predicted, w: Math.max(0, cv.poly?.cvR2 || 0) });
    }
    // 다중 선형
    if (multiFeatures && this._multiCoeffs && this._multiNorm) {
      const pred = this.predictMulti(multiFeatures, playerName);
      models.push({ name: 'multi', pred: pred.predicted, w: Math.max(0, cv.multi?.cvR2 || 0) });
    }

    if (models.length === 0) return null;

    const totalW = models.reduce((s, m) => s + m.w, 0);
    if (totalW < 1e-12) {
      // 모든 CV R²가 0이면 균등 가중
      const avg = models.reduce((s, m) => s + m.pred, 0) / models.length;
      return { predicted: Math.round(avg * 1000) / 1000, models, weights: models.map(() => 1 / models.length) };
    }

    const weights = models.map(m => m.w / totalW);
    const predicted = models.reduce((s, m, i) => s + m.pred * weights[i], 0);

    // 앙상블 불확실성: 가중 분산
    const variance = models.reduce((s, m, i) => s + weights[i] * (m.pred - predicted) ** 2, 0);
    const std = Math.sqrt(variance);

    return {
      predicted: Math.round(predicted * 1000) / 1000,
      lower: Math.round((predicted - Math.max(std, this._residualStd)) * 1000) / 1000,
      upper: Math.round((predicted + Math.max(std, this._residualStd)) * 1000) / 1000,
      models,
      weights: weights.map(w => Math.round(w * 1000) / 1000),
    };
  }

  // ─── 7) 부트스트랩 신뢰구간 ──────────────────────────────────
  bootstrapPredict(records, modelType, inputValues, B = 200) {
    const okRecords = records.filter(r => r.status === 'OK' && r.finish != null);
    if (okRecords.length < 5) return null;

    const predictions = [];
    const tempModel = new PredictionModel();

    for (let b = 0; b < B; b++) {
      // 복원 추출
      const sample = [];
      for (let i = 0; i < okRecords.length; i++) {
        sample.push(okRecords[Math.floor(Math.random() * okRecords.length)]);
      }

      let pred = null;
      if (modelType === 'simple') {
        tempModel.train(sample);
        if (tempModel.isReliable()) pred = tempModel.predict(inputValues.startTime)?.predicted;
      } else if (modelType === 'poly') {
        tempModel.trainPoly(sample);
        if (tempModel.isPolyReliable()) pred = tempModel.predictPoly(inputValues.startTime)?.predicted;
      } else if (modelType === 'multi') {
        tempModel.trainMulti(sample);
        if (tempModel.isMultiReliable()) pred = tempModel.predictMulti(inputValues.features, inputValues.playerName)?.predicted;
      }

      if (pred != null && isFinite(pred)) predictions.push(pred);
    }

    if (predictions.length < B * 0.5) return null; // 50% 이상 실패 시 신뢰 불가

    predictions.sort((a, b) => a - b);
    const lo = Math.floor(predictions.length * 0.025);
    const hi = Math.floor(predictions.length * 0.975);
    const median = predictions[Math.floor(predictions.length * 0.5)];

    return {
      ci95Lower: Math.round(predictions[lo] * 1000) / 1000,
      ci95Upper: Math.round(predictions[hi] * 1000) / 1000,
      median: Math.round(median * 1000) / 1000,
      nSuccess: predictions.length,
      nTotal: B,
    };
  }

  // ─── 범용 다중선형회귀 (키, 몸무게, 환경, 스타트 → 피니시) ───
  trainGeneralMLR(records, input) {
    const { height, weight, iceTemp, airTemp, humidity, startTime } = input;

    // 1. 학습 데이터 필터링
    let rows = records
      .filter(r => r.status === 'OK' && r.finish != null && r.start_time != null)
      .map(r => {
        const st = parseFloat(r.start_time);
        const fin = parseFloat(r.finish);
        const temp = r.temp_avg != null ? parseFloat(r.temp_avg) : -7;
        return { start_time: st, finish: fin, ice_temp: temp, date: r.date };
      })
      .filter(r => r.start_time > 0 && r.finish > 0 && r.finish < 70);

    const initialCount = rows.length;
    if (rows.length < 10) return null;

    // 2. 이상치 제거 (2.5 IQR)
    const finishes = rows.map(r => r.finish).sort((a, b) => a - b);
    const q1 = finishes[Math.floor(finishes.length * 0.25)];
    const q3 = finishes[Math.floor(finishes.length * 0.75)];
    const iqr = q3 - q1;
    const lo = q1 - 2.5 * iqr;
    const hi = q3 + 2.5 * iqr;
    rows = rows.filter(r => r.finish >= lo && r.finish <= hi);
    const outlierRemoved = initialCount - rows.length;

    if (rows.length < 10) return null;

    // 3. 독립 변수 구성
    // 현재 DB에 키/몸무게가 없으므로 스타트타임 + 얼음온도로 학습
    // 키/몸무게는 예측 시 사용자 입력값으로 보정 계수 적용
    const featureNames = ['start_time', 'ice_temp'];
    const X = rows.map(r => [r.start_time, r.ice_temp]);
    const y = rows.map(r => r.finish);
    const n = X.length;
    const p = X[0].length;

    // 4. 기술 통계량
    const descriptive = featureNames.map((name, j) => {
      const vals = X.map(row => row[j]);
      const mean = vals.reduce((s, v) => s + v, 0) / n;
      const std = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1));
      return { name, mean, std, min: Math.min(...vals), max: Math.max(...vals) };
    });
    const yMean = y.reduce((s, v) => s + v, 0) / n;
    const yStd = Math.sqrt(y.reduce((s, v) => s + (v - yMean) ** 2, 0) / (n - 1));
    descriptive.push({ name: 'finish', mean: yMean, std: yStd, min: Math.min(...y), max: Math.max(...y) });

    // 5. 상관관계 행렬 (Pearson)
    const allVars = [...X.map((row, i) => [...row, y[i]])];
    const corrLabels = [...featureNames, 'finish'];
    const nVars = corrLabels.length;
    const corrMatrix = Array.from({ length: nVars }, () => new Array(nVars).fill(0));
    for (let a = 0; a < nVars; a++) {
      for (let b = a; b < nVars; b++) {
        const va = allVars.map(row => row[a]);
        const vb = allVars.map(row => row[b]);
        const ma = va.reduce((s, v) => s + v, 0) / n;
        const mb = vb.reduce((s, v) => s + v, 0) / n;
        let sab = 0, saa = 0, sbb = 0;
        for (let i = 0; i < n; i++) {
          sab += (va[i] - ma) * (vb[i] - mb);
          saa += (va[i] - ma) ** 2;
          sbb += (vb[i] - mb) ** 2;
        }
        const r = (saa === 0 || sbb === 0) ? 0 : sab / Math.sqrt(saa * sbb);
        corrMatrix[a][b] = r;
        corrMatrix[b][a] = r;
      }
    }

    // 6. 다중선형회귀 (정규방정식)
    const Xa = X.map(row => [1, ...row]);
    const cols = p + 1;

    const XtX = Array.from({ length: cols }, () => new Float64Array(cols));
    const Xty = new Float64Array(cols);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < cols; j++) {
        Xty[j] += Xa[i][j] * y[i];
        for (let k = j; k < cols; k++) {
          XtX[j][k] += Xa[i][j] * Xa[i][k];
        }
      }
    }
    for (let j = 0; j < cols; j++) for (let k = 0; k < j; k++) XtX[j][k] = XtX[k][j];

    const coeffs = this.#solveLinearSystem(XtX, Xty, cols);
    const XtXinv = this.#invertMatrixGJ(XtX, cols);

    // 7. 잔차, R², RMSE, MAE
    const residuals = [];
    let ssRes = 0, ssTot = 0, absSum = 0;
    for (let i = 0; i < n; i++) {
      let pred = 0;
      for (let j = 0; j < cols; j++) pred += coeffs[j] * Xa[i][j];
      const resid = y[i] - pred;
      residuals.push(resid);
      ssRes += resid ** 2;
      ssTot += (y[i] - yMean) ** 2;
      absSum += Math.abs(resid);
    }
    const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;
    const adjR2 = 1 - (1 - r2) * (n - 1) / (n - p - 1);
    const rmse = Math.sqrt(ssRes / n);
    const mae = absSum / n;
    const residualStd = n > cols ? Math.sqrt(ssRes / (n - cols)) : 0;

    // 8. Durbin-Watson
    let dwNum = 0, dwDen = 0;
    for (let i = 0; i < residuals.length; i++) {
      dwDen += residuals[i] ** 2;
      if (i > 0) dwNum += (residuals[i] - residuals[i - 1]) ** 2;
    }
    const durbinWatson = dwDen > 0 ? dwNum / dwDen : 2;

    // 9. 표준화 계수 (Beta), t-value, p-value, VIF
    const xStds = featureNames.map((_, j) => {
      const vals = X.map(row => row[j]);
      const m = vals.reduce((s, v) => s + v, 0) / n;
      return Math.sqrt(vals.reduce((s, v) => s + (v - m) ** 2, 0) / (n - 1));
    });

    const coeffDetails = [{ name: '절편 (Intercept)', B: coeffs[0], beta: null, t: 0, p: 1, vif: null }];

    for (let j = 0; j < p; j++) {
      const B = coeffs[j + 1];
      const beta = (xStds[j] > 0 && yStd > 0) ? B * xStds[j] / yStd : 0;
      const se = XtXinv ? residualStd * Math.sqrt(XtXinv[j + 1][j + 1]) : 0;
      const t = se > 0 ? B / se : 0;
      const df = n - p - 1;
      // p-value approximation (two-tailed t-distribution)
      const pVal = this.#tDistPValue(Math.abs(t), df);

      // VIF
      const xj = X.map(row => row[j]);
      const Xrest = X.map(row => row.filter((_, k) => k !== j));
      let vif = 1;
      if (Xrest[0].length > 0) {
        const auxResult = this.#multipleLinearRegression(Xrest, xj);
        vif = auxResult.r2 < 1 ? 1 / (1 - auxResult.r2) : 999;
      }

      coeffDetails.push({ name: featureNames[j], B, beta, t, p: pVal, vif: Math.round(vif * 100) / 100 });
    }

    // t-value for intercept
    if (XtXinv) {
      const se0 = residualStd * Math.sqrt(XtXinv[0][0]);
      coeffDetails[0].t = se0 > 0 ? coeffs[0] / se0 : 0;
      coeffDetails[0].p = this.#tDistPValue(Math.abs(coeffDetails[0].t), n - p - 1);
    }

    // 10. 예측값 계산
    const inputFeatures = [startTime, iceTemp];
    let predicted = coeffs[0];
    for (let j = 0; j < p; j++) predicted += coeffs[j + 1] * inputFeatures[j];

    // leverage 기반 신뢰구간
    const xAug = [1, ...inputFeatures];
    const h = this.#computeLeverage(xAug, XtXinv);
    const se = residualStd * Math.sqrt(1 + h);
    // 95% CI (≈ 1.96σ)
    const tCrit = 1.96;

    // 실제 vs 예측 데이터 (차트용)
    const actualVsPred = [];
    for (let i = 0; i < n; i++) {
      let p2 = 0;
      for (let j2 = 0; j2 < cols; j2++) p2 += coeffs[j2] * Xa[i][j2];
      actualVsPred.push({ actual: y[i], predicted: p2 });
    }

    return {
      prediction: {
        predicted: Math.round(predicted * 1000) / 1000,
        lower: Math.round((predicted - tCrit * se) * 1000) / 1000,
        upper: Math.round((predicted + tCrit * se) * 1000) / 1000,
      },
      modelInfo: {
        n: rows.length,
        p,
        r2,
        adjR2,
        rmse,
        mae,
        residualStd,
        durbinWatson,
        coeffDetails,
        descriptive,
        corrLabels,
        corrMatrix,
        preprocessing: { initial: initialCount, outlierRemoved, final: rows.length },
        actualVsPred,
      },
    };
  }

  // p-value approximation for t-distribution (two-tailed)
  #tDistPValue(t, df) {
    if (df <= 0) return 1;
    const x = df / (df + t * t);
    // Regularized incomplete beta function approximation
    // Using simple approximation: for large df, t ~ N(0,1)
    if (df > 30) {
      // Normal approximation
      const z = t;
      const p = Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
      const cdf = 0.5 * (1 + this.#erf(z / Math.sqrt(2)));
      return 2 * (1 - cdf);
    }
    // For small df, use series approximation
    const a = df / 2;
    const b = 0.5;
    let result = Math.pow(x, a) * Math.pow(1 - x, b) / (a * this.#beta(a, b));
    let sum = 1;
    let term = 1;
    for (let k = 1; k < 100; k++) {
      term *= (k - b) * x / (a + k);
      sum += term;
      if (Math.abs(term) < 1e-10) break;
    }
    result *= sum;
    return Math.max(0, Math.min(1, result));
  }

  #erf(x) {
    const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429;
    const p = 0.3275911;
    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x);
    const t = 1 / (1 + p * x);
    const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    return sign * y;
  }

  #beta(a, b) {
    return (this.#gamma(a) * this.#gamma(b)) / this.#gamma(a + b);
  }

  #gamma(z) {
    if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * this.#gamma(1 - z));
    z -= 1;
    const g = 7;
    const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    let x = c[0];
    for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
    const t = z + g + 0.5;
    return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
  }

  // ─── 전체 학습 (4가지 모델 + CV) ──────────────────────────
  trainAll(records) {
    const simple = this.train(records);
    const multi = this.trainMulti(records);
    const segment = this.trainSegment(records);
    const poly = this.trainPoly(records);
    // 교차 검증 (데이터 충분한 경우만)
    if (records.filter(r => r.status === 'OK').length >= 10) {
      this.crossValidate(records);
    }
    return { simple, multi, segment, poly };
  }

  // ─── 모델 비교 리포트 ──────────────────────────────────────
  getModelComparison() {
    const cv = this._cvResults || {};
    return {
      simple: {
        name: '단순 선형 회귀',
        desc: 'Start Time → Finish',
        r2: this._r2,
        n: this._n,
        reliable: this.isReliable(),
        residualStd: this._residualStd,
        cv: cv.simple || null,
      },
      multi: {
        name: '다중 선형 회귀',
        desc: 'Start+구간+온도+상호작용',
        r2: this._multiCoeffs ? this._multiCoeffs.r2 : 0,
        n: this._multiCoeffs ? this._multiCoeffs.n : 0,
        reliable: this.isMultiReliable(),
        residualStd: this._multiCoeffs ? this._multiCoeffs.residualStd : 0,
        cv: cv.multi || null,
      },
      poly: {
        name: '2차 다항 회귀',
        desc: 'Start + Start² → Finish',
        r2: this._polyCoeffs ? this._polyCoeffs.r2 : 0,
        n: this._polyCoeffs ? this._polyCoeffs.n : 0,
        reliable: this.isPolyReliable(),
        residualStd: this._polyCoeffs ? this._polyCoeffs.residualStd : 0,
        cv: cv.poly || null,
      },
      segment: {
        name: '구간별 가중 예측',
        desc: 'Int.N 실측 → Finish 예측',
        n: this._segmentModels ? this._segmentModels.fromInt4.n : 0,
        reliable: this.isSegmentReliable(),
        stats: this._segmentModels,
      },
    };
  }

  // ─── Private: 단순 선형 회귀 ────────────────────────────────
  #simpleLinearRegression(x, y) {
    const n = x.length;
    const mx = x.reduce((s, v) => s + v, 0) / n;
    const my = y.reduce((s, v) => s + v, 0) / n;
    let ssxy = 0, ssxx = 0, ssyy = 0;
    for (let i = 0; i < n; i++) {
      ssxy += (x[i] - mx) * (y[i] - my);
      ssxx += (x[i] - mx) ** 2;
      ssyy += (y[i] - my) ** 2;
    }
    const a = ssxx === 0 ? 0 : ssxy / ssxx;
    const b = my - a * mx;
    const r2 = ssyy === 0 ? 0 : ssxy ** 2 / (ssxx * ssyy);
    const residuals = y.map((yi, i) => yi - (a * x[i] + b));
    const residualStd = Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / (n - 1));
    return { a, b, r2, residualStd };
  }

  // ─── Private: 다중 선형 회귀 (정규방정식) ───────────────────
  #multipleLinearRegression(X, y) {
    const n = X.length;
    const p = X[0].length;
    const Xa = X.map(row => [1, ...row]);
    const cols = p + 1;

    const XtX = Array.from({length: cols}, () => new Float64Array(cols));
    const Xty = new Float64Array(cols);

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < cols; j++) {
        Xty[j] += Xa[i][j] * y[i];
        for (let k = j; k < cols; k++) {
          XtX[j][k] += Xa[i][j] * Xa[i][k];
        }
      }
    }
    for (let j = 0; j < cols; j++) {
      for (let k = 0; k < j; k++) {
        XtX[j][k] = XtX[k][j];
      }
    }

    const coeffs = this.#solveLinearSystem(XtX, Xty, cols);

    const my = y.reduce((s, v) => s + v, 0) / n;
    let ssRes = 0, ssTot = 0;
    for (let i = 0; i < n; i++) {
      let pred = 0;
      for (let j = 0; j < cols; j++) pred += coeffs[j] * Xa[i][j];
      ssRes += (y[i] - pred) ** 2;
      ssTot += (y[i] - my) ** 2;
    }
    const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;
    const residualStd = n > cols ? Math.sqrt(ssRes / (n - cols)) : 0;

    return { coeffs: Array.from(coeffs), r2, residualStd };
  }

  // ─── Private: 이상치 필터링 ─────────────────────────────────
  #filterOutliers(rows, getX, getY, threshold = 2.5) {
    if (rows.length < 8) return rows;
    const X = rows.map(getX);
    const y = rows.map(getY);
    const result = this.#multipleLinearRegression(X, y);
    const n = X.length;
    const residuals = [];
    for (let i = 0; i < n; i++) {
      let pred = result.coeffs[0];
      for (let j = 0; j < X[i].length; j++) pred += result.coeffs[j + 1] * X[i][j];
      residuals.push(y[i] - pred);
    }
    const mean = residuals.reduce((s, v) => s + v, 0) / n;
    const std = Math.sqrt(residuals.reduce((s, v) => s + (v - mean) ** 2, 0) / n);
    if (std < 1e-9) return rows;
    return rows.filter((_, i) => Math.abs((residuals[i] - mean) / std) <= threshold);
  }

  // ─── Private: 날짜 기반 시계열 가중치 ─────────────────────────
  #computeTimeWeights(dates, lambda = 0.05) {
    if (!dates || dates.length === 0) return null;
    const timestamps = dates.map(d => {
      if (!d) return 0;
      const t = typeof d === 'string' ? new Date(d.replace(/\./g, '-')).getTime() : 0;
      return isNaN(t) ? 0 : t;
    });
    const maxT = Math.max(...timestamps);
    if (maxT === 0) return null;
    const dayMs = 86400000;
    return timestamps.map(t => {
      const daysDiff = (maxT - t) / dayMs;
      return Math.exp(-lambda * daysDiff / 30);
    });
  }

  // ─── Private: 가중 단순 선형 회귀 (WLS) ──────────────────────
  #weightedSimpleRegression(x, y, w) {
    const n = x.length;
    const W = w || new Array(n).fill(1);
    const sumW = W.reduce((s, v) => s + v, 0);
    const mx = W.reduce((s, wi, i) => s + wi * x[i], 0) / sumW;
    const my = W.reduce((s, wi, i) => s + wi * y[i], 0) / sumW;
    let ssxy = 0, ssxx = 0, ssyy = 0;
    for (let i = 0; i < n; i++) {
      ssxy += W[i] * (x[i] - mx) * (y[i] - my);
      ssxx += W[i] * (x[i] - mx) ** 2;
      ssyy += W[i] * (y[i] - my) ** 2;
    }
    const a = ssxx === 0 ? 0 : ssxy / ssxx;
    const b = my - a * mx;
    const r2 = ssyy === 0 ? 0 : ssxy ** 2 / (ssxx * ssyy);
    let ssRes = 0;
    for (let i = 0; i < n; i++) ssRes += W[i] * (y[i] - (a * x[i] + b)) ** 2;
    const residualStd = n > 2 ? Math.sqrt(ssRes / (sumW * (n - 2) / n)) : 0;
    // XtXinv for simple: X = [1, x], augmented design
    const XtXinv = this.#invertMatrix2x2(x, W, mx);
    return { a, b, r2, residualStd, XtXinv };
  }

  #invertMatrix2x2(x, w, mx) {
    const n = x.length;
    let s00 = 0, s01 = 0, s11 = 0;
    for (let i = 0; i < n; i++) {
      s00 += w[i]; s01 += w[i] * x[i]; s11 += w[i] * x[i] * x[i];
    }
    const det = s00 * s11 - s01 * s01;
    if (Math.abs(det) < 1e-12) return null;
    return [[s11 / det, -s01 / det], [-s01 / det, s00 / det]];
  }

  // ─── Private: 가중 다중 선형 회귀 (WLS + Ridge) ──────────────
  #weightedMultipleLinearRegression(X, y, w, ridge = 0) {
    const n = X.length;
    const p = X[0].length;
    const Xa = X.map(row => [1, ...row]);
    const cols = p + 1;
    const W = w || new Array(n).fill(1);

    const XtWX = Array.from({length: cols}, () => new Float64Array(cols));
    const XtWy = new Float64Array(cols);

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < cols; j++) {
        XtWy[j] += W[i] * Xa[i][j] * y[i];
        for (let k = j; k < cols; k++) {
          XtWX[j][k] += W[i] * Xa[i][j] * Xa[i][k];
        }
      }
    }
    for (let j = 0; j < cols; j++) {
      for (let k = 0; k < j; k++) {
        XtWX[j][k] = XtWX[k][j];
      }
    }

    // Ridge 정규화: 대각선에 λ 추가 (절편 제외)
    if (ridge > 0) {
      for (let j = 1; j < cols; j++) {
        XtWX[j][j] += ridge;
      }
    }

    const coeffs = this.#solveLinearSystem(XtWX, XtWy, cols);

    // (X'WX)⁻¹ 계산 (leverage용)
    const XtXinv = this.#invertMatrixGJ(XtWX, cols);

    const my = y.reduce((s, v) => s + v, 0) / n;
    let ssRes = 0, ssTot = 0;
    for (let i = 0; i < n; i++) {
      let pred = 0;
      for (let j = 0; j < cols; j++) pred += coeffs[j] * Xa[i][j];
      ssRes += (y[i] - pred) ** 2;
      ssTot += (y[i] - my) ** 2;
    }
    const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;
    const residualStd = n > cols ? Math.sqrt(ssRes / (n - cols)) : 0;

    return { coeffs: Array.from(coeffs), r2, residualStd, XtXinv };
  }

  // ─── Private: Gauss-Jordan 역행렬 ─────────────────────────────
  #invertMatrixGJ(A, n) {
    const aug = Array.from({length: n}, (_, i) => {
      const row = new Float64Array(2 * n);
      for (let j = 0; j < n; j++) row[j] = A[i][j];
      row[n + i] = 1;
      return row;
    });
    for (let col = 0; col < n; col++) {
      let maxRow = col;
      for (let row = col + 1; row < n; row++) {
        if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) maxRow = row;
      }
      [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];
      const pivot = aug[col][col];
      if (Math.abs(pivot) < 1e-12) return null;
      for (let j = 0; j < 2 * n; j++) aug[col][j] /= pivot;
      for (let row = 0; row < n; row++) {
        if (row === col) continue;
        const factor = aug[row][col];
        for (let j = 0; j < 2 * n; j++) aug[row][j] -= factor * aug[col][j];
      }
    }
    return aug.map(row => Array.from(row.slice(n)));
  }

  // ─── Private: leverage 계산 ───────────────────────────────────
  #computeLeverage(xAug, XtXinv) {
    if (!XtXinv) return 0;
    const p = xAug.length;
    let h = 0;
    for (let i = 0; i < p; i++) {
      for (let j = 0; j < p; j++) {
        h += xAug[i] * XtXinv[i][j] * xAug[j];
      }
    }
    return Math.max(0, Math.min(h, 1));
  }

  // ─── Private: 가우스 소거법 ─────────────────────────────────
  #solveLinearSystem(A, b, n) {
    const aug = Array.from({length: n}, (_, i) => {
      const row = new Float64Array(n + 1);
      for (let j = 0; j < n; j++) row[j] = A[i][j];
      row[n] = b[i];
      return row;
    });

    for (let col = 0; col < n; col++) {
      let maxRow = col;
      for (let row = col + 1; row < n; row++) {
        if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) maxRow = row;
      }
      [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];

      const pivot = aug[col][col];
      if (Math.abs(pivot) < 1e-12) continue;

      for (let j = col; j <= n; j++) aug[col][j] /= pivot;
      for (let row = 0; row < n; row++) {
        if (row === col) continue;
        const factor = aug[row][col];
        for (let j = col; j <= n; j++) aug[row][j] -= factor * aug[col][j];
      }
    }

    return aug.map(row => row[n]);
  }
}
