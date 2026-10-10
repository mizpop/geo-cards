// GeoHints の国ごとのページ（州ごとの旗・ナンバープレート）を、アプリで使える JSON にする
//   GET /api/geohints?country=us            … 州の一覧: { states: [{ slug, name }] }
//   GET /api/geohints?country=us&state=california … その州: { code, flag, plates: [{ src, year }], page }
// 画像の URL は、GeoHints の画像の置き場（表示はそのまま、取り込みは /api/refimg 経由）。結果は 1 日、サーバーに覚える。
// GeoHints が今、州ごとのページを出しているのは、アメリカだけ（2026-10 時点）
const ORIGIN = 'https://geohints.com';
const STORAGE = 'https://ocsc00skc0wokcs8kw8g8k84.geohints.com/storage/';
const UA = 'Mozilla/5.0 (compatible; GeoChecker/1.0; +https://geo-cards-533.pages.dev)';

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=86400' } });
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();

export function parseStates(html, country) {
  const re = new RegExp(`hx-get="/countries/${country}/states/([a-z0-9-]+)"[^>]*>\\s*([^<]+?)\\s*·?\\s*<`, 'g');
  const out = []; const seen = new Set();
  for (const m of html.matchAll(re)) { if (seen.has(m[1])) continue; seen.add(m[1]); out.push({ slug: m[1], name: decode(m[2]).replace(/\s*·\s*$/, '') }); }
  return out;
}

export function parseState(html, slug) {
  const code = /storage\/[a-z]{2}\/st_([A-Z0-9]{2})\.png/.exec(html)?.[1] || '';
  const flag = /storage\/(flags\/flags_\d+\.svg)/.exec(html)?.[1] || '';
  const plates = [];
  const seen = new Set();
  if (code) for (const m of html.matchAll(new RegExp(`storage/(licensePlates/plate_${code}_([A-Za-z0-9_-]+)\\.(?:jpg|jpeg|png|webp))`, 'g'))) {
    if (seen.has(m[1])) continue; seen.add(m[1]);
    plates.push({ src: STORAGE + m[1], year: m[2] });
  }
  return { code, flag: flag ? STORAGE + flag : '', plates, slug };
}

export async function onRequestGet({ request }) {
  const u = new URL(request.url);
  const country = (u.searchParams.get('country') || '').toLowerCase();
  const state = (u.searchParams.get('state') || '').toLowerCase();
  if (!/^[a-z]{2}$/.test(country) || (state && !/^[a-z0-9-]{1,40}$/.test(state))) return json({ error: 'bad_request' }, 400);
  const url = state ? `${ORIGIN}/countries/${country}/states/${state}` : `${ORIGIN}/countries/${country}/states`;
  let res;
  try { res = await fetch(url, { headers: { 'user-agent': UA }, cf: { cacheTtl: 86400, cacheEverything: true } }); } catch { return json({ error: 'network' }, 502); }
  if (!res.ok) return json({ error: 'not_found' }, res.status === 404 ? 404 : 502);
  const html = await res.text();
  if (!state) return json({ states: parseStates(html, country) });
  const out = parseState(html, state);
  return json({ ...out, page: url });
}
