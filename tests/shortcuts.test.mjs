import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SHORTCUTS, SHORTCUT_IDS, normalizeCode, resolveShortcuts, diffFromDefault, checkShortcuts, KeyMatcher } from "../js/shortcuts.js";

test("入力の整え: 英数字の小文字、4文字まで", () => {
  assert.equal(normalizeCode(" L-a "), "la");
  assert.equal(normalizeCode("ABCDEFG"), "abcd");
  assert.equal(normalizeCode("あ"), "");
});
test("初期値と上書き: 空文字は「なし」、上書きしたものだけ保存", () => {
  assert.deepEqual(resolveShortcuts(undefined), DEFAULT_SHORTCUTS);
  const r = resolveShortcuts({ line: "ln", rect: "" });
  assert.equal(r.line, "ln");
  assert.equal(r.rect, undefined);
  assert.equal(r.pen, "n");
  assert.deepEqual(diffFromDefault(r), { line: "ln", rect: "" });
  assert.deepEqual(diffFromDefault(resolveShortcuts(undefined)), {});
});
test("初期の文字はどの機能も重ならない・全部の機能が一覧にある", () => {
  assert.deepEqual(checkShortcuts(DEFAULT_SHORTCUTS), { dups: [], prefixes: [] });
  for (const id of Object.keys(DEFAULT_SHORTCUTS)) assert.ok(SHORTCUT_IDS.includes(id), id);
});
test("重複と、他の頭になる登録を見つける", () => {
  const c = checkShortcuts({ line: "l", rect: "l", arc: "la", pen: "n" });
  assert.deepEqual(c.dups, [["l", ["line", "rect"]]]);
  assert.deepEqual(c.prefixes, [["l", "la"]]);
});

function rig(map, wait = 700) {
  const fired = [];
  const shown = [];
  let now = 0;
  const timers = [];
  const m = new KeyMatcher({
    onFire: (id) => fired.push(id),
    onChange: (b) => shown.push(b),
    wait,
    setTimer: (fn, ms) => (timers.push({ fn, at: now + ms }), timers.length - 1),
    clearTimer: (i) => i != null && timers[i] && (timers[i].dead = true),
  });
  m.setMap(map);
  const advance = (ms) => {
    now += ms;
    for (const t of timers) if (!t.dead && t.at <= now) { t.dead = true; t.fn(); }
  };
  return { m, fired, shown, advance };
}
test("1文字: 押した瞬間に実行", () => {
  const r = rig({ line: "l", rect: "r" });
  assert.equal(r.m.feed("l"), true);
  assert.deepEqual(r.fired, ["line"]);
  assert.equal(r.m.feed("L"), true); // 大文字でも同じ
  assert.deepEqual(r.fired, ["line", "line"]);
});
test("登録のない文字・記号は使わない", () => {
  const r = rig({ line: "l" });
  assert.equal(r.m.feed("z"), false);
  assert.equal(r.m.feed("Escape"), false);
  assert.equal(r.m.feed("ArrowLeft"), false);
  assert.deepEqual(r.fired, []);
});
test("複数文字: 続けて打つと実行(待たない)", () => {
  const r = rig({ rect: "rt", pen: "n" });
  r.m.feed("r");
  assert.deepEqual(r.fired, []);
  assert.deepEqual(r.shown, ["r"]);
  r.m.feed("t");
  assert.deepEqual(r.fired, ["rect"]);
  assert.equal(r.shown.at(-1), "");
});
test("LとLAがあるとき: Lは待ってから確定・LAは続けて打てば実行", () => {
  const r = rig({ line: "l", arc: "la" });
  r.m.feed("l");
  assert.deepEqual(r.fired, []);
  r.advance(699);
  assert.deepEqual(r.fired, []);
  r.advance(2);
  assert.deepEqual(r.fired, ["line"]);
  r.m.feed("l");
  r.m.feed("a");
  assert.deepEqual(r.fired, ["line", "arc"]);
  r.advance(5000);
  assert.deepEqual(r.fired, ["line", "arc"]); // 待ちは取り消されている
});
test("途中で外れたら、その文字から打ち直しとして扱う", () => {
  const r = rig({ rect: "rt", pen: "n" });
  r.m.feed("r");
  r.m.feed("n");
  assert.deepEqual(r.fired, ["pen"]);
  r.m.feed("r");
  r.advance(2000); // 確定しない候補は一定時間で捨てる
  r.m.feed("t");
  assert.deepEqual(r.fired, ["pen"]); // 「t」だけでは何も起きない
});
test("reset で入力途中を捨てる", () => {
  const r = rig({ line: "l", arc: "la" });
  r.m.feed("l");
  r.m.reset();
  r.advance(2000);
  assert.deepEqual(r.fired, []);
});
test("既定のタイマー(setTimeout)でも動く(this の取り違えで落ちない)", () => {
  const m = new KeyMatcher({ onFire() {} });
  m.setMap({ line: "l", arc: "la" });
  assert.equal(m.feed("l"), true); // 待ちの timer を張る
  m.reset(); // clearTimeout を呼ぶ
});
