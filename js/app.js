// アプリ本体: 認証 → エディタ起動 → ファイル操作 / Google連携 / オフライン対応
import * as pdfjs from "../vendor/pdf.min.mjs";
import * as auth from "./account.js";
import { openStore, uid } from "./store.js";
import { DocModel, A4 } from "./model.js";
import { Editor } from "./editor.js";
import { Thumbs } from "./thumbs.js";
import { Props } from "./props.js";
import { exportPdf, LEVELS } from "./export.js";
import * as G from "./google.js";
import { makeScale, formatLength } from "./geometry.js";
import { fileToDataUrl, downscaleToDataUrl, stampFromImage, makeHankoDataUrl, loadImage } from "./raster.js";
import { createPad } from "./pad.js";
import { icon } from "./icons.js";
import { $, esc, toast, busy, dialog, confirmDialog, alertDialog, promptDialog, showMenu, showBanner, hideBanner, fmtBytes, fmtDate } from "./ui.js";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdf.worker.min.mjs", import.meta.url).href;
const PDF_OPTS = {
  cMapUrl: new URL("../vendor/cmaps/", import.meta.url).href,
  cMapPacked: true,
  standardFontDataUrl: new URL("../vendor/standard_fonts/", import.meta.url).href,
  wasmUrl: new URL("../vendor/wasm/", import.meta.url).href,
};

const S = { user: null, store: null, model: null, editor: null, thumbs: null, props: null, settings: { level: "small", palm: false, notify: false }, savedSrc: new Set(), deferredInstall: null };
window.__apdf = S; // 動作確認用
S.exportPdf = exportPdf;
S.G = G;

/* =========================================================
 * PDF 読み込み
 * ======================================================= */
async function loadPdf(bytes) {
  const task = pdfjs.getDocument({ data: bytes.slice(), ...PDF_OPTS });
  try {
    return await task.promise;
  } catch (e) {
    if (e?.name === "PasswordException") throw new Error("パスワード付きPDFは開けません。パスワードを解除したPDFを開いてください");
    if (e?.name === "InvalidPDFException") throw new Error("PDFとして読み込めませんでした(壊れているか、PDFではありません)");
    throw e;
  }
}
const getPdfPage = async (page) => {
  if (!page.srcId) return null;
  const src = S.model.sources.get(page.srcId);
  return src ? src.pdf.getPage(page.srcIndex + 1) : null;
};

/* =========================================================
 * 起動・認証
 * ======================================================= */
async function boot() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch((e) => console.warn("SW", e));
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    S.deferredInstall = e;
  });
  await auth.init();
  wireAuth();
  const u = auth.currentUser();
  if (u) {
    await enterApp(u);
    // 共有アカウントはサーバー側の有効性を確認(オフラインなら確認せず続行)
    auth.verifySession().then((ok) => {
      if (!ok) {
        auth.logout();
        alert("ログインの有効期限が切れました。もう一度ログインしてください。");
        location.reload();
      }
    });
  } else showAuth();
}

function showAuth() {
  $("#app").hidden = true;
  $("#auth").hidden = false;
  if (!globalThis.crypto?.subtle) {
    $("#authMsg").textContent = "この環境ではログイン機能を使えません。https:// または localhost で開いてください。";
  }
}

function wireAuth() {
  let mode = "login";
  const shared = auth.mode() === "shared";
  const setMode = (m) => {
    mode = m;
    $("#tabLogin").classList.toggle("on", m === "login");
    $("#tabRegister").classList.toggle("on", m === "register");
    $("#authPw2Row").hidden = m !== "register";
    $("#authNameRow").hidden = !(shared && m === "register");
    $("#authForgot").hidden = !(shared && m === "login");
    $("#authSubmit").textContent = m === "login" ? "ログイン" : "登録してはじめる";
    $("#authPw").autocomplete = m === "login" ? "current-password" : "new-password";
    $("#authMsg").textContent = "";
  };
  $("#authIdLabel").textContent = shared ? "メールアドレス" : "ID(メールアドレスなど)";
  $("#authHint").textContent = shared
    ? "アカウントは共有サーバー(Buildsと共通)に保存されます。一度ログインすれば、オフラインでも使えます。"
    : "アカウントはこの端末内に安全に保存されます(サーバーへは送信しません)。";
  $("#tabLogin").onclick = () => setMode("login");
  $("#tabRegister").onclick = () => setMode("register");
  $("#authForgot").onclick = () => forgotPasswordDialog($("#authId").value.trim());
  if (!auth.hasAnyUser()) setMode("register");
  else setMode("login");
  $("#authForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("#authMsg");
    msg.textContent = "";
    const id = $("#authId").value.trim();
    const pw = $("#authPw").value;
    const btn = $("#authSubmit");
    btn.disabled = true;
    try {
      if (mode === "register") {
        if (pw !== $("#authPw2").value) throw new Error("確認用パスワードが一致しません");
        await auth.register(id, pw, $("#authName").value);
      }
      const uid = await auth.login(id, pw, { remember: $("#authRemember").checked });
      $("#authPw").value = $("#authPw2").value = "";
      await enterApp(uid);
    } catch (err) {
      msg.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });
}

/** パスワードの再設定(確認コードは管理者が発行して本人に伝える。Builds互換の表示方式のときは画面に出る) */
async function forgotPasswordDialog(email = "") {
  const display = auth.resetMode() === "display";
  await dialog({
    title: "パスワードの再設定",
    body: `<p class="note">${display
      ? "メールアドレスを入れて「コードを表示」を押し、表示された6桁のコードで再設定します。"
      : "確認コードは<b>管理者が発行</b>します。管理者からコードを受け取ったら、下に入力してください。"}</p>
      <label class="field">メールアドレス<input type="text" inputmode="email" id="fpEmail" autocapitalize="off" value="${esc(email)}"></label>
      ${display ? `<button type="button" class="btn" id="fpReq">コードを表示</button><p id="fpShown" class="note"></p>` : ""}
      <label class="field">確認コード(6桁)<input type="text" inputmode="numeric" id="fpCode" maxlength="6" autocomplete="one-time-code"></label>
      <label class="field">新しいパスワード(8文字以上)<input type="password" id="fpPw" autocomplete="new-password"></label>
      <p id="fpMsg" class="msg" role="alert"></p>`,
    onOpen: (d) => {
      d.querySelector("#fpReq")?.addEventListener("click", async () => {
        try {
          const r = await auth.requestReset(d.querySelector("#fpEmail").value);
          d.querySelector("#fpShown").textContent = r.resetCode ? `確認コード: ${r.resetCode}(30分有効)` : r.notice || "";
        } catch (e) {
          d.querySelector("#fpMsg").textContent = e.message;
        }
      });
    },
    buttons: [{ label: "キャンセル", value: null }, { label: "再設定してログイン", value: true, primary: true, action: async (d) => {
      const msg = d.querySelector("#fpMsg");
      msg.textContent = "";
      try {
        const uid = await auth.confirmReset(d.querySelector("#fpEmail").value, d.querySelector("#fpCode").value, d.querySelector("#fpPw").value);
        d.querySelector("#fpPw").value = "";
        await enterApp(uid);
        toast("パスワードを再設定しました");
        return true;
      } catch (e) {
        msg.textContent = e.message;
        return false;
      }
    } }],
  });
}

/** 管理者: 利用者の確認コードを発行 */
async function issueResetDialog() {
  const email = await promptDialog({ title: "再設定コードの発行", label: "コードを発行するアカウントのメールアドレス", placeholder: "name@example.com", ok: "発行" });
  if (!email) return;
  try {
    const r = await auth.issueReset(email);
    await dialog({ title: "確認コード", body: `<p><b style="font-size:28px;letter-spacing:4px">${esc(r.resetCode)}</b></p><p class="note">${esc(r.email)} 用・30分有効。本人に直接伝えてください(5回間違えると無効になります)。</p>` });
  } catch (e) {
    toast(e.message, { error: true });
  }
}

async function enterApp(user) {
  S.user = user;
  S.store = openStore(user);
  S.settings = { ...S.settings, ...(await S.store.getSetting("settings", {})) };
  $("#auth").hidden = true;
  $("#app").hidden = false;
  if (!S.editor) initUI();
  S.editor.setPalm(S.settings.palm);
  // 前回の続きを開く
  const last = await S.store.getSetting("lastProject", null);
  let restored = false;
  if (last) {
    try {
      restored = await openProject(last, { silent: true });
    } catch (e) {
      console.warn("restore failed", e);
    }
  }
  if (!restored) setDoc(new DocModel());
  updateNet();
  refreshQueueBadge();
  if (G.isConfigured() && navigator.onLine) G.preload?.();
}

/* =========================================================
 * UI 初期化
 * ======================================================= */
const TOOLS = [
  { id: "select", icon: "select", label: "選択" },
  { id: "hand", icon: "hand", label: "移動" },
  { sep: true },
  { id: "pen", icon: "pen", label: "ペン", hint: "指・ペン・マウスでなめらかに手書きできます" },
  { id: "line", icon: "line", label: "線", hint: "ドラッグで線を引きます(Shiftで45°刻み)" },
  { id: "arrow", icon: "arrow", label: "矢印", hint: "ドラッグで矢印を引きます" },
  { id: "rect", icon: "rect", label: "四角", hint: "ドラッグで四角を描きます" },
  { id: "ellipse", icon: "ellipse", label: "丸", hint: "ドラッグで丸(楕円)を描きます" },
  { id: "polygon", icon: "polygon", label: "多角形", hint: "角をタップして点を打ち、最初の点をタップまたは「完了」で閉じます" },
  { id: "cloud", icon: "cloud", label: "雲", hint: "ドラッグで雲マークを描きます。ピッチは右のパネルで変更" },
  { id: "text", icon: "text", label: "文字", hint: "入れたい場所をタップして文字を入力します" },
  { sep: true },
  { id: "dim", icon: "dim", label: "寸法線", hint: "測りたい2点をドラッグ → 数値を入力します" },
  { id: "calib", icon: "calib", label: "縮尺設定", hint: "実際の長さが分かる2点をドラッグ → 実寸を入力して縮尺を設定" },
  { id: "measure", icon: "measure", label: "計測", hint: "2点をドラッグすると、設定した縮尺で長さを計測します" },
  { sep: true },
  { id: "sign", icon: "sign", label: "署名", hint: "署名したい範囲を四角でドラッグ(タップでも可)" },
  { id: "stamp", icon: "stamp", label: "印影", hint: "押したい位置をタップします" },
  { id: "camera", icon: "camera", label: "写真", action: true },
];

function initUI() {
  const inj = (id, name, size = 22) => ($(id).innerHTML = icon(name, size));
  inj("#btnUndo", "undo");
  inj("#btnRedo", "redo");
  inj("#btnZoomOut", "minus");
  inj("#btnZoomIn", "plus");
  inj("#btnPages", "pages");
  inj("#btnUser", "user");
  $("#emptyOpen").innerHTML = `${icon("folder", 18)}PDFを開く`;
  $("#emptyDrive").innerHTML = `${icon("drive", 18)}Googleドライブから開く`;
  $("#emptyBlank").innerHTML = `${icon("blank", 18)}白紙から作成`;
  $("#emptyCamera").innerHTML = `${icon("camera", 18)}撮影して作成`;
  // 名前表示
  const dn = document.createElement("button");
  dn.id = "docName";
  dn.className = "docname";
  dn.title = "ファイル名を変更";
  $(".topbar .logo").after(dn);
  dn.onclick = renameDoc;

  S.editor = new Editor({ model: new DocModel(), viewer: $("#viewer"), pagesEl: $("#pages"), getPdfPage });
  S.thumbs = new Thumbs({ el: $("#thumbs"), editor: S.editor, getPdfPage, onAdd: (anchor) => addPageMenu(anchor) });
  S.props = new Props({
    el: $("#props"),
    editor: S.editor,
    getStamps,
    onPickStamp: pickStamp,
    onManageStamps: manageStamps,
    onToast: toast,
  });

  buildTools();
  wireEditorEvents();
  wireTopbar();
  wireDrop();
  wireNetwork();
  $("#viewer").addEventListener("pointerdown", panStart);
  window.addEventListener("pagehide", () => saveProjectNow());
  document.addEventListener("visibilitychange", () => document.hidden && saveProjectNow());
}

function buildTools() {
  const nav = $("#tools");
  nav.innerHTML = TOOLS.map((t) =>
    t.sep ? '<span class="tool-sep"></span>' : `<button class="tool" data-tool="${t.id}" title="${t.label}">${icon(t.icon, 24)}<span>${t.label}</span></button>`,
  ).join("");
  nav.addEventListener("click", (e) => {
    const b = e.target.closest(".tool");
    if (!b) return;
    const id = b.dataset.tool;
    if (id === "camera") return photoMenu(b);
    if (id === "stamp") return enterStampTool();
    S.editor.setTool(id);
  });
}

function showHint(text, ms = 4200, actions = []) {
  const h = $("#toolHint");
  if (!text) return void (h.hidden = true);
  h.innerHTML = `<span>${esc(text)}</span>`;
  for (const a of actions) {
    const b = document.createElement("button");
    b.className = "btn" + (a.primary ? " primary" : "");
    b.textContent = a.label;
    b.onclick = a.onClick;
    h.appendChild(b);
  }
  h.hidden = false;
  clearTimeout(showHint.t);
  if (ms) showHint.t = setTimeout(() => (h.hidden = true), ms);
}

function wireEditorEvents() {
  const ed = S.editor;
  ed.on("tool", (t) => {
    document.querySelectorAll(".tool").forEach((b) => b.classList.toggle("on", b.dataset.tool === t));
    const def = TOOLS.find((x) => x.id === t);
    if (t === "polygon") showHint(def.hint, 0, [{ label: "完了", primary: true, onClick: () => ed.finishPolygon() }, { label: "取消", onClick: () => ed.cancelPolygon() }]);
    else showHint(def?.hint || "", 3800);
  });
  ed.on("polygon-state", (n) => {
    if (ed.tool !== "polygon") return;
    if (n === 0) showHint(TOOLS.find((x) => x.id === "polygon").hint, 0, [{ label: "完了", primary: true, onClick: () => ed.finishPolygon() }, { label: "取消", onClick: () => ed.cancelPolygon() }]);
  });
  ed.on("zoom", (z) => ($("#btnZoomFit").textContent = `${Math.round(z * 100)}%`));
  ed.on("sign-request", signRequest);
  ed.on("dim-request", dimRequest);
  ed.on("dim-edit", dimEdit);
  ed.on("calib-request", calibRequest);
  ed.on("need-scale", () => {
    toast("先に「縮尺設定」で、実際の長さが分かる2点を指定してください");
    ed.setTool("calib");
  });
  ed.on("need-stamp", () => manageStamps());
  ed.on("pages", () => updateEmpty());
  document.querySelector('.tool[data-tool="select"]').classList.add("on");
}

function wireTopbar() {
  const ed = S.editor;
  $("#btnUndo").onclick = () => S.model.undo();
  $("#btnRedo").onclick = () => S.model.redo();
  $("#btnZoomIn").onclick = () => ed.zoomBy(1.25);
  $("#btnZoomOut").onclick = () => ed.zoomBy(0.8);
  $("#btnZoomFit").onclick = () => ed.fitWidth();
  $("#btnPages").onclick = () => {
    const t = $("#thumbs");
    t.hidden = !t.hidden;
    $("#btnPages").classList.toggle("on", !t.hidden);
    if (!t.hidden) S.thumbs.refresh(true);
  };
  $("#btnFile").onclick = (e) => fileMenu(e.currentTarget);
  $("#btnSave").onclick = (e) => saveMenu(e.currentTarget);
  $("#btnUser").onclick = (e) => userMenu(e.currentTarget);
  $("#emptyOpen").onclick = () => $("#fileOpen").click();
  $("#emptyDrive").onclick = openFromDrive;
  $("#emptyBlank").onclick = () => newBlank();
  $("#emptyCamera").onclick = () => capturePhoto().then((p) => p && newDocFromImage(p));
  $("#fileOpen").onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (f) await openLocalFile(f);
  };
  $("#fileAdd").onchange = async (e) => {
    const fs = [...e.target.files];
    e.target.value = "";
    if (fs.length) await addPdfFiles(fs);
  };
}

function updateUndoRedo() {
  $("#btnUndo").disabled = !S.model.canUndo;
  $("#btnRedo").disabled = !S.model.canRedo;
}
function updateEmpty() {
  const has = S.model.pages.length > 0;
  $("#empty").hidden = has;
  $("#pages").hidden = !has;
  $("#docName").textContent = has ? S.model.meta.name : "";
  $("#docName").hidden = !has;
}

/* =========================================================
 * ドキュメントの切り替え・保存(端末内の自動保存)
 * ======================================================= */
function setDoc(model, { fit = true } = {}) {
  S.model = model;
  model.onChange(() => {
    updateUndoRedo();
    scheduleSave();
    S.thumbs.refresh();
  });
  S.editor.setModel(model);
  S.props.bindModel();
  S.editor.pendingStamp = null;
  updateEmpty();
  updateUndoRedo();
  $("#thumbs").hidden || S.thumbs.refresh(true);
  if (fit && model.pages.length) requestAnimationFrame(() => S.editor.fitWidth());
  S.editor.setTool("select");
}

let saveTimer = 0;
let saveWarned = false;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveProjectNow, 1200);
}
async function saveProjectNow() {
  clearTimeout(saveTimer);
  const m = S.model;
  if (!m || !S.store || !m.pages.length) return;
  try {
    const data = m.serialize();
    for (const s of data.sources) {
      if (!S.savedSrc.has(m.meta.projectId + s.id)) {
        await S.store.put("projects", { id: "src:" + s.id, bytes: s.bytes });
        S.savedSrc.add(m.meta.projectId + s.id);
      }
    }
    data.sources = data.sources.map((s) => ({ id: s.id, name: s.name }));
    await S.store.put("projects", data);
    await S.store.put("recents", { id: m.meta.projectId, name: m.meta.name, driveId: m.meta.driveId, updatedAt: Date.now(), pages: m.pages.length, thumb: S.thumbs.firstThumbDataUrl() });
    await S.store.setSetting("lastProject", m.meta.projectId);
  } catch (e) {
    console.warn("autosave failed", e);
    if (!saveWarned) {
      saveWarned = true;
      toast("端末内への自動保存に失敗しました(空き容量を確認してください)", { error: true });
    }
  }
}

async function openProject(id, { silent = false } = {}) {
  const data = await S.store.get("projects", id);
  if (!data) {
    if (!silent) toast("この端末に編集データがありません", { error: true });
    return false;
  }
  for (const s of data.sources) {
    const rec = await S.store.get("projects", "src:" + s.id);
    if (!rec) throw new Error("保存データが壊れています");
    s.bytes = rec.bytes;
    S.savedSrc.add(id + s.id);
  }
  const m = await DocModel.restore(data, loadPdf);
  setDoc(m);
  return true;
}

async function newDocFromBytes(bytes, name, meta = {}) {
  const b = busy("PDFを読み込み中…");
  try {
    const pdf = await loadPdf(bytes);
    const m = new DocModel();
    m.meta.name = name.replace(/\s+/g, " ");
    Object.assign(m.meta, meta);
    await m.addSource({ name, bytes, pdf });
    setDoc(m);
    await saveProjectNow();
    return m;
  } catch (e) {
    toast(e.message || "PDFを開けませんでした", { error: true });
    return null;
  } finally {
    b.close();
  }
}

async function openLocalFile(file) {
  if (/^image\//.test(file.type)) {
    const p = await prepPhoto(file);
    return newDocFromImage(p, file.name.replace(/\.[^.]+$/, "") + ".pdf");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  await newDocFromBytes(bytes, file.name.toLowerCase().endsWith(".pdf") ? file.name : file.name + ".pdf");
}

async function addPdfFiles(files, atIndex) {
  const m = S.model;
  if (!m.pages.length) return openLocalFile(files[0]);
  const b = busy("ページを追加中…");
  try {
    let at = atIndex ?? m.indexOf(S.editor.curPageId) + 1;
    const before = m.snapshot();
    for (const f of files) {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const pdf = await loadPdf(bytes);
      const added = await m.addSource({ name: f.name, bytes, pdf }, at);
      at += added.length;
    }
    m.commit(before);
    toast(`${files.length}個のPDFのページを追加しました`);
  } catch (e) {
    toast(e.message, { error: true });
  } finally {
    b.close();
  }
}

function newBlank(landscape = false) {
  const m = new DocModel();
  m.meta.name = "白紙.pdf";
  m.pages.push({ id: "p" + uid(), srcId: null, srcIndex: 0, rot: 0, baseRot: 0, w: landscape ? A4.h : A4.w, h: landscape ? A4.w : A4.h, shapes: [], scale: null });
  setDoc(m);
  saveProjectNow();
}

async function renameDoc() {
  const v = await promptDialog({ title: "ファイル名", label: "ファイル名", value: S.model.meta.name.replace(/\.pdf$/i, ""), ok: "変更" });
  if (!v || !v.trim()) return;
  S.model.meta.name = v.trim().replace(/[\\/:*?"<>|]/g, "_") + ".pdf";
  updateEmpty();
  scheduleSave();
}

/* ---------- ドラッグ&ドロップ ---------- */
function wireDrop() {
  const v = $("#viewer");
  ["dragenter", "dragover"].forEach((t) => v.addEventListener(t, (e) => {
    if ([...(e.dataTransfer?.types || [])].includes("Files")) {
      e.preventDefault();
      v.classList.add("drop");
    }
  }));
  ["dragleave", "drop"].forEach((t) => v.addEventListener(t, () => v.classList.remove("drop")));
  v.addEventListener("drop", async (e) => {
    const f = [...(e.dataTransfer?.files || [])];
    if (!f.length) return;
    e.preventDefault();
    const pdfs = f.filter((x) => x.type === "application/pdf" || /\.pdf$/i.test(x.name));
    if (!pdfs.length && /^image\//.test(f[0].type)) return openLocalFile(f[0]);
    if (!pdfs.length) return toast("PDFファイルをドロップしてください", { error: true });
    if (S.model.pages.length && pdfs.length) {
      const r = await dialog({
        title: "PDFの開き方",
        body: "<p>すでに開いているPDFがあります。</p>",
        buttons: [{ label: "キャンセル", value: null }, { label: "ページとして追加", value: "add" }, { label: "別のファイルとして開く", value: "open", primary: true }],
      });
      if (r === "add") return addPdfFiles(pdfs);
      if (r !== "open") return;
    }
    await openLocalFile(pdfs[0]);
  });
}

/* 「移動」ツール: マウスのドラッグでスクロール */
function panStart(e) {
  if (S.editor.tool !== "hand" || e.pointerType === "touch" || e.button !== 0) return;
  const v = $("#viewer");
  const x0 = e.clientX, y0 = e.clientY, sl = v.scrollLeft, st = v.scrollTop;
  v.style.cursor = "grabbing";
  const mv = (ev) => {
    v.scrollLeft = sl - (ev.clientX - x0);
    v.scrollTop = st - (ev.clientY - y0);
  };
  const up = () => {
    v.style.cursor = "";
    window.removeEventListener("pointermove", mv);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", mv);
  window.addEventListener("pointerup", up);
}

/* =========================================================
 * メニュー
 * ======================================================= */
function fileMenu(anchor) {
  showMenu(anchor, [
    { label: "PDFを開く(この端末)", icon: "folder", onClick: () => $("#fileOpen").click() },
    { label: "Googleドライブから開く", icon: "drive", onClick: openFromDrive },
    { label: "履歴から開く", icon: "history", onClick: openHistory },
    { sep: true },
    { label: "白紙から新規作成", icon: "blank", onClick: () => newBlank() },
    { label: "写真・スキャンから新規作成", icon: "camera", onClick: () => capturePhoto().then((p) => p && newDocFromImage(p)) },
    { label: "別のPDFのページを追加", icon: "plus", onClick: () => $("#fileAdd").click(), disabled: !S.model.pages.length },
    { sep: true },
    { label: "印影の登録・管理", icon: "stamp", onClick: manageStamps },
    { label: "ホーム画面に追加(インストール)", icon: "download", onClick: installHelp },
  ]);
}

function saveMenu(anchor) {
  const has = S.model.pages.length > 0;
  showMenu(anchor, [
    { label: S.model.meta.driveId ? "Googleドライブに保存(上書き/別名)" : "Googleドライブに保存", icon: "drive", onClick: saveToDrive, disabled: !has },
    { label: "PDFを端末に保存(最適化)", icon: "download", onClick: downloadPdf, disabled: !has },
    { label: "Gmailでメール送信", icon: "mail", onClick: mailPdf, disabled: !has },
    { sep: true },
    { label: "ファイル名を変更", icon: "text", onClick: renameDoc, disabled: !has },
  ], { align: "right" });
}

function userMenu(anchor) {
  showMenu(anchor, [
    { header: `ログイン中: ${auth.currentProfile()?.displayName ? auth.currentProfile().displayName + " (" + S.user + ")" : S.user}` },
    { label: "設定", icon: "settings", onClick: openSettings },
    { label: "履歴", icon: "history", onClick: openHistory },
    { label: "使い方・ホーム画面に追加", icon: "info", onClick: installHelp },
    ...(auth.isAdmin() ? [{ label: "再設定コードの発行(管理者)", icon: "settings", onClick: issueResetDialog }] : []),
    { sep: true },
    { label: "ログアウト", icon: "logout", onClick: async () => {
      await saveProjectNow();
      auth.logout();
      location.reload();
    } },
  ], { align: "right" });
}

function addPageMenu(anchor) {
  showMenu(anchor, [
    { label: "白紙ページ(A4縦)", icon: "blank", onClick: () => S.model.insertBlank(S.model.indexOf(S.editor.curPageId) + 1) },
    { label: "白紙ページ(A4横)", icon: "blank", onClick: () => S.model.insertBlank(S.model.indexOf(S.editor.curPageId) + 1, { w: A4.h, h: A4.w }) },
    { label: "別のPDFから追加", icon: "folder", onClick: () => $("#fileAdd").click() },
    { label: "写真を新規ページに(カメラ)", icon: "camera", onClick: () => addPhotoPage("camera") },
    { label: "画像ファイルを新規ページに", icon: "image", onClick: () => addPhotoPage("file") },
  ]);
}

/* =========================================================
 * 写真・カメラ
 * ======================================================= */
async function prepPhoto(file) {
  const url = await fileToDataUrl(file);
  const r = await downscaleToDataUrl(url, 2400, 0.86);
  return { url: r.url, aspect: r.w / r.h };
}

function pickFile(inputId) {
  return new Promise((res) => {
    const input = $(inputId);
    const done = (e) => {
      input.removeEventListener("change", done);
      const f = e.target.files[0];
      e.target.value = "";
      res(f || null);
    };
    input.addEventListener("change", done);
    input.click();
  });
}

/** カメラ(スマホはOSのカメラ、PCはWebカメラ)で撮影 → { url, aspect } */
async function capturePhoto() {
  if (matchMedia("(pointer: coarse)").matches || !navigator.mediaDevices?.getUserMedia) {
    const f = await pickFile("#fileCamera");
    return f ? prepPhoto(f) : null;
  }
  return cameraDialog();
}

async function cameraDialog() {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 2560 }, height: { ideal: 1440 } } });
  } catch {
    toast("カメラを使えませんでした。画像ファイルを選んでください", { error: true });
    const f = await pickFile("#fileImage");
    return f ? prepPhoto(f) : null;
  }
  let shot = null;
  await dialog({
    title: "カメラで撮影",
    width: "min(720px, 96vw)",
    body: `<video id="camV" autoplay playsinline muted style="width:100%;max-height:60dvh;background:#000;border-radius:10px"></video>`,
    buttons: [
      { label: "キャンセル", value: null },
      { label: "撮影", value: true, primary: true, action: (d) => {
        const v = d.querySelector("#camV");
        if (!v.videoWidth) return false;
        const c = document.createElement("canvas");
        c.width = v.videoWidth;
        c.height = v.videoHeight;
        c.getContext("2d").drawImage(v, 0, 0);
        shot = c.toDataURL("image/jpeg", 0.9);
        return true;
      } },
    ],
    onOpen: (d) => {
      d.querySelector("#camV").srcObject = stream;
    },
  });
  stream.getTracks().forEach((t) => t.stop());
  if (!shot) return null;
  const r = await downscaleToDataUrl(shot, 2400, 0.86);
  return { url: r.url, aspect: r.w / r.h };
}

function photoMenu(anchor) {
  const has = S.model.pages.length > 0;
  showMenu(anchor, [
    { header: "現在のページに挿入(この上に手書き・図形で書き込めます)" },
    { label: "カメラで撮影して挿入", icon: "camera", onClick: () => insertPhoto("camera"), disabled: !has },
    { label: "画像ファイルを挿入", icon: "image", onClick: () => insertPhoto("file"), disabled: !has },
    { header: "新しいページとして追加" },
    { label: "カメラで撮影してページ追加", icon: "camera", onClick: () => addPhotoPage("camera") },
    { label: "画像ファイルをページ追加", icon: "image", onClick: () => addPhotoPage("file") },
  ]);
}

async function getPhoto(src) {
  if (src === "camera") return capturePhoto();
  const f = await pickFile("#fileImage");
  return f ? prepPhoto(f) : null;
}

async function insertPhoto(src) {
  const p = await getPhoto(src);
  if (!p) return;
  const imgId = S.model.addImage(p.url);
  S.editor.placeImageCentered(S.editor.curPageId, imgId, p.aspect, 0.8);
  toast("写真を挿入しました。ペンや図形ツールで上から書き込めます");
}

function imagePage(aspect) {
  // 写真の縦横に合わせてA4縦/横を選ぶ
  const landscape = aspect > 1.15;
  return { w: landscape ? A4.h : A4.w, h: landscape ? A4.w : A4.h };
}

function photoPageShape(m, page, p) {
  const imgId = m.addImage(p.url);
  const margin = 0;
  let w = page.w - margin * 2;
  let h = w / p.aspect;
  if (h > page.h - margin * 2) {
    h = page.h - margin * 2;
    w = h * p.aspect;
  }
  const x = (page.w - w) / 2;
  const y = (page.h - h) / 2;
  return { id: "h" + uid(), type: "image", kind: "photo", imgId, aspect: p.aspect, pts: [[x, y], [x + w, y + h]], style: {} };
}

async function addPhotoPage(src) {
  const p = await getPhoto(src);
  if (!p) return;
  const m = S.model;
  if (!m.pages.length) return newDocFromImage(p);
  const sz = imagePage(p.aspect);
  const before = m.snapshot();
  const page = { id: "p" + uid(), srcId: null, srcIndex: 0, rot: 0, baseRot: 0, w: sz.w, h: sz.h, shapes: [], scale: null };
  page.shapes.push(photoPageShape(m, page, p));
  m.pages.splice(m.indexOf(S.editor.curPageId) + 1, 0, page);
  m.commit(before);
  S.editor.scrollToPage(page.id);
  toast("写真をページに追加しました");
}

function newDocFromImage(p, name = "写真.pdf") {
  const m = new DocModel();
  m.meta.name = name;
  const sz = imagePage(p.aspect);
  const page = { id: "p" + uid(), srcId: null, srcIndex: 0, rot: 0, baseRot: 0, w: sz.w, h: sz.h, shapes: [], scale: null };
  page.shapes.push(photoPageShape(m, page, p));
  m.pages.push(page);
  setDoc(m);
  saveProjectNow();
}

/* =========================================================
 * 署名・印影
 * ======================================================= */
async function loadSigs() {
  return (await S.store.getAll("sigs")).sort((a, b) => b.createdAt - a.createdAt);
}

async function signRequest({ pageId, rect }) {
  const saved = await loadSigs();
  let pad;
  let result = null;
  let chosen = null;
  const ok = await dialog({
    title: "署名",
    body: `<canvas class="pad" id="sigPad"></canvas>
      <div class="field"><div class="row"><span>色</span>${["#111827", "#1d4ed8", "#b91c1c"].map((c, i) => `<button type="button" class="sw${i ? "" : " on"}" data-c="${c}" style="background:${c}"></button>`).join("")}
      <span style="margin-left:8px">太さ</span><input type="range" id="sigW" min="1.5" max="8" step="0.5" value="3.5"></div></div>
      <div class="row" style="display:flex;gap:8px"><button type="button" class="btn" id="sigUndo">1つ戻す</button><button type="button" class="btn" id="sigClear">消去</button>
      <label class="check" style="margin-left:auto;display:flex;gap:6px;align-items:center"><input type="checkbox" id="sigSave" checked> この署名を保存</label></div>
      ${saved.length ? `<div class="field">保存した署名(タップで使用)<div class="stamp-tray" id="sigSaved">${saved.map((s) => `<button type="button" class="st" data-id="${s.id}"><img src="${s.url}" alt=""></button>`).join("")}</div></div>` : ""}
      <p class="note">枠内に指・ペン・マウスで署名してください。署名は「選択」ツールで移動・拡大縮小できます。</p>`,
    buttons: [
      { label: "キャンセル", value: null },
      { label: "署名を入れる", value: true, primary: true, action: (d) => {
        if (chosen) return true;
        if (pad.isEmpty()) {
          toast("署名を書いてください", { error: true });
          return false;
        }
        result = pad.toResult();
        if (d.querySelector("#sigSave").checked && result) S.store.put("sigs", { id: uid(), url: result.url, aspect: result.aspect, createdAt: Date.now() });
        return true;
      } },
    ],
    onOpen: (d) => {
      pad = createPad(d.querySelector("#sigPad"), { color: "#111827", width: 3.5 });
      d.querySelectorAll(".sw").forEach((b) => (b.onclick = () => {
        d.querySelectorAll(".sw").forEach((x) => x.classList.remove("on"));
        b.classList.add("on");
        pad.setColor(b.dataset.c);
      }));
      d.querySelector("#sigW").oninput = (e) => pad.setWidth(+e.target.value);
      d.querySelector("#sigUndo").onclick = () => pad.undo();
      d.querySelector("#sigClear").onclick = () => pad.clear();
      d.querySelector("#sigSaved")?.addEventListener("click", (e) => {
        const b = e.target.closest(".st");
        if (!b) return;
        chosen = saved.find((s) => s.id === b.dataset.id);
        d.querySelector(".foot .btn.primary").click();
      });
    },
  });
  if (ok !== true) return;
  const r = chosen ? { url: chosen.url, aspect: chosen.aspect } : result;
  if (!r) return;
  const imgId = S.model.addImage(r.url);
  S.editor.placeImageInRect(pageId, imgId, r.aspect, rect, "signature");
}

async function getStamps() {
  const list = (await S.store.getAll("stamps")).sort((a, b) => a.createdAt - b.createdAt);
  return list.map((s) => ({ ...s, imgId: "st_" + s.id }));
}

function pickStamp(s) {
  if (!S.model.images.has(s.imgId)) S.model.images.set(s.imgId, s.url);
  S.editor.setPendingStamp({ imgId: s.imgId, aspect: s.aspect });
  S.editor.setTool("stamp");
}

async function enterStampTool() {
  const stamps = await getStamps();
  if (!stamps.length) return manageStamps();
  const cur = S.editor.pendingStamp ? stamps.find((s) => s.imgId === S.editor.pendingStamp.imgId) : null;
  pickStamp(cur || stamps[0]);
}

/** 印影の登録・管理(写真から作成/文字から作成/手書き) */
async function manageStamps() {
  const render = async (d) => {
    const stamps = await getStamps();
    d.querySelector("#stList").innerHTML = stamps.length
      ? stamps.map((s) => `<div class="item"><img src="${s.url}" alt=""><div class="meta"><div class="name">${esc(s.name)}</div><div class="sub">${fmtDate(s.createdAt)}</div></div><button class="btn" data-use="${s.id}">使う</button><button class="btn danger icon" data-del="${s.id}" aria-label="削除">${icon("trash", 18)}</button></div>`).join("")
      : '<p class="note">まだ印影が登録されていません。下の方法で登録してください。</p>';
  };
  await dialog({
    title: "印影の登録・管理",
    body: `<div class="list" id="stList"></div>
      <div class="field"><b style="color:var(--ink)">新しい印影を登録</b></div>
      <div class="actions" style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" id="stPhoto">${icon("camera", 18)}写真から作成</button>
        <button class="btn" id="stFile">${icon("image", 18)}画像ファイルから</button>
        <button class="btn" id="stText">${icon("text", 18)}名前から作成</button>
        <button class="btn" id="stDraw">${icon("pen", 18)}手書きで作成</button></div>
      <p class="note">白い紙に押した印影を明るい場所で撮影すると、背景が自動で透明になります。</p>`,
    buttons: [{ label: "閉じる", value: true, primary: true }],
    onOpen: async (d, close) => {
      await render(d);
      const save = async (url, name) => {
        const img = await loadImage(url);
        await S.store.put("stamps", { id: uid(), name, url, aspect: img.naturalWidth / img.naturalHeight, createdAt: Date.now() });
        await render(d);
        S.props.refresh();
        toast("印影を登録しました");
      };
      d.querySelector("#stList").addEventListener("click", async (e) => {
        const use = e.target.closest("[data-use]");
        const del = e.target.closest("[data-del]");
        if (use) {
          const s = (await getStamps()).find((x) => x.id === use.dataset.use);
          close(true);
          if (s) pickStamp(s);
        } else if (del && (await confirmDialog("この印影を削除しますか?", { ok: "削除", danger: true }))) {
          await S.store.del("stamps", del.dataset.del);
          await render(d);
        }
      });
      const fromImage = async (file) => {
        if (!file) return;
        try {
          const src = await fileToDataUrl(file);
          const url = await stampPreviewDialog(src);
          if (url) await save(url, "印影 " + fmtDate(Date.now()));
        } catch (err) {
          toast(err.message, { error: true });
        }
      };
      d.querySelector("#stPhoto").onclick = async () => fromImage(await pickFile("#fileStampCamera"));
      d.querySelector("#stFile").onclick = async () => fromImage(await pickFile("#fileStamp"));
      d.querySelector("#stText").onclick = async () => {
        const url = await hankoTextDialog();
        if (url) await save(url.url, url.name);
      };
      d.querySelector("#stDraw").onclick = async () => {
        const r = await drawStampDialog();
        if (r) await save(r, "手書き印影");
      };
    },
  });
}

async function stampPreviewDialog(src) {
  let url = null;
  let th = 190;
  let color = "#d9261c";
  const regen = async (d) => {
    try {
      url = await stampFromImage(src, { threshold: th, recolor: color === "orig" ? null : color });
      d.querySelector("#spImg").src = url;
      d.querySelector("#spMsg").textContent = "";
    } catch (e) {
      url = null;
      d.querySelector("#spImg").removeAttribute("src");
      d.querySelector("#spMsg").textContent = e.message;
    }
  };
  const r = await dialog({
    title: "印影の確認",
    body: `<div style="background:repeating-conic-gradient(#e5e7eb 0 25%,#fff 0 50%) 0 0/16px 16px;border-radius:10px;display:grid;place-items:center;min-height:160px"><img id="spImg" alt="" style="max-width:100%;max-height:220px"></div>
      <p class="msg" id="spMsg"></p>
      <label class="field">背景を消す強さ<input type="range" id="spTh" min="80" max="240" value="190"></label>
      <div class="field"><div class="row"><span>色</span><button type="button" class="sw on" data-c="#d9261c" style="background:#d9261c"></button><button type="button" class="sw" data-c="#1d4ed8" style="background:#1d4ed8"></button><button type="button" class="sw" data-c="#111827" style="background:#111827"></button><button type="button" class="btn" data-c="orig" style="min-height:28px">元の色</button></div></div>`,
    buttons: [{ label: "やめる", value: null }, { label: "この印影を登録", value: true, primary: true, action: () => !!url }],
    onOpen: (d) => {
      regen(d);
      d.querySelector("#spTh").oninput = (e) => ((th = +e.target.value), regen(d));
      d.querySelectorAll("[data-c]").forEach((b) => (b.onclick = () => {
        d.querySelectorAll(".sw").forEach((x) => x.classList.remove("on"));
        b.classList.add("on");
        color = b.dataset.c;
        regen(d);
      }));
    },
  });
  return r === true ? url : null;
}

async function hankoTextDialog() {
  let url = "";
  let name = "";
  let color = "#d9261c";
  const r = await dialog({
    title: "名前から印影を作成",
    body: `<label class="field">名前(最大4文字)<input type="text" id="hkText" maxlength="4" placeholder="例: 山田"></label>
      <div style="display:grid;place-items:center;background:#fff;border:1px solid var(--line);border-radius:10px;min-height:140px"><img id="hkImg" alt="" style="width:120px;height:120px"></div>
      <div class="field"><div class="row"><span>色</span><button type="button" class="sw on" data-c="#d9261c" style="background:#d9261c"></button><button type="button" class="sw" data-c="#b91c1c" style="background:#b91c1c"></button><button type="button" class="sw" data-c="#1d4ed8" style="background:#1d4ed8"></button></div></div>`,
    buttons: [{ label: "やめる", value: null }, { label: "登録", value: true, primary: true, action: () => !!url }],
    onOpen: (d) => {
      const upd = () => {
        const t = d.querySelector("#hkText").value.trim();
        name = t;
        url = t ? makeHankoDataUrl(t, color) : "";
        if (url) d.querySelector("#hkImg").src = url;
        else d.querySelector("#hkImg").removeAttribute("src");
      };
      d.querySelector("#hkText").oninput = upd;
      d.querySelectorAll(".sw").forEach((b) => (b.onclick = () => {
        d.querySelectorAll(".sw").forEach((x) => x.classList.remove("on"));
        b.classList.add("on");
        color = b.dataset.c;
        upd();
      }));
      setTimeout(() => d.querySelector("#hkText").focus(), 30);
    },
  });
  return r === true ? { url, name: name + "(印)" } : null;
}

async function drawStampDialog() {
  let pad;
  let out = null;
  const r = await dialog({
    title: "手書きで印影を作成",
    body: `<canvas class="pad stamp" id="dsPad"></canvas>
      <div class="row" style="display:flex;gap:8px"><button type="button" class="btn" id="dsUndo">1つ戻す</button><button type="button" class="btn" id="dsClear">消去</button></div>`,
    buttons: [{ label: "やめる", value: null }, { label: "登録", value: true, primary: true, action: () => {
      if (pad.isEmpty()) return false;
      out = pad.toResult()?.url;
      return !!out;
    } }],
    onOpen: (d) => {
      pad = createPad(d.querySelector("#dsPad"), { color: "#d9261c", width: 4 });
      d.querySelector("#dsUndo").onclick = () => pad.undo();
      d.querySelector("#dsClear").onclick = () => pad.clear();
    },
  });
  return r === true ? out : null;
}

/* =========================================================
 * 寸法・縮尺
 * ======================================================= */
async function dimRequest({ create, length, scale }) {
  const suggest = scale ? formatLength(length / scale.ptsPerUnit, scale.unit).replace(/\s?(mm|cm|m)$/, "") : "";
  const v = await promptDialog({
    title: "寸法の数値を入力",
    label: "寸法(任意の数字・文字)",
    value: suggest,
    placeholder: "例: 3600",
    ok: "入力",
    note: scale ? "縮尺から計算した値を初期表示しています。自由に書き換えられます。" : "縮尺を設定していなくても、好きな数字を入力できます。",
  });
  if (v == null) return;
  create(v.trim());
}

async function dimEdit({ shape }) {
  const v = await promptDialog({ title: "寸法の文字を編集", label: "寸法", value: shape.text || "", ok: "変更" });
  if (v == null) return;
  S.editor.setSelection({ pageId: S.editor.model.findShape(shape.id).page.id, shapeId: shape.id });
  S.editor.updateSelected((s) => (s.text = v.trim()));
}

async function calibRequest({ pageId, p0, p1, length }) {
  let real = 0;
  let unit = "mm";
  let all = false;
  const ok = await dialog({
    title: "縮尺の設定",
    body: `<p>指定した2点の<b>実際の長さ</b>を入力してください。この長さを基準に、他の2点間の長さを計測できます。</p>
      <div class="field"><div class="row"><input type="number" id="clVal" inputmode="decimal" min="0" step="any" placeholder="例: 3600" style="flex:1;height:42px;font-size:18px"><select id="clUnit" style="height:42px;width:90px"><option>mm</option><option>cm</option><option>m</option></select></div></div>
      <label class="check" style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="clAll"> 全ページに同じ縮尺を適用</label>
      <p class="note">図面上のこの2点の長さ: ${length.toFixed(1)} pt</p>`,
    buttons: [{ label: "キャンセル", value: null }, { label: "設定", value: true, primary: true, action: (d) => {
      real = parseFloat(d.querySelector("#clVal").value);
      unit = d.querySelector("#clUnit").value;
      all = d.querySelector("#clAll").checked;
      if (!(real > 0)) {
        toast("0より大きい数字を入力してください", { error: true });
        return false;
      }
      return true;
    } }],
    onOpen: (d) => setTimeout(() => d.querySelector("#clVal").focus(), 30),
  });
  if (ok !== true) return;
  const sc = makeScale(p0, p1, real, unit);
  const m = S.model;
  const page = m.page(pageId);
  m.mutate(() => {
    page.scale = sc;
    if (all) m.pages.forEach((p) => (p.scale = { ...sc }));
    page.shapes.push({ id: "h" + uid(), type: "dim", calib: true, pts: [p0, p1], off: 24, size: S.editor.dimSize, text: `${real}${unit}(基準)`, style: { color: "#2563eb", width: 1.5, dash: false } });
  });
  toast("縮尺を設定しました。「計測」ツールで他の2点の長さを測れます");
  S.editor.setTool("measure");
}

/* =========================================================
 * 書き出し(最適化)・端末保存
 * ======================================================= */
async function askExport({ title, ok = "作成", nameField = true, extraHtml = "", extraRead }) {
  let out = null;
  const lv = S.settings.level;
  const r = await dialog({
    title,
    body: `${nameField ? `<label class="field">ファイル名<input type="text" id="exName" value="${esc(S.model.meta.name.replace(/\.pdf$/i, ""))}"></label>` : ""}
      ${extraHtml}
      <div class="field">ファイルサイズの最適化</div>
      <div class="opts">${Object.entries(LEVELS).map(([k, v]) => `<label class="opt"><input type="radio" name="exLv" value="${k}"${k === lv ? " checked" : ""}><div><b>${v.label}</b><span>${{
        standard: "元のPDFの内容を保ち、挿入した写真だけを適度に圧縮します。",
        small: "写真を強めに圧縮。通常はこれで十分軽くなります。",
        tiny: "全ページを画像にして最も軽くします。文字の選択・検索はできなくなります。",
      }[k]}</span></div></label>`).join("")}</div>`,
    buttons: [{ label: "キャンセル", value: null }, { label: ok, value: true, primary: true, action: (d) => {
      const name = nameField ? d.querySelector("#exName").value.trim() : S.model.meta.name;
      if (nameField && !name) {
        toast("ファイル名を入力してください", { error: true });
        return false;
      }
      out = { name: nameField ? name.replace(/[\\/:*?"<>|]/g, "_").replace(/\.pdf$/i, "") + ".pdf" : name, level: d.querySelector('input[name="exLv"]:checked').value, extra: extraRead?.(d) };
      return true;
    } }],
  });
  if (r !== true) return null;
  S.settings.level = out.level;
  S.store.setSetting("settings", S.settings);
  return out;
}

async function runExport(level) {
  const b = busy("PDFを作成中…");
  try {
    S.editor.finishTextEdit?.();
    return await exportPdf(S.model, { level, onProgress: (p, m) => b.update(p, m) });
  } catch (e) {
    console.error(e);
    toast(`PDFの作成に失敗しました: ${e.message}`, { error: true });
    return null;
  } finally {
    b.close();
  }
}

async function deliverFile(bytes, name) {
  const file = new File([bytes], name, { type: "application/pdf" });
  const mobile = /iPhone|iPad|Android/i.test(navigator.userAgent) || matchMedia("(pointer: coarse)").matches;
  if (mobile && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return "shared";
    } catch (e) {
      if (e?.name === "AbortError") return "cancel";
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return "download";
}

async function downloadPdf() {
  const o = await askExport({ title: "PDFを端末に保存", ok: "作成して保存" });
  if (!o) return;
  const res = await runExport(o.level);
  if (!res) return;
  S.model.meta.name = o.name;
  updateEmpty();
  const how = await deliverFile(res.bytes, o.name);
  if (how !== "cancel") toast(`${o.name}(${fmtBytes(res.bytes.length)})を保存しました`);
}

/* =========================================================
 * Google 連携(ドライブ・Gmail)
 * ======================================================= */
async function ensureGoogle() {
  if (!G.isConfigured()) {
    const go = await confirmDialog("Googleドライブ/Gmailを使うには、最初に「設定」でGoogleのクライアントIDを登録する必要があります(無料・初回のみ)。設定を開きますか?", { ok: "設定を開く" });
    if (go) openSettings();
    return false;
  }
  if (!navigator.onLine) {
    toast("オフラインです。オンラインになってから実行してください", { error: true });
    return false;
  }
  return true;
}

async function googleErr(e) {
  console.error(e);
  toast(e.message || "Google連携でエラーが発生しました", { error: true });
}

async function openFromDrive() {
  if (!(await ensureGoogle())) return;
  try {
    const doc = await G.pickPdf();
    if (!doc) return;
    await openDriveFile(doc.id);
  } catch (e) {
    googleErr(e);
  }
}

async function openDriveFile(id) {
  // この端末に同じファイルの編集データがある場合は選べるようにする
  const recents = await S.store.getAll("recents");
  const local = recents.find((r) => r.driveId === id);
  if (local) {
    const c = await dialog({
      title: "どちらを開きますか?",
      body: `<p>この端末に、このファイルの<b>編集データ</b>(${fmtDate(local.updatedAt)})があります。</p>
        <p class="note">編集データには、注釈を後から移動・削除できる状態で残っています。Driveのファイルは最新ですが、書き込んだ注釈はPDFに焼き込まれています。</p>`,
      buttons: [{ label: "キャンセル", value: null }, { label: "Driveの最新を開く", value: "drive" }, { label: "編集データを開く", value: "local", primary: true }],
    });
    if (!c) return;
    if (c === "local") return void (await openProject(local.id));
  }
  const b = busy("Googleドライブから読み込み中…");
  try {
    const f = await G.downloadFile(id);
    b.close();
    await newDocFromBytes(f.bytes, f.name, { driveId: f.id, driveFolder: f.parents?.[0] || null });
  } catch (e) {
    b.close();
    googleErr(e);
  }
}

async function saveToDrive() {
  if (!G.isConfigured() && !(await ensureGoogle())) return;
  const m = S.model;
  const extra = m.meta.driveId
    ? `<div class="opts" style="margin-bottom:6px"><label class="opt"><input type="radio" name="exMode" value="overwrite" checked><div><b>上書き保存</b><span>Driveの元のファイルを更新します</span></div></label><label class="opt"><input type="radio" name="exMode" value="new"><div><b>別のファイルとして保存</b><span>新しいファイルを作ります</span></div></label></div>`
    : "";
  const o = await askExport({ title: "Googleドライブに保存", ok: "保存", extraHtml: extra, extraRead: (d) => d.querySelector('input[name="exMode"]:checked')?.value || "new" });
  if (!o) return;
  const online = navigator.onLine;
  // ブラウザのポップアップ制限を避けるため、最初にログインを済ませる
  if (online) {
    try {
      await G.getToken();
    } catch (e) {
      return googleErr(e);
    }
  }
  const res = await runExport(o.level);
  if (!res) return;
  const fileId = o.extra === "overwrite" ? m.meta.driveId : null;
  m.meta.name = o.name;
  updateEmpty();
  if (!online) {
    await enqueue({ type: "drive-save", name: o.name, bytes: res.bytes, fileId, folderId: m.meta.driveFolder, projectId: m.meta.projectId });
    toast("オフラインのため保存待ちに入れました。オンラインになったらお知らせします");
    return;
  }
  const b = busy("Googleドライブに保存中…");
  try {
    const r = await G.uploadPdf({ name: o.name, bytes: res.bytes, fileId, folderId: m.meta.driveFolder });
    m.meta.driveId = r.id;
    await saveProjectNow();
    toast(`Googleドライブに保存しました(${fmtBytes(res.bytes.length)})`);
  } catch (e) {
    googleErr(e);
  } finally {
    b.close();
  }
}

async function mailPdf() {
  if (!G.isConfigured() && !(await ensureGoogle())) return;
  const base = S.model.meta.name.replace(/\.pdf$/i, "");
  const o = await askExport({
    title: "Gmailで送信",
    ok: "送信",
    extraHtml: `<label class="field">宛先<input type="text" id="mlTo" inputmode="email" placeholder="name@example.com(複数はカンマ区切り)"></label>
      <label class="field">Cc(任意)<input type="text" id="mlCc" inputmode="email"></label>
      <label class="field">件名<input type="text" id="mlSub" value="${esc(base)}"></label>
      <label class="field">本文<textarea id="mlBody" rows="4">お世話になっております。\nPDFを添付いたします。ご確認ください。</textarea></label>`,
    extraRead: (d) => ({ to: d.querySelector("#mlTo").value.trim(), cc: d.querySelector("#mlCc").value.trim(), subject: d.querySelector("#mlSub").value, body: d.querySelector("#mlBody").value }),
  });
  if (!o) return;
  if (!o.extra.to || !/@/.test(o.extra.to)) return toast("宛先のメールアドレスを入力してください", { error: true });
  const online = navigator.onLine;
  if (online) {
    try {
      await G.getToken();
    } catch (e) {
      return googleErr(e);
    }
  }
  const res = await runExport(o.level);
  if (!res) return;
  const msg = { ...o.extra, attachments: [{ name: o.name, bytes: res.bytes, type: "application/pdf" }] };
  if (res.bytes.length > G.MAX_MAIL_BYTES) return toast(`添付が大きすぎます(${fmtBytes(res.bytes.length)}/上限 約24MB)。「最小」で最適化し直してください`, { error: true });
  if (!online) {
    await enqueue({ type: "mail", ...msg });
    toast("オフラインのため送信待ちに入れました。オンラインになったらお知らせします");
    return;
  }
  const b = busy("メールを送信中…");
  try {
    await G.sendMail(msg);
    toast(`${o.extra.to} に送信しました(${fmtBytes(res.bytes.length)})`);
  } catch (e) {
    googleErr(e);
  } finally {
    b.close();
  }
}

/* =========================================================
 * オフライン対応: 保存待ちキュー・通知
 * ======================================================= */
async function enqueue(item) {
  await S.store.put("queue", { id: uid(), createdAt: Date.now(), ...item });
  await refreshQueueBadge();
  if (S.settings.notify && "Notification" in window && Notification.permission === "default") Notification.requestPermission();
}

async function refreshQueueBadge() {
  const q = await S.store.getAll("queue");
  const b = $("#queueBadge");
  b.hidden = !q.length;
  b.textContent = `未実行 ${q.length}件`;
  b.onclick = () => queueDialog();
  return q;
}

async function queueDialog() {
  const q = (await S.store.getAll("queue")).sort((a, b) => a.createdAt - b.createdAt);
  if (!q.length) return;
  const label = (i) => (i.type === "mail" ? `メール送信: ${i.to}(${i.attachments[0].name})` : `Driveへ保存: ${i.name}`);
  const r = await dialog({
    title: "オンラインで実行する待ち作業",
    body: `<div class="list">${q.map((i) => `<div class="item"><div class="meta"><div class="name">${esc(label(i))}</div><div class="sub">${fmtDate(i.createdAt)}</div></div><button class="btn danger icon" data-del="${i.id}" aria-label="取り消す">${icon("trash", 18)}</button></div>`).join("")}</div>
      <p class="note">${navigator.onLine ? "オンラインです。「今すぐ実行」で順番に処理します。" : "現在オフラインです。オンラインになったら実行できます。"}</p>`,
    buttons: [{ label: "閉じる", value: null }, { label: "今すぐ実行", value: true, primary: true, id: "qRun" }],
    onOpen: (d) => {
      d.querySelector("#qRun").disabled = !navigator.onLine;
      d.addEventListener("click", async (e) => {
        const del = e.target.closest("[data-del]");
        if (!del) return;
        await S.store.del("queue", del.dataset.del);
        del.closest(".item").remove();
        refreshQueueBadge();
      });
    },
  });
  if (r === true) runQueue();
}

async function runQueue() {
  const q = (await S.store.getAll("queue")).sort((a, b) => a.createdAt - b.createdAt);
  if (!q.length) return;
  if (!(await ensureGoogle())) return;
  const b = busy("待ち作業を実行中…");
  let ok = 0;
  const errs = [];
  try {
    await G.getToken();
    for (const [i, item] of q.entries()) {
      b.update(i / q.length, `${i + 1}/${q.length}: ${item.type === "mail" ? "メール送信" : "Drive保存"}`);
      try {
        if (item.type === "drive-save") {
          const r = await G.uploadPdf({ name: item.name, bytes: item.bytes, fileId: item.fileId, folderId: item.folderId });
          const rec = await S.store.get("recents", item.projectId);
          if (rec) await S.store.put("recents", { ...rec, driveId: r.id });
          const pr = await S.store.get("projects", item.projectId);
          if (pr) await S.store.put("projects", { ...pr, meta: { ...pr.meta, driveId: r.id } });
          if (S.model.meta.projectId === item.projectId) S.model.meta.driveId = r.id;
        } else if (item.type === "mail") {
          await G.sendMail(item);
        }
        await S.store.del("queue", item.id);
        ok++;
      } catch (e) {
        errs.push(e.message);
      }
    }
  } catch (e) {
    errs.push(e.message);
  } finally {
    b.close();
  }
  await refreshQueueBadge();
  if (errs.length) toast(`${ok}件を実行、${errs.length}件は失敗しました: ${errs[0]}`, { error: true });
  else toast(`${ok}件の待ち作業を実行しました`);
}

function wireNetwork() {
  window.addEventListener("online", async () => {
    updateNet();
    const q = await refreshQueueBadge();
    if (q.length) {
      showBanner(`オンラインになりました。保存・送信待ちが <b>${q.length}件</b> あります。`, [
        { label: "今すぐ実行", primary: true, onClick: runQueue },
        { label: "あとで", onClick: hideBanner },
      ]);
      notifyOnline(q.length);
    }
  });
  window.addEventListener("offline", updateNet);
}

function updateNet() {
  $("#netBadge").hidden = navigator.onLine;
}

async function notifyOnline(n) {
  if (!S.settings.notify || !("Notification" in window) || Notification.permission !== "granted" || !document.hidden) return;
  try {
    const reg = await navigator.serviceWorker?.ready;
    reg?.showNotification("PDF Files", { body: `オンラインになりました。保存・送信待ちが${n}件あります。タップして実行してください。`, icon: "icons/icon-192.png", tag: "queue" });
  } catch (e) {
    console.warn(e);
  }
}

/* =========================================================
 * 履歴
 * ======================================================= */
async function openHistory() {
  const recents = (await S.store.getAll("recents")).sort((a, b) => b.updatedAt - a.updatedAt);
  const localHtml = recents.length
    ? recents.map((r) => `<div class="item"><img src="${r.thumb || "icons/icon-192.png"}" alt=""><div class="meta"><div class="name">${esc(r.name)}</div><div class="sub">${fmtDate(r.updatedAt)} ・ ${r.pages}ページ${r.driveId ? " ・ Drive保存済み" : ""}</div></div><button class="btn" data-open="${r.id}">開く</button><button class="btn danger icon" data-del="${r.id}" aria-label="削除">${icon("trash", 18)}</button></div>`).join("")
    : '<p class="note">履歴はまだありません。</p>';
  await dialog({
    title: "履歴",
    width: "min(640px, 96vw)",
    body: `<div class="seg"><button type="button" class="on" data-tab="local">この端末(オフラインでも開けます)</button><button type="button" data-tab="drive">Googleドライブ</button></div>
      <div id="hLocal" class="list">${localHtml}</div>
      <div id="hDrive" class="list" hidden><button class="btn" id="hLoad">${icon("drive", 18)}Googleドライブの一覧を読み込む</button><p class="note">このアプリで開いた・保存したPDFが表示されます(別の端末で保存したものも含む)。</p></div>`,
    buttons: [{ label: "閉じる", value: true, primary: true }],
    onOpen: (d, close) => {
      d.querySelectorAll("[data-tab]").forEach((t) => (t.onclick = () => {
        d.querySelectorAll("[data-tab]").forEach((x) => x.classList.toggle("on", x === t));
        d.querySelector("#hLocal").hidden = t.dataset.tab !== "local";
        d.querySelector("#hDrive").hidden = t.dataset.tab !== "drive";
      }));
      d.querySelector("#hLocal").addEventListener("click", async (e) => {
        const o = e.target.closest("[data-open]");
        const del = e.target.closest("[data-del]");
        if (o) {
          close(true);
          const b = busy("開いています…");
          try {
            await saveProjectNow();
            await openProject(o.dataset.open);
          } catch (err) {
            toast(err.message, { error: true });
          } finally {
            b.close();
          }
        } else if (del && (await confirmDialog("この履歴と、端末内の編集データを削除しますか?\n(Googleドライブに保存済みのファイルは消えません)", { ok: "削除", danger: true }))) {
          const id = del.dataset.del;
          const pr = await S.store.get("projects", id);
          for (const s of pr?.sources || []) await S.store.del("projects", "src:" + s.id);
          await S.store.del("projects", id);
          await S.store.del("recents", id);
          del.closest(".item").remove();
        }
      });
      d.querySelector("#hLoad").onclick = async () => {
        if (!(await ensureGoogle())) return;
        const box = d.querySelector("#hDrive");
        try {
          const files = await G.listDriveFiles();
          box.innerHTML = files.length
            ? files.map((f) => `<div class="item"><div class="meta"><div class="name">${esc(f.name)}</div><div class="sub">${fmtDate(f.modifiedTime)}${f.size ? " ・ " + fmtBytes(+f.size) : ""}</div></div><button class="btn" data-drive="${f.id}">開く</button></div>`).join("")
            : '<p class="note">まだファイルがありません。「保存・出力 → Googleドライブに保存」で保存すると、ここに表示されます。</p>';
          box.onclick = (e) => {
            const b = e.target.closest("[data-drive]");
            if (b) {
              close(true);
              openDriveFile(b.dataset.drive);
            }
          };
        } catch (e) {
          googleErr(e);
        }
      };
    },
  });
}

/* =========================================================
 * 設定・ヘルプ
 * ======================================================= */
async function openSettings() {
  const cfg = G.getConfig();
  const origin = location.origin;
  await dialog({
    title: "設定",
    width: "min(640px, 96vw)",
    body: `<div class="field"><b style="color:var(--ink)">Google連携(ドライブ・Gmail)</b></div>
      <label class="field">OAuth クライアントID<input type="text" id="stCid" value="${esc(cfg.clientId)}" placeholder="xxxxxxxx.apps.googleusercontent.com" spellcheck="false" autocapitalize="off"></label>
      <label class="field">APIキー(ドライブのファイル選択に使用)<input type="text" id="stKey" value="${esc(cfg.apiKey)}" spellcheck="false" autocapitalize="off"></label>
      <label class="field">プロジェクト番号(任意・ファイル選択の精度向上)<input type="text" id="stApp" value="${esc(cfg.appId)}" inputmode="numeric"></label>
      <p class="note">取得方法は同梱の <code>SETUP.md</code> を参照してください(Google Cloud Console で無料・約10分)。承認済みのJavaScript生成元には <code>${esc(origin)}</code> を登録します。</p>
      <hr style="border:0;border-top:1px solid var(--line);width:100%">
      <label class="check" style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="stPalm"${S.settings.palm ? " checked" : ""}> ペン入力モード(描画はペン/マウスのみ、指はスクロール専用)</label>
      <label class="check" style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="stNotify"${S.settings.notify ? " checked" : ""}> オンライン復帰時に通知で知らせる</label>
      <div class="actions" style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" id="stPw">パスワードを変更</button>
        <button class="btn" id="stGout">Googleの接続を解除</button></div>
      <p class="note">ログイン中のID: <b>${esc(S.user)}</b> ・ データはこの端末内に保存されます。</p>`,
    buttons: [{ label: "キャンセル", value: null }, { label: "保存", value: true, primary: true, action: async (d) => {
      G.setConfig({ clientId: d.querySelector("#stCid").value.trim(), apiKey: d.querySelector("#stKey").value.trim(), appId: d.querySelector("#stApp").value.trim() });
      S.settings.palm = d.querySelector("#stPalm").checked;
      S.settings.notify = d.querySelector("#stNotify").checked;
      S.editor.setPalm(S.settings.palm);
      await S.store.setSetting("settings", S.settings);
      if (G.isConfigured() && navigator.onLine) G.preload();
      toast("設定を保存しました");
      return true;
    } }],
    onOpen: (d) => {
      d.querySelector("#stPw").onclick = changePasswordDialog;
      d.querySelector("#stGout").onclick = () => {
        G.signOut();
        toast("Googleの接続を解除しました");
      };
      d.querySelector("#stNotify").onchange = async (e) => {
        if (e.target.checked && "Notification" in window && Notification.permission !== "granted") {
          const p = await Notification.requestPermission();
          if (p !== "granted") {
            e.target.checked = false;
            toast("通知が許可されませんでした(ブラウザの設定を確認してください)", { error: true });
          }
        }
      };
    },
  });
}

async function changePasswordDialog() {
  let vals = {};
  const r = await dialog({
    title: "パスワードの変更",
    body: `<label class="field">現在のパスワード<input type="password" id="pwOld" autocomplete="current-password"></label>
      <label class="field">新しいパスワード(8文字以上)<input type="password" id="pwNew" autocomplete="new-password"></label>`,
    buttons: [{ label: "キャンセル", value: null }, { label: "変更", value: true, primary: true, action: (d) => {
      vals = { o: d.querySelector("#pwOld").value, n: d.querySelector("#pwNew").value };
      return true;
    } }],
  });
  if (r !== true) return;
  try {
    await auth.changePassword(S.user, vals.o, vals.n);
    toast("パスワードを変更しました");
  } catch (e) {
    toast(e.message, { error: true });
  }
}

async function installHelp() {
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  await dialog({
    title: "ホーム画面に追加(アプリとして使う)",
    body: `<p><b>iPhone / iPad(Safari)</b><br>画面下の共有ボタン <b>⬆︎</b> →「<b>ホーム画面に追加</b>」→「追加」。ホーム画面に「PDF Files」のアイコンができます。${ios ? "" : ""}</p>
      <p><b>Windows / Android(Chrome・Edge)</b><br>アドレスバー右の「インストール」アイコン、またはメニューの「アプリをインストール」から追加できます。</p>
      <p class="note">一度開いたあとは、機内モードでもPDFの編集・手書き・図形・寸法・計測・署名・ページ操作が使えます(Drive/Gmailを使う操作はオンラインで実行)。</p>`,
    buttons: S.deferredInstall
      ? [{ label: "閉じる", value: null }, { label: "今すぐインストール", value: true, primary: true, action: async () => {
        S.deferredInstall.prompt();
        await S.deferredInstall.userChoice;
        S.deferredInstall = null;
        return true;
      } }]
      : [{ label: "閉じる", value: true, primary: true }],
  });
}

boot();
