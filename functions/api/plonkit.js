// Plonkit の国ごとのガイドを、日本語に翻訳して、アプリの中で読めるようにする
//   GET /api/plonkit?slug=japan            … ガイドの本文（段落ごとの画像と説明）を、日本語に翻訳した JSON で返す（ログインが必要）
//   GET /api/plonkit?img=/images/japan/2.png … Plonkit の画像（Plonkit 以外のサイトからは読み込めないので、中継する）
//   GET /api/plonkit?go=https://goo.gl/maps/xx … 短縮された Google マップのリンクを、元のリンクに戻す（ログインが必要）
// 翻訳には GEMINI_API_KEY を使う（ask.js と同じ。未設定のときは、英語のまま返す）。翻訳した結果は 1 週間、サーバーに覚えておく
import { authorized } from '../_auth.js';

const ORIGIN = 'https://www.plonkit.net';
const UA = 'Mozilla/5.0 (compatible; GeoChecker/1.0; +https://geo-cards-533.pages.dev)';
const API = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODELS = ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-flash'];
const SWITCH_ON = new Set([429, 500, 502, 503, 504]);
const CHUNK_CHARS = 5000;
const CHUNK_LINES = 50;

const json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra } });

// ページに埋め込まれたデータ（__PRELOADED_DATA__）から、ガイドを取り出して、必要な形に整える
export function extractGuide(html) {
  const m = /<script id="__PRELOADED_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  if (!m) return null;
  let data;
  try { data = JSON.parse(m[1]); } catch { return null; }
  const pub = data?.data?.public || data?.data || data?.public;
  if (!pub || !Array.isArray(pub.steps)) return null;
  const steps = pub.steps.map((s) => ({
    title: String(s.title || ''),
    items: (s.items || []).map((it) => {
      if (it.kind === 'tip') {
        const d = it.data || {};
        return { k: 'tip', img: d.image?.imageUrl || '', link: d.image?.imageLink || '', w: d.image?.width || 0, alt: d.image?.alt || '', text: (d.text || []).map(String) };
      }
      if (it.kind === 'centeredImage') return { k: 'img', img: it.imageUrl || '' };
      if (it.kind === 'divider') return { k: 'div', title: String(it.title || '') };
      return null;
    }).filter(Boolean),
  })).filter((s) => s.items.length);
  return { title: String(pub.title || ''), slug: String(pub.slug || ''), code: String(pub.code || ''), hero: pub.heroImage || '', updated: pub.updatedAt || '', steps };
}

// 翻訳する文字列を、順番に集める / 翻訳したものを、同じ順番で戻す
function walk(guide, fn) {
  for (const s of guide.steps) {
    s.title = fn(s.title);
    for (const it of s.items) {
      if (it.k === 'tip') it.text = it.text.map(fn);
      else if (it.k === 'div') it.title = fn(it.title);
    }
  }
}

async function translateChunk(lines, env) {
  const prompt = `次の JSON 配列の各文字列は、GeoGuessr（ストリートビューで場所を当てるゲーム）の攻略サイト Plonk It の、国ごとのガイドの一部です。自然な日本語に翻訳して、同じ長さの JSON 配列だけを返してください。
- GeoGuessr の用語は、日本のプレイヤーが使う言い方にする（bollard=ボラード、chevron=シェブロン、guardrail=ガードレール、license plate=ナンバープレート、Google car=Google カー、generation=世代、coverage=カバレッジ、trekker=トレッカー、snow-cam など固有の用語は、カタカナ）。
- 国・地名は、一般的な日本語の表記にする。
- Markdown の記法（**太字**、行頭の「- 」、[文字](URL)）はそのまま残し、URL は絶対に変えない。[文字] の中の文字だけを翻訳する。
- 数字・記号・絵文字・空の文字列は、そのまま。
- 配列の長さと順番を変えない。

${JSON.stringify(lines)}`;
  for (const model of MODELS) {
    const body = (cfg) => JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', responseSchema: { type: 'ARRAY', items: { type: 'STRING' } }, maxOutputTokens: 16000, ...cfg } });
    const send = (cfg) => fetch(`${API}/${model}:generateContent`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY }, body: body(cfg) }).catch(() => null);
    let r = await send(/^gemini-[3-9]/.test(model) ? { thinkingConfig: { thinkingLevel: 'MINIMAL' } } : {});
    if (r && r.status === 400) r = await send({});
    if (!r) continue;
    if (r.ok) {
      try {
        const j = await r.json();
        const text = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
        const arr = JSON.parse(text);
        if (Array.isArray(arr) && arr.length === lines.length && arr.every((x) => typeof x === 'string')) return arr;
      } catch { /* 次のモデルで試す */ }
      continue;
    }
    if (!SWITCH_ON.has(r.status)) break;
  }
  return null;
}

async function translateGuide(guide, env) {
  const all = [];
  walk(guide, (s) => { all.push(s); return s; });
  const idx = all.map((s, i) => i).filter((i) => /[A-Za-z]{2}/.test(all[i])); // 翻訳が要る（英字を含む）ものだけ
  const chunks = [];
  let cur = [];
  let len = 0;
  for (const i of idx) {
    if (cur.length && (len + all[i].length > CHUNK_CHARS || cur.length >= CHUNK_LINES)) { chunks.push(cur); cur = []; len = 0; }
    cur.push(i);
    len += all[i].length;
  }
  if (cur.length) chunks.push(cur);
  const out = all.slice();
  let failed = 0;
  await Promise.all(chunks.map(async (ids) => {
    const r = await translateChunk(ids.map((i) => all[i]), env);
    if (r) ids.forEach((i, n) => { out[i] = r[n]; }); else failed += 1;
  }));
  let n = 0;
  walk(guide, () => out[n++]);
  return { done: chunks.length - failed, total: chunks.length };
}

// 翻訳済みのデータ（data/plonkit-ja.json.gz。scripts/plonkit-strings.mjs で作る）があれば、それを使う（翻訳の API は使わない）
let staticGuides; // undefined: 未確認 / null: ファイルなし
async function staticGuide(origin, slug) {
  if (staticGuides === undefined) {
    try {
      const res = await fetch(`${origin}/data/plonkit-ja.json.gz`);
      const type = res.headers.get('content-type') || '';
      if (!res.ok || type.includes('html')) staticGuides = null;
      else {
        const body = res.headers.get('content-encoding') ? res.body : res.body.pipeThrough(new DecompressionStream('gzip'));
        staticGuides = JSON.parse(await new Response(body).text());
      }
    } catch { staticGuides = null; }
  }
  const g = staticGuides?.[slug];
  return g ? { ...g, lang: 'ja', translated: true, source: `${ORIGIN}/${slug}` } : null;
}

async function guideResponse(request, env, ctx, slug) {
  const own = await staticGuide(new URL(request.url).origin, slug);
  if (own) return json(own);
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const key = new Request(`https://plonkit.cache.invalid/v1/${slug}`);
  const hit = cache ? await cache.match(key).catch(() => null) : null;
  if (hit) return new Response(hit.body, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-plonkit-cache': 'hit' } });
  const page = await fetch(`${ORIGIN}/${slug}`, { headers: { 'user-agent': UA, accept: 'text/html' }, cf: { cacheTtl: 3600, cacheEverything: true } }).catch(() => null);
  if (!page || page.status === 404) return json({ error: 'この国の Plonkit のガイドは見つかりませんでした' }, 404);
  if (!page.ok) return json({ error: `Plonkit から取得できませんでした（${page.status}）` }, 502);
  const guide = extractGuide(await page.text());
  if (!guide) return json({ error: 'Plonkit のガイドを読み取れませんでした（サイトの作りが変わったかもしれません）' }, 502);
  let translated = false;
  if (env.GEMINI_API_KEY) {
    const r = await translateGuide(guide, env);
    translated = r.total === 0 || r.done === r.total; // 一部だけ失敗したときは、覚えずに、次回やり直す
    guide.partial = !translated && r.done > 0;
  }
  guide.lang = translated || guide.partial ? 'ja' : 'en';
  guide.translated = translated;
  guide.source = `${ORIGIN}/${slug}`;
  const body = JSON.stringify(guide);
  if (cache && translated) {
    const put = cache.put(key, new Response(body, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=604800' } })).catch(() => {});
    if (ctx?.waitUntil) ctx.waitUntil(put);
  }
  return new Response(body, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

const safeEncode = (p) => { try { return encodeURI(decodeURI(p)); } catch { return p; } };
// 画像は、まず R2 に保管したもの（バインディング PLONKIT_IMAGES。scripts/upload-plonkit-images.mjs で入れる）を返す。なければ Plonkit から取得する
async function imageResponse(path, env) {
  if (!/^\/(images|static|uploads)\/[^?#\\]+$/.test(path) || path.includes('..')) return new Response('bad request', { status: 400 });
  if (env?.PLONKIT_IMAGES) {
    let key = path.replace(/^\//, '');
    try { key = decodeURI(key); } catch { /* そのまま */ }
    const obj = await env.PLONKIT_IMAGES.get(key).catch(() => null);
    if (obj) return new Response(obj.body, { headers: { 'content-type': obj.httpMetadata?.contentType || 'image/webp', 'cache-control': 'public, max-age=2592000, immutable' } });
  }
  // Plonkit は、短い間に続けて取りにいくと、断る（403・429）ことがあるので、少し待って、やり直す
  let res = null;
  for (let i = 0; i < 2; i++) {
    res = await fetch(ORIGIN + safeEncode(path), { headers: { referer: `${ORIGIN}/`, 'user-agent': UA, accept: 'image/*' }, cf: { cacheTtl: 604800, cacheEverything: true } }).catch(() => null);
    if (res?.ok || (res && res.status === 404)) break;
    await new Promise((r) => setTimeout(r, 700));
  }
  if (!res?.ok) return new Response(`upstream ${res?.status || 'error'}`, { status: res?.status === 404 ? 404 : 502, headers: { 'cache-control': 'no-store', 'x-upstream-status': String(res?.status || 0) } });
  const type = res.headers.get('content-type') || '';
  if (!type.startsWith('image/')) return new Response('not an image', { status: 415, headers: { 'cache-control': 'no-store' } });
  return new Response(res.body, { headers: { 'content-type': type, 'cache-control': 'public, max-age=604800' } });
}

// 短縮された Google マップのリンク（goo.gl/maps/…, maps.app.goo.gl/…）を、元のリンクにする（転送先だけを見る）
async function resolveShort(raw) {
  let u;
  try { u = new URL(raw); } catch { return json({ error: 'bad url' }, 400); }
  const ok = (u.hostname === 'goo.gl' && u.pathname.startsWith('/maps/')) || u.hostname === 'maps.app.goo.gl';
  if (!ok) return json({ error: 'not allowed' }, 400);
  let url = u.toString();
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url, { redirect: 'manual', headers: { 'user-agent': UA } }).catch(() => null);
    const loc = r?.headers.get('location');
    if (!loc) break;
    url = new URL(loc, url).toString();
    if (/^https?:\/\/(www\.)?google\.[a-z.]+\/maps/.test(url)) break;
  }
  return json({ url }, 200, { 'cache-control': 'private, max-age=86400' });
}

export async function onRequestGet({ request, env, waitUntil }) {
  const q = new URL(request.url).searchParams;
  if (q.has('img')) return imageResponse(q.get('img'), env);
  if ((await authorized(request, env)) !== 'ok') return json({ error: 'ログインが必要です' }, 401);
  if (q.has('go')) return resolveShort(q.get('go'));
  const slug = (q.get('slug') || '').toLowerCase();
  if (!/^[a-z0-9-]{2,60}$/.test(slug)) return json({ error: 'bad request' }, 400);
  return guideResponse(request, env, { waitUntil }, slug);
}
