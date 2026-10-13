// E2E: 角丸めフィレット・寸法の数値の測り直し・レイヤー/履歴の見切れ防止・修正メニューの移動/コピー
import { launch, register, openPdf, setZoom1, click, toScreen, shapes, check, summary } from "./e2e-lib.mjs";

for (const mobile of [false, true]) {
  const env = await launch({ mobile });
  const { page, errors } = env;
  const tag = mobile ? "(スマホ)" : "";
  await page.goto(env.base);
  await register(page, "polish" + (mobile ? "m" : "d"));
  await openPdf(page, "tests/fixtures/sample.pdf");
  const ed = (fn, arg) => page.evaluate(fn, arg);

  /* ---- レイヤーパネルが画面内に収まる ---- */
  await page.click("#btnLayers");
  await ed(() => { const m = window.__apdf.model; m.addLayer(); });
  await page.waitForTimeout(200);
  const lp = await ed(() => {
    const r = document.querySelector("#layers").getBoundingClientRect();
    const btns = [...document.querySelectorAll("#layers .lp-sub .btn, #layers .lp-head .btn")].map((b) => b.getBoundingClientRect().right);
    return { right: r.right, vw: innerWidth, maxBtn: Math.max(...btns) };
  });
  check(`レイヤー: パネルも中のボタンも画面の右端に収まる${tag}`, lp.right <= lp.vw + 0.5 && lp.maxBtn <= lp.right + 0.5, JSON.stringify(lp));
  await page.click("#btnLayers");
  if (mobile) {
    await env.close();
    check("コンソールエラーなし", errors.length === 0, errors.join("|"));
    continue;
  }

  /* ---- 履歴: 開く・削除ボタンがファイル名の下にあり見切れない ---- */
  await page.click("#btnFile");
  await page.locator("#menu button", { hasText: "履歴から開く" }).click();
  await page.waitForSelector("dialog[open] .item");
  const hist = await ed(() => {
    const d = document.querySelector("dialog[open]").getBoundingClientRect();
    const it = document.querySelector("dialog[open] .item");
    const name = it.querySelector(".name").getBoundingClientRect();
    const b = it.querySelector("[data-open]").getBoundingClientRect();
    return { dRight: d.right, bRight: b.right, below: b.top >= name.bottom - 1 };
  });
  check("履歴: 「開く」がファイル名の下に出て右に見切れない", hist.below && hist.bRight <= hist.dRight, JSON.stringify(hist));
  await page.keyboard.press("Escape");
  await page.waitForSelector("dialog[open]", { state: "detached" }).catch(() => {});
  await setZoom1(page);

  /* ---- フィレット: 四角の角を丸める ---- */
  await ed(() => { const m = window.__apdf.model; m.addShape(m.pages[0].id, { type: "rect", pts: [[100, 100], [300, 250]], style: { color: "#e11d48", width: 2, fill: "none" } }); });
  await ed(() => window.__apdf.editor.startCommand("fillet", { radius: 20 }));
  await click(page, 0, [300, 100]);
  let s = (await shapes(page)).at(-1);
  check("四角の角を1つ丸めると多角形に変わる", s.type === "polygon" && s.pts.length > 4, `${s.type} ${s.pts.length}`);
  check("丸めた角の頂点が消え、他の角は残る", !s.pts.some((p) => Math.abs(p[0] - 300) < 0.1 && Math.abs(p[1] - 100) < 0.1) && s.pts.some((p) => Math.abs(p[0] - 100) < 0.1 && Math.abs(p[1] - 100) < 0.1));
  await ed(() => window.__apdf.editor.cancelCommand());
  // 全部丸める
  await ed(() => { const m = window.__apdf.model; const e = window.__apdf.editor; const sh = m.addShape(m.pages[0].id, { type: "rect", pts: [[350, 100], [500, 200]], style: { color: "#e11d48", width: 2, fill: "none" } }); e.setSelection({ pageId: m.pages[0].id, shapeId: sh.id }); e.roundSelectedCorners(15); });
  s = (await shapes(page)).at(-1);
  check("全部の角を丸められる", s.type === "polygon" && s.pts.length >= 16, String(s.pts.length));

  /* ---- 修正メニューに 移動・コピー がある ---- */
  await ed(() => { const m = window.__apdf.model; const e = window.__apdf.editor; e.setSelection({ pageId: m.pages[0].id, shapeId: m.pages[0].shapes.at(-1).id }); });
  await page.click('.tool[data-tool="modify"]');
  const items = await page.locator("#menu button").allTextContents();
  check("修正メニューに移動・コピーが並ぶ", items.some((t) => t.startsWith("移動")) && items.some((t) => t.startsWith("コピー")), items.join("|"));
  await page.locator("#menu button", { hasText: "移動(基点" }).click();
  const before = (await shapes(page)).at(-1).pts[0].slice();
  await click(page, 0, [350, 300]);
  await click(page, 0, [400, 350]);
  const after = (await shapes(page)).at(-1).pts[0];
  check("基点→移動先で、その差だけ動く", Math.abs(after[0] - before[0] - 50) < 3 && Math.abs(after[1] - before[1] - 50) < 3, `${before} -> ${after}`);

  /* ---- 寸法の端点を動かすと数値が測り直される ---- */
  await ed(() => { const m = window.__apdf.model; const e = window.__apdf.editor; e.setTool("select"); const sh = m.addShape(m.pages[0].id, { type: "dim", pts: [[100, 450], [200, 450]], off: 24, size: 12, text: "100", style: { color: "#e11d48", width: 1 } }); e.setSelection({ pageId: m.pages[0].id, shapeId: sh.id }); });
  const [hx, hy] = await toScreen(page, 0, 200, 450);
  await page.mouse.move(hx, hy);
  await page.mouse.down();
  const [tx, ty] = await toScreen(page, 0, 300, 450);
  await page.mouse.move(tx, ty, { steps: 8 });
  await page.mouse.up();
  s = (await shapes(page)).at(-1);
  check("寸法の端点を動かすと数値も新しい長さになる", s.type === "dim" && Math.abs(+s.text - Math.hypot(s.pts[1][0] - s.pts[0][0], s.pts[1][1] - s.pts[0][1])) <= 1 && +s.text > 150, `${s.text} ${JSON.stringify(s.pts)}`);

  check("コンソールエラーなし", errors.length === 0, errors.join("|"));
  await env.close();
}
summary();
