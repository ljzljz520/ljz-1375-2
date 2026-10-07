/* 离线支持：缓存应用外壳与最近一次数据包（含 data_version） */
const CACHE = "teahorse-cache-v1";
const SHELL = ["/", "/index.html", "/catalog.html", "/admin.html",
  "/css/styles.css", "/js/i18n.js", "/js/app.js", "/js/catalog.js", "/js/admin.js"];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (url.pathname === "/api/bundle" || url.pathname.startsWith("/api/")) {
    // 数据请求：网络优先，失败回退缓存（保留 data_version 供重连比对）
    e.respondWith(fetch(e.request).then(r => {
      const copy = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return r;
    }).catch(() => caches.match(e.request)));
    return;
  }
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => {
    const copy = r.clone();
    caches.open(CACHE).then(c => c.put(e.request, copy));
    return r;
  })));
});
