// 화면 연결: 링 페이지, 할 일 페이지, 템플릿 / 일정 대화상자.
(function () {
  const RP = window.RP;
  const S = RP.store;
  const DAY = S.DAY;
  const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
  const VERSION = '24'; // 올릴 때마다 올린다. 설정에 표시되어 기기가 최신 파일을 쓰는지 확인할 수 있다.
  const DAILY_PLAN_CALENDAR = '일일계획표'; // 링 가운데 "현재 작업"에 쓰는 구글 캘린더 이름

  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (m) => {
    m = ((Math.round(m) % DAY) + DAY) % DAY;
    return pad(Math.floor(m / 60)) + ':' + pad(m % 60);
  };
  const fmtDur = (m) => {
    const h = Math.floor(m / 60), r = m % 60;
    return (h ? h + '시간' : '') + (h && r ? ' ' : '') + (r || !h ? r + '분' : '');
  };
  const parseTime = (v) => {
    const [h, m] = v.split(':').map(Number);
    return h * 60 + m;
  };
  const nowMin = () => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  };
  const todayKey = () => S.dateKey(new Date());
  const shortDate = (key) => {
    const d = S.parseKey(key);
    return d.getMonth() + 1 + '/' + d.getDate();
  };
  const keyOf = (it) => it.owner + ':' + it.block.id;

  let cur = todayKey();
  let sel = null; // 선택된 항목의 keyOf 값
  let dragInfo = null;
  let lastDay = cur;

  const isToday = () => cur === todayKey();

  function items() {
    return S.viewItems(cur).map((it) => {
      const t = it.block.todoId && S.todo(it.block.todoId);
      return Object.assign({}, it, { title: it.block.title, color: it.block.color, done: !!(t && t.done) });
    });
  }
  const selectedItem = () => items().find((i) => keyOf(i) === sel) || null;

  // 회전식은 "지금"이 기준이므로 오늘을 볼 때만 적용한다.
  const ringMode = () => (S.state.settings.mode === 'rotating' && isToday() ? 'rotating' : 'fixed');

  const ring = RP.createRing($('#ring'), {
    getView: () => ({ items: items(), externals: RP.gcal.externals(cur).items, selectedKey: sel, mode: ringMode(), snap: S.state.settings.snap, clockMin: nowMin(), showNow: isToday() }),
    onSelect: (it) => {
      sel = it ? keyOf(it) : null;
      render();
    },
    onTap: (it) => {
      if (sel === keyOf(it)) editBlock(it);
      else {
        sel = keyOf(it);
        render();
      }
    },
    onCreate: (s, e) => createBlock(s, e - s),
    onChange: (it, s, e) => {
      S.updateBlock(it.owner, it.block.id, { start: it.own ? s : s + DAY, dur: e - s });
      render();
    },
    onDragInfo: (info) => {
      dragInfo = info;
      renderCenter();
    },
  });

  // ---------- 링 페이지 렌더링 ----------
  function render() {
    renderDate();
    ring.render();
    renderCenter();
    renderSelbar();
    renderDayList();
    renderDayTodos();
    renderGoogle();
    $('#modeBtn').textContent = S.state.settings.mode === 'rotating' ? '회전식 (지금이 위)' : '고정식 (0시가 위)';
  }

  function renderDate() {
    const d = S.parseKey(cur);
    $('#dateText').innerHTML = `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEK[d.getDay()]})` + (isToday() ? '<span class="badge today">오늘</span>' : '');
  }

  function renderCenter() {
    const c = $('#center');
    if (dragInfo) {
      c.innerHTML = `<div class="big">${fmt(dragInfo.s)} – ${fmt(dragInfo.e)}</div><div class="sub">${fmtDur(dragInfo.e - dragInfo.s)}</div>`;
      return;
    }
    const its = items();
    if (isToday()) {
      const n = nowMin();
      // 지금 시각에 걸친 일정 가운데 하나를 고른다.
      // 우선순위: ① 할 일 목록에서 링에 넣은 일정(완료한 것은 제외) ② 구글 "일일계획표" 캘린더의 일정
      // 둘 다 없으면 ③ 링의 나머지 일정 ④ 다른 구글 캘린더의 일정. 같은 순위에서는 더 늦게 시작한 쪽을 고른다.
      const covers = (i) => i.s <= n && n < i.e;
      const ringNow = its.filter(covers);
      const extNow = RP.gcal.externals(cur).items.filter(covers);
      const now =
        ringNow.filter((i) => i.block.todoId && !i.done).pop() ||
        extNow.filter((x) => x.cal.replace(/\s/g, '') === DAILY_PLAN_CALENDAR).pop() ||
        ringNow.filter((i) => !i.block.todoId).pop() ||
        ringNow.pop() ||
        extNow.pop();
      const next = its.find((i) => i.s > n);
      let h = `<div class="clock">${fmt(n)}</div>`;
      h += now ? `<div class="title">${esc(now.title)}</div><div class="sub">${fmtDur(now.e - n)} 남음</div>` : '<div class="sub">비어 있는 시간</div>';
      if (next) h += `<div class="next">다음 · ${esc(next.title)} ${fmt(next.s)}</div><div class="next" style="margin-top:0">${fmtDur(next.s - n)} 뒤</div>`;
      c.innerHTML = h;
    } else {
      const d = S.parseKey(cur);
      const total = its.reduce((sum, i) => sum + Math.max(0, Math.min(DAY, i.e) - Math.max(0, i.s)), 0);
      c.innerHTML = `<div class="big">${d.getMonth() + 1}월 ${d.getDate()}일</div><div class="sub">${its.length ? `일정 ${its.length}개 · ${fmtDur(total)}` : '일정 없음'}</div>`;
    }
  }

  const rangeText = (it) => `${fmt(it.s)}–${fmt(it.e)}`;
  const crossText = (it) => (!it.own ? '전날부터 이어짐' : it.e > DAY ? '다음 날까지' : '');

  function renderSelbar() {
    const bar = $('#selbar');
    const it = selectedItem();
    if (!it) {
      sel = null;
      bar.innerHTML = '<span class="hint">빈 곳을 드래그하면 일정 생성 · 일정을 꾹 눌러 이동 · 양 끝을 끌어 시간 조절</span>';
      return;
    }
    const todo = it.block.todoId && S.todo(it.block.todoId);
    bar.innerHTML =
      `<span class="info"><span class="dot" style="background:${it.color}"></span><b>${esc(it.title)}</b> ${rangeText(it)} · ${fmtDur(it.e - it.s)}</span>` +
      (todo ? `<button class="small" data-act="done">${todo.done ? '완료 취소' : '완료'}</button>` : '') +
      '<button class="small" data-act="edit">편집</button><button class="small danger" data-act="del">삭제</button>';
  }

  $('#selbar').addEventListener('click', (ev) => {
    const act = ev.target.dataset.act;
    const it = selectedItem();
    if (!act || !it) return;
    if (act === 'edit') editBlock(it);
    else if (act === 'del') {
      S.removeBlock(it.owner, it.block.id);
      sel = null;
      render();
    } else if (act === 'done') {
      const t = S.todo(it.block.todoId);
      S.updateTodo(t.id, { done: !t.done });
      render();
    }
  });

  function renderDayList() {
    const ex = RP.gcal.externals(cur);
    $('#allDay').innerHTML = ex.allDay.map((a) => `종일 · ${esc(a.title)}`).join(' &nbsp; ');
    const its = items().concat(ex.items.map((x) => Object.assign({ ext: true }, x))).sort((a, b) => a.s - b.s);
    $('#dayList').innerHTML = its.length
      ? its
          .map((it) => {
            if (it.ext) {
              return `<li class="ext">
              <span class="dot" style="background:${esc(it.color)}"></span>
              <span class="when">${fmt(Math.max(0, it.s))}–${fmt(Math.min(DAY, it.e))}</span>
              <span class="name">${esc(it.title)}</span>
              <span class="extra">${esc(it.cal)}</span>
            </li>`;
            }
            const extra = crossText(it);
            return `<li data-key="${esc(keyOf(it))}" class="${keyOf(it) === sel ? 'sel' : ''}${it.done ? ' done' : ''}">
              <span class="dot" style="background:${it.color}"></span>
              <span class="when">${rangeText(it)}</span>
              <span class="name">${esc(it.title)}</span>
              ${extra ? `<span class="extra">${extra}</span>` : ''}
            </li>`;
          })
          .join('')
      : '<li class="empty" style="cursor:default">아직 일정이 없습니다. 링 위를 드래그하거나 "+ 일정"을 눌러 보세요.</li>';
  }

  $('#dayList').addEventListener('click', (ev) => {
    const li = ev.target.closest('li[data-key]');
    if (!li) return;
    const it = items().find((i) => keyOf(i) === li.dataset.key);
    if (!it) return;
    if (sel === li.dataset.key) editBlock(it);
    else {
      sel = li.dataset.key;
      render();
    }
  });

  // 보고 있는 날짜가 마감인 할 일 체크리스트. 체크해도 사라지지 않고 취소선만 그어진다.
  function renderDayTodos() {
    const list = S.state.todos.filter((t) => t.due === cur).sort((a, b) => a.created - b.created);
    const left = list.filter((t) => !t.done).length;
    $('#dayTodosHead').innerHTML = `이 날의 할 일<span class="n">${list.length ? `${left}개 남음 / 전체 ${list.length}개` : ''}</span>`;
    $('#dayTodoList').innerHTML = list.length
      ? list
          .map(
            (t) => `<li class="${t.done ? 'done' : ''}"><label>
              <input type="checkbox" value="${esc(t.id)}" ${t.done ? 'checked' : ''}>
              <span class="ttl">${esc(t.title)}${t.tid ? '<span class="tag">Todoist</span>' : ''}</span>
            </label></li>`
          )
          .join('')
      : '<li class="empty">이 날짜가 마감인 할 일이 없습니다.</li>';
  }

  $('#dayTodoList').addEventListener('change', (ev) => {
    if (!S.todo(ev.target.value)) return;
    S.updateTodo(ev.target.value, { done: ev.target.checked });
    render();
  });

  // ---------- 날짜 이동 ----------
  function go(key) {
    cur = key;
    sel = null;
    render();
    RP.gcal.sync(cur);
  }
  $('#prevDay').onclick = () => go(S.addDays(cur, -1));
  $('#nextDay').onclick = () => go(S.addDays(cur, 1));
  $('#todayBtn').onclick = () => go(todayKey());
  // 날짜를 누르면 달력이 열린다. 기기마다 다른 기본 날짜 선택기 대신 직접 그려서 폰에서도 똑같이 동작한다.
  let calMonth = null; // 달력에 보이는 달의 1일
  function renderCalendar() {
    const y = calMonth.getFullYear(), m = calMonth.getMonth();
    $('#calTitle').textContent = `${y}년 ${m + 1}월`;
    const today = todayKey();
    let h = WEEK.map((w, i) => `<span class="wd${i === 0 ? ' sun' : ''}">${w}</span>`).join('');
    h += '<span></span>'.repeat(new Date(y, m, 1).getDay());
    const days = new Date(y, m + 1, 0).getDate();
    for (let d = 1; d <= days; d++) {
      const key = S.dateKey(new Date(y, m, d));
      const cls = (key === cur ? ' sel' : '') + (key === today ? ' today' : '') + (new Date(y, m, d).getDay() === 0 ? ' sun' : '');
      h += `<button type="button" class="day${cls}" data-key="${key}">${d}${S.ownBlocks(key).length ? '<i></i>' : ''}</button>`;
    }
    $('#calGrid').innerHTML = h;
  }
  const moveCal = (n) => {
    calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + n, 1);
    renderCalendar();
  };
  $('#dateBtn').onclick = () => {
    const d = S.parseKey(cur);
    calMonth = new Date(d.getFullYear(), d.getMonth(), 1);
    renderCalendar();
    $('#dlgCal').showModal();
  };
  $('#calPrev').onclick = () => moveCal(-1);
  $('#calNext').onclick = () => moveCal(1);
  $('#calClose').onclick = () => $('#dlgCal').close();
  $('#calToday').onclick = () => {
    $('#dlgCal').close();
    go(todayKey());
  };
  $('#calGrid').onclick = (ev) => {
    const btn = ev.target.closest('[data-key]');
    if (!btn) return;
    $('#dlgCal').close();
    go(btn.dataset.key);
  };
  // 바깥(어두운 부분)을 누르면 닫는다.
  $('#dlgCal').addEventListener('click', (ev) => ev.target === ev.currentTarget && ev.currentTarget.close());

  $('#modeBtn').onclick = () => {
    S.setSetting('mode', S.state.settings.mode === 'rotating' ? 'fixed' : 'rotating');
    render();
  };

  // ---------- 일정 대화상자 ----------
  // 저장하면 { action:'save', title, start, dur, color }, 삭제하면 { action:'delete' }, 취소하면 null
  function blockDialog(init) {
    return new Promise((resolve) => {
      const dlg = $('#dlgBlock');
      let color = init.color;
      let result = null;
      $('#blockHead').textContent = init.isNew ? '새 일정' : '일정 편집';
      $('#bTitle').value = init.title || '';
      $('#bDate').value = init.date;
      // 할 일 목록에도 넣을지: 새 일정은 지난번 선택을 기억하고, 이미 연결된 일정은 안내만 보여 준다.
      $('#bTodoRow').hidden = !!init.todoId;
      $('#bLinked').hidden = !init.todoId;
      $('#bTodo').checked = init.isNew ? S.state.settings.blockTodo !== false : false;
      $('#bStart').value = fmt(init.start);
      $('#bEnd').value = fmt(init.start + init.dur);
      $('#bDelete').hidden = !!init.isNew;
      const note = () => {
        const s = parseTime($('#bStart').value || '00:00'), e = parseTime($('#bEnd').value || '00:00');
        $('#bNote').textContent = e <= s ? '종료가 시작보다 이르면 다음 날까지 이어지는 일정으로 저장됩니다.' : '';
      };
      const swatches = () => {
        $('#bColors').innerHTML = S.COLORS.map((c) => `<button type="button" data-c="${c}" class="${c === color ? 'on' : ''}" style="background:${c}" aria-label="색 ${c}"></button>`).join('');
      };
      note();
      swatches();
      $('#bStart').oninput = $('#bEnd').oninput = note;
      $('#bColors').onclick = (ev) => {
        if (!ev.target.dataset.c) return;
        color = ev.target.dataset.c;
        swatches();
      };
      $('#blockForm').onsubmit = (ev) => {
        ev.preventDefault();
        const start = parseTime($('#bStart').value);
        let dur = parseTime($('#bEnd').value) - start;
        if (dur <= 0) dur += DAY;
        result = { action: 'save', title: $('#bTitle').value.trim() || '일정', date: $('#bDate').value || init.date, start, dur, color, makeTodo: !init.todoId && $('#bTodo').checked };
        dlg.close();
      };
      $('#bDelete').onclick = () => {
        result = { action: 'delete' };
        dlg.close();
      };
      $('#bCancel').onclick = () => dlg.close();
      dlg.onclose = () => resolve(result);
      dlg.showModal();
      if (init.isNew) $('#bTitle').focus();
    });
  }

  async function createBlock(start, dur) {
    const res = await blockDialog({ isNew: true, date: cur, start, dur, color: S.nextColor(cur) });
    if (!res || res.action !== 'save') return render();
    S.setSetting('blockTodo', res.makeTodo);
    const b = S.addBlock(res.date, Object.assign({ todoId: res.makeTodo ? todoFor(res).id : undefined }, res));
    showBlock(res.date, b);
  }

  // 일정과 짝이 되는 할 일을 만든다: 마감은 일정 날짜, 예상 소요 시간은 일정 길이.
  const todoFor = (res) => S.addTodo({ title: res.title, due: res.date, est: res.dur });

  // 링에서 일정의 이름이나 날짜를 바꾸면 연결된 할 일(과 Todoist 작업)의 이름·마감일도 같이 바꾼다.
  function syncTodo(todoId, want) {
    const t = todoId && S.todo(todoId);
    if (!t) return;
    const patch = {};
    for (const k of Object.keys(want)) if (t[k] !== want[k]) patch[k] = want[k];
    if (Object.keys(patch).length) S.updateTodo(todoId, patch);
  }

  // 방금 저장한 일정이 보이도록, 다른 날짜에 넣었으면 그 날짜로 이동한다 (그 날의 구글 동기화도 이때 돈다).
  function showBlock(date, b) {
    if (date !== cur) go(date);
    sel = date + ':' + b.id;
    render();
  }

  async function editBlock(it) {
    const res = await blockDialog(Object.assign({ date: it.owner }, it.block));
    if (!res) return;
    if (res.action === 'delete') {
      S.removeBlock(it.owner, it.block.id);
      sel = null;
    } else if (res.date !== it.owner) {
      // 날짜를 바꾸면 원래 날짜에서 지우고 새 날짜에 다시 만든다 (구글 캘린더에도 그렇게 반영된다).
      const todoId = it.block.todoId || (res.makeTodo ? todoFor(res).id : undefined);
      syncTodo(it.block.todoId, { title: res.title, due: res.date });
      S.removeBlock(it.owner, it.block.id);
      return showBlock(res.date, S.addBlock(res.date, Object.assign({ todoId }, res)));
    } else {
      const patch = { title: res.title, start: res.start, dur: res.dur, color: res.color };
      if (res.makeTodo) patch.todoId = todoFor(res).id;
      S.updateBlock(it.owner, it.block.id, patch);
      syncTodo(it.block.todoId, { title: res.title });
    }
    render();
  }

  $('#addBlockBtn').onclick = () => {
    const snap = S.state.settings.snap;
    const from = isToday() ? nowMin() : 9 * 60;
    const start = S.findSlot(cur, 60, from, snap);
    createBlock(start, Math.min(60, DAY - start));
  };

  // ---------- 선택 대화상자 ----------
  function choose(message, labels) {
    return new Promise((resolve) => {
      const dlg = $('#dlgChoose');
      let picked = -1;
      $('#chooseMsg').textContent = message;
      $('#chooseBtns').innerHTML = '<span class="sp"></span>' + labels.map((l, i) => `<button type="button" data-i="${i}" class="${i === 0 ? 'primary' : ''}">${esc(l)}</button>`).join('');
      $('#chooseBtns').onclick = (ev) => {
        if (ev.target.dataset.i === undefined) return;
        picked = Number(ev.target.dataset.i);
        dlg.close();
      };
      dlg.onclose = () => resolve(picked);
      dlg.showModal();
    });
  }

  // ---------- 할 일 ----------
  function ddayBadge(due) {
    if (!due) return '';
    const days = Math.round((S.parseKey(due) - S.parseKey(todayKey())) / 86400000);
    const text = days === 0 ? 'D-DAY' : days > 0 ? 'D-' + days : 'D+' + -days;
    const cls = days < 0 ? 'over' : days <= 3 ? 'soon' : '';
    return `<span class="badge ${cls}">${text}</span>`;
  }

  function sortedTodos() {
    return [...S.state.todos].sort((a, b) => a.done - b.done || (a.due || '9999') .localeCompare(b.due || '9999') || a.created - b.created);
  }

  function todoMeta(t, sched) {
    const parts = [];
    parts.push(t.due ? `마감 ${shortDate(t.due)} ${t.done ? '' : ddayBadge(t.due)}` : '마감 없음');
    parts.push('예상 ' + fmtDur(t.est));
    const placed = sched[t.id];
    if (placed) parts.push('링: ' + placed.map((p) => `${shortDate(p.date)} ${fmt(p.start)}`).join(', '));
    return parts.map((p) => `<span>${p}</span>`).join('');
  }

  // ---------- 할 일 보드 (날짜별 열) ----------
  let weekOffset = 0; // 0 = 이번 주, 1 = 다음 주 …
  const todoView = () => S.state.settings.todoView || 'board';

  function renderBoard() {
    const board = $('#todoBoard');
    const sched = S.todoSchedule();
    const today = todayKey();
    const open = sortedTodos().filter((t) => !t.done);
    // 주는 일요일에 시작한다. 이미 지난 날짜는 열로 만들지 않고 "기한이 지난"에 모은다.
    const weekStart = S.addDays(today, -S.parseKey(today).getDay() + 7 * weekOffset);
    const weekEnd = S.addDays(weekStart, 6);
    const tomorrow = S.addDays(today, 1);
    const over = { title: '기한이 지난', items: open.filter((t) => t.due && t.due < today), cls: 'over pin', showDue: true };
    const cols = [];
    for (let i = 0; i < 7; i++) {
      const k = S.addDays(weekStart, i);
      if (k < today) continue;
      const d = S.parseKey(k);
      const name = k === today ? '오늘' : k === tomorrow ? '내일' : WEEK[d.getDay()] + '요일';
      cols.push({ date: k, title: `${d.getMonth() + 1}월 ${d.getDate()}일 · ${name}`, items: open.filter((t) => t.due === k) });
    }
    cols.push({ date: '', title: '마감 없음', items: open.filter((t) => !t.due) });

    const md = (k) => {
      const d = S.parseKey(k);
      return `${d.getMonth() + 1}월 ${d.getDate()}일`;
    };
    $('#weekText').textContent = `${md(weekStart)} – ${md(weekEnd)}` + (weekOffset === 0 ? ' (이번 주)' : weekOffset === 1 ? ' (다음 주)' : '');
    $('#weekPrev').disabled = weekOffset === 0;
    $('#weekNow').hidden = weekOffset === 0;

    const card = (t, c) => {
      const meta = [];
      if (c.showDue) meta.push(`<span class="due">${shortDate(t.due)}</span>`);
      meta.push(`<span>${fmtDur(t.est)}</span>`);
      const placed = sched[t.id];
      if (placed) meta.push('<span>링 ' + placed.map((p) => `${shortDate(p.date)} ${fmt(p.start)}`).join(', ') + '</span>');
      return `<div class="card" data-id="${esc(t.id)}">
        <button class="check" data-act="done" aria-label="완료"></button>
        <div class="body"><div class="ttl">${esc(t.title)}${t.tid ? '<span class="tag">Todoist</span>' : ''}</div><div class="meta">${meta.join('')}</div></div>
      </div>`;
    };
    // 그 날 링에 잡아 둔 일정을 열 위쪽에 간단히 보여 준다.
    const dayBlocks = (k) => {
      const its = S.viewItems(k).filter((i) => i.own);
      if (!its.length) return '';
      const rows = its.slice(0, 4).map((i) => `<div><i style="background:${esc(i.block.color)}"></i>${fmt(i.s)}–${fmt(i.e)} ${esc(i.block.title)}</div>`);
      if (its.length > 4) rows.push(`<div>그 외 ${its.length - 4}</div>`);
      return `<div class="dayblocks">${rows.join('')}</div>`;
    };

    const column = (c) => {
      const droppable = c.date !== undefined;
      return `<div class="col ${c.cls || ''}" ${droppable ? `data-date="${c.date}"` : ''}>
          <div class="colhead">${c.title}<span class="n">${c.items.length}</span></div>
          ${c.date ? dayBlocks(c.date) : ''}
          ${c.items.map((t) => card(t, c)).join('')}
          ${droppable ? '<button class="addcard" data-act="add">+ 작업 추가</button>' : c.items.length ? '' : '<div class="none">없음</div>'}
        </div>`;
    };
    const old = board.querySelector('.scroller');
    const left = old && board.dataset.week === weekStart ? old.scrollLeft : 0;
    board.dataset.week = weekStart;
    board.innerHTML = column(over) + `<div class="scroller">${cols.map(column).join('')}</div>`;
    board.querySelector('.scroller').scrollLeft = left;
  }

  $('#todoBoard').addEventListener('click', async (ev) => {
    if (suppressClick) return;
    const act = ev.target.dataset.act;
    const cardEl = ev.target.closest('.card');
    if (act === 'add') {
      // 열 안에서 바로 제목·마감·예상 소요 시간을 적어 추가한다.
      const col = ev.target.closest('.col');
      const form = document.createElement('form');
      form.className = 'addform';
      form.innerHTML = `<input name="title" placeholder="할 일" required autocomplete="off">
        <div class="row">
          <input type="date" name="due" value="${col.dataset.date}" aria-label="마감일">
          <input name="est" value="1시간" placeholder="소요 시간" autocomplete="off" aria-label="예상 소요 시간">
        </div>
        <div class="row"><span class="sp"></span><button type="button" class="small" data-cancel>취소</button><button class="small primary">추가</button></div>`;
      ev.target.replaceWith(form);
      const f = form.elements;
      f.title.focus();
      f.est.oninput = () => f.est.setCustomValidity('');
      form.onsubmit = (e) => {
        e.preventDefault();
        const est = readEst(f.est);
        const title = f.title.value.trim();
        if (est === null || !title) return;
        S.addTodo({ title, due: f.due.value || null, est });
        renderTodos();
      };
      form.querySelector('[data-cancel]').onclick = () => renderTodos();
      form.onkeydown = (e) => e.key === 'Escape' && renderTodos();
      return;
    }
    if (!cardEl) return;
    const t = S.todo(cardEl.dataset.id);
    if (!t) return;
    if (act === 'done') S.updateTodo(t.id, { done: true });
    else await todoDialog(t);
    renderTodos();
  });

  // 카드를 끌어 다른 날짜 열에 놓으면 마감일이 바뀐다.
  // 마우스는 바로 끌고, 터치는 꾹 누른 뒤 끈다 (그냥 밀면 보드가 넘어간다).
  const boardEl = $('#todoBoard');
  let cardDrag = null;
  let suppressClick = false;

  function startCardDrag() {
    const d = cardDrag;
    d.active = true;
    const r = d.card.getBoundingClientRect();
    d.dx = d.x - r.left;
    d.dy = d.y - r.top;
    d.ghost = document.createElement('div');
    d.ghost.className = 'board ghost';
    d.ghost.style.width = r.width + 'px';
    d.ghost.appendChild(d.card.cloneNode(true));
    document.body.appendChild(d.ghost);
    d.card.classList.add('dragging');
    d.scroller = boardEl.querySelector('.scroller');
    d.scroller.style.scrollSnapType = 'none';
    try {
      boardEl.setPointerCapture(d.id);
    } catch (e) {}
    if (d.touch && navigator.vibrate) navigator.vibrate(15);
    d.scrollTimer = setInterval(autoScrollBoard, 16);
    moveCardDrag();
  }

  function moveCardDrag() {
    const d = cardDrag;
    d.ghost.style.transform = `translate(${d.x - d.dx}px, ${d.y - d.dy}px)`;
    // 세로 위치와 상관없이, 포인터가 놓인 가로 위치의 날짜 열을 고른다 (빈 열은 높이가 낮아서).
    const sr = d.scroller.getBoundingClientRect();
    const col =
      d.x >= sr.left && d.x <= sr.right
        ? [...d.scroller.querySelectorAll('.col[data-date]')].find((c) => {
            const r = c.getBoundingClientRect();
            return d.x >= r.left && d.x <= r.right;
          }) || null
        : null;
    if (col === d.col) return;
    if (d.col) d.col.classList.remove('drop');
    if (col) col.classList.add('drop');
    d.col = col;
  }

  // 가장자리 근처로 끌고 가면 날짜 열이 옆으로 넘어간다.
  function autoScrollBoard() {
    const d = cardDrag;
    if (!d || !d.active) return;
    const r = d.scroller.getBoundingClientRect();
    const edge = 48;
    if (d.x > r.right - edge) d.scroller.scrollLeft += 10;
    else if (d.x >= r.left && d.x < r.left + edge) d.scroller.scrollLeft -= 10;
    else return;
    moveCardDrag();
  }

  function endCardDrag(drop) {
    const d = cardDrag;
    cardDrag = null;
    if (!d) return;
    clearTimeout(d.pressTimer);
    clearInterval(d.scrollTimer);
    if (!d.active) return;
    d.ghost.remove();
    try {
      boardEl.releasePointerCapture(d.id);
    } catch (e) {}
    // 끌기가 끝난 직후의 클릭이 수정 창을 열지 않게 한다.
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 80);
    const t = S.todo(d.todoId);
    if (drop && d.col && t) {
      const due = d.col.dataset.date || null;
      if (t.due !== due) S.updateTodo(t.id, { due });
    }
    renderTodos();
  }

  boardEl.addEventListener('pointerdown', (ev) => {
    if (cardDrag && !cardDrag.active) endCardDrag(false);
    const cardEl = ev.target.closest('.card');
    if (!cardEl || ev.button || ev.target.closest('.check') || cardDrag) return;
    cardDrag = { id: ev.pointerId, card: cardEl, todoId: cardEl.dataset.id, x: ev.clientX, y: ev.clientY, x0: ev.clientX, y0: ev.clientY, touch: ev.pointerType !== 'mouse', active: false };
    if (cardDrag.touch) cardDrag.pressTimer = setTimeout(() => cardDrag && !cardDrag.active && startCardDrag(), 350);
  });
  boardEl.addEventListener('pointermove', (ev) => {
    const d = cardDrag;
    if (!d || ev.pointerId !== d.id) return;
    d.x = ev.clientX;
    d.y = ev.clientY;
    if (d.active) return moveCardDrag();
    const dist = Math.hypot(d.x - d.x0, d.y - d.y0);
    if (!d.touch && dist > 6) startCardDrag();
    else if (d.touch && dist > 10) endCardDrag(false); // 꾹 누르기 전에 움직이면 스크롤로 본다
  });
  boardEl.addEventListener('pointerup', (ev) => {
    if (cardDrag && ev.pointerId === cardDrag.id) endCardDrag(true);
  });
  boardEl.addEventListener('pointercancel', () => endCardDrag(false));
  // 끄는 동안에는 화면이 같이 밀리지 않게 한다.
  boardEl.addEventListener('touchmove', (ev) => cardDrag && cardDrag.active && ev.preventDefault(), { passive: false });
  boardEl.addEventListener('contextmenu', (ev) => cardDrag && ev.preventDefault());

  const goWeek = (n) => {
    weekOffset = Math.max(0, n);
    renderTodos();
  };
  $('#weekPrev').onclick = () => goWeek(weekOffset - 1);
  $('#weekNext').onclick = () => goWeek(weekOffset + 1);
  $('#weekNow').onclick = () => goWeek(0);

  document.querySelectorAll('.viewsw button').forEach((btn) => {
    btn.onclick = () => {
      S.setSetting('todoView', btn.dataset.tv);
      renderTodos();
    };
  });

  function renderTodos() {
    if (cardDrag && cardDrag.active) return; // 끄는 중에는 화면을 다시 그리지 않는다
    const boardMode = todoView() === 'board';
    document.querySelectorAll('.viewsw button').forEach((b) => b.classList.toggle('on', b.dataset.tv === todoView()));
    document.querySelector('main').classList.toggle('wide', boardMode && !$('#view-todos').hidden);
    $('#todoBoard').hidden = !boardMode;
    $('#weekNav').hidden = !boardMode;
    $('#todoList').hidden = boardMode;
    if (boardMode) return renderBoard();
    const sched = S.todoSchedule();
    const list = sortedTodos();
    if (!list.length) {
      $('#todoList').innerHTML = '<li class="empty">해야 할 일을 적어 두면 링 화면에서 골라 넣을 수 있습니다.</li>';
      return;
    }
    let h = '';
    let doneHeader = false;
    for (const t of list) {
      if (t.done && !doneHeader) {
        h += '<h3>완료</h3>';
        doneHeader = true;
      }
      h += `<li data-id="${t.id}" class="${t.done ? 'done' : ''}">
        <input type="checkbox" data-act="toggle" ${t.done ? 'checked' : ''} aria-label="완료">
        <div class="body"><div class="ttl">${esc(t.title)}${t.tid ? '<span class="tag">Todoist</span>' : ''}</div><div class="meta">${todoMeta(t, sched)}</div></div>
        <div class="btns"><button class="small" data-act="edit">수정</button><button class="small danger" data-act="del">삭제</button></div>
      </li>`;
    }
    $('#todoList').innerHTML = h;
  }

  // 예상 소요 시간을 글자로 받아 분으로 바꾼다. "90", "90분", "1시간 30분", "1.5시간", "1:30", "1h 30m" 모두 된다.
  function parseEst(value) {
    const v = String(value).trim().toLowerCase();
    const fit = (m) => Math.max(5, Math.min(DAY, Math.round(m)));
    if (!v) return 60;
    const clock = v.match(/^(\d+):(\d{1,2})$/);
    if (clock) return fit(Number(clock[1]) * 60 + Number(clock[2]));
    const h = v.match(/(\d+(?:\.\d+)?)\s*(시간|h)/);
    const m = v.match(/(\d+)\s*(분|m)/);
    if (h || m) return fit((h ? parseFloat(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0));
    return /^\d+(\.\d+)?$/.test(v) ? fit(parseFloat(v)) : null;
  }

  // 입력 칸의 값을 분으로 읽는다. 알아볼 수 없으면 칸에 안내를 띄우고 null 을 돌려준다.
  function readEst(input) {
    const est = parseEst(input.value);
    input.setCustomValidity(est === null ? '예: 90, 1시간 30분, 1.5시간' : '');
    if (est === null) input.reportValidity();
    return est;
  }

  $('#todoForm').onsubmit = (ev) => {
    ev.preventDefault();
    const title = $('#tTitle').value.trim();
    if (!title) return;
    const est = readEst($('#tEst'));
    if (est === null) return;
    S.addTodo({ title, due: $('#tDue').value || null, est });
    $('#tTitle').value = '';
    renderTodos();
  };

  $('#todoList').addEventListener('click', async (ev) => {
    const act = ev.target.dataset.act;
    const li = ev.target.closest('li[data-id]');
    if (!act || !li) return;
    const t = S.todo(li.dataset.id);
    if (act === 'toggle') S.updateTodo(t.id, { done: ev.target.checked });
    else if (act === 'del') {
      if ((await choose(`"${t.title}" 을(를) 삭제할까요?\n링에 넣어 둔 일정도 함께 삭제됩니다.`, ['삭제', '취소'])) !== 0) return;
      S.removeTodo(t.id);
    } else if (act === 'edit') {
      await todoDialog(t);
    }
    renderTodos();
  });

  function todoDialog(t) {
    return new Promise((resolve) => {
      const dlg = $('#dlgTodo');
      $('#eTitle').value = t.title;
      $('#eDue').value = t.due || '';
      $('#eEst').value = fmtDur(t.est);
      $('#eEst').setCustomValidity('');
      $('#todoEditForm').onsubmit = (ev) => {
        ev.preventDefault();
        const est = readEst($('#eEst'));
        if (est === null) return;
        S.updateTodo(t.id, { title: $('#eTitle').value.trim() || t.title, due: $('#eDue').value || null, est });
        dlg.close();
      };
      $('#eCancel').onclick = () => dlg.close();
      $('#eDelete').onclick = async () => {
        dlg.close();
        if ((await choose(`"${t.title}" 을(를) 삭제할까요? 링에 넣어 둔 일정도 함께 삭제됩니다.`, ['삭제', '취소'])) === 0) S.removeTodo(t.id);
        renderTodos();
      };
      dlg.onclose = () => resolve();
      dlg.showModal();
    });
  }

  // ---------- 링 화면의 "할 일에서 추가" ----------
  $('#pickTodoBtn').onclick = () => {
    const dlg = $('#dlgPick');
    const sched = S.todoSchedule();
    const open = sortedTodos().filter((t) => !t.done);
    $('#pickList').innerHTML = open.length
      ? open
          .map((t) => {
            const here = (sched[t.id] || []).some((p) => p.date === cur);
            return `<li class="${here ? 'placed' : ''}"><label>
              <input type="checkbox" value="${t.id}" ${here ? 'disabled' : ''}>
              <div class="body"><div>${esc(t.title)}</div><div class="meta">${todoMeta(t, sched)}${here ? '<span>이 날 링에 이미 있음</span>' : ''}</div></div>
            </label></li>`;
          })
          .join('')
      : '<li class="empty">남은 할 일이 없습니다. "할 일" 탭에서 먼저 적어 주세요.</li>';
    const count = () => {
      const n = dlg.querySelectorAll('#pickList input:checked').length;
      $('#pickAdd').textContent = n ? `링에 추가 (${n})` : '링에 추가';
      $('#pickAdd').disabled = !n;
    };
    $('#pickList').onchange = count;
    count();
    $('#pickCancel').onclick = () => dlg.close();
    $('#pickAdd').onclick = () => {
      const snap = S.state.settings.snap;
      let last = null;
      for (const box of dlg.querySelectorAll('#pickList input:checked')) {
        const t = S.todo(box.value);
        const from = isToday() ? nowMin() : 9 * 60;
        const start = S.findSlot(cur, t.est, from, snap);
        last = S.addBlock(cur, { title: t.title, start, dur: Math.min(t.est, DAY - start), todoId: t.id });
      }
      if (last) sel = cur + ':' + last.id;
      dlg.close();
      render();
    };
    dlg.showModal();
  };

  // ---------- 템플릿 ----------
  function renderTemplates() {
    const list = S.state.templates;
    $('#tplList').innerHTML = list.length
      ? list
          .map((t) => {
            const total = t.blocks.reduce((sum, b) => sum + b.dur, 0);
            return `<li data-id="${t.id}">
              <div class="body"><b>${esc(t.name)}</b><div class="meta">일정 ${t.blocks.length}개 · ${fmtDur(total)}</div></div>
              <div class="btns">
                <button class="small primary" data-act="load">불러오기</button>
                <button class="small" data-act="over">현재 링으로 덮어쓰기</button>
                <button class="small" data-act="rename">이름</button>
                <button class="small danger" data-act="del">삭제</button>
              </div>
            </li>`;
          })
          .join('')
      : '<li class="empty">저장된 템플릿이 없습니다. 하루 링을 만든 뒤 이름을 붙여 저장하세요.</li>';
  }

  $('#templateBtn').onclick = () => {
    $('#tplName').value = '';
    renderTemplates();
    $('#dlgTpl').showModal();
  };
  $('#tplClose').onclick = () => $('#dlgTpl').close();

  $('#tplForm').onsubmit = async (ev) => {
    ev.preventDefault();
    const name = $('#tplName').value.trim();
    if (!name) return;
    if (!S.ownBlocks(cur).length) {
      await choose('이 날짜에 저장할 일정이 없습니다.', ['확인']);
      return;
    }
    if (S.state.templates.some((t) => t.name === name) && (await choose(`"${name}" 템플릿이 이미 있습니다. 덮어쓸까요?`, ['덮어쓰기', '취소'])) !== 0) return;
    S.saveTemplate(name, cur);
    $('#tplName').value = '';
    renderTemplates();
  };

  $('#tplList').addEventListener('click', async (ev) => {
    const act = ev.target.dataset.act;
    const li = ev.target.closest('li[data-id]');
    if (!act || !li) return;
    const t = S.state.templates.find((x) => x.id === li.dataset.id);
    if (act === 'load') {
      let replace = true;
      if (S.ownBlocks(cur).length) {
        const pick = await choose('이 날짜에 이미 일정이 있습니다.\n템플릿으로 교체할까요, 기존 일정에 합칠까요?', ['교체', '합치기', '취소']);
        if (pick !== 0 && pick !== 1) return;
        replace = pick === 0;
      }
      S.applyTemplate(t.id, cur, replace);
      sel = null;
      $('#dlgTpl').close();
      render();
      return;
    }
    if (act === 'over') {
      if (!S.ownBlocks(cur).length) return void (await choose('이 날짜에 저장할 일정이 없습니다.', ['확인']));
      if ((await choose(`"${t.name}" 템플릿을 현재 링 내용으로 덮어쓸까요?`, ['덮어쓰기', '취소'])) !== 0) return;
      S.overwriteTemplate(t.id, cur);
    } else if (act === 'rename') {
      const name = (prompt('템플릿 이름', t.name) || '').trim();
      if (!name) return;
      S.renameTemplate(t.id, name);
    } else if (act === 'del') {
      if ((await choose(`"${t.name}" 템플릿을 삭제할까요?`, ['삭제', '취소'])) !== 0) return;
      S.removeTemplate(t.id);
    }
    renderTemplates();
  });

  // ---------- 화면 모드 ----------
  // 기본은 기기 설정을 따르고, 밝게/어둡게를 고르면 이 기기에서만 고정된다.
  function applyTheme() {
    const theme = S.state.settings.theme || 'auto';
    if (theme === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    document.querySelectorAll('#themeSw button').forEach((b) => b.classList.toggle('on', b.dataset.themeSet === theme));
    const dark = theme === 'dark' || (theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => (m.content = dark ? '#262624' : '#faf9f5'));
    // 폰 브라우저의 "강제 다크"가 밝게 고른 화면을 다시 어둡게 만들지 않도록 알려 준다.
    $('meta[name="color-scheme"]').content = theme === 'light' ? 'only light' : theme === 'dark' ? 'dark' : 'light dark';
  }
  document.querySelectorAll('#themeSw button').forEach((b) => {
    b.onclick = () => {
      S.setSetting('theme', b.dataset.themeSet);
      applyTheme();
    };
  });
  const darkQuery = matchMedia('(prefers-color-scheme: dark)');
  if (darkQuery.addEventListener) darkQuery.addEventListener('change', applyTheme);
  applyTheme();

  // ---------- 버전 / 새로 받기 ----------
  // 홈 화면 앱에는 새로고침 버튼이 없어서, 저장해 둔 옛 파일을 버리고 다시 받는 버튼을 둔다.
  $('#versionText').textContent = '버전 ' + VERSION;
  $('#refreshBtn').onclick = async () => {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.update()));
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch (e) {}
    location.replace(location.pathname + '?r=' + Date.now());
  };

  // ---------- 설정 / 백업 ----------
  $('#snapSel').value = String(S.state.settings.snap);
  $('#snapSel').onchange = (ev) => S.setSetting('snap', Number(ev.target.value));

  $('#exportBtn').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([S.exportJSON()], { type: 'application/json' }));
    a.download = `링계획표-백업-${todayKey()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  $('#importBtn').onclick = () => $('#importFile').click();
  $('#importFile').onchange = async (ev) => {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    if ((await choose('백업 파일을 가져오면 지금 저장된 내용이 모두 바뀝니다. 계속할까요?', ['가져오기', '취소'])) !== 0) return;
    try {
      S.importJSON(await file.text());
      sel = null;
      $('#snapSel').value = String(S.state.settings.snap);
      render();
      renderTodos();
    } catch (e) {
      choose('가져오지 못했습니다: ' + e.message, ['확인']);
    }
  };

  // ---------- 구글 캘린더 ----------
  function renderGoogle() {
    const st = RP.gcal.status;
    const text = { off: '', idle: '', syncing: '구글 동기화 중…', ok: '구글과 동기화됨', expired: '구글 연결이 만료되었습니다.', error: st.text }[st.state];
    const label = { off: 'Google 캘린더 연결', idle: '지금 동기화', syncing: '', ok: '지금 동기화', expired: '다시 연결', error: '다시 시도' }[st.state];
    $('#gStatus').textContent = st.state === 'off' && st.text ? st.text : text;
    $('#gStatus').className = st.state === 'error' || st.state === 'expired' ? 'err' : '';
    $('#gBtn').textContent = label;
    $('#gBtn').hidden = !label;

    const connected = !!S.state.settings.gcal;
    $('#gSettings').hidden = !connected;
    const hidden = S.state.settings.hiddenCals;
    $('#calList').innerHTML = RP.gcal.calendars
      .map((c) => `<li><label><input type="checkbox" value="${esc(c.id)}" ${hidden.includes(c.id) ? '' : 'checked'}><span class="dot" style="background:${esc(c.color)}"></span>${esc(c.name)}</label></li>`)
      .join('');
  }

  $('#gBtn').onclick = () => {
    const state = RP.gcal.status.state;
    if (state === 'off' || state === 'expired' || !S.state.settings.gcal) RP.gcal.connect();
    else syncAll(true);
  };
  $('#calList').onchange = (ev) => {
    const id = ev.target.value;
    const hidden = S.state.settings.hiddenCals.filter((x) => x !== id);
    if (!ev.target.checked) hidden.push(id);
    S.setSetting('hiddenCals', hidden);
    RP.gcal.sync(cur);
  };
  $('#gDisconnect').onclick = async () => {
    if ((await choose('구글 연결을 해제할까요?\n이 기기에 저장된 일정과 구글 캘린더의 일정은 그대로 남습니다.', ['해제', '취소'])) === 0) RP.gcal.disconnect();
  };

  // 일정을 바꾸면 잠시 뒤 구글에 반영한다.
  let syncTimer = null;
  S.onChange = () => {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => syncAll(), 1200);
  };
  let lastFocusSync = Date.now();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || Date.now() - lastFocusSync < 60000) return;
    lastFocusSync = Date.now();
    syncAll();
  });

  RP.gcal.init({
    currentKey: () => cur,
    onStatus: renderGoogle,
    // 드래그 중이거나 대화상자가 열려 있으면 화면을 건드리지 않는다 (끝나면 다시 그려진다).
    onChange: () => {
      if (dragInfo || document.querySelector('dialog[open], .addform')) return;
      if ($('#view-ring').hidden) renderTodos();
      else render();
    },
  });

  // ---------- Todoist ----------
  // Todoist를 먼저 맞춘 뒤 구글(드라이브·캘린더)에 올려야 다른 기기가 같은 상태를 받는다.
  async function syncAll(force) {
    await RP.todoist.sync(force);
    RP.gcal.sync(cur, force);
  }

  function renderTodoist() {
    const st = RP.todoist.status;
    const on = RP.todoist.connected && st.state !== 'off';
    const text = { off: '', idle: 'Todoist에 연결되어 있습니다.', syncing: 'Todoist 동기화 중…', ok: 'Todoist와 동기화됨', error: st.text }[st.state];
    $('#tdOff').hidden = on;
    $('#tdOn').hidden = !on;
    $('#tdState').textContent = text;
    $('#tdState').style.color = st.state === 'error' ? 'var(--danger)' : '';
    $('#tStatus').hidden = !on && st.state !== 'error';
    $('#tStatus').innerHTML = `<span class="${st.state === 'error' ? 'err' : ''}">${esc(text)}</span>`;
  }

  $('#tdConnect').onclick = async () => {
    const value = $('#tdToken').value;
    $('#tdToken').value = '';
    $('#tdConnect').disabled = true;
    await RP.todoist.connect(value);
    $('#tdConnect').disabled = false;
    if (RP.todoist.connected) RP.gcal.sync(cur);
  };
  $('#tdSync').onclick = () => syncAll(true);
  $('#tdDisconnect').onclick = async () => {
    if ((await choose('Todoist 연결을 해제할까요? 할 일 목록과 Todoist의 작업은 그대로 남습니다.', ['해제', '취소'])) === 0) RP.todoist.disconnect();
  };

  RP.todoist.init({
    onStatus: renderTodoist,
    onChange: () => {
      if (dragInfo || document.querySelector('dialog[open], .addform')) return;
      if ($('#view-ring').hidden) renderTodos();
      else render();
    },
  });

  // ---------- 탭 ----------
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.onclick = () => {
      document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', b === btn));
      $('#view-ring').hidden = btn.dataset.view !== 'ring';
      $('#view-todos').hidden = btn.dataset.view !== 'todos';
      document.querySelector('main').classList.remove('wide');
      if (btn.dataset.view === 'ring') render();
      else renderTodos();
    };
  });

  document.addEventListener('keydown', (ev) => {
    if ((ev.key !== 'Delete' && ev.key !== 'Backspace') || document.querySelector('dialog[open]')) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName)) return;
    const it = selectedItem();
    if (!it || $('#view-ring').hidden) return;
    S.removeBlock(it.owner, it.block.id);
    sel = null;
    render();
  });

  // 시각이 흐르면 현재 시각 바늘과 가운데 안내를 갱신하고, 자정을 넘기면 오늘로 따라간다.
  setInterval(() => {
    const today = todayKey();
    if (today !== lastDay) {
      if (cur === lastDay) cur = today;
      lastDay = today;
    }
    if (!$('#view-ring').hidden && !dragInfo && !document.querySelector('dialog[open]')) render();
  }, 20000);

  $('#tEst').oninput = $('#eEst').oninput = (ev) => ev.target.setCustomValidity('');
  render();
  syncAll();
})();
