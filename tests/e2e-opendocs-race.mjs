// E2E: 「開いているファイル」の登録は、ほぼ同時に何件来ても取りこぼさない
import { launch, register, check, summary } from "./e2e-lib.mjs";

const env = await launch();
const { page, errors } = env;
await page.goto(env.base);
await register(page, "odrace01");
const res = await page.evaluate(async () => {
  const S = window.__apdf;
  await Promise.all([S.trackOpen("doc-a"), S.trackOpen("doc-b"), S.trackOpen("doc-c")]);
  const saved = (await S.store.getSetting("openDocs", [])) || [];
  await Promise.all([S.untrackOpen("doc-b"), S.trackOpen("doc-d")]);
  const after = (await S.store.getSetting("openDocs", [])) || [];
  return { saved, after, mem: S.openDocs };
});
check("同時に3件登録しても全部残る", ["doc-a", "doc-b", "doc-c"].every((x) => res.saved.includes(x)), JSON.stringify(res.saved));
check("登録と削除が重なっても取りこぼさない", res.after.includes("doc-a") && res.after.includes("doc-c") && res.after.includes("doc-d") && !res.after.includes("doc-b"), JSON.stringify(res.after));
check("画面側の一覧も保存内容と同じ", JSON.stringify(res.mem) === JSON.stringify(res.after), JSON.stringify(res.mem));
check("コンソールエラーなし", errors.length === 0, errors.join("\n"));
await env.close();
const r = summary();
console.log(`opendocs-race: ${r.pass} pass / ${r.fail} fail`);
process.exit(r.fail ? 1 : 0);
