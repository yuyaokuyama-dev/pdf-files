// Service Worker: アプリ本体を端末に保存し、オフラインでも全機能を使えるようにする。
const VERSION = "v1.6.0";
const CORE = `apdf-core-${VERSION}`;
const RUNTIME = `apdf-runtime-${VERSION}`;

const CORE_FILES = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "css/app.css",
  "js/account.js", "js/app.js", "js/auth.js", "js/editor.js", "js/export.js", "js/geometry.js", "js/google.js", "js/drivebrowse.js",
  "js/icons.js", "js/model.js", "js/pad.js", "js/props.js", "js/raster.js", "js/version.js", "js/render.js",
  "js/store.js", "js/tabs.js", "js/thumbs.js", "js/ui.js",
  "vendor/pdf.min.mjs", "vendor/pdf.worker.min.mjs", "vendor/pdf-lib.esm.min.js",
  "icons/logo.svg", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CORE).then((c) => c.addAll(CORE_FILES.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("apdf-") && k !== CORE && k !== RUNTIME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // Google等の外部通信は触らない
  if (url.pathname.includes("/api/")) return; // 認証API: キャッシュしない(常にサーバーへ)

  // ページ遷移はオフラインでも index.html を返す
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).then((r) => {
        const copy = r.clone();
        caches.open(CORE).then((c) => c.put("index.html", copy));
        return r;
      }).catch(() => caches.match("index.html", { ignoreSearch: true })),
    );
    return;
  }

  // 本体ファイル: キャッシュ優先(裏で更新) / cmap・標準フォント等: 使った分だけ保存
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      const net = fetch(req).then((r) => {
        if (r.ok) {
          const copy = r.clone();
          const isCore = CORE_FILES.some((f) => new URL(f, location.href).pathname === url.pathname);
          caches.open(isCore ? CORE : RUNTIME).then((c) => c.put(req, copy));
        }
        return r;
      });
      if (hit) {
        net.catch(() => {});
        return hit;
      }
      return net;
    }),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) if ("focus" in c) return c.focus();
      return self.clients.openWindow("./");
    }),
  );
});
