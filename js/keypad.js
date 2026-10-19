// iPhone 用の常設テンキー(プロパティの下)。画面キーボードを出さずに数字を入力する
const MQ = "(max-width: 800px) and (pointer: coarse)";
const KEYS = [
  ["7", "8", "9", "⌫"],
  ["4", "5", "6", "C"],
  ["1", "2", "3", "−"],
  ["0", ".", "↵"],
];
const isNum = (el) =>
  el instanceof HTMLInputElement && !el.closest("dialog") && (el.type === "number" || el.getAttribute("inputmode") === "decimal" || el.getAttribute("inputmode") === "none") && el.type !== "range" && (el.closest("#props") || el.closest(".dynbox"));

export function keypadOn() {
  return !!document.getElementById("keypad") && !document.getElementById("keypad").hidden;
}

export function initKeypad({ editor }) {
  const host = document.getElementById("keypad");
  if (!host) return;
  const mq = matchMedia(MQ);
  let fold = false;
  try { fold = localStorage.getItem("keypadFold") === "1"; } catch {}
  let el = null, key = null, buf = "", fresh = true;

  host.innerHTML = `<div class="kp-head"><span class="kp-lbl" id="kpLbl">数字入力</span><output id="kpOut" class="kp-out"></output><button type="button" class="kp-fold" id="kpFold" aria-label="テンキーを畳む">▾</button></div>
    <div class="kp-grid">${KEYS.map((r) => r.map((k) => `<button type="button" class="kp-k${k === "0" ? " kp-0" : ""}${"⌫C−↵".includes(k) ? " kp-fn" : ""}" data-key="${k}">${k}</button>`).join("")).join("")}</div>`;
  const out = host.querySelector("#kpOut"), lbl = host.querySelector("#kpLbl");

  function sync() {
    const on = mq.matches;
    host.hidden = !on;
    host.classList.toggle("fold", fold);
    document.documentElement.classList.toggle("kp-on", on && !fold);
    host.querySelector("#kpFold").textContent = fold ? "▴" : "▾";
    host.querySelector("#kpFold").setAttribute("aria-label", fold ? "テンキーを開く" : "テンキーを畳む");
  }
  mq.addEventListener?.("change", sync);
  sync();

  const show = () => { out.textContent = buf; };
  const label = (e) => (e?.closest("label")?.firstChild?.textContent || e?.getAttribute("aria-label") || "数字入力").trim();
  function pick(e) {
    if (e === el) return;
    el = e; key = e.dataset.k || null; buf = ""; fresh = true;
    lbl.textContent = label(e);
    show();
  }
  const current = () => {
    if (el && el.isConnected) return el;
    if (key) { // プロパティが描き直されたら同じ項目を探し直す
      const n = document.querySelector(`#props input[data-k="${CSS.escape(key)}"]:not([type=range])`);
      if (n) { el = n; n.focus({ preventScroll: true }); return n; }
    }
    return null;
  };

  // 画面キーボードを出さない(テンキーで打つため)
  const quiet = (t) => {
    if (host.hidden || !isNum(t)) return;
    if (t.getAttribute("inputmode") !== "none") t.setAttribute("inputmode", "none");
  };
  document.addEventListener("pointerdown", (e) => quiet(e.target), true);
  document.addEventListener("focusin", (e) => {
    quiet(e.target);
    if (!host.hidden && isNum(e.target)) pick(e.target);
  }, true);

  function put(n, v) {
    // type=number は「1.」を受け付けないので、末尾の「.」「-」は見せずに保持する
    n.value = n.type === "number" ? v.replace(/\.$/, "").replace(/^-$/, "") : v;
    n.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function press(k) {
    const n = current();
    if (!n) { // 入力欄がなければ移動・コピーの距離入力へ
      const map = { "⌫": "Backspace", "↵": "Enter", C: "Escape" };
      if (k === "−") return;
      editor?.moveDistKey?.({ key: map[k] || k, preventDefault() {}, stopPropagation() {} });
      return;
    }
    if (k === "↵") {
      n.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      n.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    if (fresh && k !== "⌫" && k !== "C") { buf = ""; }
    if (k === "⌫") buf = buf.slice(0, -1);
    else if (k === "C") buf = "";
    else if (k === "−") buf = buf.startsWith("-") ? buf.slice(1) : "-" + buf;
    else if (k === ".") { if (!buf.includes(".")) buf = (buf === "" || buf === "-" ? buf + "0" : buf) + "."; }
    else buf += k;
    fresh = false;
    put(current() || n, buf);
    show();
  }

  host.addEventListener("pointerdown", (e) => { if (e.target.closest("button")) e.preventDefault(); });
  host.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.id === "kpFold") {
      fold = !fold;
      try { localStorage.setItem("keypadFold", fold ? "1" : "0"); } catch {}
      sync();
      return;
    }
    if (b.dataset.key) press(b.dataset.key);
  });
}
