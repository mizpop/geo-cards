// 地図の参考写真（GeoHints）を、このサイト経由で取得する（カード作成用。GeoHints の画像は他サイトから読み込めないため）
// 取得できるのは GeoHints の画像だけ（任意の URL を中継しない）
const ALLOWED = 'https://ocsc00skc0wokcs8kw8g8k84.geohints.com/storage/';

export async function onRequestGet({ request }) {
  const path = new URL(request.url).searchParams.get('path') || '';
  if (!/^[\w\-./%() ]+$/.test(path) || path.includes('..')) return new Response('bad request', { status: 400 });
  const res = await fetch(ALLOWED + path, { cf: { cacheTtl: 86400, cacheEverything: true } });
  if (!res.ok) return new Response('not found', { status: 404 });
  const type = res.headers.get('content-type') || '';
  if (!type.startsWith('image/')) return new Response('not an image', { status: 415 });
  return new Response(res.body, { headers: { 'content-type': type, 'cache-control': 'public, max-age=86400' } });
}
