// E2E: トリムが四角・多角形・丸・円弧にも使える
import { launch, register, openPdf, setZoom1, click, shapes, check, summary } from "./e2e-lib.mjs";

const env = await launch();
const { page, errors } = env;
await page.goto(env.base);
await register(page, "trim01");
await openPdf(page, "tests/fixtures/sample.pdf");
await setZoom1(page);
const near = (a, b, t = 0.6) => Math.abs(a - b) < t;
const ed = (fn, a) => page.evaluate(fn, a);
const st = { color: "#e11d48", width: 2, fill: "none" };
const add = (sh) => ed((s) => { const m = window.__apdf.model; m.addShape(m.pages[0].id, s); }, sh);
const trim = () => ed(() => { window.__apdf.editor.setTool("select"); window.__apdf.editor.startCommand("trim"); });
const last = async (type) => (await shapes(page)).filter((s) => !type || s.type === type).at(-1);

/* ---- 四角: 上辺の x=150〜250 を消す ---- */
await add({ type: "rect", pts: [[100, 100], [300, 200]], style: st });
await add({ type: "line", pts: [[150, 60], [150, 240]], style: st });
await add({ type: "line", pts: [[250, 60], [250, 240]], style: st });
await trim();
await click(page, 0, [200, 100]);
let all = await shapes(page);
const poly = all.find((s) => s.type === "polyline");
check("四角が開いた線(ポリライン)になる", !!poly && !all.some((s) => s.type === "rect"), JSON.stringify(all.map((s) => s.type)));
check("上辺の150〜250だけが消える", poly && near(poly.pts[0][0], 250) && near(poly.pts[0][1], 100) && near(poly.pts.at(-1)[0], 150) && near(poly.pts.at(-1)[1], 100), JSON.stringify(poly?.pts));
check("残りは右・下・左の辺と上辺の両端(6点)", poly?.pts.length === 6, String(poly?.pts.length));
await page.keyboard.press("Control+z");
check("取り消しで四角に戻る", (await shapes(page)).some((s) => s.type === "rect"));
await page.keyboard.press("Escape");

/* ---- 交わりが足りないとき ---- */
await ed(() => { const m = window.__apdf.model; const pg = m.pages[0]; m.mutate(() => { pg.shapes.length = 0; }); });
await add({ type: "rect", pts: [[100, 100], [300, 200]], style: st });
await add({ type: "line", pts: [[150, 60], [150, 150]], style: st }); // 上辺とだけ1か所で交わる
await trim();
await click(page, 0, [200, 100]);
check("交点が1か所だけなら何も変わらない", (await shapes(page)).some((s) => s.type === "rect"));
await page.keyboard.press("Escape");

/* ---- 円: 水平線との交点2つ。下半分を消す ---- */
await ed(() => { const m = window.__apdf.model; const pg = m.pages[0]; m.mutate(() => { pg.shapes.length = 0; }); });
await add({ type: "ellipse", pts: [[200, 300], [300, 400]], style: st }); // 中心(250,350) 半径50
await add({ type: "line", pts: [[150, 350], [350, 350]], style: st });
await trim();
await click(page, 0, [250, 400]); // 下の端
all = await shapes(page);
const arc = all.find((s) => s.type === "arc");
check("円が円弧になる", !!arc && !all.some((s) => s.type === "ellipse"), JSON.stringify(all.map((s) => s.type)));
check("残るのは上半分(180°)", arc && near(arc.sweep, 180, 1), String(arc?.sweep));
check("円弧は中心が元の円と同じ", arc && near(arc.pts[0][0], 250) && near(arc.pts[0][1], 350));
check("始まりは左端(180°)", arc && near(arc.pts[1][0], 200, 1) && near(arc.pts[1][1], 350, 1), JSON.stringify(arc?.pts));
await page.keyboard.press("Escape");

/* ---- 円弧: 下半分の円弧を縦線で区切って片側を消す ---- */
await ed(() => { const m = window.__apdf.model; const pg = m.pages[0]; m.mutate(() => { pg.shapes.length = 0; }); });
await add({ type: "arc", pts: [[250, 450], [350, 450]], sweep: 180, style: st }); // 中心(250,450)から右へ、時計回り180°=下半分
await add({ type: "line", pts: [[250, 400], [250, 550]], style: st });
await trim();
await click(page, 0, [250 + 100 * Math.SQRT1_2, 450 + 100 * Math.SQRT1_2]); // 右側の弧(45°)をつまむ
all = await shapes(page);
const arcs = all.filter((s) => s.type === "arc");
check("円弧は残りの1つになる", arcs.length === 1, String(arcs.length));
check("残るのは左側の90°", arcs[0] && near(arcs[0].sweep, 90, 1), String(arcs[0]?.sweep));
check("残った円弧は真下(90°)から始まる", arcs[0] && near(arcs[0].pts[1][0], 250, 1) && near(arcs[0].pts[1][1], 550, 1), JSON.stringify(arcs[0]?.pts));

/* ---- 多角形 ---- */
await ed(() => { window.__apdf.editor.cancelCommand?.(); const m = window.__apdf.model; const pg = m.pages[0]; m.mutate(() => { pg.shapes.length = 0; }); });
await add({ type: "polygon", pts: [[100, 100], [300, 100], [200, 250]], style: st });
await add({ type: "line", pts: [[150, 50], [150, 120]], style: st });
await add({ type: "line", pts: [[250, 50], [250, 120]], style: st });
await trim();
await click(page, 0, [200, 100]);
const pl = (await shapes(page)).find((s) => s.type === "polyline");
check("多角形も開いた線になる(上辺の一部が消える)", pl && near(pl.pts[0][0], 250) && near(pl.pts.at(-1)[0], 150), JSON.stringify(pl?.pts));

check("コンソールエラーなし", errors.length === 0, errors.join("\n"));
await env.close();
summary();
