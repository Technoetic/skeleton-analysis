class PlayerAnalyzer {
  static OUTLIER_THRESHOLD = 3;
  static SPEED_MIN = 90;
  static TREND_THRESHOLD = 0.3;
  static CORRELATION_HIGH = 0.7;
  static CORRELATION_MEDIUM = 0.4;

  constructor(dataStore) {
    this.ds = dataStore;
    this._statsCache = new Map();
    this._splitCache = new Map();
    this._trendCache = new Map();
    this._percentileCache = new Map();
  }

  _getOkRecords(name) {
    const recs = this.ds.getPlayerRecords(name).filter(
      r => r.status === 'OK' && r.finish != null
    );
    return this._removeOutliers(recs);
  }

  _removeOutliers(records) {
    // 날짜별 그룹화 후 이상치 제거
    const byDate = {};
    for (const r of records) {
      if (!byDate[r.date]) byDate[r.date] = [];
      byDate[r.date].push(r);
    }
    const clean = [];
    for (const group of Object.values(byDate)) {
      if (group.length === 1) { clean.push(...group); continue; }
      const finishes = group.map(r => parseFloat(r.finish)).filter(f => !isNaN(f));
      const sorted = finishes.sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
      for (const r of group) {
        const f = parseFloat(r.finish);
        const spd = parseFloat(r.speed) || 0;
        if (Math.abs(f - median) > PlayerAnalyzer.OUTLIER_THRESHOLD) continue; // 이상치 제거
        if (spd > 0 && spd < PlayerAnalyzer.SPEED_MIN) continue;       // 속도 이상 제거
        clean.push(r);
      }
    }
    return clean;
  }

  getStats(name) {
    if (this._statsCache.has(name)) return this._statsCache.get(name);
    const recs = this._getOkRecords(name);
    if (recs.length === 0) { this._statsCache.set(name, null); return null; }
    const finishes = recs.map(r => parseFloat(r.finish)).filter(f => !isNaN(f));
    if (finishes.length === 0) return null;
    const avg = finishes.reduce((s,v)=>s+v,0) / finishes.length;
    const best = Math.min(...finishes);
    const worst = Math.max(...finishes);
    const variance = finishes.reduce((s,v)=>s+(v-avg)**2,0) / finishes.length;
    const stddev = Math.sqrt(variance);
    const result = {
      avg: Math.round(avg*1000)/1000,
      best: Math.round(best*1000)/1000,
      worst: Math.round(worst*1000)/1000,
      stddev: Math.round(stddev*1000)/1000,
      count: finishes.length,
      consistency: avg > 0 ? Math.round(Math.max(0, 1 - stddev/avg)*1000)/1000 : 0,
    };
    this._statsCache.set(name, result);
    return result;
  }

  getSplitStats(name) {
    if (this._splitCache.has(name)) return this._splitCache.get(name);
    const recs = this._getOkRecords(name).filter(
      r => r.int1 != null && r.int2 != null && r.int3 != null && r.int4 != null
    );
    if (recs.length === 0) return null;
    // 누적 → 분할 변환
    const splits = recs.map(r => ({
      s0: parseFloat(r.start_time) || 0,
      s1: (parseFloat(r.int1) || 0) - (parseFloat(r.start_time) || 0),
      s2: parseFloat(r.int2) - parseFloat(r.int1),
      s3: parseFloat(r.int3) - parseFloat(r.int2),
      s4: parseFloat(r.int4) - parseFloat(r.int3),
      s5: parseFloat(r.finish) - parseFloat(r.int4),
    }));
    const segments = [
      { key: 's0', label: 'Start' },
      { key: 's1', label: 'Start→Int.1' },
      { key: 's2', label: 'Int.1→2' },
      { key: 's3', label: 'Int.2→3' },
      { key: 's4', label: 'Int.3→4' },
      { key: 's5', label: 'Int.4→Finish' },
    ];
    const result = segments.map(seg => {
      const vals = splits.map(s => s[seg.key]).filter(v => v > 0 && v < 30);
      if (vals.length === 0) return { label: seg.label, avg: null, best: null, worst: null, stddev: null };
      const avg = vals.reduce((s,v)=>s+v,0)/vals.length;
      const variance = vals.reduce((s,v)=>s+(v-avg)**2,0)/vals.length;
      return {
        label: seg.label,
        avg: Math.round(avg*1000)/1000,
        best: Math.round(Math.min(...vals)*1000)/1000,
        worst: Math.round(Math.max(...vals)*1000)/1000,
        stddev: Math.round(Math.sqrt(variance)*1000)/1000,
        count: vals.length,
      };
    });
    this._splitCache.set(name, result);
    return result;
  }

  getTrend(name) {
    if (this._trendCache.has(name)) return this._trendCache.get(name);
    const recs = this._getOkRecords(name)
      .filter(r => r.date && r.date !== 'unknown' && r.finish != null)
      .sort((a, b) => a.date.localeCompare(b.date));
    const result = recs.map(r => ({
      date: r.date,
      finish: parseFloat(r.finish),
      run: r.run,
      session: r.session,
    }));
    this._trendCache.set(name, result);
    return result;
  }

  compareMultiple(names) {
    return names.map(name => {
      const stats = this.getStats(name);
      const splitStats = this.getSplitStats(name);
      return { name, stats, splitStats };
    });
  }

  getPercentiles(name) {
    if (this._percentileCache.has(name)) return this._percentileCache.get(name);
    const recs = this._getOkRecords(name);
    const finishes = recs.map(r => parseFloat(r.finish)).filter(f => !isNaN(f)).sort((a,b) => a - b);
    if (finishes.length < 3) return null;
    const pct = (p) => {
      const idx = (p / 100) * (finishes.length - 1);
      const lo = Math.floor(idx), hi = Math.ceil(idx);
      return lo === hi ? finishes[lo] : finishes[lo] + (finishes[hi] - finishes[lo]) * (idx - lo);
    };
    const result = { p10: pct(10), p25: pct(25), p50: pct(50), p75: pct(75), p90: pct(90), p95: pct(95), count: finishes.length };
    this._percentileCache.set(name, result);
    return result;
  }

  getSeasonTrend(name) {
    const trend = this.getTrend(name);
    if (trend.length < 4) return { direction: 'insufficient', slope: 0, label: '데이터 부족' };
    // Simple linear regression on sequential index vs finish
    const n = trend.length;
    const xs = trend.map((_, i) => i);
    const ys = trend.map(t => t.finish);
    const mx = (n - 1) / 2;
    const my = ys.reduce((s, v) => s + v, 0) / n;
    let ssxy = 0, ssxx = 0;
    for (let i = 0; i < n; i++) {
      ssxy += (xs[i] - mx) * (ys[i] - my);
      ssxx += (xs[i] - mx) ** 2;
    }
    const slope = ssxx === 0 ? 0 : ssxy / ssxx;
    // Compare first half avg to second half avg
    const half = Math.floor(n / 2);
    const firstAvg = ys.slice(0, half).reduce((s, v) => s + v, 0) / half;
    const secondAvg = ys.slice(half).reduce((s, v) => s + v, 0) / (n - half);
    const diff = secondAvg - firstAvg;
    let direction, label;
    if (diff < -PlayerAnalyzer.TREND_THRESHOLD) { direction = 'improving'; label = '향상 추세'; }
    else if (diff > PlayerAnalyzer.TREND_THRESHOLD) { direction = 'declining'; label = '하락 추세'; }
    else { direction = 'stable'; label = '안정 유지'; }
    return { direction, slope: Math.round(slope * 1000) / 1000, diff: Math.round(diff * 1000) / 1000, label, firstAvg: Math.round(firstAvg * 1000) / 1000, secondAvg: Math.round(secondAvg * 1000) / 1000 };
  }

  getSegmentCorrelation(name) {
    const recs = this._getOkRecords(name).filter(
      r => r.int1 != null && r.int2 != null && r.int3 != null && r.int4 != null && r.start_time != null
    );
    if (recs.length < 5) return null;
    const finishes = recs.map(r => parseFloat(r.finish));
    const segments = {
      'Start': recs.map(r => parseFloat(r.start_time)),
      'Start→Int.1': recs.map(r => parseFloat(r.int1) - parseFloat(r.start_time)),
      'Int.1→2': recs.map(r => parseFloat(r.int2) - parseFloat(r.int1)),
      'Int.2→3': recs.map(r => parseFloat(r.int3) - parseFloat(r.int2)),
      'Int.3→4': recs.map(r => parseFloat(r.int4) - parseFloat(r.int3)),
      'Int.4→F': recs.map(r => parseFloat(r.finish) - parseFloat(r.int4)),
    };
    const corr = (x, y) => {
      const n = x.length;
      const mx = x.reduce((s, v) => s + v, 0) / n;
      const my = y.reduce((s, v) => s + v, 0) / n;
      let sxy = 0, sxx = 0, syy = 0;
      for (let i = 0; i < n; i++) {
        sxy += (x[i] - mx) * (y[i] - my);
        sxx += (x[i] - mx) ** 2;
        syy += (y[i] - my) ** 2;
      }
      return sxx === 0 || syy === 0 ? 0 : sxy / Math.sqrt(sxx * syy);
    };
    const results = [];
    for (const [label, vals] of Object.entries(segments)) {
      const r = corr(vals, finishes);
      results.push({ segment: label, correlation: Math.round(r * 1000) / 1000, impact: Math.abs(r) > PlayerAnalyzer.CORRELATION_HIGH ? 'high' : Math.abs(r) > PlayerAnalyzer.CORRELATION_MEDIUM ? 'medium' : 'low' });
    }
    return results.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
  }
}
