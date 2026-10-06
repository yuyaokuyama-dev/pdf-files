// 手書きパッド(署名・手書き印影用)。ポインタの粗い入力を中点法のベジェでなめらかにして描画する。
import { createPenFilter, mid } from "./geometry.js";
import { trimCanvas } from "./raster.js";

export function createPad(canvas, { color = "#111827", width = 3 } = {}) {
  const ratio = Math.max(2, Math.min(3, window.devicePixelRatio || 2));
  const state = { color, width, strokes: [], cur: null };
  const g = canvas.getContext("2d");

  function resize() {
    const r = canvas.getBoundingClientRect();
    canvas.width = Math.max(10, Math.round(r.width * ratio));
    canvas.height = Math.max(10, Math.round(r.height * ratio));
    redraw();
  }

  const toLocal = (e) => {
    const r = canvas.getBoundingClientRect();
    return [(e.clientX - r.left) * (canvas.width / r.width) / ratio, (e.clientY - r.top) * (canvas.height / r.height) / ratio];
  };

  function drawStroke(s, upTo = s.pts.length) {
    const pts = s.pts;
    g.save();
    g.scale(ratio, ratio);
    g.strokeStyle = s.color;
    g.fillStyle = s.color;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.lineWidth = s.width;
    if (upTo === 1) {
      g.beginPath();
      g.arc(pts[0][0], pts[0][1], s.width / 2, 0, Math.PI * 2);
      g.fill();
    } else if (upTo > 1) {
      g.beginPath();
      g.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < upTo - 1; i++) {
        const m = mid(pts[i], pts[i + 1]);
        g.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1]);
      }
      const last = pts[upTo - 1];
      g.lineTo(last[0], last[1]);
      g.stroke();
    }
    g.restore();
  }

  function redraw() {
    g.clearRect(0, 0, canvas.width, canvas.height);
    for (const s of state.strokes) drawStroke(s);
    if (state.cur) drawStroke(state.cur);
  }

  let raf = 0;
  canvas.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    const f = createPenFilter({ smoothing: 0.45, minDist: 0.5 });
    const p = f.add(toLocal(e));
    state.cur = { pts: [p], color: state.color, width: state.width, filter: f, id: e.pointerId };
    redraw();
  });
  canvas.addEventListener("pointermove", (e) => {
    const s = state.cur;
    if (!s || e.pointerId !== s.id) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ce of evs.length ? evs : [e]) {
      const q = s.filter.add(toLocal(ce));
      if (q) s.pts.push(q);
    }
    if (!raf) raf = requestAnimationFrame(() => ((raf = 0), redraw()));
  });
  const end = (e) => {
    const s = state.cur;
    if (!s || (e && e.pointerId !== s.id)) return;
    state.cur = null;
    delete s.filter;
    state.strokes.push(s);
    redraw();
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);

  new ResizeObserver(resize).observe(canvas);
  resize();

  return {
    clear() {
      state.strokes = [];
      redraw();
    },
    undo() {
      state.strokes.pop();
      redraw();
    },
    setColor(c) {
      state.color = c;
    },
    setWidth(w) {
      state.width = w;
    },
    isEmpty: () => state.strokes.length === 0,
    /** 余白を切り詰めた透明PNG。{ url, aspect } または null */
    toResult() {
      const t = trimCanvas(canvas, 6);
      if (!t) return null;
      return { url: t.toDataURL("image/png"), aspect: t.width / t.height };
    },
  };
}
