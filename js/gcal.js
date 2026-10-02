// 구글 캘린더 연동.
// - "링 계획표" 전용 캘린더와 양방향 동기화한다 (이 앱이 만든 캘린더에만 쓴다).
// - 다른 캘린더의 일정은 읽기만 해서 링 안쪽에 얇게 표시한다.
// 블록의 동기화 상태: gid(구글 이벤트 id), sy('ok' | 'dirty' | 없음=아직 안 올림)
(function () {
  const RP = window.RP;
  const S = RP.store;
  const DAY = S.DAY;
  const CLIENT_ID = '243594612511-6ltb0tfuqcv1l0vujo6jg1rd6olif7pi.apps.googleusercontent.com';
  const SCOPES = [
    'https://www.googleapis.com/auth/calendar.app.created',
    'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
    'https://www.googleapis.com/auth/calendar.events.readonly',
  ];
  const API = 'https://www.googleapis.com/calendar/v3';
  const RING_NAME = '링 계획표';
  const TOKEN_KEY = 'ringplan.gtoken';
  const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const pad = (n) => String(n).padStart(2, '0');
  const settings = () => S.state.settings;

  let token = null; // { token, exp }
  let tokenClient = null;
  let gisPromise = null;
  let calendars = []; // 링 캘린더를 뺀 나머지 [{ id, name, color }]
  let calendarsLoaded = false;
  let ext = {}; // 날짜 -> { items:[{title,s,e,color,cal}], allDay:[{title,cal,color}] }
  let running = false;
  let queued = null;
  let status = { state: 'off', text: '' };
  let cb = { onChange() {}, onStatus() {} };

  function setStatus(state, text) {
    status = { state, text: text || '', at: Date.now() };
    if (state === 'expired') armAutoRenew();
    cb.onStatus();
  }

  // 연결은 1시간마다 만료된다. 로그인 창은 사용자의 클릭 안에서만 열 수 있으므로,
  // 만료 뒤 화면을 처음 누르는 순간에 자동으로 다시 연결한다 (실패하면 버튼으로 남긴다).
  let armed = false;
  let autoTried = false;
  let expiryTimer = null;
  function armAutoRenew() {
    if (armed || autoTried || !settings().gcal) return;
    armed = true;
    document.addEventListener(
      'click',
      function handler(ev) {
        document.removeEventListener('click', handler, true);
        armed = false;
        autoTried = true;
        if (!ev.target.closest('#gBtn')) connect();
      },
      true
    );
  }
  function watchExpiry() {
    clearTimeout(expiryTimer);
    if (!token) return;
    expiryTimer = setTimeout(() => {
      if (!tokenValid() && settings().gcal) setStatus('expired');
    }, Math.max(0, token.exp - Date.now() - 20000));
  }

  // ---------- 인증 ----------
  function loadToken() {
    try {
      const t = JSON.parse(localStorage.getItem(TOKEN_KEY));
      if (t && t.exp > Date.now() + 60000) return t;
    } catch (e) {}
    return null;
  }

  function tokenValid() {
    if (token && token.exp <= Date.now() + 30000) token = null;
    return !!token;
  }

  function loadGis() {
    if (!gisPromise) {
      gisPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://accounts.google.com/gsi/client';
        s.onload = resolve;
        s.onerror = () => {
          gisPromise = null;
          reject(new Error('구글 로그인 스크립트를 불러오지 못했습니다.'));
        };
        document.head.appendChild(s);
      });
    }
    return gisPromise;
  }

  function onToken(resp) {
    if (resp.error) return setStatus('error', '구글 연결에 실패했습니다: ' + resp.error);
    if (!google.accounts.oauth2.hasGrantedAllScopes(resp, ...SCOPES)) {
      return setStatus('error', '권한 화면에서 항목을 모두 체크해야 연동됩니다. 다시 연결해 주세요.');
    }
    token = { token: resp.access_token, exp: Date.now() + resp.expires_in * 1000 };
    try {
      localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
    } catch (e) {}
    S.setSetting('gcal', true);
    autoTried = false;
    watchExpiry();
    calendarsLoaded = false;
    sync(cb.currentKey());
  }

  async function connect() {
    try {
      await loadGis();
    } catch (e) {
      return setStatus('error', e.message);
    }
    if (!tokenClient) {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES.join(' '),
        callback: onToken,
        error_callback: (err) => setStatus(settings().gcal ? 'expired' : 'off', err && err.type === 'popup_failed_to_open' ? '팝업이 차단되었습니다. 팝업을 허용해 주세요.' : ''),
      });
    }
    // 계정을 미리 알려 주면 계정 선택 화면 없이 바로 이어진다.
    const email = settings().gEmail;
    tokenClient.requestAccessToken(email ? { prompt: '', login_hint: email } : { prompt: '' });
  }

  function disconnect() {
    if (token && window.google) {
      try {
        google.accounts.oauth2.revoke(token.token, () => {});
      } catch (e) {}
    }
    token = null;
    localStorage.removeItem(TOKEN_KEY);
    S.setSetting('gcal', false);
    calendars = [];
    calendarsLoaded = false;
    ext = {};
    setStatus('off');
    cb.onChange();
  }

  // ---------- API ----------
  async function api(path, opts) {
    opts = opts || {};
    if (!tokenValid()) {
      setStatus('expired');
      throw Object.assign(new Error('구글 연결이 만료되었습니다.'), { status: 401 });
    }
    const res = await fetch(API + path, {
      method: opts.method || 'GET',
      headers: Object.assign({ Authorization: 'Bearer ' + token.token }, opts.body ? { 'Content-Type': 'application/json' } : {}),
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (res.status === 401) {
      token = null;
      localStorage.removeItem(TOKEN_KEY);
      setStatus('expired');
      throw Object.assign(new Error('구글 연결이 만료되었습니다.'), { status: 401 });
    }
    if (!res.ok) {
      let msg = res.status + '';
      try {
        msg = (await res.json()).error.message || msg;
      } catch (e) {}
      throw Object.assign(new Error(msg), { status: res.status });
    }
    return res.status === 204 ? null : res.json();
  }

  const calPath = (id) => '/calendars/' + encodeURIComponent(id);

  async function listEvents(calId, tMin, tMax) {
    const out = [];
    let pageToken = '';
    do {
      const q = new URLSearchParams({ timeMin: tMin.toISOString(), timeMax: tMax.toISOString(), singleEvents: 'true', maxResults: '250', orderBy: 'startTime' });
      if (pageToken) q.set('pageToken', pageToken);
      const r = await api(`${calPath(calId)}/events?${q}`);
      out.push(...(r.items || []));
      pageToken = r.nextPageToken || '';
    } while (pageToken);
    return out;
  }

  // 캘린더 목록을 읽고, 링 전용 캘린더가 없으면 만든다.
  async function ensureCalendars() {
    const all = [];
    let pageToken = '';
    do {
      const r = await api('/users/me/calendarList?maxResults=250' + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''));
      all.push(...(r.items || []));
      pageToken = r.nextPageToken || '';
    } while (pageToken);

    let ring = all.find((c) => c.id === settings().gcalId) || all.find((c) => c.summary === RING_NAME && c.accessRole === 'owner');
    let ringId = ring && ring.id;
    if (!ringId) ringId = (await api('/calendars', { method: 'POST', body: { summary: RING_NAME, timeZone: TZ } })).id;

    if (ringId !== settings().gcalId) {
      // 다른 캘린더에 연결되었으므로 예전 동기화 기록은 버린다 (로컬 일정은 새로 올라간다).
      for (const key of Object.keys(S.state.days)) {
        for (const b of S.state.days[key]) {
          delete b.sy;
          delete b.gid;
        }
      }
      S.state.tomb = [];
      S.setSetting('gcalId', ringId);
    }
    const primary = all.find((c) => c.primary);
    if (primary && primary.id !== settings().gEmail) S.setSetting('gEmail', primary.id);
    calendars = all.filter((c) => c.id !== ringId).map((c) => ({ id: c.id, name: c.summaryOverride || c.summary, color: c.backgroundColor || '#8D99AE' }));
    calendarsLoaded = true;
  }

  // ---------- 링 캘린더 양방향 동기화 ----------
  const newGid = () => 'rp' + Array.from(crypto.getRandomValues(new Uint8Array(12)), (x) => pad(x.toString(16))).join('');

  function eventBody(key, b) {
    const st = S.parseKey(key);
    st.setMinutes(b.start);
    const en = new Date(st.getTime() + b.dur * 60000);
    const iso = (d) => `${S.dateKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
    return {
      summary: b.title,
      start: { dateTime: iso(st), timeZone: TZ },
      end: { dateTime: iso(en), timeZone: TZ },
      extendedProperties: { private: { rpColor: b.color, rpTodo: b.todoId || '' } },
    };
  }

  async function push(ringId, key, b) {
    const rev = b.rev || 0;
    const body = eventBody(key, b);
    const patch = () => api(`${calPath(ringId)}/events/${b.gid}`, { method: 'PATCH', body });
    try {
      if (b.sy) await patch();
      else {
        if (!b.gid) {
          b.gid = newGid();
          S.save();
        }
        try {
          await api(`${calPath(ringId)}/events`, { method: 'POST', body: Object.assign({ id: b.gid }, body) });
        } catch (e) {
          if (e.status !== 409) throw e;
          await patch(); // 이미 올라가 있던 경우
        }
      }
    } catch (e) {
      if (e.status === 404 || e.status === 410) {
        // 구글 쪽에서 사라진 이벤트: 다음 동기화에서 새로 올린다.
        delete b.sy;
        delete b.gid;
        S.save();
      }
      throw e;
    }
    b.sy = (b.rev || 0) === rev ? 'ok' : 'dirty';
    S.save();
  }

  async function syncRing(key) {
    const ringId = settings().gcalId;
    const prev = S.addDays(key, -1);
    const days = [prev, key];
    const events = await listEvents(ringId, S.parseKey(prev), S.parseKey(S.addDays(key, 1)));

    const remote = new Map();
    for (const ev of events) {
      if (ev.status === 'cancelled' || !ev.start || !ev.start.dateTime || !ev.end || !ev.end.dateTime) continue;
      const st = new Date(ev.start.dateTime);
      const k = S.dateKey(st);
      if (!days.includes(k)) continue;
      const priv = (ev.extendedProperties && ev.extendedProperties.private) || {};
      remote.set(ev.id, {
        key: k,
        title: ev.summary || '(제목 없음)',
        start: st.getHours() * 60 + st.getMinutes(),
        dur: Math.max(5, Math.min(DAY, Math.round((new Date(ev.end.dateTime) - st) / 60000))),
        color: /^#[0-9a-fA-F]{6}$/.test(priv.rpColor || '') ? priv.rpColor : null,
        todoId: priv.rpTodo || null,
      });
    }

    // 목록을 받은 직후의 로컬 상태로 한 번에 판단하고, 올릴 것만 뒤에서 순서대로 보낸다.
    const tasks = [];
    const locals = [];
    for (const d of days) for (const b of S.ownBlocks(d)) locals.push([d, b]);
    for (const [d, b] of locals) {
      if (!(b.sy && b.gid)) {
        tasks.push(() => push(ringId, d, b));
        continue;
      }
      const r = remote.get(b.gid);
      if (!r) {
        S.dropBlock(d, b.id); // 구글에서 삭제된 일정
        continue;
      }
      remote.delete(b.gid);
      if (b.sy === 'dirty') {
        tasks.push(() => push(ringId, d, b));
        continue;
      }
      b.title = r.title;
      b.start = r.start;
      b.dur = r.dur;
      if (r.color) b.color = r.color;
      if (r.key !== d) {
        S.dropBlock(d, b.id);
        S.insertBlock(r.key, b);
      }
    }
    const tomb = new Set(S.state.tomb);
    for (const [gid, r] of remote) {
      if (tomb.has(gid)) continue;
      const block = { id: S.uid(), gid, sy: 'ok', title: r.title, start: r.start, dur: r.dur, color: r.color || S.nextColor(r.key) };
      if (r.todoId && S.todo(r.todoId)) block.todoId = r.todoId;
      S.insertBlock(r.key, block);
    }
    for (const gid of tomb) {
      tasks.push(async () => {
        try {
          await api(`${calPath(ringId)}/events/${gid}`, { method: 'DELETE' });
        } catch (e) {
          if (e.status !== 404 && e.status !== 410) throw e;
        }
        S.state.tomb = S.state.tomb.filter((x) => x !== gid);
        S.save();
      });
    }
    S.save();

    let firstError = null;
    for (const t of tasks) {
      try {
        await t();
      } catch (e) {
        firstError = firstError || e;
        if (e.status === 401) break;
      }
    }
    if (firstError) throw firstError;
  }

  // ---------- 다른 캘린더 (읽기 전용) ----------
  async function loadExternal(key) {
    const hidden = settings().hiddenCals;
    const from = S.parseKey(key), to = S.parseKey(S.addDays(key, 1));
    const items = [], allDay = [];
    await Promise.all(
      calendars
        .filter((c) => !hidden.includes(c.id))
        .map(async (c) => {
          let events;
          try {
            events = await listEvents(c.id, from, to);
          } catch (e) {
            if (e.status === 401) throw e;
            return; // 읽을 수 없는 캘린더는 건너뛴다
          }
          for (const ev of events) {
            if (ev.status === 'cancelled' || !ev.start) continue;
            const title = ev.summary || '(제목 없음)';
            if (!ev.start.dateTime) {
              allDay.push({ title, cal: c.name, color: c.color });
              continue;
            }
            const s = Math.round((new Date(ev.start.dateTime) - from) / 60000);
            const e = Math.round((new Date(ev.end.dateTime) - from) / 60000);
            if (e > 0 && s < DAY && e > s) items.push({ title, s, e, color: c.color, cal: c.name });
          }
        })
    );
    items.sort((a, b) => a.s - b.s);
    ext[key] = { items, allDay };
  }

  // ---------- 진입점 ----------
  async function sync(key, refreshCalendars) {
    if (!settings().gcal) return;
    if (!tokenValid()) return setStatus('expired');
    if (running) {
      queued = key;
      return;
    }
    running = true;
    setStatus('syncing');
    try {
      if (!calendarsLoaded || refreshCalendars) await ensureCalendars();
      await syncRing(key);
      await loadExternal(key);
      setStatus('ok');
    } catch (e) {
      console.warn('구글 캘린더 동기화 실패', e);
      if (status.state !== 'expired') setStatus('error', '동기화 실패: ' + e.message);
    }
    running = false;
    cb.onChange();
    if (queued) {
      const k = queued;
      queued = null;
      sync(k);
    }
  }

  function init(callbacks) {
    cb = callbacks;
    token = loadToken();
    watchExpiry();
    if (settings().gcal) setStatus(token ? 'idle' : 'expired');
    // 연결 버튼을 누른 즉시 로그인 창을 띄울 수 있도록 미리 불러 둔다.
    loadGis().catch(() => {});
  }

  RP.gcal = {
    init,
    connect,
    disconnect,
    sync,
    get status() {
      return status;
    },
    get calendars() {
      return calendars;
    },
    externals: (key) => ext[key] || { items: [], allDay: [] },
  };
})();
