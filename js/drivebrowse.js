// アプリ内のGoogleドライブ一覧。Googleの選択画面(Picker)が使えないiPhone/iPadのSafari向け。
// 閲覧用の権限(drive.readonly)を、使うときだけ追加で求める。
import * as G from "./google.js";
import { dialog, esc, fmtDate } from "./ui.js";

const ICON_FOLDER = "📁";
const ICON_PDF = "📄";
const isFolder = (f) => f.mimeType === "application/vnd.google-apps.folder";

/**
 * mode: "pdf"(PDFを1つ選ぶ) | "folder"(フォルダを1つ選ぶ)
 * 戻り値: { id, name } か、キャンセルなら null
 */
export async function browseDrive({ mode = "pdf" } = {}) {
  await G.getToken({ browse: true }); // 先にログイン(ボタンを押した直後でないとポップアップが開かない)
  const start = G.startFolderId();
  const root = { id: "root", name: "マイドライブ" };
  let stack = start && start !== "root" ? [root, { id: start, name: G.getStart().name || "指定のフォルダ" }] : [root];
  let view = "drive"; // drive | shared | search
  let seq = 0;

  return dialog({
    title: mode === "pdf" ? "Googleドライブから PDF を選択" : "保存先のフォルダを選択",
    width: "min(640px, 96vw)",
    body: `<div class="seg"><button type="button" data-v="drive" class="on">マイドライブ</button><button type="button" data-v="shared">共有ドライブ</button></div>
      ${mode === "pdf" ? '<div class="row" style="gap:6px;margin:6px 0"><input type="search" id="dbQ" placeholder="ファイル名で検索" style="flex:1;height:40px"><button type="button" class="btn" id="dbGo">検索</button></div>' : ""}
      <div id="dbPath" class="note" style="margin:6px 0;display:flex;flex-wrap:wrap;gap:4px"></div>
      <div id="dbList" class="list" style="max-height:52vh;overflow:auto"></div>`,
    buttons: [
      { label: "キャンセル", value: null },
      ...(mode === "folder" ? [{ label: "このフォルダに保存", value: "__pick", primary: true, id: "dbPickHere" }] : []),
    ],
    onOpen: (d, close) => {
      const list = d.querySelector("#dbList");
      const pathEl = d.querySelector("#dbPath");
      const pickBtn = d.querySelector("#dbPickHere");
      const cur = () => stack[stack.length - 1];

      // 「このフォルダに保存」は、いま開いているフォルダを返す
      if (pickBtn) {
        pickBtn.addEventListener("click", (e) => {
          e.stopImmediatePropagation();
          close({ id: cur().id, name: cur().name });
        }, true);
      }

      const renderPath = () => {
        pathEl.innerHTML = view === "drive" || (view === "shared" && stack.length)
          ? stack.map((s, i) => `<button type="button" class="linkbtn" data-p="${i}" style="padding:2px 0">${esc(s.name)}</button>`).join(" ＞ ")
          : "";
        if (pickBtn) pickBtn.disabled = !(view === "drive" || (view === "shared" && stack.length));
      };
      const row = (f) =>
        `<div class="item" data-id="${esc(f.id)}" data-name="${esc(f.name)}" data-k="${isFolder(f) || f.drive ? "d" : "f"}" style="cursor:pointer"><span style="font-size:22px">${isFolder(f) || f.drive ? ICON_FOLDER : ICON_PDF}</span><div class="meta"><div class="name">${esc(f.name)}</div>${f.modifiedTime ? `<div class="sub">${fmtDate(f.modifiedTime)}</div>` : ""}</div></div>`;

      const load = async (fn, empty) => {
        const my = ++seq;
        list.innerHTML = '<p class="note">読み込み中…</p>';
        try {
          const items = await fn();
          if (my !== seq) return;
          list.innerHTML = items.length ? items.map(row).join("") : `<p class="note">${empty}</p>`;
        } catch (e) {
          if (my !== seq) return;
          list.innerHTML = `<p class="note">読み込めませんでした: ${esc(e.message || "")}</p><button type="button" class="btn" id="dbRetry">再試行</button>`;
          list.querySelector("#dbRetry").onclick = refresh;
        }
      };
      const refresh = () => {
        renderPath();
        if (view === "shared" && !stack.length) return load(async () => (await G.listSharedDrives()).map((x) => ({ ...x, drive: true })), "共有ドライブはありません");
        if (view === "search") return;
        return load(() => G.listChildren(cur().id, { foldersOnly: mode === "folder" }), mode === "folder" ? "フォルダはありません(このフォルダに保存できます)" : "PDFもフォルダもありません");
      };

      d.querySelectorAll("[data-v]").forEach((b) => (b.onclick = () => {
        d.querySelectorAll("[data-v]").forEach((x) => x.classList.toggle("on", x === b));
        view = b.dataset.v;
        stack = view === "drive" ? [root] : [];
        refresh();
      }));
      pathEl.addEventListener("click", (e) => {
        const b = e.target.closest("[data-p]");
        if (!b) return;
        stack = stack.slice(0, +b.dataset.p + 1);
        view = view === "search" ? "drive" : view;
        refresh();
      });
      list.addEventListener("click", (e) => {
        const it = e.target.closest(".item");
        if (!it) return;
        const f = { id: it.dataset.id, name: it.dataset.name };
        if (it.dataset.k === "d") {
          stack.push(f);
          if (view === "search") view = "drive";
          refresh();
        } else close(f);
      });
      const doSearch = () => {
        const q = d.querySelector("#dbQ")?.value.trim();
        if (!q) return;
        view = "search";
        pathEl.textContent = `「${q}」の検索結果`;
        load(() => G.searchPdfs(q), "見つかりませんでした");
      };
      d.querySelector("#dbGo")?.addEventListener("click", doSearch);
      d.querySelector("#dbQ")?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); doSearch(); }
      });
      refresh();
    },
  }).then((v) => (v && v !== "__pick" ? v : null));
}
