// Todoist 연동: 자체 할 일 목록과 Todoist의 진행 중인 모든 작업을 양방향으로 맞춘다.
// 할 일의 연동 상태: tid(Todoist 작업 id), tsy('ok' | 'dirty')
// 링에 배치한 시간은 Todoist 작업 설명의 "[링 계획표] …" 줄에 적는다.
(function () {
  const RP = window.RP;
  const S = RP.store;
  const API = 'https://api.todoist.com/api/v1';
  const TOKEN_KEY = 'ringplan.todoist';
  const MARK = '[링 계획표]';

  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (m) => {
    m = ((m % S.DAY) + S.DAY) % S.DAY;
    return pad(Math.floor(m / 60)) + ':' + pad(m % 60);
  };

  let token = '';
  let status = { state: 'off', text: '' };
  let cb = { onChange() {}, onStatus() {} };
  let running = false;
  let again = null;
  let last = 0;

  function setStatus(state, text) {
    status = { state, text: text || '' };
    cb.onStatus();
  }

  async function api(path, opts) {
    opts = opts || {};
    const res = await fetch(API + path, {
      method: opts.method || 'GET',
      headers: Object.assign({ Authorization: 'Bearer ' + token }, opts.body ? { 'Content-Type': 'application/json' } : {}),
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (!res.ok) {
      let msg = String(res.status);
      try {
        msg = (await res.text()).slice(0, 200) || msg;
      } catch (e) {}
      throw Object.assign(new Error(msg), { status: res.status });
    }
    const text = res.status === 204 ? '' : await res.text();
    return text ? JSON.parse(text) : null;
  }

  async function listTasks() {
    const out = [];
    let cursor = '';
    do {
      const r = await api('/tasks?limit=200' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
      if (Array.isArray(r)) {
        out.push(...r);
        cursor = '';
      } else {
        out.push(...((r && r.results) || []));
        cursor = (r && r.next_cursor) || '';
      }
    } while (cursor);
    return out;
  }

  const dueOf = (r) => (r.due && r.due.date ? String(r.due.date).slice(0, 10) : null);

  // 설명에 넣을 시간 줄. 오늘 이후 배치를 적고, 없으면 가장 최근 것을 남긴다.
  function timeLine(placed) {
    if (!placed || !placed.length) return '';
    const today = S.dateKey(new Date());
    let list = placed.filter((p) => p.date >= today);
    if (!list.length) list = [placed[placed.length - 1]];
    return MARK + ' ' + list.map((p) => `${p.date} ${fmt(p.start)}–${fmt(p.start + p.dur)}`).join(', ');
  }

  // 사용자가 쓴 설명은 그대로 두고 우리 줄만 바꾼다.
  function withLine(desc, line) {
    const rest = (desc || '')
      .split('\n')
      .filter((l) => !l.startsWith(MARK))
      .join('\n')
      .replace(/\s+$/, '');
    return line ? (rest ? rest + '\n\n' + line : line) : rest;
  }

  async function create(t, line) {
    const body = { content: t.title };
    if (t.due) body.due_date = t.due;
    if (line) body.description = line;
    const r = await api('/tasks', { method: 'POST', body });
    Object.assign(live(t), { tid: String(r.id), tsy: 'ok', mod: Date.now() });
  }

  // 요청을 기다리는 사이 구글 쪽 병합으로 할 일 객체가 바뀔 수 있어, 결과는 항상 현재 객체에 적는다.
  const live = (t) => S.todo(t.id) || t;

  // 로컬에서 바뀐 할 일을 Todoist에 반영한다. r 은 Todoist의 진행 중 작업(없으면 완료·삭제된 상태).
  async function pushTodo(t, r, line) {
    const rev = t.mod;
    const fields = (remote) => {
      const body = {};
      if (!remote || t.title !== remote.content) body.content = t.title;
      if (!remote || t.due !== dueOf(remote)) {
        if (t.due) body.due_date = t.due;
        else if (remote) body.due_string = 'no date';
      }
      const desc = withLine(remote ? remote.description : '', line);
      if (remote && desc !== (remote.description || '')) body.description = desc;
      return body;
    };
    try {
      if (r) {
        const body = fields(r);
        if (Object.keys(body).length) await api('/tasks/' + t.tid, { method: 'POST', body });
        if (t.done) await api(`/tasks/${t.tid}/close`, { method: 'POST' });
      } else if (!t.done) {
        await api(`/tasks/${t.tid}/reopen`, { method: 'POST' });
        await api('/tasks/' + t.tid, { method: 'POST', body: fields(null) });
      }
    } catch (e) {
      if (e.status !== 404) throw e;
      // Todoist에서 지워진 작업: 연결을 끊어 두면 다음 동기화에서 새로 만든다.
      const gone = live(t);
      delete gone.tid;
      delete gone.tsy;
      gone.mod = Date.now();
      return;
    }
    const now = live(t);
    if (now.mod === rev) Object.assign(now, { tsy: 'ok', mod: Date.now() });
  }

  async function reconcile() {
    const tasks = await listTasks();
    const remote = new Map(tasks.filter((r) => !r.checked && !r.is_deleted).map((r) => [String(r.id), r]));
    const jobs = [];
    const before = JSON.stringify(S.state.todos);

    // 같은 Todoist 작업에 묶인 할 일이 둘이면(두 기기가 동시에 받아온 경우) 하나로 합친다.
    const byTid = new Map();
    for (const t of S.state.todos.slice()) {
      if (!t.tid) continue;
      const other = byTid.get(t.tid);
      if (!other) {
        byTid.set(t.tid, t);
        continue;
      }
      const keep = other.id.startsWith('td') && !t.id.startsWith('td') ? t : other;
      const drop = keep === other ? t : other;
      byTid.set(t.tid, keep);
      S.dropTodo(drop.id, keep.id);
    }

    for (const tid of S.state.ttomb.slice()) {
      remote.delete(tid);
      jobs.push(async () => {
        try {
          await api('/tasks/' + tid, { method: 'DELETE' });
        } catch (e) {
          if (e.status !== 404) throw e;
        }
        S.state.ttomb = S.state.ttomb.filter((x) => x !== tid);
      });
    }

    const sched = S.todoSchedule();
    for (const t of S.state.todos) {
      const line = timeLine(sched[t.id]);
      if (!t.tid) {
        if (!t.done) jobs.push(() => create(t, line));
        continue;
      }
      const r = remote.get(t.tid);
      remote.delete(t.tid);
      if (t.tsy === 'dirty') {
        jobs.push(() => pushTodo(t, r, line));
      } else if (r) {
        const due = dueOf(r);
        if (t.title !== r.content || t.due !== due || t.done) Object.assign(t, { title: r.content, due, done: false, mod: Date.now() });
        const desc = withLine(r.description, line);
        if (desc !== (r.description || '')) jobs.push(() => api('/tasks/' + t.tid, { method: 'POST', body: { description: desc } }));
      } else if (!t.done) {
        Object.assign(t, { done: true, mod: Date.now() }); // Todoist에서 완료(또는 삭제)됨
      }
    }

    for (const [tid, r] of remote) {
      const minutes = r.duration && r.duration.unit === 'minute' ? r.duration.amount : 60;
      S.state.todos.push({ id: 'td' + tid, tid, tsy: 'ok', title: r.content, due: dueOf(r), est: minutes, done: false, created: Date.parse(r.added_at || r.created_at) || Date.now(), mod: Date.now() });
    }
    if (JSON.stringify(S.state.todos) !== before) S.markData();

    let firstError = null;
    for (const job of jobs) {
      try {
        await job();
      } catch (e) {
        firstError = firstError || e;
        if (e.status === 401 || e.status === 403) break;
      }
    }
    if (jobs.length) S.markData();
    if (firstError) throw firstError;
  }

  // force 가 아니면 바뀐 것이 있거나 1분이 지났을 때만 Todoist를 부른다. 실패해도 예외를 던지지 않는다.
  async function sync(force) {
    if (!token) return;
    if (running) {
      again = { force: force || (again && again.force) };
      return;
    }
    if (!force && !S.state.tDirty && Date.now() - last < 60000) return;
    running = true;
    S.state.tDirty = false;
    setStatus('syncing');
    try {
      await reconcile();
      last = Date.now();
      setStatus('ok');
    } catch (e) {
      console.warn('Todoist 동기화 실패', e);
      S.state.tDirty = true;
      if (e.status === 401 || e.status === 403) setStatus('error', 'Todoist 토큰이 올바르지 않습니다. 다시 연결해 주세요.');
      else setStatus('error', 'Todoist 동기화 실패: ' + e.message);
    }
    S.save();
    running = false;
    cb.onChange();
    if (again) {
      const a = again;
      again = null;
      await sync(a.force);
    }
  }

  async function connect(value) {
    token = (value || '').trim();
    if (!token) return;
    await sync(true);
    if (status.state === 'ok') localStorage.setItem(TOKEN_KEY, token);
    else token = '';
  }

  function disconnect() {
    token = '';
    localStorage.removeItem(TOKEN_KEY);
    setStatus('off');
  }

  function init(callbacks) {
    cb = callbacks;
    token = localStorage.getItem(TOKEN_KEY) || '';
    setStatus(token ? 'idle' : 'off');
  }

  RP.todoist = {
    init,
    connect,
    disconnect,
    sync,
    get status() {
      return status;
    },
    get connected() {
      return !!token;
    },
  };
})();
