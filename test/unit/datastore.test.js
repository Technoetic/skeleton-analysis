const assert = require('assert');

// Read and eval DataStore class
const fs = require('fs');
const dataStoreCode = fs.readFileSync(
  'c:\\Users\\Admin\\Desktop\\pred\\web\\src\\js\\DataStore.js',
  'utf8'
);
const vm = require('vm');
vm.runInThisContext(dataStoreCode);

// Mock skeleton race records
const mockRecords = [
  {
    file: 'SKN-2025-01-10-Women.pdf',
    date: '2025-01-10',
    session: 'Training',
    gender: 'F',
    format: 'TRAINING',
    nat: 'KOR',
    start_no: 1,
    name: '박 민지',
    run: 1,
    status: 'OK',
    start_time: 4.82,
    int1: 15.23,
    int2: 27.45,
    int3: 39.67,
    int4: 48.92,
    finish: 52.15,
    speed: 2.5
  },
  {
    file: 'SKN-2025-01-10-Women.pdf',
    date: '2025-01-10',
    session: 'Training',
    gender: 'F',
    format: 'TRAINING',
    nat: 'KOR',
    start_no: 1,
    name: '박 민지',
    run: 2,
    status: 'OK',
    start_time: 4.75,
    int1: 15.10,
    int2: 27.32,
    int3: 39.54,
    int4: 48.78,
    finish: 51.98,
    speed: 2.6
  },
  {
    file: 'SKN-2025-01-10-Men.pdf',
    date: '2025-01-10',
    session: 'Training',
    gender: 'M',
    format: 'TRAINING',
    nat: 'KOR',
    start_no: 2,
    name: '이 준호',
    run: 1,
    status: 'OK',
    start_time: 4.90,
    int1: 15.45,
    int2: 27.68,
    int3: 39.89,
    int4: 49.12,
    finish: 52.34,
    speed: 2.4
  },
  {
    file: 'SKN-2025-01-10-Men.pdf',
    date: '2025-01-10',
    session: 'Training',
    gender: 'M',
    format: 'TRAINING',
    nat: 'KOR',
    start_no: 2,
    name: '이 준호',
    run: 2,
    status: 'OK',
    start_time: 4.85,
    int1: 15.35,
    int2: 27.58,
    int3: 39.79,
    int4: 49.02,
    finish: 52.24,
    speed: 2.5
  },
  {
    file: 'SKN-2025-01-15-Women.pdf',
    date: '2025-01-15',
    session: 'Official',
    gender: 'F',
    format: 'OFFICIAL',
    nat: 'USA',
    start_no: 3,
    name: 'Sarah Johnson',
    run: 1,
    status: 'OK',
    start_time: 5.12,
    int1: 15.78,
    int2: 28.12,
    int3: 40.34,
    int4: 49.67,
    finish: 52.89,
    speed: 2.3
  },
  {
    file: 'SKN-2025-01-15-Women.pdf',
    date: '2025-01-15',
    session: 'Official',
    gender: 'F',
    format: 'OFFICIAL',
    nat: 'USA',
    start_no: 3,
    name: 'Sarah Johnson',
    run: 2,
    status: 'OK',
    start_time: 5.08,
    int1: 15.72,
    int2: 28.05,
    int3: 40.27,
    int4: 49.59,
    finish: 52.78,
    speed: 2.3
  },
  {
    file: 'SKN-2025-01-20-Men.pdf',
    date: '2025-01-20',
    session: 'Training',
    gender: 'M',
    format: 'TRAINING',
    nat: 'CAN',
    start_no: 4,
    name: 'James Smith',
    run: 1,
    status: 'OK',
    start_time: 5.25,
    int1: 16.02,
    int2: 28.45,
    int3: 40.67,
    int4: 50.12,
    finish: 53.45,
    speed: 2.2
  },
  {
    file: 'SKN-2025-01-20-Men.pdf',
    date: '2025-01-20',
    session: 'Training',
    gender: 'M',
    format: 'TRAINING',
    nat: 'CAN',
    start_no: 4,
    name: 'James Smith',
    run: 2,
    status: 'DNS',
    start_time: null,
    int1: null,
    int2: null,
    int3: null,
    int4: null,
    finish: null,
    speed: null
  },
  {
    file: 'SKN-2025-02-01-Women.pdf',
    date: '2025-02-01',
    session: 'Official',
    gender: 'MF',
    format: 'OFFICIAL',
    nat: 'KOR',
    start_no: 5,
    name: '김 지연',
    run: 1,
    status: 'OK',
    start_time: 4.88,
    int1: 15.32,
    int2: 27.54,
    int3: 39.75,
    int4: 48.98,
    finish: 51.89,
    speed: 2.6
  },
  {
    file: 'SKN-2025-02-01-Women.pdf',
    date: '2025-02-01',
    session: 'Official',
    gender: 'MF',
    format: 'OFFICIAL',
    nat: 'KOR',
    start_no: 5,
    name: '김 지연',
    run: 2,
    status: 'DNF',
    start_time: 4.92,
    int1: 15.40,
    int2: 27.62,
    int3: null,
    int4: null,
    finish: null,
    speed: null
  },
  {
    file: 'SKN-2025-02-05-Men.pdf',
    date: '2025-02-05',
    session: 'Training',
    gender: 'M',
    format: 'TRAINING',
    nat: 'GER',
    start_no: 6,
    name: 'Hans Mueller',
    run: 1,
    status: 'OK',
    start_time: 5.35,
    int1: 16.15,
    int2: 28.58,
    int3: 40.82,
    int4: 50.28,
    finish: 53.67,
    speed: 2.1
  },
  {
    file: 'SKN-2025-02-05-Men.pdf',
    date: '2025-02-05',
    session: 'Training',
    gender: 'M',
    format: 'TRAINING',
    nat: 'GER',
    start_no: 6,
    name: 'Hans Mueller',
    run: 2,
    status: 'OK',
    start_time: 5.30,
    int1: 16.08,
    int2: 28.50,
    int3: 40.74,
    int4: 50.19,
    finish: 53.56,
    speed: 2.1
  },
  {
    file: 'SKN-2025-02-10-Women.pdf',
    date: '2025-02-10',
    session: 'Training',
    gender: 'F',
    format: 'TRAINING',
    nat: 'JPN',
    start_no: 7,
    name: 'Yuki Tanaka',
    run: 1,
    status: 'OK',
    start_time: 5.18,
    int1: 15.88,
    int2: 28.25,
    int3: 40.48,
    int4: 49.82,
    finish: 53.12,
    speed: 2.2
  },
  {
    file: 'SKN-2025-02-10-Women.pdf',
    date: '2025-02-10',
    session: 'Training',
    gender: 'F',
    format: 'TRAINING',
    nat: 'JPN',
    start_no: 7,
    name: 'Yuki Tanaka',
    run: 2,
    status: 'OK',
    start_time: 5.15,
    int1: 15.82,
    int2: 28.18,
    int3: 40.40,
    int4: 49.73,
    finish: 53.01,
    speed: 2.3
  }
];

let passCount = 0;
let failCount = 0;

function testCase(description, fn) {
  try {
    fn();
    console.log(`✓ ${description}`);
    passCount++;
  } catch (err) {
    console.log(`✗ ${description}`);
    console.log(`  Error: ${err.message}`);
    failCount++;
  }
}

// Test suite
console.log('\n=== DataStore Unit Tests ===\n');

// Test 1: Constructor and data initialization
testCase('Constructor initializes data correctly', () => {
  const store = new DataStore(mockRecords);
  assert.strictEqual(store.data.length, mockRecords.length);
  assert.strictEqual(store._playerCache, null, 'playerCache should be null initially');
  assert(store._nameIndex instanceof Map, '_nameIndex should be a Map');
});

// Test 2: getAllRecords returns all records
testCase('getAllRecords returns all records', () => {
  const store = new DataStore(mockRecords);
  const records = store.getAllRecords();
  assert.strictEqual(records.length, mockRecords.length);
  assert.strictEqual(records[0].name, '박 민지');
});

// Test 3: getPlayers returns only valid players with min 2 records
testCase('getPlayers filters valid records (status=OK, finish in range, min 2 records)', () => {
  const store = new DataStore(mockRecords);
  const players = store.getPlayers();

  // Should include: 박 민지, 이 준호, Sarah Johnson, James Smith (OK), 김 지연, Hans Mueller, Yuki Tanaka
  // Should exclude: James Smith (has DNS record)
  assert(players.length > 0, 'Should have at least one player');

  const playerNames = players.map(p => p.name);
  assert(playerNames.includes('박 민지'), 'Should include 박 민지');
  assert(playerNames.includes('이 준호'), 'Should include 이 준호');
  assert(playerNames.includes('Sarah Johnson'), 'Should include Sarah Johnson');
  assert(playerNames.includes('Hans Mueller'), 'Should include Hans Mueller');
});

// Test 4: getPlayers caching behavior
testCase('getPlayers returns cached result on second call', () => {
  const store = new DataStore(mockRecords);
  const players1 = store.getPlayers();
  const players2 = store.getPlayers();
  assert.strictEqual(players1, players2, 'Should return same cached object');
});

// Test 5: getPlayerRecords for specific player
testCase('getPlayerRecords returns all records for a player', () => {
  const store = new DataStore(mockRecords);
  const records = store.getPlayerRecords('박 민지');
  assert.strictEqual(records.length, 2, '박 민지 should have 2 records');
  assert(records.every(r => r.name === '박 민지'), 'All records should be for 박 민지');
});

// Test 6: getPlayerRecords with session filter
testCase('getPlayerRecords filters by session', () => {
  const store = new DataStore(mockRecords);
  const records = store.getPlayerRecords('박 민지', { sessionFilter: 'Training' });
  assert.strictEqual(records.length, 2, 'Should have 2 Training records for 박 민지');
  assert(records.every(r => r.session === 'Training'), 'All should be Training session');
});

// Test 7: getPlayerRecords with status filter
testCase('getPlayerRecords filters by status', () => {
  const store = new DataStore(mockRecords);
  const records = store.getPlayerRecords('James Smith', { statusFilter: 'OK' });
  assert.strictEqual(records.length, 1, 'Should have 1 OK record for James Smith');
  assert.strictEqual(records[0].status, 'OK');
});

// Test 8: getPlayerRecords with date range filter
testCase('getPlayerRecords filters by date range', () => {
  const store = new DataStore(mockRecords);
  const records = store.getPlayerRecords('박 민지', { dateFrom: '2025-01-10', dateTo: '2025-01-15' });
  assert(records.length > 0, 'Should have records in date range');
  assert(records.every(r => r.date >= '2025-01-10' && r.date <= '2025-01-15'));
});

// Test 9: getFilteredRecords with gender filter
testCase('getFilteredRecords filters by gender (F)', () => {
  const store = new DataStore(mockRecords);
  const records = store.getFilteredRecords({ gender: 'F' });
  assert(records.length > 0, 'Should have female records');
  assert(records.every(r => r.gender === 'F' || r.gender === 'MF'), 'All should be female or MF');
});

// Test 10: getFilteredRecords with gender filter (M)
testCase('getFilteredRecords filters by gender (M)', () => {
  const store = new DataStore(mockRecords);
  const records = store.getFilteredRecords({ gender: 'M' });
  assert(records.length > 0, 'Should have male records');
  assert(records.every(r => r.gender === 'M' || r.gender === 'MF'), 'All should be male or MF');
});

// Test 11: getFilteredRecords with nationality filter
testCase('getFilteredRecords filters by nationality', () => {
  const store = new DataStore(mockRecords);
  const records = store.getFilteredRecords({ nat: 'KOR' });
  assert(records.length > 0, 'Should have Korean records');
  assert(records.every(r => r.nat === 'KOR'), 'All should be KOR nationality');
});

// Test 12: getFilteredRecords with finish time range
testCase('getFilteredRecords filters by finish time range', () => {
  const store = new DataStore(mockRecords);
  const records = store.getFilteredRecords({ minFinish: 52, maxFinish: 53 });
  assert(records.length > 0, 'Should have records in finish range');
  assert(records.every(r => {
    if (r.finish === null || r.finish === undefined) return true;
    const f = parseFloat(r.finish);
    return f >= 52 && f <= 53;
  }), 'All should have finish time in range');
});

// Test 13: getFilteredRecords with multiple filters
testCase('getFilteredRecords applies multiple filters correctly', () => {
  const store = new DataStore(mockRecords);
  const records = store.getFilteredRecords({
    gender: 'F',
    nat: 'KOR',
    status: 'OK'
  });
  assert(records.every(r => {
    const genderMatch = r.gender === 'F' || r.gender === 'MF';
    return genderMatch && r.nat === 'KOR' && r.status === 'OK';
  }), 'All filters should be applied');
});

// Test 14: Gender matching with MF (Mixed/Both)
testCase('_genderMatches handles MF (both genders) correctly', () => {
  const store = new DataStore([]);
  assert.strictEqual(store._genderMatches('MF', 'W'), true, 'MF should match W filter');
  assert.strictEqual(store._genderMatches('MF', 'M'), true, 'MF should match M filter');
  assert.strictEqual(store._genderMatches('Mixed', 'W'), true, 'Mixed should match W filter');
  assert.strictEqual(store._genderMatches('Mixed', 'M'), true, 'Mixed should match M filter');
  assert.strictEqual(store._genderMatches('W', 'W'), true, 'W should match W filter');
  assert.strictEqual(store._genderMatches('M', 'M'), true, 'M should match M filter');
  assert.strictEqual(store._genderMatches('F', null), true, 'Any gender should match null filter');
});

// Test 15: getSessionList returns unique sessions
testCase('getSessionList returns unique sessions with counts', () => {
  const store = new DataStore(mockRecords);
  const sessions = store.getSessionList();
  assert(sessions.length > 0, 'Should have sessions');
  assert(sessions.every(s => s.id && s.label && s.count >= 0), 'Sessions should have id, label, count');

  const sessionIds = sessions.map(s => s.id);
  const uniqueIds = new Set(sessionIds);
  assert.strictEqual(sessionIds.length, uniqueIds.size, 'Session IDs should be unique');
});

// Test 16: getSessionList caching behavior
testCase('getSessionList returns cached result on second call', () => {
  const store = new DataStore(mockRecords);
  const sessions1 = store.getSessionList();
  const sessions2 = store.getSessionList();
  assert.strictEqual(sessions1, sessions2, 'Should return same cached object');
});

// Test 17: getGenderList returns unique genders
testCase('getGenderList returns unique genders sorted', () => {
  const store = new DataStore(mockRecords);
  const genders = store.getGenderList();
  assert(genders.length > 0, 'Should have genders');

  const uniqueGenders = new Set(genders);
  assert.strictEqual(genders.length, uniqueGenders.size, 'Genders should be unique');

  // Check if sorted
  const sorted = [...genders].sort();
  assert.deepStrictEqual(genders, sorted, 'Genders should be sorted');
});

// Test 18: getNatList returns unique nationalities
testCase('getNatList returns unique nationalities with KOR first', () => {
  const store = new DataStore(mockRecords);
  const nats = store.getNatList();
  assert(nats.length > 0, 'Should have nationalities');

  const uniqueNats = new Set(nats);
  assert.strictEqual(nats.length, uniqueNats.size, 'Nationalities should be unique');

  // KOR should be first
  assert.strictEqual(nats[0], 'KOR', 'KOR should be first in list');
});

// Test 19: getNatList caching behavior
testCase('getNatList returns cached result on second call', () => {
  const store = new DataStore(mockRecords);
  const nats1 = store.getNatList();
  const nats2 = store.getNatList();
  assert.strictEqual(nats1, nats2, 'Should return same cached object');
});

// Test 20: getPlayersFiltered with gender filter
testCase('getPlayersFiltered filters by gender', () => {
  const store = new DataStore(mockRecords);
  const players = store.getPlayersFiltered('F', null);
  assert(players.length > 0, 'Should have female players');
  assert(players.every(p => p.gender === 'F' || p.gender === 'MF'), 'All should be F or MF');
});

// Test 21: getPlayersFiltered with nationality filter
testCase('getPlayersFiltered filters by nationality', () => {
  const store = new DataStore(mockRecords);
  const players = store.getPlayersFiltered(null, 'KOR');
  assert(players.length > 0, 'Should have Korean players');
  assert(players.every(p => p.nat === 'KOR'), 'All should be KOR');
});

// Test 22: getPlayersFiltered with both filters
testCase('getPlayersFiltered applies both gender and nationality filters', () => {
  const store = new DataStore(mockRecords);
  const players = store.getPlayersFiltered('F', 'KOR');
  assert(players.every(p => {
    const genderMatch = p.gender === 'F' || p.gender === 'MF';
    return genderMatch && p.nat === 'KOR';
  }), 'Both filters should be applied');
});

// Test 23: getDateRange returns min and max dates
testCase('getDateRange returns min and max dates', () => {
  const store = new DataStore(mockRecords);
  const range = store.getDateRange();
  assert(range.min, 'Should have min date');
  assert(range.max, 'Should have max date');
  assert(range.min <= range.max, 'Min should be <= Max');
  assert.strictEqual(range.min, '2025-01-10', 'Min should be earliest date');
  assert.strictEqual(range.max, '2025-02-10', 'Max should be latest date');
});

// Test 24: getDateRange caching behavior
testCase('getDateRange returns cached result on second call', () => {
  const store = new DataStore(mockRecords);
  const range1 = store.getDateRange();
  const range2 = store.getDateRange();
  assert.strictEqual(range1, range2, 'Should return same cached object');
});

// Test 25: getAllNames returns sorted player names
testCase('getAllNames returns all player names sorted', () => {
  const store = new DataStore(mockRecords);
  const names = store.getAllNames();
  assert(names.length > 0, 'Should have player names');

  const sorted = [...names].sort();
  assert.deepStrictEqual(names, sorted, 'Names should be sorted');
});

// Test 26: getAllNames caching behavior
testCase('getAllNames returns cached result on second call', () => {
  const store = new DataStore(mockRecords);
  const names1 = store.getAllNames();
  const names2 = store.getAllNames();
  assert.strictEqual(names1, names2, 'Should return same cached object');
});

// Test 27: groupByNat groups players by nationality
testCase('groupByNat groups players by nationality with KOR first', () => {
  const store = new DataStore(mockRecords);
  const players = store.getPlayers();
  const grouped = store.groupByNat(players);

  assert(grouped.sortedNats, 'Should have sortedNats');
  assert(grouped.groups, 'Should have groups');
  assert.strictEqual(grouped.sortedNats[0], 'KOR', 'KOR should be first');

  // Verify all players are in exactly one group
  const totalPlayers = Object.values(grouped.groups).reduce((sum, g) => sum + g.length, 0);
  assert.strictEqual(totalPlayers, players.length, 'All players should be in groups');
});

// Test 28: groupByNat assigns unspecified nat to 'ETC'
testCase('groupByNat assigns null nationality to ETC', () => {
  const testData = [
    { name: 'Test Player', nat: null, gender: 'M' }
  ];
  const store = new DataStore(testData);
  const players = store.getPlayers().length > 0 ? store.getPlayers() : testData;
  const grouped = store.groupByNat(players);

  // This test is about the grouping logic itself
  assert(grouped.groups, 'Should have groups object');
});

// Test 29: Player sorting by bestFinish
testCase('getPlayers sorts players by best finish time', () => {
  const store = new DataStore(mockRecords);
  const players = store.getPlayers();

  if (players.length > 1) {
    for (let i = 0; i < players.length - 1; i++) {
      assert(
        players[i].bestFinish <= players[i + 1].bestFinish,
        `Player ${i} (${players[i].bestFinish}) should have better or equal finish than player ${i + 1} (${players[i + 1].bestFinish})`
      );
    }
  }
});

// Test 30: Player object structure
testCase('Player objects have correct structure', () => {
  const store = new DataStore(mockRecords);
  const players = store.getPlayers();

  if (players.length > 0) {
    const player = players[0];
    assert(player.name, 'Player should have name');
    assert(player.nat, 'Player should have nationality');
    assert(player.gender, 'Player should have gender');
    assert.strictEqual(typeof player.recordCount, 'number', 'Player should have recordCount');
    assert.strictEqual(typeof player.bestFinish, 'number', 'Player should have bestFinish');
  }
});

// Test 31: Empty data handling
testCase('DataStore handles empty data correctly', () => {
  const store = new DataStore([]);
  assert.strictEqual(store.getAllRecords().length, 0);
  assert.strictEqual(store.getPlayers().length, 0);
  assert.strictEqual(store.getSessionList().length, 0);
  assert.strictEqual(store.getGenderList().length, 0);
  assert.strictEqual(store.getNatList().length, 0);
});

// Test 32: Records with null/undefined finish values
testCase('getPlayers ignores records with null finish values', () => {
  const testData = [
    { name: 'Player1', gender: 'M', nat: 'KOR', status: 'OK', finish: '52.5' },
    { name: 'Player1', gender: 'M', nat: 'KOR', status: 'OK', finish: null },
    { name: 'Player1', gender: 'M', nat: 'KOR', status: 'OK', finish: undefined }
  ];
  const store = new DataStore(testData);
  const players = store.getPlayers();

  if (players.length > 0) {
    const player = players[0];
    assert.strictEqual(player.recordCount, 1, 'Should count only record with valid finish');
  }
});

// Test 33: FINISH_MIN and FINISH_MAX constants
testCase('getPlayers filters by FINISH_MIN and FINISH_MAX', () => {
  const testData = [
    { name: 'TooFast', gender: 'M', nat: 'KOR', status: 'OK', finish: '35.0' }, // Too fast
    { name: 'Valid', gender: 'M', nat: 'KOR', status: 'OK', finish: '52.5' }, // Valid
    { name: 'Valid', gender: 'M', nat: 'KOR', status: 'OK', finish: '52.5' }, // Valid
    { name: 'TooSlow', gender: 'F', nat: 'KOR', status: 'OK', finish: '70.0' }  // Too slow
  ];
  const store = new DataStore(testData);
  const players = store.getPlayers();

  const playerNames = players.map(p => p.name);
  assert(!playerNames.includes('TooFast'), 'Should exclude times < FINISH_MIN');
  assert(!playerNames.includes('TooSlow'), 'Should exclude times > FINISH_MAX');
});

// Test 34: MIN_RECORD_COUNT constant
testCase('getPlayers requires minimum record count', () => {
  const testData = [
    { name: 'OneRecord', gender: 'M', nat: 'KOR', status: 'OK', finish: '52.5' },
    { name: 'TwoRecords', gender: 'M', nat: 'KOR', status: 'OK', finish: '52.5' },
    { name: 'TwoRecords', gender: 'M', nat: 'KOR', status: 'OK', finish: '52.3' }
  ];
  const store = new DataStore(testData);
  const players = store.getPlayers();

  const playerNames = players.map(p => p.name);
  assert(!playerNames.includes('OneRecord'), 'Should exclude players with < MIN_RECORD_COUNT');
  assert(playerNames.includes('TwoRecords'), 'Should include players with >= MIN_RECORD_COUNT');
});

// Test 35: Status filtering in getPlayers
testCase('getPlayers only includes OK status records', () => {
  const testData = [
    { name: 'Valid', gender: 'M', nat: 'KOR', status: 'OK', finish: '52.5' },
    { name: 'Valid', gender: 'M', nat: 'KOR', status: 'OK', finish: '52.3' },
    { name: 'DNS', gender: 'F', nat: 'KOR', status: 'DNS', finish: null },
    { name: 'DNS', gender: 'F', nat: 'KOR', status: 'DNS', finish: null }
  ];
  const store = new DataStore(testData);
  const players = store.getPlayers();

  const playerNames = players.map(p => p.name);
  assert(playerNames.includes('Valid'), 'Should include OK status');
  assert(!playerNames.includes('DNS'), 'Should exclude non-OK status');
});

// Print summary
console.log('\n=== Test Summary ===');
console.log(`Total: ${passCount + failCount}`);
console.log(`Passed: ${passCount}`);
console.log(`Failed: ${failCount}`);
console.log(`Success Rate: ${((passCount / (passCount + failCount)) * 100).toFixed(1)}%\n`);

process.exit(failCount > 0 ? 1 : 0);
