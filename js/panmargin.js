// プロパティパネルが出ているあいだ、PDFの端がパネルの外まで出せるようにスクロールの範囲を広げる。
// ページの並び(中央寄せ)は変えず、見えない1pxの目印を PDF の外側に置いて、スクロールできる範囲だけを足す。
const PANEL_W = 290; // 横に出るパネル(幅262 + 余白)
const NARROW = "(max-width: 800px)"; // 狭い画面では下から出るパネル(高さは画面の46%まで)

export function initPanMargin({ viewer, pagesEl }) {
  const sizer = document.createElement("div");
  sizer.className = "pan-sizer";
  sizer.setAttribute("aria-hidden", "true");
  sizer.style.cssText = "position:absolute;left:0;top:0;width:1px;height:1px;visibility:hidden;pointer-events:none";
  viewer.appendChild(sizer);

  const update = () => {
    const open = document.documentElement.classList.contains("props-open");
    const narrow = window.matchMedia(NARROW).matches;
    const vr = viewer.getBoundingClientRect();
    let right = 0;
    let bottom = 0;
    for (const p of pagesEl.querySelectorAll(".page")) {
      const r = p.getBoundingClientRect();
      right = Math.max(right, r.right - vr.left + viewer.scrollLeft);
      bottom = Math.max(bottom, r.bottom - vr.top + viewer.scrollTop);
    }
    const x = open && !narrow ? PANEL_W : 0;
    const y = open && narrow ? Math.round(viewer.clientHeight * 0.5) : 0;
    sizer.style.left = `${Math.round(right + x)}px`;
    sizer.style.top = `${Math.round(bottom + y)}px`;
  };

  const ro = new ResizeObserver(update);
  ro.observe(pagesEl);
  ro.observe(viewer);
  document.addEventListener("props-visibility", update);
  window.matchMedia(NARROW).addEventListener?.("change", update);
  update();
  return { update };
}
