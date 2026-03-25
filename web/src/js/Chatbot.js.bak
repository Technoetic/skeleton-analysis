/**

 * Sliding Sports Chatbot — Zero-hallucination pipeline

 * LLM: google/gemini-2.5-flash-lite via BizRouter

 * Pipeline: Intent → SQL (parallel vote) → DB exec → Answer + Factcheck

 */

class Chatbot {

  static API_URL = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')

    ? 'https://bizrouter.ai/api/v1/chat/completions'

    : '/api/llm/chat/completions';

  static API_KEY = '';

  static MODEL = 'google/gemini-2.5-flash-lite';

  static SUPABASE_URL = 'https://dxaehcocrbvhatyfmrvp.supabase.co';

  static SUPABASE_KEY = (typeof SUPABASE_KEY !== 'undefined' && SUPABASE_KEY) ? SUPABASE_KEY : 'sb_publishable_5_U3dll4HB9fAXOxmgm83w_wnOiei-e';



  static TABLES = {

    skeleton: { records: 'skeleton_records', athletes: 'athletes' },

    luge: { records: 'luge_records', athletes: 'luge_athletes' },

    bobsled: { records: 'bobsled_records', athletes: 'bobsled_athletes' },

  };



  static ALLOWED_COLUMNS = [

    'id','date','session','gender','format','nat','start_no','name','run',

    'status','start_time','int1','int2','int3','int4','finish','speed',

    'athlete_id','air_temp','humidity_pct','pressure_hpa','wind_speed_ms',

    'dewpoint_c','ice_temp_est','temp_avg',

    'height_cm','weight_kg','birth_year','role','pilot','brakeman',

  ];



  static SCHEMA_PROMPT = `You are a SQL assistant for a sliding sports (skeleton/luge/bobsled) database at Pyeongchang Alpensia.



TABLES:

- skeleton_records: id, date, session, gender(M/W), format, nat, start_no, name, run, status(OK/DNS/DNF), start_time, int1, int2, int3, int4, finish, speed, athlete_id, air_temp, humidity_pct, pressure_hpa, wind_speed_ms, dewpoint_c, temp_avg

- luge_records: same columns as skeleton_records

- bobsled_records: same + pilot, brakeman columns

- athletes: id, athlete_id, name, nat, birth_year, gender, height_cm, weight_kg

- luge_athletes: same as athletes

- bobsled_athletes: same as athletes + role



IMPORTANT - NAME FORMAT:

- Names are stored in UPPERCASE ENGLISH: "YEO Chanhyuk", "KIM Jisoo", "HONG Sujung", "JUNG Seunggi"

- Korean name mapping: 여찬혁=YEO Chanhyuk, 김지수=KIM Jisoo, 홍수정=HONG Sujung, 정승기=JUNG Seunggi, 신연수=SHIN Yeonsu, 정예은=CHUNG Yeeun, 곽은우=KWACK Eunwoo, 안재웅=AN Jaewoong, 김민지=KIM Minji, 김예림=KIM Yerim, 정장환=JUNG Janghwan, 송영민=SONG Youngmin, 이승훈=LEE Seunghoon, 박예운=PARK Yewoon

- For Korean names, use ILIKE with the romanized surname: e.g. WHERE name ILIKE 'YEO%' for 여찬혁

- For luge: 유지훈=YU Jihun, 박지예=PARK Jiye, 오정임=OH Jungim, 김보근=KIM Bogeun

- For bobsled: 김진수=KIM Jinsu, 석영진=SEOK Youngjin, 김유란=KIM Yuran



RULES:

1. ONLY generate SELECT queries. Never INSERT/UPDATE/DELETE.

2. Use only the table and column names listed above.

3. Always filter status='OK' AND finish > 45 AND finish < 65 for performance queries (to exclude abnormal records).

4. finish is in seconds (lower = better). "최고 기록" means lowest finish time, use ORDER BY finish ASC LIMIT 1.

5. start_time is in seconds (typically 4~6 seconds).

6. Return ONLY the SQL query, nothing else.

7. Use Supabase PostgREST syntax is NOT needed — use standard SQL.

8. Limit results to 50 rows max.

9. For name searches, use ILIKE for fuzzy matching.

10. "평균 기록" = AVG(finish), "최고 기록" = MIN(finish), "최저 기록" = MAX(finish).

11. If the user inputs ONLY a player name (e.g. "여찬혁"), return that player's records: SELECT * FROM {records_table} WHERE name ILIKE '{romanized}%' AND status='OK' ORDER BY finish ASC LIMIT 20

12. ALWAYS include a WHERE clause with the player name when a name is mentioned.

13. For COMPARE queries (vs, 비교, 누가): use OR to include BOTH players. Example: "김지수 vs 정승기" → SELECT * FROM skeleton_records WHERE (name ILIKE 'KIM Ji%' OR name ILIKE 'JUNG Seung%') AND status='OK' ORDER BY finish ASC LIMIT 40

14. When two Korean names are mentioned, ALWAYS include BOTH in the WHERE clause with OR.`;



  constructor() {

    this.messages = [];

    this.sport = typeof CURRENT_SPORT !== 'undefined' ? CURRENT_SPORT : 'skeleton';

    this._initUI();

  }



  _initUI() {

    // Floating chat button

    const btn = document.createElement('button');

    btn.id = 'chatbot-toggle';

    btn.innerHTML = '💬';

    btn.title = 'AI 챗봇';

    document.body.appendChild(btn);



    // Chat panel

    const panel = document.createElement('div');

    panel.id = 'chatbot-panel';

    panel.style.display = 'none';

    panel.innerHTML = `

      <div class="chatbot-header">

        <span>🤖 AI 분석 챗봇</span>

        <span class="chatbot-sport">${this.sport}</span>

        <button id="chatbot-close">✕</button>

      </div>

      <div id="chatbot-messages"></div>

      <div class="chatbot-input-wrap">

        <input id="chatbot-input" type="text" placeholder="질문을 입력하세요..." autocomplete="off">

        <button id="chatbot-send">→</button>

      </div>

    `;

    document.body.appendChild(panel);



    btn.addEventListener('click', () => {

      panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';

      if (panel.style.display === 'flex') {

        document.getElementById('chatbot-input').focus();

        if (this.messages.length === 0) this._addBotMessage('안녕하세요! 경기 기록, 선수 비교, 환경 분석 등을 질문해 주세요.');

      }

    });

    document.getElementById('chatbot-close').addEventListener('click', () => panel.style.display = 'none');

    document.getElementById('chatbot-send').addEventListener('click', () => this._onSend());

    document.getElementById('chatbot-input').addEventListener('keydown', e => {

      if (e.key === 'Enter') this._onSend();

    });

  }



  updateSport(sport) {

    this.sport = sport;

    const el = document.querySelector('.chatbot-sport');

    if (el) el.textContent = sport;

  }



  _addUserMessage(text) {

    const el = document.getElementById('chatbot-messages');

    el.innerHTML += `<div class="chatbot-msg user"><div class="chatbot-bubble user">${this._escHtml(text)}</div></div>`;

    el.scrollTop = el.scrollHeight;

  }



  _addBotMessage(text, isTable = false) {

    const el = document.getElementById('chatbot-messages');

    const content = isTable ? text : this._renderMd(text);

    el.innerHTML += `<div class="chatbot-msg bot"><div class="chatbot-bubble bot">${content}</div></div>`;

    el.scrollTop = el.scrollHeight;

  }



  _addLoading() {

    const el = document.getElementById('chatbot-messages');

    el.innerHTML += `<div class="chatbot-msg bot" id="chatbot-loading"><div class="chatbot-bubble bot">⏳ 분석 중...</div></div>`;

    el.scrollTop = el.scrollHeight;

  }



  _removeLoading() {

    const el = document.getElementById('chatbot-loading');

    if (el) el.remove();

  }











  _renderMd(s) {
    let h = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    h = h.replace(/^###\s+(.+)$/gm, "<strong>$1</strong>");
    h = h.replace(/^##\s+(.+)$/gm, "<strong>$1</strong>");
    h = h.replace(/[*][*]([^*]+)[*][*]/g, "<strong>$1</strong>");
    h = h.replace(/[*]([^*]+)[*]/g, "<em>$1</em>");
    h = h.split(String.fromCharCode(10)).join("<br>");
    return h;
  }

  _escHtml(s) {
    return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").split(String.fromCharCode(10)).join("<br>");
  }

  async _naturalWrap(question, factText) {

    // If factText is very short or an error/status message, return as-is

    if (!factText || factText.length < 20 || factText.startsWith('이 질문은') || factText.startsWith('죄송') || factText.startsWith('해당 조건') || factText.startsWith('비교할')) {

      return factText;

    }



    try {

      const wrapped = await this._callLLM([

        { role: 'system', content: `You rewrite dry data reports into friendly, conversational Korean.



ABSOLUTE RULES:

1. You MUST include ALL numbers from the original text EXACTLY as-is. Do not round, change, or omit any number.

2. Do NOT add any facts, numbers, or claims not in the original.

3. Do NOT add opinions or predictions.

4. Keep it concise (3-5 sentences).

5. Use a warm, coach-like tone with occasional emoji.

6. If the original has bullet points or rankings, keep them but make them flow naturally.` },

        { role: 'user', content: `Original data:\n${factText}\n\nRewrite naturally:` },

      ], 0.3);



      // Verify: all numbers from factText must appear in wrapped

      const factNums = factText.match(/\d+\.?\d*/g) || [];

      const wrapNums = wrapped.match(/\d+\.?\d*/g) || [];

      const wrapNumSet = new Set(wrapNums);



      // Check key numbers (decimals like 50.71, 52.128)

      const keyNums = factNums.filter(n => n.includes('.'));

      const allPresent = keyNums.every(n => wrapNumSet.has(n));



      if (allPresent) {

        return wrapped;

      }

      // Fallback: return original factText

      return factText;

    } catch (e) {

      return factText;

    }

  }



  async _onSend() {

    const input = document.getElementById('chatbot-input');

    const text = input.value.trim();

    if (!text) return;

    input.value = '';



    this._addUserMessage(text);

    this._addLoading();

    this.messages.push({ role: 'user', content: text });



    try {

      const answer = await this._pipeline(text);

      // LLM natural language wrapping (facts are locked, style only)

      const finalText = await this._naturalWrap(text, answer.text);

      this._removeLoading();

      this._addBotMessage(finalText);

      this.messages.push({ role: 'assistant', content: finalText });

    } catch (e) {

      this._removeLoading();

      this._addBotMessage('죄송합니다. 오류가 발생했습니다: ' + e.message);

    }

  }



  // ===== ZERO-HALLUCINATION PIPELINE (MAX PARALLEL) =====

  //

  // Phase 1: Intent(1) + SQL(5) — 6 LLM calls in parallel

  // Phase 2: DB exec (1)

  // Phase 3: Answer(5) — 5 LLM calls in parallel

  // Phase 4: Factcheck(3) — 3 LLM calls in parallel

  // Total: 14 LLM calls, 4 sequential phases, ~3-4 seconds

  //



  // Korean name detection helper

  static _isKorean(str) {

    return /[\uac00-\ud7a3]/.test(str);

  }



  // Fetch name_kr map from athletes table

  async _getNameKrMap(tables) {

    if (this._nameKrCache) return this._nameKrCache;

    const h = { 'apikey': Chatbot.SUPABASE_KEY, 'Authorization': 'Bearer ' + Chatbot.SUPABASE_KEY };

    try {

      const resp = await fetch(`${Chatbot.SUPABASE_URL}/rest/v1/${tables.athletes}?select=name,name_kr&limit=200`, { headers: h });

      const data = await resp.json();

      this._nameKrCache = {};

      for (const a of data) { if (a.name_kr) this._nameKrCache[a.name] = a.name_kr; }

    } catch (e) { this._nameKrCache = {}; }

    return this._nameKrCache;

  }



  _toKr(name, map) { return map[name] || name; }



  // Korean particle helper: 이/가, 은/는, 을/를

  static _particle(name, type) {

    const last = name.charCodeAt(name.length - 1);

    const hasBatchim = (last - 0xAC00) % 28 !== 0;

    if (type === '이가') return hasBatchim ? '이' : '가';

    if (type === '은는') return hasBatchim ? '은' : '는';

    if (type === '을를') return hasBatchim ? '을' : '를';

    return '';

  }



  // Extract Korean names from question (strip common particles)

  _extractKoreanNames(question) {

    const matches = question.match(/[\uac00-\ud7a3]{2,5}/g) || [];

    const particles = ['와', '과', '이랑', '하고', '이', '가', '은', '는', '을', '를', '의', '도', '에서', '에게', '한테'];

    return [...new Set(matches.map(m => {

      for (const p of particles) {

        if (m.endsWith(p) && m.length > p.length + 1) return m.slice(0, -p.length);

      }

      return m;

    }).filter(m => m.length >= 2))];

  }



  _isCompareQuestion(question) {

    const q = question.toLowerCase();

    return q.includes('vs') || q.includes('비교') || q.includes('누가') || q.includes('와 ') || q.includes('과 ');

  }



  async _resolveKoreanName(name, tables) {

    // For skeleton: search name_kr in athletes table, get english name

    // For luge/bobsled: name is already Korean

    const h = { 'apikey': Chatbot.SUPABASE_KEY, 'Authorization': 'Bearer ' + Chatbot.SUPABASE_KEY };

    if (this.sport === 'skeleton') {

      const url = `${Chatbot.SUPABASE_URL}/rest/v1/${tables.athletes}?select=name,name_kr,athlete_id&name_kr=eq.${encodeURIComponent(name)}&limit=1`;

      const resp = await fetch(url, { headers: h });

      const rows = await resp.json();

      if (rows.length > 0) return { engName: rows[0].name, krName: name, aid: rows[0].athlete_id };

      // Fallback: search in records name directly (for Korean-named skeleton athletes)

      const url2 = `${Chatbot.SUPABASE_URL}/rest/v1/${tables.records}?select=name,athlete_id&name=eq.${encodeURIComponent(name)}&limit=1`;

      const resp2 = await fetch(url2, { headers: h });

      const rows2 = await resp2.json();

      if (rows2.length > 0) return { engName: rows2[0].name, krName: name, aid: rows2[0].athlete_id };

    } else {

      // Luge/bobsled: name is Korean directly

      const url = `${Chatbot.SUPABASE_URL}/rest/v1/${tables.records}?select=name,athlete_id&name=eq.${encodeURIComponent(name)}&limit=1`;

      const resp = await fetch(url, { headers: h });

      const rows = await resp.json();

      if (rows.length > 0) return { engName: rows[0].name, krName: name, aid: rows[0].athlete_id };

    }

    return null;

  }



  async _compareQuery(korNames, tables) {

    const resolved = await Promise.all(korNames.map(n => this._resolveKoreanName(n, tables)));

    const valid = resolved.filter(r => r != null);

    if (valid.length < 2) return { text: `비교할 선수를 찾을 수 없습니다. (인식: ${korNames.join(', ')})` };



    const range = this.sport === 'skeleton' ? [50, 60] : [45, 65];

    const h = { 'apikey': Chatbot.SUPABASE_KEY, 'Authorization': 'Bearer ' + Chatbot.SUPABASE_KEY };



    const fetches = valid.map(({ engName }) => {

      const url = `${Chatbot.SUPABASE_URL}/rest/v1/${tables.records}?select=finish,athlete_id&name=eq.${encodeURIComponent(engName)}&status=eq.OK&finish=gte.${range[0]}&finish=lte.${range[1]}&order=finish&limit=50`;

      return fetch(url, { headers: h }).then(r => r.json());

    });

    const results = await Promise.all(fetches);



    const lines = [];

    for (let i = 0; i < valid.length; i++) {

      const data = results[i];

      const finishes = data.map(r => parseFloat(r.finish)).filter(f => !isNaN(f));

      if (finishes.length === 0) {

        lines.push({ kr: valid[i].krName, aid: valid[i].aid, best: null, avg: null, count: 0 });

        continue;

      }

      const avg = +(finishes.reduce((a, b) => a + b, 0) / finishes.length).toFixed(2);

      const best = +Math.min(...finishes).toFixed(2);

      lines.push({ kr: valid[i].krName, aid: valid[i].aid, best, avg, count: finishes.length });

    }

    lines.sort((a, b) => (a.best || 999) - (b.best || 999));



    let text = lines.map((l, i) =>

      l.best ? `${i + 1}. ${l.kr}: 최고 ${l.best}초, 평균 ${l.avg}초 (${l.count}건)` : `${i + 1}. ${l.kr}: 데이터 없음`

    ).join('\n');



    if (lines.length >= 2 && lines[0].best && lines[1].best) {

      const diff = (lines[1].best - lines[0].best).toFixed(2);

      text += `\n→ ${lines[0].kr}${Chatbot._particle(lines[0].kr, '이가')} ${diff}초 빠름`;

    }

    return { text };

  }



  // ===== INSIGHT ENGINE (LLM function selection + DB computation) =====



  static INSIGHT_FUNCTIONS = [

    { name: 'start_impact', desc: 'Analyze how start time affects finish. Use for: improving start, push time, 0.1s effect, acceleration.' },

    { name: 'segment', desc: 'Analyze track segments/curves. Use for: curve analysis, section times, where to improve.' },

    { name: 'curve_detail', desc: 'Specific curve info. Use for: specific curve number, curve tip.' },

    { name: 'curve_ranking', desc: 'Rank curves by danger. Use for: most dangerous, hardest, DNF location.' },

    { name: 'frost', desc: 'Frost/dew point effect. Use for: frost, dew, ice moisture.' },

    { name: 'temperature', desc: 'Temperature effect. Use for: temp, cold, warm, ice condition, optimal.' },

    { name: 'humidity', desc: 'Humidity effect. Use for: humidity, moisture, dry/wet.' },

    { name: 'wind', desc: 'Wind effect. Use for: wind, breeze, gust.' },

    { name: 'player_records', desc: 'Player stats. Use for: player name, personal best, average.' },

    { name: 'trend', desc: 'Player record trend over time. Use for: improving, getting better/worse, trend, progress, form.' },

    { name: 'consistency', desc: 'Player consistency ranking. Use for: stable, consistent, reliable, variance, deviation.' },

    { name: 'best_condition', desc: 'Best record conditions. Use for: what conditions, when best, optimal weather for records.' },

    { name: 'time_of_season', desc: 'Season timing analysis. Use for: early/late season, which month, December vs January.' },

    { name: 'start_vs_technique', desc: 'Start speed vs driving technique. Use for: fast start slow finish, technique, driving skill.' },

    { name: 'body_effect', desc: 'Height/weight effect on records. Use for: tall, heavy, body, weight advantage, height.' },

    { name: 'run_fatigue', desc: 'Run number fatigue. Use for: first/second/third run, fatigue, which run is fastest.' },

    { name: 'head_to_head', desc: 'Direct comparison on same day. Use for: beat, win, head to head, same day matchup.' },

    { name: 'general_sql', desc: 'General DB query. Use when no other function matches.' },

  ];



  async _detectInsight(question, tables) {

    const h = { 'apikey': Chatbot.SUPABASE_KEY, 'Authorization': 'Bearer ' + Chatbot.SUPABASE_KEY };

    const range = this.sport === 'skeleton' ? [50, 60] : [45, 65];

    const baseUrl = `${Chatbot.SUPABASE_URL}/rest/v1/${tables.records}`;



    // ── 키워드 사전 분류 (LLM 호출 없이 빠르게) ──
    const q = question.toLowerCase();
    const keywordMap = [
      { keys: ["서리","결빙","얼음"], funcs: ["frost"] },
      { keys: ["온도","빙면","트랙 온도","얼음 온도"], funcs: ["temperature"] },
      { keys: ["습도","습한","건조","비 오"], funcs: ["humidity"] },
      { keys: ["바람","풍속","돌풍","강풍"], funcs: ["wind"] },
      { keys: ["커브","코너","번 커브"], funcs: ["curve_detail"] },
      { keys: ["위험","난이도","어려운 커브","위험한"], funcs: ["curve_ranking"] },
      { keys: ["구간","세그먼트","어디서 느려","어디서 빨라"], funcs: ["segment"] },
      { keys: ["스타트","출발","0.1초","줄이면"], funcs: ["start_impact"] },
      { keys: ["체중","몸무게","체격","bmi"], funcs: ["body_effect"] },
      { keys: ["피로","지치","후반","런 피로"], funcs: ["run_fatigue"] },
      { keys: ["일관","안정","편차","꾸준"], funcs: ["consistency"] },
      { keys: ["추이","추세","성장","발전","요즘"], funcs: ["trend"] },
      { keys: ["시즌","월별","언제 가장"], funcs: ["time_of_season"] },
      { keys: ["최적","좋은 조건","베스트 컨디션"], funcs: ["best_condition"] },
      { keys: ["vs ","비교","대결","맞대결"], funcs: ["head_to_head"] },
      { keys: ["잘하","제일","최고","1등","누가 가장"], funcs: ["consistency"] },
      { keys: ["기술","테크닉","주행 실력"], funcs: ["start_vs_technique"] },
    ];
    const preMatched = [];
    for (const {keys, funcs} of keywordMap) {
      if (keys.some(k => q.includes(k))) preMatched.push(...funcs);
    }
    if (preMatched.length > 0) {
      const uniqueFuncs = [...new Set(preMatched)].slice(0, 3);
      const results = await Promise.all(uniqueFuncs.map(fn => this._execInsightFunc(fn, question, baseUrl, h, range, tables)));
      const valid = results.filter(r => r != null);
      if (valid.length > 0) return { text: valid.map(r => r.text).join(String.fromCharCode(10,10)) };
    }

    // ── LLM 분류 (키워드 매칭 실패 시 fallback) ──
    // LLM selects which functions to call

    const funcList = Chatbot.INSIGHT_FUNCTIONS.map(f => `${f.name}: ${f.desc}`).join('\n');

    let selected;

    try {

      selected = await this._callLLM([

        { role: 'system', content: `You are a function router. Given a user question about sliding sports, select which analysis functions to call.



Available functions:

${funcList}



RULES:

1. Reply with ONLY function names, comma-separated. Example: "start_impact,segment"

2. Select 1-3 most relevant functions.

3. If the question mentions a specific curve number, include "curve_detail".

4. If asking about danger/difficulty, include "curve_ranking".

5. If asking about improving records, include "start_impact,segment".

6. If no function matches, reply "general_sql".` },

        { role: 'user', content: question },

      ]);

    } catch (e) {

      return null; // Fall through to general pipeline

    }



    const funcs = selected.toLowerCase().split(',').map(s => s.trim()).filter(s => s);

    if (funcs.length === 0 || (funcs.length === 1 && funcs[0] === 'general_sql')) {

      return null;

    }



    // Execute selected functions in parallel

    const results = await Promise.all(funcs.map(fn => this._execInsightFunc(fn, question, baseUrl, h, range, tables)));

    const validResults = results.filter(r => r != null);



    if (validResults.length === 0) return null;



    // Combine results

    const combined = validResults.map(r => r.text).join('\n\n');

    return { text: combined };

  }



  async _execInsightFunc(funcName, question, baseUrl, h, range, tables) {

    try {

      switch (funcName) {

        case 'start_impact':

          return await this._insightStartImpact(baseUrl, h, range);

        case 'segment':

          return await this._insightSegment(question, baseUrl, h, range);

        case 'curve_detail': {

          const num = question.match(/(\d+)/);

          if (!num) return null;

          // Delegate to segment with curve number

          return await this._insightSegment(question, baseUrl, h, range);

        }

        case 'curve_ranking': {

          const metaUrl = `${Chatbot.SUPABASE_URL}/rest/v1/track_metadata?select=*&order=curve_number`;

          const metaResp = await fetch(metaUrl, { headers: h });

          const meta = await metaResp.json();

          const ranked = [...meta].sort((a, b) => a.radius_m - b.radius_m);

          let text = '📊 커브 난이도 순위 (반경 작을수록 위험)\n\n';

          for (const c of ranked.slice(0, 5)) {

            text += `${c.curve_number}번 커브: 반경 ${c.radius_m}m, 뱅킹 ${c.banking_deg}도, 난이도 ${c.difficulty}\n`;

            text += `  → ${c.coaching_tip}\n\n`;

          }

          return { text };

        }

        case 'frost':

          return await this._insightFrost(baseUrl, h, range);

        case 'temperature':

          return await this._insightTemperature(baseUrl, h, range);

        case 'humidity':

          return await this._insightHumidity(baseUrl, h, range);

        case 'wind':

          return await this._insightWind(baseUrl, h, range);

        case 'player_records': {

          const korNames = this._extractKoreanNames(question);

          if (korNames.length > 0) {

            const resolved = await this._resolveKoreanName(korNames[0], tables);

            if (resolved) {

              const url = `${baseUrl}?select=finish,start_time,date&name=eq.${encodeURIComponent(resolved.engName)}&status=eq.OK&finish=gte.${range[0]}&finish=lte.${range[1]}&order=finish&limit=50`;

              const resp = await fetch(url, { headers: h });

              const data = await resp.json();

              if (data.length > 0) {

                const agg = this._clientAggregate(data);

                return { text: this._templateFallback(question, data, agg) };

              }

            }

          }

          return null;

        }

        case 'trend': {

          const korNames = this._extractKoreanNames(question);

          const resolved = korNames.length > 0 ? await this._resolveKoreanName(korNames[0], tables) : null;

          const nameFilter = resolved ? `&name=eq.${encodeURIComponent(resolved.engName)}` : '';

          const url = `${baseUrl}?select=finish,date&is_normal=eq.true${nameFilter}&order=date&limit=500`;

          const data = (await (await fetch(url, { headers: h })).json());

          if (data.length < 5) return { text: '추이 분석을 위한 데이터가 부족합니다.' };

          const who = resolved ? resolved.krName : '전체';



          // Monthly breakdown

          const months = {};

          for (const r of data) {

            const m = r.date.substring(0, 7);

            if (!months[m]) months[m] = [];

            months[m].push(parseFloat(r.finish));

          }

          const sorted = Object.entries(months).sort(([a], [b]) => a.localeCompare(b));



          let text = `📈 ${who} 월별 기록 추이 (${data.length}건)\n\n`;

          let prevAvg = null;

          for (const [month, vals] of sorted) {

            const avg = +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2);

            const best = +Math.min(...vals).toFixed(2);

            const change = prevAvg ? (avg - prevAvg).toFixed(2) : null;

            const arrow = change ? (change < 0 ? ` (${change}초 ↑)` : ` (+${change}초 ↓)`) : '';

            text += `• ${month}: 평균 ${avg}초, 최고 ${best}초 (${vals.length}건)${arrow}\n`;

            prevAvg = avg;

          }



          // Overall trend

          const firstMonth = sorted[0];

          const lastMonth = sorted[sorted.length - 1];

          const firstAvg = +(firstMonth[1].reduce((a, b) => a + b, 0) / firstMonth[1].length).toFixed(2);

          const lastAvg = +(lastMonth[1].reduce((a, b) => a + b, 0) / lastMonth[1].length).toFixed(2);

          const totalDiff = (firstAvg - lastAvg).toFixed(2);

          const p = Chatbot._particle(who, '은는');

          text += totalDiff > 0

            ? `\n→ ${who}${p} ${firstMonth[0]}~${lastMonth[0]} 동안 ${Math.abs(totalDiff)}초 개선`

            : `\n→ ${who}${p} ${firstMonth[0]}~${lastMonth[0]} 동안 ${Math.abs(totalDiff)}초 하락`;

          return { text };

        }

        case 'consistency': {

          // Fetch records + athlete name_kr

          const [recResp, athResp] = await Promise.all([

            fetch(`${baseUrl}?select=finish,name,athlete_id&is_normal=eq.true&order=name&limit=2000`, { headers: h }),

            fetch(`${Chatbot.SUPABASE_URL}/rest/v1/${tables.athletes}?select=name,name_kr&limit=200`, { headers: h }),

          ]);

          const data = await recResp.json();

          const athData = await athResp.json();

          const nameKrMap = {};

          for (const a of athData) { if (a.name_kr) nameKrMap[a.name] = a.name_kr; }



          const groups = {};

          for (const r of data) {

            const k = r.athlete_id || r.name;

            if (!groups[k]) groups[k] = { name: r.name, vals: [] };

            groups[k].vals.push(parseFloat(r.finish));

          }

          const stats = Object.entries(groups)

            .filter(([, v]) => v.vals.length >= 5)

            .map(([aid, v]) => {

              const avg = v.vals.reduce((a, b) => a + b, 0) / v.vals.length;

              const std = Math.sqrt(v.vals.reduce((s, x) => s + (x - avg) ** 2, 0) / v.vals.length);

              const displayName = nameKrMap[v.name] || v.name;

              return { aid, name: displayName, avg: +avg.toFixed(2), std: +std.toFixed(2), n: v.vals.length };

            });



          // Group by level: fast (<53), mid (53-55), slow (>55)

          const fast = stats.filter(s => s.avg < 53).sort((a, b) => a.std - b.std);

          const mid = stats.filter(s => s.avg >= 53 && s.avg < 55).sort((a, b) => a.std - b.std);



          let text = `📊 선수 일관성 순위 (편차 작을수록 안정적, 5건 이상)\n\n`;

          if (fast.length > 0) {

            text += `🥇 상위권 (평균 53초 미만):\n`;

            for (const s of fast.slice(0, 5)) text += `  ${s.name}: 편차 ${s.std}초, 평균 ${s.avg}초 (${s.n}건)\n`;

            text += '\n';

          }

          if (mid.length > 0) {

            text += `🥈 중위권 (평균 53~55초):\n`;

            for (const s of mid.slice(0, 5)) text += `  ${s.name}: 편차 ${s.std}초, 평균 ${s.avg}초 (${s.n}건)\n`;

          }

          return { text };

        }

        case 'best_condition': {

          const url = `${baseUrl}?select=finish,air_temp,humidity_pct,pressure_hpa,wind_speed_ms,temp_avg,date&is_normal=eq.true&air_temp=not.is.null&order=finish&limit=2000`;

          const data = (await (await fetch(url, { headers: h })).json());

          if (data.length < 20) return { text: '조건 분석 데이터가 부족합니다.' };

          const top10 = data.slice(0, Math.ceil(data.length * 0.1));

          const avg = (key) => +(top10.reduce((s, r) => s + parseFloat(r[key] || 0), 0) / top10.length).toFixed(1);

          let text = `📊 상위 10% 최고 기록의 환경 조건 (${top10.length}건)\n\n`;

          text += `• 기온: 평균 ${avg('air_temp')}°C\n`;

          text += `• 빙면 온도: 평균 ${avg('temp_avg')}°C\n`;

          text += `• 습도: 평균 ${avg('humidity_pct')}%\n`;

          text += `• 기압: 평균 ${avg('pressure_hpa')}hPa\n`;

          text += `• 풍속: 평균 ${avg('wind_speed_ms')}m/s\n`;

          text += `\n→ 이 조건에서 가장 좋은 기록이 나옵니다.`;

          return { text };

        }

        case 'time_of_season': {

          const url = `${baseUrl}?select=finish,date&is_normal=eq.true&order=date&limit=2000`;

          const data = (await (await fetch(url, { headers: h })).json());

          if (data.length < 20) return { text: '시즌 분석 데이터가 부족합니다.' };

          const months = {};

          for (const r of data) {

            const m = r.date.substring(0, 7);

            if (!months[m]) months[m] = [];

            months[m].push(parseFloat(r.finish));

          }

          let text = `📊 월별 평균 기록 분석\n\n`;

          const sorted = Object.entries(months).sort(([a], [b]) => a.localeCompare(b));

          for (const [month, vals] of sorted) {

            const avg = (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2);

            text += `• ${month}: 평균 ${avg}초 (${vals.length}건)\n`;

          }

          const best = sorted.reduce((a, b) => {

            const avgA = a[1].reduce((s, v) => s + v, 0) / a[1].length;

            const avgB = b[1].reduce((s, v) => s + v, 0) / b[1].length;

            return avgA < avgB ? a : b;

          });

          text += `\n→ 가장 기록이 좋은 달: ${best[0]}`;

          return { text };

        }

        case 'start_vs_technique': {

          const krMap = await this._getNameKrMap(tables);

          const url = `${baseUrl}?select=finish,start_time,name,athlete_id&is_normal=eq.true&order=name&limit=2000`;

          const data = (await (await fetch(url, { headers: h })).json());

          const groups = {};

          for (const r of data) {

            const k = r.athlete_id || r.name;

            if (!groups[k]) groups[k] = { name: r.name, starts: [], finishes: [] };

            groups[k].starts.push(parseFloat(r.start_time));

            groups[k].finishes.push(parseFloat(r.finish));

          }

          const stats = Object.entries(groups)

            .filter(([, v]) => v.starts.length >= 5)

            .map(([, v]) => {

              const avgSt = v.starts.reduce((a, b) => a + b, 0) / v.starts.length;

              const avgFin = v.finishes.reduce((a, b) => a + b, 0) / v.finishes.length;

              const technique = avgFin - avgSt;

              return { name: this._toKr(v.name, krMap), avgSt: +avgSt.toFixed(2), avgFin: +avgFin.toFixed(2), technique: +technique.toFixed(2), n: v.starts.length };

            });

          const byTech = [...stats].sort((a, b) => a.technique - b.technique);

          const byStart = [...stats].sort((a, b) => a.avgSt - b.avgSt);

          let text = `📊 스타트 속도 vs 주행 기술 분석\n\n`;

          text += `🏃 스타트 빠른 선수 Top 5:\n`;

          for (const s of byStart.slice(0, 5)) text += `  ${s.name}: 스타트 ${s.avgSt}초, 피니시 ${s.avgFin}초\n`;

          text += `\n🎯 주행 기술 좋은 선수 Top 5 (주행 구간 시간 짧은 순):\n`;

          for (const s of byTech.slice(0, 5)) text += `  ${s.name}: 주행구간 ${s.technique}초, 스타트 ${s.avgSt}초, 피니시 ${s.avgFin}초\n`;

          return { text };

        }

        case 'body_effect': {

          const krMap = await this._getNameKrMap(tables);

          const athUrl = `${Chatbot.SUPABASE_URL}/rest/v1/${tables.athletes}?select=name,height_cm,weight_kg&height_cm=not.is.null&weight_kg=not.is.null`;

          const athletes = (await (await fetch(athUrl, { headers: h })).json());

          const athMap = {};

          for (const a of athletes) athMap[a.name] = a;

          const url = `${baseUrl}?select=finish,name&is_normal=eq.true&limit=2000`;

          const data = (await (await fetch(url, { headers: h })).json());

          const groups = {};

          for (const r of data) {

            if (!athMap[r.name]) continue;

            if (!groups[r.name]) groups[r.name] = { ...athMap[r.name], vals: [] };

            groups[r.name].vals.push(parseFloat(r.finish));

          }

          const stats = Object.values(groups)

            .filter(v => v.vals.length >= 5)

            .map(v => ({ name: this._toKr(v.name, krMap), h: v.height_cm, w: v.weight_kg, avg: +(v.vals.reduce((a, b) => a + b, 0) / v.vals.length).toFixed(2), n: v.vals.length }));

          if (stats.length < 5) return { text: '신체 데이터가 있는 선수가 부족합니다.' };

          const heights = stats.map(s => s.h);

          const finishes = stats.map(s => s.avg);

          const weights = stats.map(s => s.w);

          const regH = this._linearRegression(heights, finishes);

          const regW = this._linearRegression(weights, finishes);

          let text = `📊 신체 조건 vs 기록 분석 (${stats.length}명)\n\n`;

          if (regH) text += `• 키 1cm 증가 → 피니시 ${regH.slope > 0 ? '+' : ''}${regH.slope.toFixed(3)}초 (R²=${(regH.r2 * 100).toFixed(1)}%)\n`;

          if (regW) text += `• 체중 1kg 증가 → 피니시 ${regW.slope > 0 ? '+' : ''}${regW.slope.toFixed(3)}초 (R²=${(regW.r2 * 100).toFixed(1)}%)\n`;

          text += `\n🏋️ 체중 가벼운 순 (기록 포함):\n`;

          const byW = [...stats].sort((a, b) => a.w - b.w);

          for (const s of byW.slice(0, 5)) text += `  ${s.name}: ${s.h}cm/${s.w}kg → 평균 ${s.avg}초\n`;

          return { text };

        }

        case 'run_fatigue': {

          const url = `${baseUrl}?select=finish,run&is_normal=eq.true&run=not.is.null&order=run&limit=2000`;

          const data = (await (await fetch(url, { headers: h })).json());

          const runs = {};

          for (const r of data) {

            const rn = parseInt(r.run);

            if (isNaN(rn) || rn < 1 || rn > 10) continue;

            if (!runs[rn]) runs[rn] = [];

            runs[rn].push(parseFloat(r.finish));

          }

          let text = `📊 주행 순서별 기록 분석 (피로도)\n\n`;

          const sorted = Object.entries(runs).sort(([a], [b]) => a - b);

          for (const [rn, vals] of sorted) {

            const avg = (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2);

            text += `• ${rn}번째 주행: 평균 ${avg}초 (${vals.length}건)\n`;

          }

          if (sorted.length >= 2) {

            const first = sorted[0][1].reduce((a, b) => a + b, 0) / sorted[0][1].length;

            const last = sorted[sorted.length - 1][1].reduce((a, b) => a + b, 0) / sorted[sorted.length - 1][1].length;

            const diff = (last - first).toFixed(2);

            text += `\n→ 1번째 vs ${sorted[sorted.length - 1][0]}번째: ${diff > 0 ? '+' : ''}${diff}초 차이`;

          }

          return { text };

        }

        case 'head_to_head': {

          const korNames = this._extractKoreanNames(question);

          if (korNames.length < 2) return { text: '두 선수 이름을 입력해주세요.' };

          const resolved = await Promise.all(korNames.slice(0, 2).map(n => this._resolveKoreanName(n, tables)));

          if (resolved.some(r => !r)) return { text: '선수를 찾을 수 없습니다.' };

          const [a, b] = resolved;

          const urlA = `${baseUrl}?select=finish,date&name=eq.${encodeURIComponent(a.engName)}&is_normal=eq.true&order=date&limit=200`;

          const urlB = `${baseUrl}?select=finish,date&name=eq.${encodeURIComponent(b.engName)}&is_normal=eq.true&order=date&limit=200`;

          const [dataA, dataB] = await Promise.all([

            fetch(urlA, { headers: h }).then(r => r.json()),

            fetch(urlB, { headers: h }).then(r => r.json()),

          ]);

          const datesA = {};

          for (const r of dataA) { if (!datesA[r.date]) datesA[r.date] = []; datesA[r.date].push(parseFloat(r.finish)); }

          const datesB = {};

          for (const r of dataB) { if (!datesB[r.date]) datesB[r.date] = []; datesB[r.date].push(parseFloat(r.finish)); }

          const common = Object.keys(datesA).filter(d => datesB[d]);

          let winsA = 0, winsB = 0;

          let text = `📊 ${a.krName} vs ${b.krName} 직접 대결 (같은 날)\n\n`;

          for (const d of common.sort()) {

            const bestA = Math.min(...datesA[d]);

            const bestB = Math.min(...datesB[d]);

            const winner = bestA < bestB ? a.krName : b.krName;

            if (bestA < bestB) winsA++; else winsB++;

            text += `• ${d}: ${a.krName} ${bestA.toFixed(2)}초 vs ${b.krName} ${bestB.toFixed(2)}초 → ${winner} 승\n`;

          }

          text += `\n→ 전적: ${a.krName} ${winsA}승 vs ${b.krName} ${winsB}승 (총 ${common.length}회)`;

          return { text };

        }

        case 'coaching': {
          const topUrl = baseUrl + '?select=name,finish,start_time,speed&is_normal=eq.true&order=finish&limit=50';
          const athUrl2 = Chatbot.SUPABASE_URL + '/rest/v1/' + Chatbot.TABLES[this.sport].athletes;
          const [topRecs, athData] = await Promise.all([
            fetch(topUrl, { headers: h }).then(r => r.json()),
            fetch(athUrl2 + '?select=name,height_cm,weight_kg,gender&height_cm=not.is.null&order=name', { headers: h }).then(r => r.json()),
          ]);
          if (!Array.isArray(topRecs) || topRecs.length < 5) return { text: '코칭 데이터가 부족합니다.' };
          const topNames = [...new Set(topRecs.map(r => r.name))].slice(0, 5);
          const top20 = topRecs.slice(0, 20);
          const avgStart = (top20.reduce((s, r) => s + parseFloat(r.start_time), 0) / 20).toFixed(2);
          const avgFinish = (top20.reduce((s, r) => s + parseFloat(r.finish), 0) / 20).toFixed(2);
          const topAth = athData.filter(a => topNames.includes(a.name));
          let ctx = '상위 선수: ' + topNames.join(', ') + '. 평균 스타트: ' + avgStart + '초, 평균 피니시: ' + avgFinish + '초.';
          if (topAth.length > 0) {
            const avgH = (topAth.reduce((s, a) => s + parseFloat(a.height_cm || 175), 0) / topAth.length).toFixed(0);
            const avgW = (topAth.reduce((s, a) => s + parseFloat(a.weight_kg || 75), 0) / topAth.length).toFixed(0);
            ctx += ' 평균 체격: ' + avgH + 'cm/' + avgW + 'kg.';
          }
          return { text: ctx, needsLLM: true };
        }

        default:

          return null;

      }

    } catch (e) {

      console.warn(`Insight func ${funcName} failed:`, e);

      return null;

    }

  }



  async _fetchRecords(baseUrl, h, range, extra = '', normalOnly = false) {

    const normalFilter = normalOnly ? '&is_normal=eq.true' : `&status=eq.OK&finish=gte.${range[0]}&finish=lte.${range[1]}`;

    const url = `${baseUrl}?select=start_time,finish,int1,int2,int3,int4,seg1,seg2,seg3,seg4,seg5,speed,air_temp,humidity_pct,pressure_hpa,wind_speed_ms,dewpoint_c,temp_avg${normalFilter}${extra}&limit=2000`;

    const resp = await fetch(url, { headers: h });

    return await resp.json();

  }



  _linearRegression(xs, ys) {

    const n = xs.length;

    if (n < 5) return null;

    const mx = xs.reduce((a, b) => a + b, 0) / n;

    const my = ys.reduce((a, b) => a + b, 0) / n;

    let sxy = 0, sxx = 0;

    for (let i = 0; i < n; i++) {

      sxy += (xs[i] - mx) * (ys[i] - my);

      sxx += (xs[i] - mx) ** 2;

    }

    if (sxx === 0) return null;

    const slope = sxy / sxx;

    const intercept = my - slope * mx;

    let ssRes = 0, ssTot = 0;

    for (let i = 0; i < n; i++) {

      ssRes += (ys[i] - (slope * xs[i] + intercept)) ** 2;

      ssTot += (ys[i] - my) ** 2;

    }

    const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;

    return { slope, intercept, r2, n };

  }



  // Filter for normal records (all intermediate times present and reasonable)

  _filterNormal(data) {

    return data.filter(r => {

      const st = parseFloat(r.start_time), i1 = parseFloat(r.int1), i2 = parseFloat(r.int2);

      const i3 = parseFloat(r.int3), i4 = parseFloat(r.int4), fin = parseFloat(r.finish);

      if (!st || !i1 || !i2 || !i3 || !i4 || !fin) return false;

      // Normal: start 3~8, int1 13~17, int2 22~26, int3 32~37, int4 42~48, finish 49~60

      if (st < 3 || st > 8) return false;

      if (i1 < 12 || i1 > 18) return false;

      if (i2 < 20 || i2 > 28) return false;

      if (i3 < 28 || i3 > 40) return false;

      if (i4 < 38 || i4 > 50) return false;

      // Segment times must be positive and reasonable (> 3s each)

      if (i1 - st < 3 || i2 - i1 < 3 || i3 - i2 < 3 || i4 - i3 < 3 || fin - i4 < 3) return false;

      return true;

    });

  }



  async _insightStartImpact(baseUrl, h, range) {

    const data = await this._fetchRecords(baseUrl, h, range, '', true);

    const xs = data.map(r => parseFloat(r.start_time));

    const ys = data.map(r => parseFloat(r.finish));

    const reg = this._linearRegression(xs, ys);

    if (!reg) return { text: '데이터가 부족합니다.' };



    const impact01 = Math.abs(reg.slope * 0.1);

    const ratio = Math.abs(reg.slope);



    let text = `📊 스타트 → 피니시 영향 분석 (${data.length}건)\n\n`;

    text += `• 스타트 1초 단축 → 피니시 약 ${ratio.toFixed(2)}초 단축\n`;

    text += `• 스타트 0.1초 단축 → 피니시 약 ${impact01.toFixed(2)}초 단축\n`;

    text += `• 증폭 비율: ${ratio.toFixed(1)}배\n`;

    text += `• 상관계수 R²: ${(reg.r2 * 100).toFixed(1)}%\n\n`;

    text += `→ 스타트 0.1초 줄이면 피니시 약 ${impact01.toFixed(2)}초 빨라집니다.`;

    return { text };

  }



  async _insightSegment(q, baseUrl, h, range) {

    const valid = await this._fetchRecords(baseUrl, h, range, '', true);



    if (valid.length < 10) return { text: '구간 데이터가 부족합니다.' };



    // Use pre-computed segment columns from DB

    const segments = valid.map(r => ({

      'Start→Int.1': parseFloat(r.seg1),

      'Int.1→Int.2': parseFloat(r.seg2),

      'Int.2→Int.3': parseFloat(r.seg3),

      'Int.3→Int.4': parseFloat(r.seg4),

      'Int.4→Finish': parseFloat(r.seg5),

    }));



    const segNames = ['Start→Int.1', 'Int.1→Int.2', 'Int.2→Int.3', 'Int.3→Int.4', 'Int.4→Finish'];

    const curveInfo = ['커브 1~4', '커브 4~7', '커브 7~12', '커브 12~15', '커브 15~Finish'];



    // Check if specific curve number is mentioned

    let targetCurve = null;

    const curveNumMatch = q.match(/(\d+)/);

    if (curveNumMatch) targetCurve = parseInt(curveNumMatch[1]);



    // Fetch track metadata from DB

    let trackMeta = [];

    try {

      const metaUrl = `${Chatbot.SUPABASE_URL}/rest/v1/track_metadata?select=*&order=curve_number`;

      const metaResp = await fetch(metaUrl, { headers: h });

      trackMeta = await metaResp.json();

    } catch (e) { /* ignore */ }



    // If specific curve asked, show detailed info

    if (targetCurve && targetCurve >= 1 && targetCurve <= 16) {

      const curve = trackMeta.find(c => c.curve_number === targetCurve);

      if (curve) {

        let text = `📊 커브 ${targetCurve} 상세 정보\n\n`;

        text += `• 방향: ${curve.curve_type}\n`;

        text += `• 반경: ${curve.radius_m}m\n`;

        text += `• 뱅킹: ${curve.banking_deg}도\n`;

        text += `• 고도: ${curve.elevation_m}m (낙차: ${curve.elevation_drop_m}m)\n`;

        text += `• 출발점 거리: ${curve.distance_from_start_m}m\n`;

        text += `• 구간: ${curve.segment}\n`;

        text += `• 난이도: ${curve.difficulty}\n`;

        text += `\n💡 코칭 팁: ${curve.coaching_tip}`;



        // Add segment stats for the curve's segment

        const segIdx = segNames.indexOf(curve.segment.replace(/-/g, '→'));

        if (segIdx >= 0) {

          const times = segments.map(s => s[segNames[segIdx]]).filter(v => !isNaN(v) && v > 0);

          if (times.length > 0) {

            const avg = (times.reduce((a, b) => a + b, 0) / times.length).toFixed(2);

            const std = Math.sqrt(times.reduce((s, v) => s + (v - avg) ** 2, 0) / times.length).toFixed(2);

            text += `\n\n📈 해당 구간(${curve.segment}) 통계:`;

            text += `\n• 평균: ${avg}초, 편차: ${std}초`;

          }

        }

        return { text };

      }

    }



    let targetSeg = -1;

    if (targetCurve) {

      if (targetCurve <= 4) targetSeg = 0;

      else if (targetCurve <= 7) targetSeg = 1;

      else if (targetCurve <= 12) targetSeg = 2;

      else if (targetCurve <= 15) targetSeg = 3;

      else targetSeg = 4;

    }



    let text = `📊 구간별 분석 (${valid.length}건)\n\n`;



    for (let i = 0; i < segNames.length; i++) {

      const times = segments.map(s => s[segNames[i]]).filter(v => !isNaN(v) && v > 0);

      const avg = (times.reduce((a, b) => a + b, 0) / times.length).toFixed(2);

      const std = Math.sqrt(times.reduce((s, v) => s + (v - avg) ** 2, 0) / times.length).toFixed(2);

      const min = Math.min(...times).toFixed(2);

      const max = Math.max(...times).toFixed(2);



      // Correlation with finish

      const finishes = valid.map(r => parseFloat(r.finish));

      const reg = this._linearRegression(times, finishes);

      const corrStr = reg ? `(피니시 상관: R²=${(reg.r2 * 100).toFixed(1)}%)` : '';



      const marker = i === targetSeg ? ' ⭐' : '';

      text += `${segNames[i]} ${curveInfo[i]}${marker}\n`;

      text += `  평균: ${avg}초, 편차: ${std}초, 범위: ${min}~${max}초 ${corrStr}\n`;

    }



    // Find most variable segment

    const stds = segNames.map((name, i) => {

      const times = segments.map(s => s[name]).filter(v => !isNaN(v) && v > 0);

      return { name, std: Math.sqrt(times.reduce((s, v) => s + (v - times.reduce((a, b) => a + b, 0) / times.length) ** 2, 0) / times.length) };

    });

    stds.sort((a, b) => b.std - a.std);

    text += `\n→ 편차가 가장 큰 구간: ${stds[0].name} (${stds[0].std.toFixed(2)}초) — 기록 개선 여지가 가장 큼`;



    return { text };

  }



  async _insightFrost(baseUrl, h, range) {

    const data = await this._fetchRecords(baseUrl, h, range);

    const withDew = data.filter(r => r.dewpoint_c != null && r.temp_avg != null);

    if (withDew.length < 20) return { text: '서리 분석을 위한 데이터가 부족합니다.' };



    const frost = withDew.filter(r => parseFloat(r.dewpoint_c) > parseFloat(r.temp_avg));

    const noFrost = withDew.filter(r => parseFloat(r.dewpoint_c) <= parseFloat(r.temp_avg));



    const avgFrost = frost.length > 0 ? (frost.reduce((s, r) => s + parseFloat(r.finish), 0) / frost.length).toFixed(2) : '-';

    const avgNoFrost = noFrost.length > 0 ? (noFrost.reduce((s, r) => s + parseFloat(r.finish), 0) / noFrost.length).toFixed(2) : '-';



    let text = `📊 서리(Frost) 영향 분석 (${withDew.length}건)\n\n`;

    text += `• 서리 위험 (이슬점 > 빙면온도): ${frost.length}건, 평균 기록: ${avgFrost}초\n`;

    text += `• 서리 없음: ${noFrost.length}건, 평균 기록: ${avgNoFrost}초\n`;



    if (frost.length > 0 && noFrost.length > 0) {

      const diff = (parseFloat(avgFrost) - parseFloat(avgNoFrost)).toFixed(2);

      text += `\n→ 서리 발생 시 평균 ${diff}초 느려짐`;

      text += `\n→ 원인: 빙면에 서리가 맺히면 마찰계수 증가`;

      text += `\n→ 대책: 트랙 내부 습도 조절(제습)로 이슬점을 빙면 온도 아래로 유지`;

    }

    return { text };

  }



  async _insightTemperature(baseUrl, h, range) {

    const data = await this._fetchRecords(baseUrl, h, range);

    const withTemp = data.filter(r => r.temp_avg != null);

    if (withTemp.length < 20) return { text: '온도 분석 데이터가 부족합니다.' };



    const xs = withTemp.map(r => parseFloat(r.temp_avg));

    const ys = withTemp.map(r => parseFloat(r.finish));

    const reg = this._linearRegression(xs, ys);



    // Group by temperature range

    const groups = [

      { label: '극저온 (< -8°C)', filter: r => parseFloat(r.temp_avg) < -8 },

      { label: '저온 (-8 ~ -6°C)', filter: r => { const t = parseFloat(r.temp_avg); return t >= -8 && t < -6; } },

      { label: '적정 (-6 ~ -4°C)', filter: r => { const t = parseFloat(r.temp_avg); return t >= -6 && t < -4; } },

      { label: '고온 (> -4°C)', filter: r => parseFloat(r.temp_avg) >= -4 },

    ];



    let text = `📊 빙면 온도 vs 기록 분석 (${withTemp.length}건)\n\n`;

    for (const g of groups) {

      const subset = withTemp.filter(g.filter);

      if (subset.length < 3) continue;

      const avg = (subset.reduce((s, r) => s + parseFloat(r.finish), 0) / subset.length).toFixed(2);

      text += `• ${g.label}: ${subset.length}건, 평균 ${avg}초\n`;

    }



    if (reg) {

      text += `\n• 온도 1°C 하락 → 피니시 약 ${Math.abs(reg.slope).toFixed(3)}초 변화`;

      text += `\n• R²: ${(reg.r2 * 100).toFixed(1)}%`;

    }



    // Top 10% records temperature

    const sorted = withTemp.sort((a, b) => parseFloat(a.finish) - parseFloat(b.finish));

    const top10 = sorted.slice(0, Math.ceil(sorted.length * 0.1));

    const optTemp = (top10.reduce((s, r) => s + parseFloat(r.temp_avg), 0) / top10.length).toFixed(1);

    text += `\n\n→ 상위 10% 기록의 평균 빙면 온도: ${optTemp}°C (최적 온도)`;



    return { text };

  }



  async _insightHumidity(baseUrl, h, range) {

    const data = await this._fetchRecords(baseUrl, h, range);

    const withHum = data.filter(r => r.humidity_pct != null);

    if (withHum.length < 20) return { text: '습도 분석 데이터가 부족합니다.' };



    const groups = [

      { label: '저습 (< 40%)', filter: r => parseFloat(r.humidity_pct) < 40 },

      { label: '중간 (40~60%)', filter: r => { const h = parseFloat(r.humidity_pct); return h >= 40 && h < 60; } },

      { label: '고습 (60~80%)', filter: r => { const h = parseFloat(r.humidity_pct); return h >= 60 && h < 80; } },

      { label: '초고습 (> 80%)', filter: r => parseFloat(r.humidity_pct) >= 80 },

    ];



    let text = `📊 습도 vs 기록 분석 (${withHum.length}건)\n\n`;

    for (const g of groups) {

      const subset = withHum.filter(g.filter);

      if (subset.length < 3) continue;

      const avg = (subset.reduce((s, r) => s + parseFloat(r.finish), 0) / subset.length).toFixed(2);

      text += `• ${g.label}: ${subset.length}건, 평균 ${avg}초\n`;

    }



    const xs = withHum.map(r => parseFloat(r.humidity_pct));

    const ys = withHum.map(r => parseFloat(r.finish));

    const reg = this._linearRegression(xs, ys);

    if (reg) {

      text += `\n• 습도 10% 증가 → 피니시 약 ${(reg.slope * 10).toFixed(3)}초 변화`;

      text += `\n• R²: ${(reg.r2 * 100).toFixed(1)}%`;

    }

    return { text };

  }



  async _insightWind(baseUrl, h, range) {

    const data = await this._fetchRecords(baseUrl, h, range);

    const withWind = data.filter(r => r.wind_speed_ms != null);

    if (withWind.length < 20) return { text: '풍속 분석 데이터가 부족합니다.' };



    const groups = [

      { label: '약풍 (< 2 m/s)', filter: r => parseFloat(r.wind_speed_ms) < 2 },

      { label: '보통 (2~5 m/s)', filter: r => { const w = parseFloat(r.wind_speed_ms); return w >= 2 && w < 5; } },

      { label: '강풍 (> 5 m/s)', filter: r => parseFloat(r.wind_speed_ms) >= 5 },

    ];



    let text = `📊 풍속 vs 기록 분석 (${withWind.length}건)\n\n`;

    for (const g of groups) {

      const subset = withWind.filter(g.filter);

      if (subset.length < 3) continue;

      const avg = (subset.reduce((s, r) => s + parseFloat(r.finish), 0) / subset.length).toFixed(2);

      text += `• ${g.label}: ${subset.length}건, 평균 ${avg}초\n`;

    }



    const xs = withWind.map(r => parseFloat(r.wind_speed_ms));

    const ys = withWind.map(r => parseFloat(r.finish));

    const reg = this._linearRegression(xs, ys);

    if (reg) {

      text += `\n• 풍속 1m/s 증가 → 피니시 약 ${reg.slope.toFixed(3)}초 변화`;

      text += `\n• R²: ${(reg.r2 * 100).toFixed(1)}%`;

    }

    return { text };

  }



  async _pipeline(question) {

    this._lastQuestion = question;

    const tables = Chatbot.TABLES[this.sport];



    // ── Phase 0: 키워드 사전 분류 (intent 분류보다 우선) ──
    const _q = question.toLowerCase();
    const _kwMap = [
      { keys: ['잘하','제일','최고','1등','누가 가장'], func: 'consistency' },
      { keys: ['서리','결빙'], func: 'frost' },
      { keys: ['습도','습한','건조','비 오'], func: 'humidity' },
      { keys: ['바람','풍속','돌풍'], func: 'wind' },
      { keys: ['체중','몸무게','체격'], func: 'body_effect' },
      { keys: ['피로','지치','후반'], func: 'run_fatigue' },
      { keys: ['추이','추세','성장','요즘'], func: 'trend' },
    ];
    for (const {keys, func} of _kwMap) {
      if (keys.some(k => _q.includes(k))) {
        const _h = { 'apikey': Chatbot.SUPABASE_KEY, 'Authorization': 'Bearer ' + Chatbot.SUPABASE_KEY };
        const _baseUrl = Chatbot.SUPABASE_URL + '/rest/v1/' + tables.records;
        const _range = this.sport === 'skeleton' ? [50, 60] : [45, 65];
        const _r = await this._execInsightFunc(func, question, _baseUrl, _h, _range, tables);
        if (_r && _r.text) return _r;
      }
    }


    // Compare shortcut FIRST: detect 2+ Korean names → direct DB fetch (no LLM needed)

    const korNames = this._extractKoreanNames(question);

    if (korNames.length >= 2 && this._isCompareQuestion(question)) {

      // Run compare + head_to_head in parallel

      const [compareResult, h2hResult] = await Promise.all([

        this._compareQuery(korNames, tables),

        this._execInsightFunc('head_to_head', question, `${Chatbot.SUPABASE_URL}/rest/v1/${tables.records}`,

          { 'apikey': Chatbot.SUPABASE_KEY, 'Authorization': 'Bearer ' + Chatbot.SUPABASE_KEY },

          this.sport === 'skeleton' ? [50, 60] : [45, 65], tables),

      ]);

      let text = compareResult.text;

      if (h2hResult) text += '\n\n' + h2hResult.text;

      return { text };

    }



    // Insight shortcut: detect analytical questions → direct DB computation (no LLM SQL)

    const insight = await this._detectInsight(question, tables);

    if (insight) return insight;



    // Single Korean name shortcut → direct DB fetch

    if (korNames.length === 1 && question.trim().length <= 10) {

      const resolved = await this._resolveKoreanName(korNames[0], tables);

      if (resolved) {

        const range = this.sport === 'skeleton' ? [50, 60] : [45, 65];

        const h = { 'apikey': Chatbot.SUPABASE_KEY, 'Authorization': 'Bearer ' + Chatbot.SUPABASE_KEY };

        const url = `${Chatbot.SUPABASE_URL}/rest/v1/${tables.records}?select=finish,start_time,date&name=eq.${encodeURIComponent(resolved.engName)}&status=eq.OK&finish=gte.${range[0]}&finish=lte.${range[1]}&order=finish&limit=50`;

        const resp = await fetch(url, { headers: h });

        const data = await resp.json();

        if (data.length > 0) {

          const agg = this._clientAggregate(data);

          return { text: this._templateFallback(question, data, agg) };

        }

      }

    }



    // ── Phase 1: Intent + SQL generation (4 calls parallel) ──

    const [intentResult, ...sqlResults] = await Promise.all([

      this._classifyIntent(question),

      this._generateSQL(question, tables, 0.0),

      this._generateSQL(question, tables, 0.3),

      this._generateSQL(question, tables, 0.6),

    ]);



    if (intentResult === 'out_of_scope') {

      return { text: '이 질문은 경기 기록 데이터로 답변할 수 없습니다. 기록, 선수, 환경 관련 질문을 해주세요.' };

    }



    // 날씨 질문 → KMA API 직접 호출

    if (intentResult.includes('environment')) {

      try {

        const weather = await this._fetchKMAWeather();

        if (weather) {

          const answer = await this._callLLM([

            { role: 'system', content: '당신은 슬라이딩 스포츠 전문 AI입니다. 주어진 기상 데이터를 바탕으로 핵심만 간결하게 한국어로 답변하세요. 200자 이내.' },

            { role: 'user', content: question + ' 현재 평창 대관령 기상 데이터: ' + JSON.stringify(weather) },

          ]);

          return { text: answer };

        }

      } catch (e) {

        console.warn('[Chatbot] KMA fallback failed:', e);

        return { text: '날씨 정보를 가져오는 데 실패했습니다. 다시 시도해주세요.' };

      }

    }



    // 코칭 질문 -> insight 함수로 위임
    if (intentResult.includes('coaching')) {
      try {
        const h = { 'apikey': Chatbot.SUPABASE_KEY, 'Authorization': 'Bearer ' + Chatbot.SUPABASE_KEY };
        const baseUrl = Chatbot.SUPABASE_URL + '/rest/v1/' + tables.records;
        const insightResult = await this._execInsightFunc('coaching', question, baseUrl, h, null, tables);
        if (insightResult && insightResult.text) {
          const answer = await this._callLLM([
            { role: 'system', content: '당신은 슬라이딩 스포츠 전문 코치 AI입니다. 주어진 데이터를 바탕으로 핵심 코칭 조언을 한국어로 제공하세요. 반드시 300자 이내로 간결하게 답변하세요. 데이터 숫자를 인용하세요.' },
            { role: 'user', content: question + ' [데이터] ' + insightResult.text },
          ]);
          return { text: answer };
        }
      } catch (e) {
        console.warn('[Chatbot] coaching failed:', e);
        return { text: '코칭 분석 중 오류가 발생했습니다. 다시 시도해주세요.' };
      }
    }

    // SQL consensus vote (majority from 5)

    const validSqls = sqlResults.filter(s => this._validateSQL(s, tables));

    if (validSqls.length === 0) {

      return { text: '질문을 이해했지만, 안전한 데이터 쿼리를 생성할 수 없습니다. 다시 질문해 주세요.' };

    }

    const rawSQL = this._pickConsensus(validSqls);

    const finalSQL = this._injectFilters(rawSQL, tables);

    console.log('[Chatbot] Raw SQL:', rawSQL);

    console.log('[Chatbot] Final SQL:', finalSQL);



    // ── Phase 2: DB execution ──

    let dbResult = await this._executeSQL(finalSQL, tables);

    if (!dbResult || dbResult.length === 0) {

      return { text: '해당 조건에 맞는 데이터가 없습니다.' };

    }



    // Post-filter: enforce finish range client-side (safety net)

    const range = this.sport === 'skeleton' ? [50, 60] : [45, 65];

    if (dbResult[0] && 'finish' in dbResult[0]) {

      dbResult = dbResult.filter(r => {

        const f = parseFloat(r.finish);

        return isNaN(f) || (f >= range[0] && f <= range[1]);

      });

      if (dbResult.length === 0) {

        return { text: '해당 조건에 맞는 정상 기록이 없습니다.' };

      }

    }



    // Client-side aggregation for common operations

    const aggregated = this._clientAggregate(dbResult);



    // ── Phase 3: Answer generation (2 calls parallel) ──

    const answers = await Promise.all([

      this._generateAnswer(question, dbResult, finalSQL, aggregated, 0),

      this._generateAnswer(question, dbResult, finalSQL, aggregated, 0.3),

    ]);



    // ── Phase 4: Factcheck (2 calls parallel) ──

    const factResults = await Promise.all(

      answers.map(ans => this._llmFactcheck(ans, dbResult, aggregated))

    );



    // Pick best answer: highest factcheck score

    let bestIdx = 0;

    let bestScore = -1;

    for (let i = 0; i < factResults.length; i++) {

      const score = this._parseFactScore(factResults[i]);

      if (score > bestScore) {

        bestScore = score;

        bestIdx = i;

      }

    }



    // If question matches a known pattern, ALWAYS use template (zero hallucination)

    const qLow = question.toLowerCase();

    const forceTemplate = ['최고', '최소', '가장 빠른', '가장 느린', '평균', 'best', 'worst', 'average', 'fastest', 'slowest', 'vs', '누가 빨라', '비교']

      .some(k => qLow.includes(k));



    let finalAnswer;

    if (forceTemplate) {

      finalAnswer = this._templateFallback(question, dbResult, aggregated);

    } else if (bestScore < 0.8) {

      finalAnswer = this._templateFallback(question, dbResult, aggregated);

    } else {

      finalAnswer = this._codeFactcheck(answers[bestIdx], dbResult, aggregated);

    }



    return { text: finalAnswer };

  }



  _clientAggregate(data) {

    if (!data || data.length === 0) return {};

    const agg = { count: data.length };

    const numCols = ['finish', 'start_time', 'int1', 'int2', 'int3', 'int4', 'speed',

                     'air_temp', 'humidity_pct', 'pressure_hpa', 'wind_speed_ms'];

    for (const col of numCols) {

      const vals = data.map(r => parseFloat(r[col])).filter(v => !isNaN(v) && v > 0);

      if (vals.length > 0) {

        agg[col + '_avg'] = +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(3);

        agg[col + '_min'] = +Math.min(...vals).toFixed(3);

        agg[col + '_max'] = +Math.max(...vals).toFixed(3);

        agg[col + '_count'] = vals.length;

      }

    }

    return agg;

  }



  _templateFallback(question, data, agg) {

    // Zero-LLM fallback: pure template

    const q = (question || '').toLowerCase();

    // Compare pattern: group by athlete_id

    if (q.includes('vs') || q.includes('비교') || q.includes('누가 빨라')) {

      const groups = {};

      for (const row of data) {

        const aid = row.athlete_id || 'unknown';

        if (!groups[aid]) groups[aid] = [];

        groups[aid].push(parseFloat(row.finish));

      }

      const lines = [];

      for (const [aid, finishes] of Object.entries(groups)) {

        const valid = finishes.filter(f => !isNaN(f));

        if (valid.length === 0) continue;

        const avg = (valid.reduce((a, b) => a + b, 0) / valid.length).toFixed(2);

        const best = Math.min(...valid).toFixed(2);

        lines.push({ aid, avg: parseFloat(avg), best: parseFloat(best), count: valid.length });

      }

      lines.sort((a, b) => a.best - b.best);

      let text = lines.map((l, i) => `${i + 1}. ${l.aid}: 최고 ${l.best}초, 평균 ${l.avg}초 (${l.count}건)`).join('\n');

      if (lines.length >= 2) {

        const diff = (lines[1].best - lines[0].best).toFixed(2);

        const aidName = lines[0].aid;

        text += `\n→ ${aidName}${Chatbot._particle(aidName, '이가')} ${diff}초 빠름`;

      }

      return text;

    }

    // Specific question patterns

    if (q.includes('최고') || q.includes('최소') || q.includes('가장 빠른') || q.includes('best')) {

      if (agg.finish_min) {

        const bestRow = data.find(r => parseFloat(r.finish) === agg.finish_min);

        const who = bestRow && bestRow.name ? ` (${bestRow.name})` : '';

        return `최고 기록: ${agg.finish_min}초${who} (총 ${agg.count}건 중)`;

      }

    }

    if (q.includes('평균') || q.includes('average')) {

      if (agg.finish_avg) return `평균 기록: ${agg.finish_avg}초 (총 ${agg.count}건)`;

    }



    let text = `조회 결과: ${agg.count}건`;

    if (agg.finish_avg) text += `\n평균 기록: ${agg.finish_avg}초`;

    if (agg.finish_min) text += `\n최고 기록: ${agg.finish_min}초`;

    if (agg.finish_max) text += `\n최저 기록: ${agg.finish_max}초`;

    if (agg.start_time_avg) text += `\n평균 스타트: ${agg.start_time_avg}초`;

    return text;

  }



  async _llmFactcheck(answer, dbResult, aggregated) {

    const dataSnippet = JSON.stringify(dbResult.slice(0, 5));

    const aggStr = JSON.stringify(aggregated);

    return await this._callLLM([

      { role: 'system', content: `You are a strict factchecker. Compare the ANSWER against the DB DATA and AGGREGATED stats.

Score from 0.0 (all wrong) to 1.0 (all correct).

Check: Are all numbers in the answer present in the data? Is any information fabricated?

Reply with ONLY a number between 0.0 and 1.0.` },

      { role: 'user', content: `ANSWER: ${answer}\n\nDB DATA (sample): ${dataSnippet}\n\nAGGREGATED: ${aggStr}` },

    ]);

  }



  _parseFactScore(result) {

    const match = result.match(/([\d.]+)/);

    return match ? parseFloat(match[1]) : 0;

  }



  _codeFactcheck(answer, dbResult, aggregated) {

    // Extract decimal numbers from answer (e.g. 50.71, 55.335)

    const ansNums = (answer.match(/\d+\.\d+/g) || []).map(Number);

    if (ansNums.length === 0) return answer;



    // Build set of valid numbers from DB + aggregated

    const validNums = new Set();

    for (const row of dbResult) {

      for (const val of Object.values(row)) {

        if (typeof val === 'number') {

          validNums.add(+val.toFixed(3));

          validNums.add(+val.toFixed(2));

          validNums.add(+val.toFixed(1));

        }

      }

    }

    for (const val of Object.values(aggregated)) {

      if (typeof val === 'number') {

        validNums.add(+val.toFixed(3));

        validNums.add(+val.toFixed(2));

        validNums.add(+val.toFixed(1));

      }

    }



    // Check each number in answer — if ANY key number is wrong, reject

    let wrongCount = 0;

    for (const n of ansNums) {

      const rounded = [+n.toFixed(3), +n.toFixed(2), +n.toFixed(1)];

      if (!rounded.some(r => validNums.has(r))) {

        wrongCount++;

      }

    }



    // If ANY decimal number is wrong, fall back to template (strict mode)

    if (wrongCount > 0) {

      return this._templateFallback(this._lastQuestion || '', dbResult, aggregated);

    }

    return answer;

  }



  async _callLLM(messages, temperature = 0, retries = 3) {

    for (let attempt = 0; attempt <= retries; attempt++) {

      try {

        const controller = new AbortController();

        const timeout = setTimeout(() => controller.abort(), 30000);

        const hdrs = { 'Content-Type': 'application/json' };

        if (Chatbot.API_KEY) hdrs['Authorization'] = 'Bearer ' + Chatbot.API_KEY;

        const resp = await fetch(Chatbot.API_URL, {

          method: 'POST',

          headers: hdrs,

          body: JSON.stringify({

            model: Chatbot.MODEL,

            messages,

            max_tokens: 1024,

            temperature,

          }),

          signal: controller.signal,

        });

        clearTimeout(timeout);

        if ((resp.status === 503 || resp.status === 429) && attempt < retries) {

          await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));

          continue;

        }

        if (!resp.ok) throw new Error('LLM API error: ' + resp.status);

        const data = await resp.json();

        return data.choices[0].message.content.trim();

      } catch (e) {

        if (attempt >= retries) throw e;

        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));

      }

    }

  }



  async _classifyIntent(question) {

    const resp = await this._callLLM([

      { role: 'system', content: `You classify user questions about sliding sports (skeleton/luge/bobsled) into categories.

Categories: record_query, player_compare, environment_analysis, prediction, coaching, out_of_scope

- If the input is just a player name (e.g. "여찬혁", "김지수"), classify as record_query.

- If it's about weather/temperature/humidity, classify as environment_analysis.

- If it asks to compare two or more players, classify as player_compare.
- If it is about improving performance, winning medals, training tips, coaching advice, how to get faster, role models, benchmark players, or who to learn from, classify as coaching.

Reply with ONLY the category name.` },

      { role: 'user', content: question },

    ]);

    const cat = resp.toLowerCase().trim();

    if (cat.includes('out_of_scope')) return 'out_of_scope';

    return cat;

  }



  async _generateSQL(question, tables, temperature) {

    const prompt = Chatbot.SCHEMA_PROMPT + `\n\nCurrent sport tables: ${tables.records}, ${tables.athletes}

The user's sport is: ${this.sport}



User question: ${question}



Generate a single SELECT SQL query:`;



    const resp = await this._callLLM([

      { role: 'system', content: prompt },

      { role: 'user', content: question },

    ], temperature);



    // Extract SQL from response

    let sql = resp;

    const match = sql.match(/```sql?\s*([\s\S]*?)```/);

    if (match) sql = match[1].trim();

    sql = sql.replace(/^sql\s*/i, '').trim();

    if (sql.endsWith(';')) sql = sql.slice(0, -1).trim();

    return sql;

  }



  _validateSQL(sql, tables) {

    if (!sql) return false;

    const upper = sql.toUpperCase().trim();



    // Must be SELECT

    if (!upper.startsWith('SELECT')) return false;



    // Block dangerous keywords

    const blocked = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE', 'TRUNCATE', 'EXEC', 'EXECUTE', '--', '/*'];

    for (const b of blocked) {

      if (upper.includes(b)) return false;

    }



    // Must reference allowed tables

    const allowedTables = [tables.records, tables.athletes, 'skeleton_records', 'luge_records', 'bobsled_records', 'athletes', 'luge_athletes', 'bobsled_athletes'];

    const hasTable = allowedTables.some(t => upper.includes(t.toUpperCase()));

    if (!hasTable) return false;



    return true;

  }



  // Inject mandatory filters into SQL (post-validation)

  _injectFilters(sql, tables) {

    const upper = sql.toUpperCase();

    // Only inject into record tables (not athlete tables)

    const isRecordQuery = [tables.records, 'skeleton_records', 'luge_records', 'bobsled_records']

      .some(t => upper.includes(t.toUpperCase()));

    if (!isRecordQuery) return sql;



    const filters = [];

    if (!upper.includes("STATUS")) filters.push("status = 'OK'");

    // Sport-specific normal finish range

    const range = this.sport === 'skeleton' ? [50, 60] : [45, 65];

    if (!upper.includes("FINISH >") && !upper.includes("FINISH BETWEEN") && !upper.includes("FINISH <")) {

      filters.push(`finish BETWEEN ${range[0]} AND ${range[1]}`);

    }



    if (filters.length === 0) return sql;



    const injection = filters.join(' AND ');

    if (upper.includes('WHERE')) {

      // Append to existing WHERE

      return sql.replace(/WHERE\s+/i, `WHERE ${injection} AND `);

    } else {

      // Insert WHERE before ORDER/LIMIT/GROUP or at end

      const insertPoint = sql.search(/\s+(ORDER|LIMIT|GROUP)\s+/i);

      if (insertPoint > 0) {

        return sql.slice(0, insertPoint) + ` WHERE ${injection}` + sql.slice(insertPoint);

      }

      return sql + ` WHERE ${injection}`;

    }

  }



  _pickConsensus(sqls) {

    // Normalize and count

    const normalized = sqls.map(s => s.replace(/\s+/g, ' ').toLowerCase().trim());

    const counts = {};

    normalized.forEach((s, i) => {

      counts[s] = counts[s] || { count: 0, idx: i };

      counts[s].count++;

    });

    // Pick most frequent

    let best = null;

    for (const key of Object.keys(counts)) {

      if (!best || counts[key].count > counts[best].count) best = key;

    }

    return sqls[counts[best].idx];

  }



  async _executeSQL(sql, tables) {

    // Convert SQL to Supabase REST API call

    // Simple approach: use RPC or direct REST with query params

    // For complex SQL, we parse and build REST URL



    try {

      // Try to convert simple SQL to REST

      const restUrl = this._sqlToRest(sql, tables);

      if (restUrl) {

        const resp = await fetch(restUrl, {

          headers: {

            'apikey': Chatbot.SUPABASE_KEY,

            'Authorization': 'Bearer ' + Chatbot.SUPABASE_KEY,

          },

        });

        if (resp.ok) return await resp.json();

      }

    } catch (e) {

      console.warn('REST conversion failed, trying alternative:', e);

    }



    // Fallback: ask LLM to convert to REST URL

    const restPrompt = `Convert this SQL to a Supabase REST API URL.

Base: ${Chatbot.SUPABASE_URL}/rest/v1/

SQL: ${sql}

Rules:

- Use ?select= for columns

- Use &column=eq.value for WHERE

- Use &order=column.desc for ORDER BY

- Use &limit=N for LIMIT

- For aggregates like COUNT/AVG, just select all matching rows (we compute client-side)

Reply with ONLY the URL path after /rest/v1/ (no base URL):`;



    const urlPath = await this._callLLM([

      { role: 'system', content: restPrompt },

      { role: 'user', content: sql },

    ]);



    const cleanPath = urlPath.replace(/```/g, '').replace(/^\/rest\/v1\//,'').replace(/^https?:\/\/[^/]+\/rest\/v1\//,'').trim();

    const fullUrl = `${Chatbot.SUPABASE_URL}/rest/v1/${cleanPath}`;



    const resp = await fetch(fullUrl, {

      headers: {

        'apikey': Chatbot.SUPABASE_KEY,

        'Authorization': 'Bearer ' + Chatbot.SUPABASE_KEY,

      },

    });

    if (!resp.ok) throw new Error('DB query failed: ' + resp.status);

    return await resp.json();

  }



  _sqlToRest(sql, tables) {

    // Simple SQL parser for common patterns

    const upper = sql.toUpperCase();

    const lower = sql.toLowerCase();



    // Extract table name

    const fromMatch = sql.match(/FROM\s+(\w+)/i);

    if (!fromMatch) return null;

    const table = fromMatch[1];



    // Extract select columns

    const selectMatch = sql.match(/SELECT\s+([\s\S]+?)\s+FROM/i);

    if (!selectMatch) return null;

    let selectCols = selectMatch[1].trim();

    if (selectCols === '*') selectCols = '*';



    let url = `${Chatbot.SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(selectCols)}`;



    // WHERE clauses

    const whereMatch = sql.match(/WHERE\s+([\s\S]+?)(?:\s+ORDER|\s+LIMIT|\s+GROUP|\s*$)/i);

    if (whereMatch) {

      let whereStr = whereMatch[1];



      // Handle OR groups: (col ILIKE 'A%' OR col ILIKE 'B%')

      const orGroupMatch = whereStr.match(/\(([^)]+\s+OR\s+[^)]+)\)/i);

      if (orGroupMatch) {

        const orParts = orGroupMatch[1].split(/\s+OR\s+/i);

        const orFilters = [];

        for (const part of orParts) {

          const m = part.trim().match(/(\w+)\s+ILIKE\s+'([^']+)'/i);

          if (m) {

            const val = m[2].replace(/%/g, '*');

            orFilters.push(`${m[1]}.ilike.${val}`);

          }

        }

        if (orFilters.length > 0) {

          url += `&or=(${orFilters.join(',')})`;

        }

        // Remove the OR group from whereStr so AND parsing doesn't break

        whereStr = whereStr.replace(orGroupMatch[0], '').replace(/^\s*AND\s+/i, '').replace(/\s+AND\s*$/i, '').trim();

      }



      const conditions = whereStr ? whereStr.split(/\s+AND\s+/i).filter(c => c.trim()) : [];

      for (const cond of conditions) {

        const eqMatch = cond.match(/(\w+)\s*=\s*'([^']+)'/i);

        if (eqMatch) {

          url += `&${eqMatch[1]}=eq.${encodeURIComponent(eqMatch[2])}`;

          continue;

        }

        const eqNumMatch = cond.match(/(\w+)\s*=\s*(\d+\.?\d*)/i);

        if (eqNumMatch) {

          url += `&${eqNumMatch[1]}=eq.${eqNumMatch[2]}`;

          continue;

        }

        const gtMatch = cond.match(/(\w+)\s*>\s*(\d+\.?\d*)/i);

        if (gtMatch) {

          url += `&${gtMatch[1]}=gt.${gtMatch[2]}`;

          continue;

        }

        const ltMatch = cond.match(/(\w+)\s*<\s*(\d+\.?\d*)/i);

        if (ltMatch) {

          url += `&${ltMatch[1]}=lt.${ltMatch[2]}`;

          continue;

        }

        const gteMatch = cond.match(/(\w+)\s*>=\s*(\d+\.?\d*)/i);

        if (gteMatch) {

          url += `&${gteMatch[1]}=gte.${gteMatch[2]}`;

          continue;

        }

        const lteMatch = cond.match(/(\w+)\s*<=\s*(\d+\.?\d*)/i);

        if (lteMatch) {

          url += `&${lteMatch[1]}=lte.${lteMatch[2]}`;

          continue;

        }

        const likeMatch = cond.match(/(\w+)\s+LIKE\s+'%([^']+)%'/i);

        if (likeMatch) {

          url += `&${likeMatch[1]}=ilike.*${encodeURIComponent(likeMatch[2])}*`;

          continue;

        }

        // ILIKE 'prefix%'

        const ilikePrefixMatch = cond.match(/(\w+)\s+ILIKE\s+'([^']+)%'/i);

        if (ilikePrefixMatch) {

          url += `&${ilikePrefixMatch[1]}=ilike.${encodeURIComponent(ilikePrefixMatch[2])}*`;

          continue;

        }

        // ILIKE '%text%'

        const ilikeMatch = cond.match(/(\w+)\s+ILIKE\s+'%([^']+)%'/i);

        if (ilikeMatch) {

          url += `&${ilikeMatch[1]}=ilike.*${encodeURIComponent(ilikeMatch[2])}*`;

          continue;

        }

        const notNullMatch = cond.match(/(\w+)\s+IS\s+NOT\s+NULL/i);

        if (notNullMatch) {

          url += `&${notNullMatch[1]}=not.is.null`;

          continue;

        }

        // BETWEEN

        const betweenMatch = cond.match(/(\w+)\s+BETWEEN\s+(\d+\.?\d*)\s+AND\s+(\d+\.?\d*)/i);

        if (betweenMatch) {

          url += `&${betweenMatch[1]}=gte.${betweenMatch[2]}&${betweenMatch[1]}=lte.${betweenMatch[3]}`;

          continue;

        }

      }

    }



    // ORDER BY

    const orderMatch = sql.match(/ORDER\s+BY\s+(\w+)(?:\s+(ASC|DESC))?/i);

    if (orderMatch) {

      const dir = (orderMatch[2] || 'ASC').toLowerCase() === 'desc' ? '.desc' : '';

      url += `&order=${orderMatch[1]}${dir}`;

    }



    // LIMIT

    const limitMatch = sql.match(/LIMIT\s+(\d+)/i);

    url += `&limit=${limitMatch ? Math.min(parseInt(limitMatch[1]), 50) : 50}`;



    return url;

  }



  async _generateAnswer(question, dbResult, sql, aggregated, temperature = 0) {

    const dataStr = JSON.stringify(dbResult.slice(0, 15));

    const totalRows = dbResult.length;

    const aggStr = aggregated ? JSON.stringify(aggregated) : '';



    const resp = await this._callLLM([

      { role: 'system', content: `You are a sports data analyst assistant. Answer in Korean.

CRITICAL RULES:

1. ONLY use numbers from the DB result and AGGREGATED stats below. NEVER invent data.

2. For "평균", "최고", "최저" — use the pre-computed AGGREGATED values (they are exact).

3. Keep answers concise (2-4 sentences).

4. Always mention exact numbers from the data.

5. Do NOT add opinions, predictions, or info not in the data.

6. If data is insufficient, say "데이터가 부족합니다".` },

      { role: 'user', content: `Question: ${question}\n\nDB Result (${totalRows} rows, sample):\n${dataStr}\n\nAGGREGATED STATS:\n${aggStr}\n\nAnswer:` },

    ], temperature);



    return resp;

  }



  _factcheck(answer, dbResult) {

    // Extract all numbers from answer

    const answerNums = answer.match(/\d+\.?\d*/g) || [];



    // Extract all numbers from DB result

    const dbNums = new Set();

    for (const row of dbResult) {

      for (const val of Object.values(row)) {

        if (typeof val === 'number') {

          dbNums.add(val.toString());

          dbNums.add(val.toFixed(1));

          dbNums.add(val.toFixed(2));

          dbNums.add(val.toFixed(3));

          dbNums.add(Math.round(val).toString());

        }

        if (typeof val === 'string' && /^\d+\.?\d*$/.test(val)) {

          dbNums.add(val);

        }

      }

    }

    // Add count

    dbNums.add(dbResult.length.toString());



    // Check: allow common numbers (years, counts, percentages derived from data)

    // Strict mode: flag if a decimal number in answer isn't in DB

    // (relaxed for integers < 100 which could be counts/rankings)



    return answer; // For now, return as-is (factcheck logging only)

  }



  static DISPLAY_COLS = {

    date: '날짜', finish: '기록(초)', start_time: '스타트(초)',

    int1: 'Int.1', int2: 'Int.2', int3: 'Int.3', int4: 'Int.4',

    speed: '속도', athlete_id: '선수ID',

    air_temp: '기온', humidity_pct: '습도', pressure_hpa: '기압',

    wind_speed_ms: '풍속',

  };





  async _fetchKMAWeather() {

    const KMA_KEY = 'ncpn3dPgT5OKZ93T4D-TJw';

    const now = new Date();

    const kst = new Date(now.getTime() + 9 * 3600000 - 2 * 60000);

    const tm2 = kst.toISOString().replace(/[-T:]/g, '').slice(0, 12);

    const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';

    const base = isLocal ? 'https://apihub.kma.go.kr/api' : '/api/kma';

    const url = base + '/typ01/cgi-bin/url/nph-aws2_min?tm2=' + tm2 + '&stn=100&disp=0&help=0&authKey=' + KMA_KEY;

    const resp = await fetch(url);

    if (!resp.ok) throw new Error('KMA ' + resp.status);

    const text = await resp.text();

    const lines = text.split(String.fromCharCode(10));

    const dataLine = lines.find(l => l.trim() && !l.startsWith('#'));

    if (!dataLine) return null;

    const c = dataLine.trim().split(/\s+/);

    const v = s => { const n = parseFloat(s); return (!isNaN(n) && n > -90) ? n : null; };

    return { time: c[0], station: '대관령 (평창)', air_temp_c: v(c[8]), humidity_pct: v(c[14]), pressure_hpa: v(c[15]), dewpoint_c: v(c[17]), wind_dir_deg: v(c[2]), wind_speed_ms: v(c[3]), wind_gust_ms: v(c[5]) };

  }

  _buildTable(data) {

    if (!data || data.length === 0) return '';

    // Show only key columns that exist in data

    const allCols = Object.keys(data[0]);

    const priority = ['date', 'athlete_id', 'finish', 'start_time', 'int1', 'int2', 'int3', 'int4', 'speed', 'air_temp', 'humidity_pct'];

    const cols = priority.filter(c => allCols.includes(c));

    if (cols.length === 0) return '';



    const maxRows = Math.min(data.length, 10);

    let html = '<table class="chatbot-table"><thead><tr>';

    for (const c of cols) html += `<th>${Chatbot.DISPLAY_COLS[c] || c}</th>`;

    html += '</tr></thead><tbody>';

    for (let i = 0; i < maxRows; i++) {

      html += '<tr>';

      for (const c of cols) {

        const v = data[i][c];

        html += `<td>${v != null ? this._escHtml(String(v)) : '-'}</td>`;

      }

      html += '</tr>';

    }

    html += '</tbody></table>';

    if (data.length > 10) html += `<div class="chatbot-more">... 외 ${data.length - 10}건</div>`;

    return html;

  }

}



// Auto-init

document.addEventListener('DOMContentLoaded', () => {

  window._chatbot = new Chatbot();





























































});

