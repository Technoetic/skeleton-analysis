class DataStore {
  static FINISH_MIN = 40;
  static FINISH_MAX = 65;
  static MIN_RECORD_COUNT = 2;

  constructor(rawData) {
    this.data = rawData;
    this._playerCache = null;
    this._nameIndex = new Map();
    this._sessionListCache = null;
    this._natListCache = null;
    this._genderListCache = null;
    this._dateRangeCache = null;
    this._allNamesCache = null;
    this._buildIndex();
  }

  getAllRecords() { return this.data; }

  _buildIndex() {
    for (const r of this.data) {
      const name = r.name;
      if (!this._nameIndex.has(name)) this._nameIndex.set(name, []);
      this._nameIndex.get(name).push(r);
    }
  }

  _genderMatches(recordGender, filterGender) {
    if (!filterGender) return true;
    if (recordGender === filterGender) return true;
    if (recordGender === 'MF' && (filterGender === 'M' || filterGender === 'W')) return true;
    if (recordGender === 'Mixed' && (filterGender === 'M' || filterGender === 'W')) return true;
    return false;
  }

  static _natSort(a, b) {
    if (a === 'KOR') return -1;
    if (b === 'KOR') return 1;
    return a.localeCompare(b);
  }

  getPlayers() {
    if (this._playerCache) return this._playerCache;
    const map = {};
    for (const r of this.data) {
      if (r.status !== 'OK' || !r.finish) continue;
      const f = parseFloat(r.finish);
      if (f < DataStore.FINISH_MIN || f > DataStore.FINISH_MAX) continue;
      const key = r.name;
      if (!map[key]) {
        map[key] = { name: r.name, nat: r.nat, gender: r.gender, recordCount: 0, bestFinish: Infinity };
      }
      map[key].recordCount++;
      if (f < map[key].bestFinish) map[key].bestFinish = f;
    }
    this._playerCache = Object.values(map)
      .filter(p => p.recordCount >= DataStore.MIN_RECORD_COUNT)
      .sort((a, b) => a.bestFinish - b.bestFinish);
    return this._playerCache;
  }

  getPlayerRecords(name, options = {}) {
    const records = this._nameIndex.get(name) || [];
    const { sessionFilter, dateFrom, dateTo, statusFilter } = options;
    if (!sessionFilter && !dateFrom && !dateTo && !statusFilter) return records;
    return records.filter(r => {
      if (sessionFilter && r.session !== sessionFilter) return false;
      if (statusFilter && r.status !== statusFilter) return false;
      if (dateFrom && r.date < dateFrom) return false;
      if (dateTo && r.date > dateTo) return false;
      return true;
    });
  }

  getFilteredRecords(filters = {}) {
    const { name, session, dateFrom, dateTo, status, minFinish, maxFinish, gender, nat } = filters;
    return this.data.filter(r => {
      if (!this._genderMatches(r.gender, gender)) return false;
      if (nat && r.nat !== nat) return false;
      if (name && r.name !== name) return false;
      if (session && r.session !== session) return false;
      if (status && r.status !== status) return false;
      if (dateFrom && r.date < dateFrom) return false;
      if (dateTo && r.date > dateTo) return false;
      if (r.finish != null) {
        const f = parseFloat(r.finish);
        if (minFinish != null && f < minFinish) return false;
        if (maxFinish != null && f > maxFinish) return false;
      }
      return true;
    });
  }

  getSessionList() {
    if (this._sessionListCache) return this._sessionListCache;
    const map = {};
    for (const r of this.data) {
      if (!map[r.session]) map[r.session] = { id: r.session, label: r.session, count: 0 };
      map[r.session].count++;
    }
    this._sessionListCache = Object.values(map).sort((a, b) => b.count - a.count);
    return this._sessionListCache;
  }

  getGenderList() {
    if (this._genderListCache) return this._genderListCache;
    const set = new Set();
    for (const r of this.data) {
      if (r.gender) set.add(r.gender);
    }
    this._genderListCache = [...set].sort();
    return this._genderListCache;
  }

  getNatList() {
    if (this._natListCache) return this._natListCache;
    const map = {};
    for (const r of this.data) {
      if (r.nat) {
        if (!map[r.nat]) map[r.nat] = 0;
        map[r.nat]++;
      }
    }
    this._natListCache = Object.keys(map).sort((a, b) => DataStore._natSort(a, b));
    return this._natListCache;
  }

  getPlayersFiltered(genderFilter, natFilter) {
    const players = this.getPlayers();
    return players.filter(p => {
      if (!this._genderMatches(p.gender, genderFilter)) return false;
      if (natFilter && p.nat !== natFilter) return false;
      return true;
    });
  }

  getDateRange() {
    if (this._dateRangeCache) return this._dateRangeCache;
    const dates = this.data.map(r => r.date).filter(d => d && d !== 'unknown').sort();
    this._dateRangeCache = { min: dates[0] || '', max: dates[dates.length - 1] || '' };
    return this._dateRangeCache;
  }

  getAllNames() {
    if (this._allNamesCache) return this._allNamesCache;
    this._allNamesCache = [...this._nameIndex.keys()].sort();
    return this._allNamesCache;
  }

  /** 선수 배열을 국가별 그룹으로 반환 { sortedNats: string[], groups: Record<string, Player[]> } */
  groupByNat(players) {
    const groups = {};
    for (const p of players) {
      const nat = p.nat || 'ETC';
      if (!groups[nat]) groups[nat] = [];
      groups[nat].push(p);
    }
    const sortedNats = Object.keys(groups).sort((a, b) => DataStore._natSort(a, b));
    return { sortedNats, groups };
  }
}
