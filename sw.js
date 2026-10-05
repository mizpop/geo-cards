// オフラインでも開けるようにする（ホーム画面に追加したとき用）
// 方針: このサイトのファイルは「まずネットから取得し、取れなければ保存済みのものを使う」。
// 更新したのに古いファイルが残る、ということが起きないように、ネットにつながるときは常に最新を使う
const CACHE = 'geochecker-v1';
const CORE = ['./', './index.html', './css/style.css', './manifest.webmanifest', './icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // 自分のサイトの GET だけ（Supabase・地図タイル・画像の中継などはそのまま）
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('./index.html'))),
  );
});
