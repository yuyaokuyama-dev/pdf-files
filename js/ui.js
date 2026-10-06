// 共通UI部品: トースト・処理中表示・ダイアログ・ポップアップメニュー
import { icon } from "./icons.js";

export const $ = (s, r = document) => r.querySelector(s);
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

let toastTimer;
export function toast(msg, { error = false, ms = 3400 } = {}) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast" + (error ? " err" : "");
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), error ? Math.max(ms, 5000) : ms);
}

export function busy(msg = "処理中…") {
  const b = $("#busy");
  $("#busyMsg").textContent = msg;
  $("#busyBar").style.width = "0%";
  b.hidden = false;
  return {
    update(p, m) {
      if (m) $("#busyMsg").textContent = m;
      if (p != null) $("#busyBar").style.width = `${Math.round(p * 100)}%`;
    },
    close() {
      b.hidden = true;
    },
  };
}

/**
 * ダイアログを開き、押されたボタンの value を返す(キャンセルは null)。
 * buttons[].action(dlg) が false を返すと閉じない(入力チェック用)。
 */
export function dialog({ title, body, buttons = [{ label: "閉じる", value: true, primary: true }], onOpen, width }) {
  return new Promise((resolve) => {
    const dlg = document.createElement("dialog");
    if (width) dlg.style.width = width;
    dlg.innerHTML = `<form method="dialog" class="dlg" novalidate>
      ${title ? `<h2>${esc(title)}</h2>` : ""}
      <div class="dlg-body">${body || ""}</div>
      <div class="foot">${buttons.map((b, i) => `<button type="button" class="btn${b.primary ? " primary" : ""}${b.danger ? " danger" : ""}" data-i="${i}"${b.id ? ` id="${b.id}"` : ""}>${esc(b.label)}</button>`).join("")}</div>
    </form>`;
    $("#dialogs").appendChild(dlg);
    let done = false;
    const close = (v) => {
      if (done) return;
      done = true;
      if (dlg.open) dlg.close();
      dlg.remove();
      resolve(v);
    };
    dlg.addEventListener("cancel", (e) => {
      e.preventDefault();
      close(null);
    });
    dlg.addEventListener("click", (e) => {
      if (e.target === dlg) close(null); // 背景クリックで閉じる
    });
    dlg.querySelectorAll(".foot .btn").forEach((el) =>
      el.addEventListener("click", async () => {
        const b = buttons[+el.dataset.i];
        if (b.action) {
          const r = await b.action(dlg);
          if (r === false) return;
        }
        close(b.value ?? true);
      }),
    );
    dlg.querySelector("form").addEventListener("submit", (e) => e.preventDefault());
    dlg.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.tagName === "INPUT" && e.target.type !== "checkbox" && e.target.type !== "radio") {
        e.preventDefault();
        const p = dlg.querySelector(".foot .btn.primary");
        p?.click();
      }
    });
    dlg.showModal();
    onOpen?.(dlg, close);
  });
}

export const confirmDialog = (message, { ok = "OK", danger = false, title } = {}) =>
  dialog({
    title,
    body: `<p>${esc(message).replace(/\n/g, "<br>")}</p>`,
    buttons: [
      { label: "キャンセル", value: false },
      { label: ok, value: true, primary: !danger, danger },
    ],
  }).then((v) => v === true);

export const alertDialog = (message, title) => dialog({ title, body: `<p>${esc(message).replace(/\n/g, "<br>")}</p>` });

/** 1行入力。入力値(または null)を返す */
export function promptDialog({ title, label, value = "", placeholder = "", type = "text", inputmode, ok = "OK", note }) {
  let out = null;
  return dialog({
    title,
    body: `<label class="field">${esc(label || "")}<input type="${type}" id="pdIn" value="${esc(value)}" placeholder="${esc(placeholder)}"${inputmode ? ` inputmode="${inputmode}"` : ""}></label>${note ? `<p class="note">${esc(note)}</p>` : ""}`,
    buttons: [
      { label: "キャンセル", value: null },
      { label: ok, value: true, primary: true, action: (d) => ((out = d.querySelector("#pdIn").value), true) },
    ],
    onOpen: (d) => setTimeout(() => d.querySelector("#pdIn")?.focus(), 30),
  }).then((v) => (v === true ? out : null));
}

/** ポップアップメニュー。items: [{label, icon, onClick, sep, header, disabled}] */
export function showMenu(anchor, items, { align = "left" } = {}) {
  const m = $("#menu");
  m.innerHTML = items
    .map((it, i) =>
      it.sep ? "<hr>" : it.header ? `<div class="mlabel">${esc(it.header)}</div>` : `<button data-i="${i}"${it.disabled ? " disabled" : ""}>${it.icon ? icon(it.icon, 20) : ""}<span>${esc(it.label)}</span></button>`,
    )
    .join("");
  m.hidden = false;
  const r = anchor.getBoundingClientRect();
  const w = m.offsetWidth;
  const h = m.offsetHeight;
  let left = align === "right" ? r.right - w : r.left;
  left = Math.max(8, Math.min(innerWidth - w - 8, left));
  let top = r.bottom + 6;
  if (top + h > innerHeight - 8) top = Math.max(8, r.top - h - 6);
  m.style.left = `${left}px`;
  m.style.top = `${top}px`;
  const close = () => {
    m.hidden = true;
    document.removeEventListener("pointerdown", onDoc, true);
    document.removeEventListener("keydown", onKey, true);
  };
  const onDoc = (e) => {
    if (!m.contains(e.target)) close();
  };
  const onKey = (e) => e.key === "Escape" && close();
  setTimeout(() => {
    document.addEventListener("pointerdown", onDoc, true);
    document.addEventListener("keydown", onKey, true);
  });
  m.onclick = (e) => {
    const b = e.target.closest("button[data-i]");
    if (!b) return;
    const it = items[+b.dataset.i];
    close();
    it.onClick?.();
  };
  return close;
}

export function showBanner(html, actions = []) {
  const b = $("#banner");
  b.innerHTML = `<span>${html}</span>`;
  for (const a of actions) {
    const btn = document.createElement("button");
    btn.className = "btn" + (a.primary ? " primary" : "");
    btn.textContent = a.label;
    btn.onclick = () => {
      b.hidden = true;
      a.onClick?.();
    };
    b.appendChild(btn);
  }
  b.hidden = false;
}
export const hideBanner = () => ($("#banner").hidden = true);

export function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 2 : 1)} MB`;
}
export function fmtDate(t) {
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
