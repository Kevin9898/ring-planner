// 데이터 저장소: 날짜별 블록, 템플릿, 할 일, 설정을 localStorage에 보관한다.
// 블록은 { id, title, start(분, 0~1439), dur(분), color, todoId? } 이고
// start + dur 가 1440을 넘으면 다음 날로 이어지는 일정이다.
(function () {
  const RP = (window.RP = window.RP || {});
  const KEY = 'ringplan.v1';
  const DAY = 1440;
  const COLORS = ['#5B8DEF', '#F2994A', '#27AE60', '#EB5757', '#9B51E0', '#F2C94C', '#2DB6C4', '#8D99AE'];

  const defaults = () => ({
    days: {},
    templates: [],
    todos: [],
    settings: { mode: 'fixed', snap: 10 },
  });

  function normalize(s) {
    const d = defaults();
    return {
      days: s.days || d.days,
      templates: s.templates || d.templates,
      todos: s.todos || d.todos,
      settings: Object.assign(d.settings, s.settings),
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return normalize(JSON.parse(raw));
    } catch (e) {
      console.warn('저장된 데이터를 읽지 못했습니다.', e);
    }
    return defaults();
  }

  let state = load();

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      console.warn('저장에 실패했습니다.', e);
    }
  }

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const pad = (n) => String(n).padStart(2, '0');
  const dateKey = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const parseKey = (key) => {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  const addDays = (key, n) => {
    const d = parseKey(key);
    d.setDate(d.getDate() + n);
    return dateKey(d);
  };

  const ownBlocks = (key) => state.days[key] || [];

  // 해당 날짜의 링에 보이는 항목. s/e 는 그 날 0시 기준 분이며,
  // 전날에서 넘어온 일정은 s 가 음수이고 own 이 false 다.
  function viewItems(key) {
    const out = ownBlocks(key).map((b) => ({ block: b, owner: key, own: true, s: b.start, e: b.start + b.dur }));
    const prev = addDays(key, -1);
    for (const b of ownBlocks(prev)) {
      if (b.start + b.dur > DAY) out.push({ block: b, owner: prev, own: false, s: b.start - DAY, e: b.start + b.dur - DAY });
    }
    return out.sort((a, b) => a.s - b.s || a.e - b.e);
  }

  function nextColor(key) {
    return COLORS[ownBlocks(key).length % COLORS.length];
  }

  function addBlock(key, b) {
    const block = { id: uid(), title: b.title, start: b.start, dur: b.dur, color: b.color || nextColor(key) };
    if (b.todoId) block.todoId = b.todoId;
    (state.days[key] = state.days[key] || []).push(block);
    save();
    return block;
  }

  function updateBlock(key, id, patch) {
    const b = ownBlocks(key).find((x) => x.id === id);
    if (!b) return;
    Object.assign(b, patch);
    save();
  }

  function removeBlock(key, id) {
    const list = ownBlocks(key).filter((x) => x.id !== id);
    if (list.length) state.days[key] = list;
    else delete state.days[key];
    save();
  }

  // 그 날 비어 있는 첫 자리를 찾는다. 없으면 from 위치에 겹쳐 놓는다.
  function findSlot(key, dur, from, snap) {
    const busy = viewItems(key).map((i) => [Math.max(0, i.s), Math.min(DAY, i.e)]);
    const first = Math.ceil(from / snap) * snap;
    for (let t = first; t + dur <= DAY; t += snap) {
      if (!busy.some(([a, b]) => t < b && t + dur > a)) return t;
    }
    return Math.max(0, Math.min(first, DAY - snap));
  }

  // ---- 할 일 ----
  const todo = (id) => state.todos.find((t) => t.id === id);

  function addTodo(t) {
    const item = { id: uid(), title: t.title, due: t.due || null, est: t.est || 60, done: false, created: Date.now() };
    state.todos.push(item);
    save();
    return item;
  }

  function updateTodo(id, patch) {
    const t = todo(id);
    if (!t) return;
    Object.assign(t, patch);
    save();
  }

  function removeTodo(id) {
    state.todos = state.todos.filter((t) => t.id !== id);
    for (const key of Object.keys(state.days)) {
      for (const b of state.days[key]) if (b.todoId === id) delete b.todoId;
    }
    save();
  }

  // todoId -> 링에 배치된 [{ date, start }] 목록
  function todoSchedule() {
    const map = {};
    for (const key of Object.keys(state.days).sort()) {
      for (const b of state.days[key]) {
        if (b.todoId) (map[b.todoId] = map[b.todoId] || []).push({ date: key, start: b.start });
      }
    }
    return map;
  }

  // ---- 템플릿 ----
  const stripBlocks = (blocks) => blocks.map((b) => ({ title: b.title, start: b.start, dur: b.dur, color: b.color }));

  function saveTemplate(name, key) {
    const blocks = stripBlocks(ownBlocks(key));
    const existing = state.templates.find((t) => t.name === name);
    if (existing) existing.blocks = blocks;
    else state.templates.push({ id: uid(), name, blocks });
    save();
  }

  function overwriteTemplate(id, key) {
    const t = state.templates.find((x) => x.id === id);
    if (!t) return;
    t.blocks = stripBlocks(ownBlocks(key));
    save();
  }

  function renameTemplate(id, name) {
    const t = state.templates.find((x) => x.id === id);
    if (!t) return;
    t.name = name;
    save();
  }

  function removeTemplate(id) {
    state.templates = state.templates.filter((t) => t.id !== id);
    save();
  }

  function applyTemplate(id, key, replace) {
    const t = state.templates.find((x) => x.id === id);
    if (!t) return;
    const clones = t.blocks.map((b) => Object.assign({ id: uid() }, b));
    state.days[key] = replace ? clones : ownBlocks(key).concat(clones);
    if (!state.days[key].length) delete state.days[key];
    save();
  }

  // ---- 설정 / 백업 ----
  function setSetting(name, value) {
    state.settings[name] = value;
    save();
  }

  const exportJSON = () => JSON.stringify(state, null, 2);

  function importJSON(text) {
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object' || !data.days || !Array.isArray(data.templates) || !Array.isArray(data.todos)) {
      throw new Error('링 계획표 백업 파일이 아닙니다.');
    }
    state = normalize(data);
    save();
  }

  RP.store = {
    DAY,
    COLORS,
    get state() {
      return state;
    },
    dateKey,
    parseKey,
    addDays,
    ownBlocks,
    viewItems,
    nextColor,
    addBlock,
    updateBlock,
    removeBlock,
    findSlot,
    todo,
    addTodo,
    updateTodo,
    removeTodo,
    todoSchedule,
    saveTemplate,
    overwriteTemplate,
    renameTemplate,
    removeTemplate,
    applyTemplate,
    setSetting,
    exportJSON,
    importJSON,
  };
})();
