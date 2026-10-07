/* 离线支持：外壳与静态资源缓存优先；/api/* 不做 HTTP 缓存，
   由页面 localStorage 保存“绑定来源版本的结果快照”，离线时显式标注为缓存数据。 */
const CACHE = 'tmr-shell-v1';
const SHELL = ['/', '/index.html', '/styles.css', '/app.js', '/locales/zh.json', '/locales/en.json'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/')) return; // API：交回页面（其自带 localStorage 快照策略）
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
    if (res.ok && e.request.method === 'GET') {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
    }
    return res;
  }).catch(() => caches.match('/index.html'))));
});
