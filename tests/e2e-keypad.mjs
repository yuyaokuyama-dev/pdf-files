// E2E: iPhone相当の画面で、プロパティの下に常にテンキーが出て数字を入力できる
import { launch, register, openPdf, setZoom1, shapes, check, summary } from "./e2e-lib.mjs";

const env = await launch({ mobile: true });
const { page, errors } = env;
await page.goto(env.base);
await register(page, "keypad01");
await openPdf(page, "tests/fixtures/sample.pdf");
await setZoom1(page);

check("テンキーが表示される", await page.locator("#keypad").isVisible());
check("15個のキーがある", (await page.locator("#keypad .kp-k").count()) === 15);

// 線を作って選ぶ → プロパティに太さの欄
await page.evaluate(() => { const S = window.__apdf, m = S.model; m.mutate(() => m.pages[0].shapes.push({ id: "k1", type: "line", pts: [[100, 200], [300, 200]], style: { color: "#2563eb", width: 2 } })); S.editor.setSelection({ pageId: m.pages[0].id, shapeId: "k1" }); });
await page.waitForSelector('#props input[type=number][data-k="width"]');
const w0 = (await shapes(page))[0].style.width;
const geo = await page.evaluate(() => {
  const p = document.querySelector("#props").getBoundingClientRect(), k = document.querySelector("#keypad").getBoundingClientRect(), t = document.querySelector("#tools").getBoundingClientRect();
  return { pb: p.bottom, kt: k.top, kb: k.bottom, tt: t.top };
});
check("テンキーはプロパティの下・ツールバーの上", geo.kt >= geo.pb - 1 && geo.kb <= geo.tt + 1, JSON.stringify(geo));

const inp = page.locator('#props input[type=number][data-k="width"]').first();
await inp.tap();
check("数値欄は画面キーボードを出さない(inputmode=none)", (await inp.getAttribute("inputmode")) === "none");
const key = (k) => page.locator(`#keypad [data-key="${k}"]`).tap();
await key("5"); await key("."); await key("5");
check("5.5 と打つと太さが 5.5 になる", (await shapes(page))[0].style.width === 5.5, String((await shapes(page))[0].style.width));
await key("⌫");
check("⌫ で 5 になる", (await shapes(page))[0].style.width === 5, String((await shapes(page))[0].style.width));
await key("C"); await key("9");
check("C のあとに 9 で 9 になる", (await shapes(page))[0].style.width === 9);
check("w0 から変わっている", w0 !== 9);

// 畳む
await page.locator("#kpFold").tap();
check("畳むとキーが隠れる", !(await page.locator("#keypad .kp-grid").isVisible()));
await page.locator("#kpFold").tap();

check("コンソールエラーなし", errors.length === 0, errors.join("\n"));
await env.close();
const s = summary();
console.log(`keypad: ${s.pass} pass / ${s.fail} fail`);
process.exit(s.fail ? 1 : 0);
