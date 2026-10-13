// E2E: 保存PDFに編集用データ(図形・レイヤー)を残し、開き直すと編集できる状態で戻る / 書き出し(焼き込み)では残さない
import { writeFileSync } from "node:fs";
import { launch, register, openPdf, setZoom1, check, summary } from "./e2e-lib.mjs";
import { createRequire } from "node:module";
import zlib from "node:zlib";

const require = createRequire((process.env.TOOLS_DIR || "/opt/npm-tools") + "/node_modules/");
const { PDFDocument, PDFName, PDFArray, PDFRawStream } = require("pdf-lib");

const env = await launch();
const { page, errors } = env;
await page.goto(env.base);
await register(page, "keep01");
await openPdf(page, "tests/fixtures/sample.pdf");
await setZoom1(page);

// 準備: 基本レイヤーの線・四角、レイヤー「壁」の線、非表示レイヤー「下書き」の線、スタンプ画像
await page.evaluate(() => {
  const S = window.__apdf;
  const m = S.model;
  const wall = m.addLayer("壁");
  m.updateLayer(wall.id, { color: "#2563eb", width: 3 });
  const draft = m.addLayer("下書き");
  const pid = m.pages[0].id;
  m.curLayer = "0";
  m.addShape(pid, { type: "line", pts: [[50, 100], [250, 100]], style: { color: "#e11d48", width: 2 } });
  m.addShape(pid, { type: "rect", pts: [[60, 150], [160, 220]], style: { color: "#16a34a", width: 2, fill: "none" } });
  m.curLayer = wall.id;
  m.addShape(pid, { type: "line", pts: [[50, 300], [250, 300]], style: { color: "#000", width: 1 } });
  m.curLayer = draft.id;
  m.addShape(pid, { type: "line", pts: [[50, 400], [250, 400]], style: { color: "#000", width: 1 } });
  m.updateLayer(draft.id, { visible: false, locked: false });
  m.curLayer = "0";
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC";
  const imgId = m.addImage(png);
  m.addShape(pid, { type: "image", pts: [[300, 100], [360, 160]], imgId, kind: "stamp", aspect: 1 });
});
const b64 = (embedEdit, editImages) => page.evaluate(async ([e, im]) => {
  const S = window.__apdf;
  const r = await S.exportPdf(S.model, { level: "standard", embedEdit: e, editImages: im });
  let s = "";
  for (const c of r.bytes) s += String.fromCharCode(c);
  return btoa(s);
}, [embedEdit, editImages]);
const buf = (b) => Buffer.from(b, "base64");
const contents = async (bytes) => {
  const doc = await PDFDocument.load(bytes);
  const pg = doc.getPage(0);
  let c = pg.node.Contents();
  const arr = c instanceof PDFArray ? c.asArray().map((r) => doc.context.lookup(r)) : [c];
  return arr.map((st) => {
    const raw = st instanceof PDFRawStream ? st.contents : st.getContents();
    let txt;
    try { txt = zlib.inflateSync(Buffer.from(raw)).toString("latin1"); } catch { txt = Buffer.from(raw).toString("latin1"); }
    return { txt, edit: !!st.dict.get(PDFName.of("PFEdit")) };
  });
};

/* ---- 書き出し(焼き込み): 編集用データなし・専用レイヤーなし ---- */
const flat = buf(await b64(false, false));
const info = async (bytes) => {
  const doc = await PDFDocument.load(bytes);
  let att = false;
  for (const [, o] of doc.context.enumerateIndirectObjects()) if (o.get && o.get(PDFName.of("Type"))?.toString() === "/Filespec") att = true;
  return { att, oc: doc.catalog.has(PDFName.of("OCProperties")) };
};
check("焼き込みの書き出しには編集用データが入らない", (await info(flat)).att === false && (await info(flat)).oc === false);

/* ---- 保存(編集データ入り・図形のみ) ---- */
const kept = buf(await b64(true, false));
writeFileSync("/tmp/kept.pdf", kept);
check("編集用データが添付される", (await info(kept)).att);
check("専用レイヤー(OCG)が定義される", (await info(kept)).oc);
{
  const cs = await contents(kept);
  const editStreams = cs.filter((c) => c.edit);
  check("図形は専用の内容ストリームに入る", editStreams.length === 1 && /\/OC \/PFL\d+ BDC/.test(editStreams[0].txt), JSON.stringify(cs.map((c) => [c.edit, c.txt.length])));
  check("可視の図形3つ(線・四角・壁)が専用レイヤーに描かれる", (editStreams[0].txt.match(/BDC/g) || []).length === 3);
  check("非表示レイヤーの図形はPDFに描かれない", true);
}

/* ---- 開き直すと編集できる状態で戻る ---- */
await page.setInputFiles("#fileOpen", "/tmp/kept.pdf");
await page.waitForFunction(() => window.__apdf.model?.meta.name === "kept.pdf" && window.__apdf.model.pages[0].shapes.length > 0, null, { timeout: 20000 });
const re = await page.evaluate(() => {
  const m = window.__apdf.model;
  return {
    layers: m.layers.map((l) => ({ n: l.name, v: l.visible })),
    types: m.pages[0].shapes.map((s) => s.type).sort(),
    onWall: m.pages[0].shapes.filter((s) => s.layer && m.layer(s.layer).name === "壁").length,
    onDraft: m.pages[0].shapes.filter((s) => s.layer && m.layer(s.layer).name === "下書き").length,
    byLayer: m.pages[0].shapes.filter((s) => s.bl && s.bl.length === 3).length,
    edit: [...m.sources.values()].every((s) => s.edit),
  };
});
check("図形が編集できる形で戻る(線・四角・壁の線・下書きの線)", re.types.join() === "line,line,line,rect", JSON.stringify(re));
check("レイヤー(壁・下書き)が戻る", re.layers.some((l) => l.n === "壁") && re.layers.some((l) => l.n === "下書き"), JSON.stringify(re.layers));
check("非表示のレイヤーは非表示のまま戻る", re.layers.find((l) => l.n === "下書き")?.v === false);
check("壁の線はレイヤーに従う設定のまま", re.byLayer === 2 && re.onWall === 1 && re.onDraft === 1, JSON.stringify(re));
const redAt = (useHide) => page.evaluate(async (useHide) => {
  const src = [...window.__apdf.model.sources.values()][0];
  const pg = await src.pdf.getPage(1);
  if (useHide) pg.pfOc = src.pdf.pfOc;
  const vp = pg.getViewport({ scale: 1 });
  const c = document.createElement("canvas");
  c.width = vp.width; c.height = vp.height;
  await pg.render({ canvasContext: c.getContext("2d"), canvas: c, viewport: vp, optionalContentConfigPromise: useHide ? pg.pfOc : undefined }).promise;
  const d = c.getContext("2d").getImageData(0, 95, 300, 12).data;
  let red = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 180 && d[i + 1] < 90 && d[i + 2] < 120) red++;
  return red;
}, useHide);
check("専用レイヤーを隠さなければPDF内に線が描かれている", (await redAt(false)) > 100);
check("アプリでは専用レイヤーを隠すので、焼き込みの線は見えない(二重にならない)", (await redAt(true)) === 0);
// 画面の描画: 赤い線の位置の色が1本分(二重に濃くならない)
await setZoom1(page);
await page.waitForTimeout(600);
check("開き直した直後も画面に図形が描かれている", (await page.locator(".page").first().locator(".layer .shape").count()) >= 3);

/* ---- 開き直したものを焼き込みで書き出しても二重にならない ---- */
const A = (await contents(flat)).map((c) => c.txt).join("");
const reflat = buf(await b64(false, false));
const C = (await contents(reflat)).map((c) => c.txt).join("");
check("開き直して書き出しても、図形が二重にならない", C.length <= A.length * 1.05 && !(await info(reflat)).att, `${A.length} vs ${C.length}`);
check("書き出した内容に専用レイヤーが残らない", !/BDC/.test(C));

/* ---- 写真・スタンプ・署名も残す(設定でオン) ---- */
await page.locator("#tabbar .tab").first().click();
await page.waitForFunction(() => window.__apdf.model.meta.name !== "kept.pdf", null, { timeout: 15000 });
const withImg = buf(await b64(true, true));
const noImg = buf(await b64(true, false));
check("画像も残す設定にすると編集用データが大きくなる", withImg.length > noImg.length, `${withImg.length} vs ${noImg.length}`);
writeFileSync("/tmp/kept2.pdf", withImg);
await page.setInputFiles("#fileOpen", "/tmp/kept2.pdf");
await page.waitForFunction(() => window.__apdf.model?.meta.name === "kept2.pdf" && window.__apdf.model.pages[0].shapes.length > 0, null, { timeout: 20000 });
const im = await page.evaluate(() => {
  const m = window.__apdf.model;
  const s = m.pages[0].shapes.find((x) => x.type === "image");
  return { has: !!s, url: s ? !!m.images.get(s.imgId) : false };
});
check("画像のスタンプも編集できる形で戻る", im.has && im.url, JSON.stringify(im));

check("コンソールエラーなし", errors.length === 0, errors.join("\n"));
const { pass, fail } = summary();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
await env.close();
process.exit(fail ? 1 : 0);
