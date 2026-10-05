// オフラインでも開けるようにする（ホーム画面に追加したとき用）
// 方針: このサイトのファイルは「まずネットから取得し、取れなければ保存済みのものを使う」。
// 更新したのに古いファイルが残る、ということが起きないように、ネットにつながるときは常に最新を使う
const CACHE = 'geochecker-v1';
const CORE = ['./', './index.html', './css/style.css', './manifest.webmanifest', './icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
const KEEP = [CACHE, 'geochecker-offline-v1', 'geochecker-cdn-v1']; // 古い版だけ消す（オフライン用の保存と、CDN のライブラリは残す）
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET') return;
  // オフライン用に保存した画像
  if (url.origin === self.location.origin && url.pathname.startsWith('/offline-img/')) {
    e.respondWith(caches.open('geochecker-offline-v1').then((c) => c.match(req.url.split('?')[0])).then((r) => r || new Response('', { status: 404 })));
    return;
  }
  // CDN のライブラリ（地図・Supabase クライアントなど）: 一度読み込んだものは、オフラインでも使えるように保存しておく
  if (/^(cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com)$/.test(url.hostname)) {
    e.respondWith(caches.open('geochecker-cdn-v1').then(async (c) => {
      const hit = await c.match(req);
      const net = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => null);
      return hit || (await net) || new Response('', { status: 504 });
    }));
    return;
  }
  // 自分のサイトの GET だけ（Supabase・地図タイル・画像の中継などはそのまま）
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('./index.html'))),
  );
});
