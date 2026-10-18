// ショートカットキー: 機能ごとに1〜4文字の「呼び出し文字」を決められる(例: 線=L、四角=RT)。
// DOM に依存しない部分(登録の整理・重複の検査・キー入力の判定)をここにまとめ、node でテストする。

export const MAX_CODE_LEN = 4;
/** 続きの文字が来るかもしれないとき、確定までに待つ時間(ミリ秒) */
export const PREFIX_WAIT_MS = 700;

/** 設定画面に並べる機能。id は Editor.runShortcut が解釈する(cmd:〜 は選んだ図形などへのコマンド) */
export const SHORTCUT_GROUPS = [
  { label: "選ぶ・動かす", items: [["select", "選択"], ["marquee", "範囲選択"], ["lasso", "投げ縄"], ["hand", "移動(画面)"]] },
  { label: "作図", items: [["pen", "ペン"], ["eraser", "消しゴム"], ["line", "線"], ["arrow", "矢印"], ["rect", "四角"], ["ellipse", "丸"], ["arc", "円弧"], ["polygon", "多角形"], ["cloud", "雲"]] },
  { label: "寸法・計測", items: [["leader", "引出線"], ["dim", "寸法線"], ["calib", "縮尺設定"], ["measure", "計測"], ["dimradius", "半径寸法"], ["dimdiameter", "直径寸法"], ["dimangle", "角度寸法"], ["dimseries", "直列寸法"], ["dimpara", "並列寸法"]] },
  { label: "修正", items: [["cmd:move", "移動(選んだ図形)"], ["cmd:copy", "コピー(選んだ図形)"], ["cmd:mirror", "ミラー複写(元を残す)"], ["cmd:mirrormove", "ミラー(元を消す)"], ["cmd:join", "結合"], ["cmd:explode", "分解"], ["trim", "トリム"], ["extend", "延長"], ["break", "切断"], ["stretch", "ストレッチ"]] },
  { label: "挿入", items: [["text", "文字"], ["sign", "署名"]] },
];
export const SHORTCUT_IDS = SHORTCUT_GROUPS.flatMap((g) => g.items.map((x) => x[0]));
export const SHORTCUT_LABEL = Object.fromEntries(SHORTCUT_GROUPS.flatMap((g) => g.items));

/** 初期のショートカット(これまでの1文字キーと同じ) */
export const DEFAULT_SHORTCUTS = {
  select: "v", marquee: "w", pen: "n", line: "l", rect: "r", ellipse: "c", arc: "a", polygon: "p", cloud: "o",
  text: "t", leader: "q", dim: "d", eraser: "e", hand: "h",
  "cmd:move": "m", "cmd:copy": "k", "cmd:explode": "x", "cmd:join": "j",
};

/** 入力された文字を、使える文字(英数字・小文字・4文字まで)に整える */
export const normalizeCode = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, MAX_CODE_LEN);

/** 保存されている「初期から変えた分」を初期値に重ねて、機能 → 文字 の対応にする。空文字は「なし」 */
export function resolveShortcuts(overrides) {
  const out = {};
  for (const id of SHORTCUT_IDS) {
    const o = overrides && Object.prototype.hasOwnProperty.call(overrides, id) ? normalizeCode(overrides[id]) : DEFAULT_SHORTCUTS[id] || "";
    if (o) out[id] = o;
  }
  return out;
}

/** 初期値と違うものだけを取り出す(保存用)。初期にあるものを消したときは "" で残す */
export function diffFromDefault(map) {
  const out = {};
  for (const id of SHORTCUT_IDS) {
    const v = normalizeCode(map[id]);
    if (v !== (DEFAULT_SHORTCUTS[id] || "")) out[id] = v;
  }
  return out;
}

/** 同じ文字を複数の機能に登録していないか。{ dups: [[文字, [id…]]…], prefixes: [[短い方, 長い方]…] } */
export function checkShortcuts(map) {
  const byCode = new Map();
  for (const [id, code] of Object.entries(map)) {
    if (!code) continue;
    if (!byCode.has(code)) byCode.set(code, []);
    byCode.get(code).push(id);
  }
  const dups = [...byCode].filter(([, ids]) => ids.length > 1);
  const codes = [...byCode.keys()];
  const prefixes = [];
  for (const a of codes) for (const b of codes) if (a !== b && b.startsWith(a)) prefixes.push([a, b]);
  return { dups, prefixes };
}

/**
 * キー入力の判定。feed(キー) が true を返したら、そのキーはショートカットとして使った。
 * 「L」と「LA」の両方があるときは、Lのあと wait ミリ秒のあいだ次の文字を待ち、来なければLとして確定する。
 */
export class KeyMatcher {
  constructor({ onFire, onChange = () => {}, wait = PREFIX_WAIT_MS, setTimer = setTimeout, clearTimer = clearTimeout }) {
    this.onFire = onFire;
    this.onChange = onChange;
    this.wait = wait;
    // setTimeout は this が window でないと "Illegal invocation" になるので、関数として包んで持つ
    this.setTimer = (fn, ms) => setTimer(fn, ms);
    this.clearTimer = (t) => clearTimer(t);
    this.codes = new Map();
    this.buf = "";
    this.timer = null;
  }
  /** map: 機能 → 文字 */
  setMap(map) {
    this.codes = new Map();
    for (const [id, code] of Object.entries(map)) if (code && !this.codes.has(code)) this.codes.set(code, id);
    this.reset();
  }
  reset() {
    this.clearTimer(this.timer);
    this.timer = null;
    if (this.buf) {
      this.buf = "";
      this.onChange("");
    }
  }
  candidates(s) {
    const out = [];
    for (const c of this.codes.keys()) if (c.startsWith(s)) out.push(c);
    return out;
  }
  fire(code) {
    const id = this.codes.get(code);
    this.reset();
    if (id) this.onFire(id);
  }
  feed(key) {
    if (!/^[a-zA-Z0-9]$/.test(key || "")) return false;
    this.clearTimer(this.timer);
    this.timer = null;
    const ch = key.toLowerCase();
    let nb = this.buf + ch;
    let cands = this.candidates(nb);
    if (!cands.length && this.buf) {
      nb = ch; // 続かない文字は、新しく打ち始めたものとして扱う
      cands = this.candidates(nb);
    }
    if (!cands.length) {
      this.reset();
      return false;
    }
    this.buf = nb;
    const exact = this.codes.has(nb);
    if (exact && cands.length === 1) {
      this.fire(nb);
    } else if (exact) {
      this.onChange(nb);
      this.timer = this.setTimer(() => this.fire(nb), this.wait);
    } else {
      this.onChange(nb);
      this.timer = this.setTimer(() => this.reset(), this.wait * 2);
    }
    return true;
  }
}
