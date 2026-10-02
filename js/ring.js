// 24시간 링: SVG 렌더링과 포인터 조작(생성 / 이동 / 양 끝 시간 조절).
// 화면 상태는 cb.getView() 로 받아오고, 결과는 콜백으로만 내보낸다.
(function () {
  const RP = (window.RP = window.RP || {});
  const DAY = 1440;
  const C = 200; // viewBox 400x400 의 중심
  const RO = 166; // 링 바깥 반지름
  const RI = 102; // 링 안쪽 반지름
  const RM = (RO + RI) / 2;
  const LONG_PRESS_MS = 420;

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (m) => {
    m = ((Math.round(m) % DAY) + DAY) % DAY;
    return pad(Math.floor(m / 60)) + ':' + pad(m % 60);
  };
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const keyOf = (it) => it.owner + ':' + it.block.id;

  function isDark(hex) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return 0.299 * r + 0.587 * g + 0.114 * b < 160;
  }

  RP.createRing = function (svg, cb) {
    let drag = null;

    const rotOf = (v) => (v.mode === 'rotating' ? -(v.clockMin / DAY) * 2 * Math.PI : 0);
    const angle = (min, ro) => (min / DAY) * 2 * Math.PI - Math.PI / 2 + ro;
    const pt = (min, r, ro) => {
      const a = angle(min, ro);
      return [C + r * Math.cos(a), C + r * Math.sin(a)];
    };
    const f = (n) => n.toFixed(2);

    function arc(a0, a1, ro, rOut, rIn) {
      if (a1 - a0 >= DAY) a1 = a0 + DAY - 0.01;
      const large = a1 - a0 > DAY / 2 ? 1 : 0;
      const p1 = pt(a0, rOut, ro), p2 = pt(a1, rOut, ro), p3 = pt(a1, rIn, ro), p4 = pt(a0, rIn, ro);
      return `M${f(p1[0])} ${f(p1[1])}A${rOut} ${rOut} 0 ${large} 1 ${f(p2[0])} ${f(p2[1])}L${f(p3[0])} ${f(p3[1])}A${rIn} ${rIn} 0 ${large} 0 ${f(p4[0])} ${f(p4[1])}Z`;
    }

    // 모서리가 둥근 띠 조각. 짧은 조각은 양 끝 모서리가 겹치지 않도록 둥글림을 줄인다.
    function roundArc(a0, a1, ro, rOut, rIn, radius) {
      if (a1 - a0 >= DAY) return arc(a0, a1, ro, rOut, rIn);
      const t0 = angle(a0, ro), t1 = angle(a1, ro);
      const span = t1 - t0;
      let c = Math.min(radius, (rOut - rIn) / 2);
      while (c > 0.5 && 2 * Math.asin(c / (rIn + c)) > span) c *= 0.7;
      if (c <= 0.5) return arc(a0, a1, ro, rOut, rIn);
      const dOut = Math.asin(c / (rOut - c)), dIn = Math.asin(c / (rIn + c));
      const eOut = (rOut - c) * Math.cos(dOut), eIn = (rIn + c) * Math.cos(dIn);
      const P = (t, r) => f(C + r * Math.cos(t)) + ' ' + f(C + r * Math.sin(t));
      const bigOut = span - 2 * dOut > Math.PI ? 1 : 0, bigIn = span - 2 * dIn > Math.PI ? 1 : 0;
      return (
        `M${P(t0 + dOut, rOut)}A${rOut} ${rOut} 0 ${bigOut} 1 ${P(t1 - dOut, rOut)}A${f(c)} ${f(c)} 0 0 1 ${P(t1, eOut)}` +
        `L${P(t1, eIn)}A${f(c)} ${f(c)} 0 0 1 ${P(t1 - dIn, rIn)}A${rIn} ${rIn} 0 ${bigIn} 0 ${P(t0 + dIn, rIn)}` +
        `A${f(c)} ${f(c)} 0 0 1 ${P(t0, eIn)}L${P(t0, eOut)}A${f(c)} ${f(c)} 0 0 1 ${P(t0 + dOut, rOut)}Z`
      );
    }

    function label(it, a, b, ro) {
      const span = b - a;
      if (span < 40) return '';
      const mid = (a + b) / 2;
      const ang = angle(mid, ro);
      const arcLen = (span / DAY) * 2 * Math.PI * RM;
      // 글자는 눕히지 않으므로, 위·아래에서는 호 길이만큼 / 좌·우에서는 링 두께만큼 쓸 수 있다.
      const avail = Math.min(110, arcLen * Math.sin(ang) ** 2 + (RO - RI) * Math.cos(ang) ** 2);
      const n = Math.floor(avail / 10.5);
      if (n < 2) return '';
      let t = it.title || '';
      if (t.length > n) t = t.slice(0, n - 1) + '…';
      const [x, y] = pt(mid, RM, ro);
      const cls = 'lbl' + (isDark(it.color) ? ' on-dark' : '');
      const withTime = span >= 90 && avail >= 56;
      let h = `<text class="${cls}" x="${f(x)}" y="${f(y + (withTime ? -2 : 3.5))}">${esc(t)}</text>`;
      if (withTime) h += `<text class="${cls} time" x="${f(x)}" y="${f(y + 9)}">${fmt(it.s)}–${fmt(it.e)}</text>`;
      return h;
    }

    function render() {
      const v = cb.getView();
      const ro = rotOf(v);
      let h = `<circle class="track" cx="${C}" cy="${C}" r="${RM}" stroke-width="${RO - RI}"/>`;

      for (let hr = 0; hr < 24; hr++) {
        const m = hr * 60;
        const major = hr % 6 === 0;
        const g1 = pt(m, RI, ro), g2 = pt(m, RO, ro);
        h += `<line class="grid" x1="${f(g1[0])}" y1="${f(g1[1])}" x2="${f(g2[0])}" y2="${f(g2[1])}"/>`;
        const t1 = pt(m, RO + 3, ro), t2 = pt(m, RO + (major ? 10 : 7), ro);
        h += `<line class="tick${major ? ' major' : ''}" x1="${f(t1[0])}" y1="${f(t1[1])}" x2="${f(t2[0])}" y2="${f(t2[1])}"/>`;
        const tp = pt(m, RO + 21, ro);
        h += `<text class="hour${major ? ' major' : ''}" x="${f(tp[0])}" y="${f(tp[1] + 3.5)}">${hr}</text>`;
      }

      const moving = drag && drag.mode === 'move' ? keyOf(drag.item) : null;
      const items = v.items.map((it) => (drag && drag.item && drag.cur && keyOf(it) === keyOf(drag.item) ? Object.assign({}, it, drag.cur) : it));
      // 이동 중인 블록은 맨 위에 그린다.
      items.sort((x, y) => (keyOf(x) === moving) - (keyOf(y) === moving));

      // 다른 캘린더의 일정(읽기 전용)은 링 안쪽에 얇은 띠로 표시한다.
      for (const x of v.externals || []) {
        const a = Math.max(0, x.s), b = Math.min(DAY, x.e);
        if (b > a) h += `<path class="ext" fill="${x.color}" d="${arc(a, b, ro, RI - 3, RI - 9)}"/>`;
      }

      let handles = '';
      for (const it of items) {
        const a = Math.max(0, it.s), b = Math.min(DAY, it.e);
        if (b <= a) continue;
        const k = keyOf(it);
        const lifted = k === moving;
        const selected = k === v.selectedKey;
        const cls = 'blk' + (selected ? ' sel' : '') + (lifted ? ' lift' : '') + (it.done ? ' done' : '') + (it.own ? '' : ' carry');
        h += `<path class="${cls}" fill="${it.color}" d="${roundArc(a, b, ro, RO + (lifted ? 4 : -2), RI - (lifted ? 4 : -2), 8)}"/>`;
        h += label(it, a, b, ro);
        if (selected && !lifted) {
          if (it.s >= 0) {
            const p = pt(it.s, RM, ro);
            handles += `<circle class="handle" cx="${f(p[0])}" cy="${f(p[1])}" r="7" stroke="${it.color}"/>`;
          }
          if (it.e <= DAY) {
            const p = pt(it.e, RM, ro);
            handles += `<circle class="handle" cx="${f(p[0])}" cy="${f(p[1])}" r="7" stroke="${it.color}"/>`;
          }
        }
      }
      h += handles;

      if (drag && drag.mode === 'create') {
        h += `<path class="preview" d="${roundArc(drag.cur.s, Math.min(DAY, drag.cur.e), ro, RO - 2, RI + 2, 8)}"/>`;
      }

      if (v.showNow) {
        const n1 = pt(v.clockMin, RI - 8, ro), n2 = pt(v.clockMin, RO + 9, ro);
        h += `<line class="nowhand" x1="${f(n1[0])}" y1="${f(n1[1])}" x2="${f(n2[0])}" y2="${f(n2[1])}"/>`;
        h += `<circle class="nowdot" cx="${f(n2[0])}" cy="${f(n2[1])}" r="3.5"/>`;
      }

      svg.innerHTML = h;
    }

    // 포인터 위치 -> 그 날의 분(0~1440)과 중심에서의 거리(viewBox 단위)
    function locate(ev) {
      const r = svg.getBoundingClientRect();
      const scale = 400 / r.width;
      const x = (ev.clientX - r.left) * scale - C;
      const y = (ev.clientY - r.top) * scale - C;
      const a = Math.atan2(y, x) + Math.PI / 2 - rotOf(cb.getView());
      let min = ((a / (2 * Math.PI)) * DAY) % DAY;
      if (min < 0) min += DAY;
      return { min, rad: Math.hypot(x, y) };
    }

    function edgeOf(it, min, outside) {
      const a = Math.max(0, it.s), b = Math.min(DAY, it.e);
      const tin = Math.min(20, (b - a) * 0.25);
      const tout = outside ? 15 : 0;
      if (it.s >= 0 && min >= a - tout && min <= a + tin) return 'start';
      if (it.e <= DAY && min <= b + tout && min >= b - tin) return 'end';
      return null;
    }

    function hit(min, v) {
      const selected = v.items.find((i) => keyOf(i) === v.selectedKey);
      if (selected) {
        const part = edgeOf(selected, min, true);
        if (part) return { item: selected, part };
      }
      for (let k = v.items.length - 1; k >= 0; k--) {
        const it = v.items[k];
        if (min >= Math.max(0, it.s) && min < Math.min(DAY, it.e)) return { item: it, part: edgeOf(it, min, false) || 'body' };
      }
      return null;
    }

    function endDrag() {
      if (!drag) return null;
      const d = drag;
      drag = null;
      clearTimeout(d.timer);
      try {
        svg.releasePointerCapture(d.id);
      } catch (e) {}
      return d;
    }

    svg.addEventListener('pointerdown', (ev) => {
      if (ev.button || drag) return;
      const v = cb.getView();
      const p = locate(ev);
      if (p.rad < RI - 6) return cb.onSelect(null);
      if (p.rad > RO + 26) return;
      ev.preventDefault();
      try {
        svg.setPointerCapture(ev.pointerId);
      } catch (e) {}
      const snapTo = (x) => Math.round(x / v.snap) * v.snap;
      drag = { id: ev.pointerId, last: p.min, acc: 0, x0: ev.clientX, y0: ev.clientY, touch: ev.pointerType !== 'mouse', snap: v.snap, snapTo };
      const h = hit(p.min, v);
      if (!h) {
        drag.mode = 'create-pending';
        drag.anchor = clamp(snapTo(p.min), 0, DAY - v.snap);
        return;
      }
      drag.item = h.item;
      drag.orig = { s: h.item.s, e: h.item.e };
      drag.cur = { s: h.item.s, e: h.item.e };
      if (h.part === 'body') {
        drag.mode = 'press';
        drag.timer = setTimeout(() => {
          if (!drag || drag.mode !== 'press') return;
          drag.mode = 'move';
          if (navigator.vibrate) navigator.vibrate(15);
          cb.onSelect(drag.item);
          render();
          cb.onDragInfo(drag.cur);
        }, LONG_PRESS_MS);
      } else {
        drag.mode = 'resize-' + h.part;
        cb.onSelect(h.item);
        render();
      }
    });

    svg.addEventListener('pointermove', (ev) => {
      if (!drag || ev.pointerId !== drag.id) return;
      const p = locate(ev);
      let d = p.min - drag.last;
      if (d > DAY / 2) d -= DAY;
      if (d < -DAY / 2) d += DAY;
      drag.acc += d;
      drag.last = p.min;
      const dist = Math.hypot(ev.clientX - drag.x0, ev.clientY - drag.y0);
      const sn = drag.snap, o = drag.orig;

      if (drag.mode === 'press') {
        if (!drag.touch && dist > 6) {
          // 마우스는 꾹 누르지 않아도 끌면 바로 이동한다.
          clearTimeout(drag.timer);
          drag.mode = 'move';
          cb.onSelect(drag.item);
        } else if (drag.touch && dist > 12) {
          endDrag();
          return;
        } else return;
      }
      if (drag.mode === 'create-pending') {
        if (dist > 5 && Math.abs(drag.acc) >= sn / 2) drag.mode = 'create';
        else return;
      }

      if (drag.mode === 'create') {
        const a = drag.anchor, b = drag.snapTo(drag.anchor + drag.acc);
        const s = Math.max(0, Math.min(a, b));
        let e = Math.max(a, b);
        if (e - s < sn) e = s + sn;
        if (e - s > DAY) e = s + DAY;
        drag.cur = { s, e };
      } else if (drag.mode === 'move') {
        const len = o.e - o.s;
        let s = o.s + drag.snapTo(drag.acc);
        // 일정은 원래 속한 날짜를 벗어나지 않는다.
        s = drag.item.own ? clamp(s, 0, DAY - sn) : clamp(s, Math.max(-DAY, sn - len), -sn);
        drag.cur = { s, e: s + len };
      } else if (drag.mode === 'resize-start') {
        const s = clamp(drag.snapTo(o.s + drag.acc), Math.max(0, o.e - DAY), o.e - sn);
        drag.cur = { s, e: o.e };
      } else if (drag.mode === 'resize-end') {
        const lo = drag.item.own ? o.s + sn : Math.max(o.s + sn, sn);
        const e = clamp(drag.snapTo(o.e + drag.acc), lo, o.s + DAY);
        drag.cur = { s: o.s, e };
      }
      render();
      cb.onDragInfo(drag.cur);
    });

    svg.addEventListener('pointerup', (ev) => {
      if (!drag || ev.pointerId !== drag.id) return;
      const d = endDrag();
      cb.onDragInfo(null);
      if (d.mode === 'press') cb.onTap(d.item);
      else if (d.mode === 'create-pending') cb.onSelect(null);
      else if (d.mode === 'create') cb.onCreate(d.cur.s, d.cur.e);
      else if (d.cur.s !== d.orig.s || d.cur.e !== d.orig.e) cb.onChange(d.item, d.cur.s, d.cur.e);
      render();
    });

    svg.addEventListener('pointercancel', () => {
      endDrag();
      cb.onDragInfo(null);
      render();
    });

    svg.addEventListener('contextmenu', (ev) => ev.preventDefault());

    return { render };
  };
})();
