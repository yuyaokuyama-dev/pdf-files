// E2E: オブジェクトスナップ・極トラッキング(Shift=90°固定)・数値入力・軽さ
import { launch, register, openPdf, setZoom1, drag, click, tool, shapes, toScreen, check, summary } from "./e2e-lib.mjs";

const env = await launch();
const { page, errors } = env;
await page.goto(env.base);
await page.evaluate(() => localStorage.removeItem("apdf_defaults_v1"));
await register(page, "snap01");
await openPdf(page, "tests/fixtures/sample.pdf");
await setZoom1(page);

const near = (a, b, tol = 0.6) => Math.abs(a - b) <= tol;
const last = async () => (await shapes(page)).at(-1);
const len = (s) => Math.hypot(s.pts[1][0] - s.pts[0][0], s.pts[1][1] - s.pts[0][1]);
const cfg = () => page.evaluate(() => window.__apdf.editor.aid.cfg);

/* ---- 準備: 基準の線 A (100,100)-(200,100) ---- */
await tool(page, "line");
await drag(page, 0, [100, 100], [200, 100]);
await page.keyboard.press("Escape");
await page.keyboard.press("Escape");

/* ---- オブジェクトスナップ: Aの端点(200,100)の近くから描き始める ---- */
// Ctrl を押していなければ吸着しない
await tool(page, "line");
await drag(page, 0, [204, 103], [260, 170]);
let s = await last();
check("Ctrlなしでは吸着しない(既定は押している間だけ)", near(s.pts[0][0], 204, 0.8) && near(s.pts[0][1], 103, 0.8), JSON.stringify(s.pts));
await page.evaluate(() => window.__apdf.model.undo()); // この線の端点にも吸着してしまうので取り消す
await page.keyboard.press("Escape");
await page.keyboard.press("Escape");
// 押す前(ホバー)でも、Ctrl中は記号と名前が出る
await tool(page, "line");
const [hx, hy] = await toScreen(page, 0, 204, 103);
await page.mouse.move(hx, hy);
check("Ctrlなしでは記号は出ない", (await page.locator(".page svg .draft text").count()) === 0);
await page.keyboard.down("Control");
await page.mouse.move(hx + 1, hy + 1);
check("Ctrl中は端点の記号と名前が出る", (await page.locator(".page svg .draft text").first().textContent().catch(() => "")) === "端点");
await page.keyboard.up("Control");
await page.waitForTimeout(100);
check("Ctrlを離すと記号が消える(動かさなくても)", (await page.locator(".page svg .draft text").count()) === 0);
await page.keyboard.press("Escape");
await page.keyboard.press("Escape");
await tool(page, "line");
await page.keyboard.down("Control");
await drag(page, 0, [204, 103], [260, 170]);
await page.keyboard.up("Control");
s = await last();
check("描き始めがAの端点にスナップ", near(s.pts[0][0], 200) && near(s.pts[0][1], 100), JSON.stringify(s.pts));
check("終点はそのまま", near(s.pts[1][0], 260, 3), JSON.stringify(s.pts));
await page.keyboard.press("Escape");
await page.keyboard.press("Escape");

/* ---- 中点スナップ(150,100) ---- */
await tool(page, "line");
await page.keyboard.down("Control");
await drag(page, 0, [400, 300], [152, 102]);
await page.keyboard.up("Control");
s = await last();
check("終点がAの中点にスナップ", near(s.pts[1][0], 150) && near(s.pts[1][1], 100), JSON.stringify(s.pts[1]));
await page.keyboard.press("Escape");
await page.keyboard.press("Escape");

/* ---- 極トラッキング(既定45°刻み・3°以内) ---- */
await tool(page, "line");
await drag(page, 0, [100, 400], [200, 403]);
s = await last();
check("ほぼ水平なら水平に合う", near(s.pts[1][1], 400) && near(len(s), Math.hypot(100, 3), 0.5), JSON.stringify(s.pts));
await page.keyboard.press("Escape");
await page.keyboard.press("Escape");
await tool(page, "line");
await drag(page, 0, [100, 450], [180, 480]);
s = await last();
check("角度が外れていれば吸着しない", near(s.pts[1][1], 480) && near(s.pts[1][0], 180), JSON.stringify(s.pts));
await page.keyboard.press("Escape");
await page.keyboard.press("Escape");

/* ---- 刻み角を変える(30°)と30°に合う ---- */
await page.evaluate(() => window.__apdf.editor.aid.setConfig({ step: 30 }));
await tool(page, "line");
await drag(page, 0, [300, 500], [300 + 100 * Math.cos((29 * Math.PI) / 180), 500 - 100 * Math.sin((29 * Math.PI) / 180)]);
s = await last();
{
  const ang = (Math.atan2(-(s.pts[1][1] - s.pts[0][1]), s.pts[1][0] - s.pts[0][0]) * 180) / Math.PI;
  check("刻み角30°: 29°が30°に合う", near(ang, 30, 0.05), String(ang));
}
await page.evaluate(() => window.__apdf.editor.aid.setConfig({ step: 45 }));
await page.keyboard.press("Escape");
await page.keyboard.press("Escape");

/* ---- Shift = 90°固定(直交モードの代わり) ---- */
await tool(page, "line");
await page.keyboard.down("Shift");
await drag(page, 0, [400, 500], [480, 530]);
await page.keyboard.up("Shift");
s = await last();
check("Shiftで水平に固定される", near(s.pts[1][1], 500) && s.pts[1][0] > 400, JSON.stringify(s.pts));
await page.keyboard.press("Escape");
await page.keyboard.press("Escape");
await tool(page, "line");
await page.keyboard.down("Shift");
await drag(page, 0, [500, 500], [520, 590]);
await page.keyboard.up("Shift");
s = await last();
check("Shiftで垂直に固定される", near(s.pts[1][0], 500) && s.pts[1][1] > 500, JSON.stringify(s.pts));
await page.keyboard.press("Escape");
await page.keyboard.press("Escape");

/* ---- オブジェクトスナップを切ると吸着しない(F3) ---- */
await page.keyboard.press("F3");
check("F3でオブジェクトスナップが切り替わる", (await cfg()).osnap === false);
await tool(page, "line");
await drag(page, 0, [204, 103], [260, 190]);
s = await last();
check("オフなら端点に吸着しない", near(s.pts[0][0], 204, 0.6) && near(s.pts[0][1], 103, 0.6), JSON.stringify(s.pts[0]));
await page.keyboard.press("F3");
await page.keyboard.press("Escape");
await page.keyboard.press("Escape");

/* ---- 数値入力: 線(クリック→長さ→Enter) ---- */
const n0 = (await shapes(page)).length;
await tool(page, "line");
await click(page, 0, [300, 600]);
check("クリックだけだと数値入力の欄が出る", await page.locator(".dynbox").isVisible());
check("図形はまだ作られない", (await shapes(page)).length === n0);
await page.keyboard.type("120");
await page.keyboard.press("Enter"); // → 角度の欄
await page.keyboard.type("90");
await page.keyboard.press("Enter"); // 確定
check("欄が閉じる", (await page.locator(".dynbox").count()) === 0);
s = await last();
check("長さ120・上向き90°で作られる", (await shapes(page)).length === n0 + 1 && near(len(s), 120) && near(s.pts[0][0], 300) && near(s.pts[1][0], 300) && s.pts[1][1] < s.pts[0][1], JSON.stringify(s.pts));
await page.keyboard.press("Escape");
await page.keyboard.press("Escape");

/* ---- 数値入力: 長さだけ打って確定(角度は画面の向き=右) ---- */
await tool(page, "line");
await click(page, 0, [100, 650]);
await page.keyboard.type("75");
await page.keyboard.press("Enter");
await page.keyboard.press("Enter");
s = await last();
check("角度を空にすると画面の向き(既定は右)", near(len(s), 75) && near(s.pts[1][1], 650), JSON.stringify(s.pts));
await page.keyboard.press("Escape");
await page.keyboard.press("Escape");

/* ---- 数値入力: 四角(幅→高さ) ---- */
await tool(page, "rect");
await click(page, 0, [350, 650]);
check("四角も数値入力が出る", await page.locator(".dynbox").isVisible());
await page.keyboard.type("80");
await page.keyboard.press("Enter");
await page.keyboard.type("40");
await page.keyboard.press("Enter");
s = await last();
check("四角: 幅80×高さ40", s.type === "rect" && near(Math.abs(s.pts[1][0] - s.pts[0][0]), 80) && near(Math.abs(s.pts[1][1] - s.pts[0][1]), 40), JSON.stringify(s.pts));
await page.keyboard.press("Escape");
await page.keyboard.press("Escape");

/* ---- 数値入力: 丸は半径 ---- */
await tool(page, "ellipse");
await click(page, 0, [450, 700]);
await page.keyboard.type("25");
await page.keyboard.press("Enter");
s = await last();
check("丸: 半径25(幅・高さ50)", s.type === "ellipse" && near(Math.abs(s.pts[1][0] - s.pts[0][0]), 50) && near(Math.abs(s.pts[1][1] - s.pts[0][1]), 50), JSON.stringify(s.pts));
await page.keyboard.press("Escape");
await page.keyboard.press("Escape");

/* ---- 数値入力: Escで中止 / クリックで画面の位置に確定 ---- */
const n1 = (await shapes(page)).length;
await tool(page, "line");
await click(page, 0, [100, 720]);
await page.keyboard.type("50");
await page.keyboard.press("Escape");
check("Escで中止(図形は増えない)", (await shapes(page)).length === n1 && (await page.locator(".dynbox").count()) === 0);
await click(page, 0, [100, 720]);
await click(page, 0, [190, 720]);
s = await last();
check("2回目のクリックで画面の位置に確定", (await shapes(page)).length === n1 + 1 && near(len(s), 90, 1.5), JSON.stringify(s.pts));
await page.keyboard.press("Escape");
await page.keyboard.press("Escape");

/* ---- 数値入力をオフにすると、クリックだけでは何も起きない ---- */
await page.evaluate(() => window.__apdf.editor.aid.setConfig({ dyn: false }));
const n2 = (await shapes(page)).length;
await tool(page, "line");
await click(page, 0, [300, 720]);
check("オフならクリックだけでは欄が出ない", (await page.locator(".dynbox").count()) === 0 && (await shapes(page)).length === n2);
await page.evaluate(() => window.__apdf.editor.aid.setConfig({ dyn: true }));

/* ---- 選択した線・四角を数値で変える(最初の点を固定) ---- */
await page.keyboard.press("Escape");
await tool(page, "line");
await drag(page, 0, [100, 50], [160, 50]);
s = await last();
await page.locator('#props input[data-k="numLen"]').fill("200");
await page.locator('#props input[data-k="numLen"]').press("Enter");
s = await last();
check("プロパティで長さを変える(最初の点は動かない)", near(len(s), 200) && near(s.pts[0][0], 100) && near(s.pts[0][1], 50), JSON.stringify(s.pts));
await page.locator('#props input[data-k="numAng"]').fill("90");
await page.locator('#props input[data-k="numAng"]').press("Enter");
s = await last();
check("角度を変えても長さは同じ", near(len(s), 200) && near(s.pts[1][0], 100) && s.pts[1][1] < 50 - 199, JSON.stringify(s.pts));
await page.click("#btnUndo");
s = await last();
check("取り消しで角度が戻る", near(s.pts[1][1], 50) && near(len(s), 200), JSON.stringify(s.pts));

/* ---- 縮尺を設定したページでは mm で入力する ---- */
await page.keyboard.press("Escape");
await page.keyboard.press("Escape");
await page.evaluate(() => { const S = window.__apdf; S.model.mutate(() => { S.model.pages[0].scale = { ptsPerUnit: 0.5, unit: "mm" }; }); });
await tool(page, "line");
await click(page, 0, [300, 100]);
check("縮尺ありなら単位がmm", (await page.locator(".dynbox").textContent()).includes("mm"));
await page.keyboard.type("100");
await page.keyboard.press("Enter");
await page.keyboard.press("Enter");
s = await last();
check("100mm = 50pt", near(len(s), 50), String(len(s)));
await page.keyboard.press("Escape");
await page.keyboard.press("Escape");

/* ---- 直前の設定の引き継ぎ: 選んだ線の色・太さを変えると、次に描く線も同じになる ---- */
await page.keyboard.press("Escape");
await page.keyboard.press("Escape");
await tool(page, "line");
await drag(page, 0, [20, 20], [90, 20]);
await page.locator('#props .sw[data-c="#2563eb"]').click();
await page.locator('#props input[type=number][data-k="width"], #props input[type=range][data-k="width"]').first().fill("5");
await page.locator('#props input[data-k="width"]').first().dispatchEvent("change");
await page.keyboard.press("Escape");
await page.keyboard.press("Escape");
await tool(page, "line");
await drag(page, 0, [20, 40], [90, 40]);
s = await last();
check("次に描く線は直前の色・太さを引き継ぐ", s.style.color === "#2563eb" && s.style.width === 5, JSON.stringify(s.style));
await page.keyboard.press("Escape");
await page.keyboard.press("Escape");

/* ---- 軽さ: 図形500個のページで動かしても重くならない ---- */
await page.evaluate(() => {
  const S = window.__apdf;
  S.model.mutate(() => {
    for (let i = 0; i < 500; i++) {
      const x = 20 + (i % 25) * 20;
      const y = 120 + Math.floor(i / 25) * 25;
      S.model.pages[0].shapes.push({ id: "p" + i, type: i % 3 ? "line" : "rect", pts: [[x, y], [x + 14, y + (i % 7) * 2]], style: { color: "#e11d48", width: 1 } });
    }
  });
});
const perf = await page.evaluate(() => {
  const S = window.__apdf;
  const ed = S.editor;
  const pid = S.model.pages[0].id;
  const t0 = performance.now();
  const pts = ed.aid.pointsFor(pid);
  const tCollect = performance.now() - t0;
  const t1 = performance.now();
  for (let i = 0; i < 300; i++) ed.aid.resolve([100 + i, 300 + (i % 50)], { pts, p0: [90, 290] });
  const tMove = (performance.now() - t1) / 300;
  return { n: pts.length, tCollect, tMove };
});
check(`スナップ候補の作成は軽い(${perf.n}点・${perf.tCollect.toFixed(1)}ms)`, perf.tCollect < 250, JSON.stringify(perf));
check(`動かす間の判定は1回 ${perf.tMove.toFixed(3)}ms`, perf.tMove < 1.5, JSON.stringify(perf));
{
  const t = await page.evaluate(async () => {
    const S = window.__apdf;
    const t0 = performance.now();
    await new Promise((r) => requestAnimationFrame(() => r()));
    return performance.now() - t0;
  });
  check("フレームが詰まらない", t < 200, String(t));
}
// 実際に500個ある中でドラッグして描く
await tool(page, "line");
const t0 = Date.now();
await drag(page, 0, [20, 600], [420, 640], { steps: 60 });
const dt = Date.now() - t0;
check(`図形500個でもドラッグ作図が滑らか(${dt}ms)`, dt < 4000, String(dt));

check("コンソールエラーなし", errors.length === 0, errors.join("\n"));
const { pass, fail } = summary();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
await env.close();
process.exit(fail ? 1 : 0);
