// 国モードの地図: 選んだ国だけを、州・県などの地域ごとに分けて表示する。
// 地域の境界は geoBoundaries（ADM1: 州・県・省など。名前は英語）を、国ごとに、必要になったとき取得する。
// 地域は「国コード:地域コード」（例: JP:JP-13）で区別し、国ごとの情報（シェブロン・ガードレールなど）と同じ仕組みで、値を保存・表示する。
import { createHoverBubble } from './hoverbubble.js';
import { loadLibs, addBaseTiles, isDark, svFind, mapIsLite } from './map.js';
import { suggestCities, searchCitiesOSM, fillNames, altNames } from './cities.js';
import { openSvWindow, SV_ICON } from './svwin.js';
import { MAP_MODES, modeDef, infoStyle, ensurePatterns, scalePatterns, legendHtml, factChipHtml, factPanelHtml } from './infomap.js';

// ---- 地域の旗（Wikidata の ISO 3166-2 コード → Wikimedia Commons の旗の画像）----
const flagCache = new Map(); // 地域コード → 画像の URL（なければ null）
const flagAsked = new Set(); // 問い合わせ済みの国
const flagThumb = new Map(); // 地域コード → upload.wikimedia.org の PNG（カードにするとき、ブラウザから読み込める）
export const regionFlagSrc = (rc, w = 160) => { const u = flagCache.get(rc); return flagThumb.get(rc) || (u ? `${u}?width=${w}` : ''); };
export const regionFlagReadable = (rc) => flagThumb.has(rc);
export async function loadRegionFlags(country, codes) {
  if (flagAsked.has(country)) return;
  flagAsked.add(country);
  const isos = codes.map((c) => c.split(':')[1]).filter((x) => /^[A-Z]{2}-[A-Z0-9]{1,3}$/.test(x || ''));
  for (let i = 0; i < isos.length; i += 120) {
    const part = isos.slice(i, i + 120);
    const q = `SELECT ?iso ?flag WHERE { VALUES ?iso { ${part.map((x) => `"${x}"`).join(' ')} } ?r wdt:P300 ?iso . ?r wdt:P41 ?flag . }`;
    try {
      const r = await fetch(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`, { headers: { accept: 'application/sparql-results+json' } });
      const j = await r.json();
      for (const b of j.results?.bindings || []) { const rc = `${country}:${b.iso.value}`; if (!flagCache.get(rc)) flagCache.set(rc, b.flag.value.replace(/^http:/, 'https:')); }
    } catch { /* 旗が取れなくても使える */ }
  }
  // Special:FilePath は、ブラウザから直接は読めない（CORS）ので、Commons の API で、画像の置き場（upload.wikimedia.org）の URL を求める
  const titles = new Map(); // タイトル → 地域コード
  for (const [rc, u] of flagCache) { if (!rc.startsWith(`${country}:`)) continue; try { titles.set(`File:${decodeURIComponent(u.split('/Special:FilePath/')[1])}`, rc); } catch { /* 無視 */ } }
  const all = [...titles.keys()];
  for (let i = 0; i < all.length; i += 40) {
    try {
      const r = await fetch(`https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&prop=imageinfo&iiprop=url&iiurlwidth=480&titles=${encodeURIComponent(all.slice(i, i + 40).join('|'))}`);
      const j = await r.json();
      const norm = new Map((j.query?.normalized || []).map((n) => [n.to, n.from]));
      for (const pg of Object.values(j.query?.pages || {})) {
        const thumb = pg.imageinfo?.[0]?.thumburl;
        const rc = titles.get(norm.get(pg.title) || pg.title);
        if (thumb && rc) flagThumb.set(rc, thumb);
      }
    } catch { /* 無視 */ }
  }
}


// ---- 地域のナンバープレート（Wikimedia Commons）: あらかじめ集めて保存したリンク（data/region-plates.json。scripts/collect-plates.mjs で作る）を読み込む ----
// 現行のもの・今でも使われていそうなものだけ（古い年・歴史的・外交官用・トレーラーなどを除いて、新しい年を先に）。画像は、upload.wikimedia.org の縮小画像（そのまま表示できる）
let plateData = null; let platePromise = null;
export function loadPlateData() {
  if (!platePromise) platePromise = fetch('/data/region-plates.json').then((r) => (r.ok ? r.json() : null)).then((j) => { plateData = j?.plates || {}; return plateData; }).catch(() => { platePromise = null; plateData = {}; return plateData; });
  return platePromise;
}
const plateKey = (s) => String(s || '').toLowerCase().replace(/\b(prefecture|province|state|region|oblast|department|county|district|governorate|municipality|autonomous|republic|of|the|city|canton|land|voivodeship)\b/g, '').replace(/[^a-z0-9\u00c0-\u024f\u3040-\u30ff\u3400-\u9fff]/g, '');
export function platesForRegion(country, regionName) {
  const reg = plateData?.[country];
  if (!reg) return [];
  const n = plateKey(regionName);
  if (!n) return [];
  const hit = Object.keys(reg).find((k) => plateKey(k) === n) || Object.keys(reg).find((k) => n.length >= 4 && (plateKey(k).includes(n) || n.includes(plateKey(k))) && plateKey(k).length >= 4);
  return hit ? reg[hit].map((x) => ({ src: x.u, title: x.t, year: x.y, page: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(x.t.replace(/ /g, '_'))}` })) : [];
}

// ---- GeoHints の州ごとのページ（旗・ナンバープレート。/api/geohints 経由。GeoHints が今、州ごとのページを出しているのは、アメリカだけ）----
export const ghSupported = (code) => code === 'US';
const ghListCache = new Map(); // 国コード → Promise<[{ slug, name }]>
const ghStateCache = new Map(); // 地域コード → Promise<{ flag, plates: [{ src, year }], page } | null>
const ghNorm = (s) => String(s || '').toLowerCase().replace(/\b(district|of|the|state)\b/g, '').replace(/[^a-z0-9]/g, '');
export function loadGhStateByName(country, rc, name) {
  if (!ghSupported(country)) return Promise.resolve(null);
  if (!ghStateCache.has(rc)) {
    ghStateCache.set(rc, (async () => {
      if (!ghListCache.has(country)) ghListCache.set(country, fetch(`/api/geohints?country=${country.toLowerCase()}`).then((r) => r.json()).then((j) => j.states || []).catch(() => { ghListCache.delete(country); return []; }));
      const list = await ghListCache.get(country);
      const n = ghNorm(name);
      const hit = list.find((x) => ghNorm(x.name) === n) || list.find((x) => ghNorm(x.slug) === n) || list.find((x) => n && (ghNorm(x.name).includes(n) || n.includes(ghNorm(x.name))) && ghNorm(x.name).length >= 5);
      if (!hit) return null;
      const j = await (await fetch(`/api/geohints?country=${country.toLowerCase()}&state=${hit.slug}`)).json();
      if (j.error) return null;
      return { flag: j.flag || '', plates: j.plates || [], page: j.page || '' };
    })().catch(() => { ghStateCache.delete(rc); return null; }));
  }
  return ghStateCache.get(rc);
}

const registry = new Map(); // 地域コード → { name, parent }
export const isRegionCode = (c) => typeof c === 'string' && c.includes(':');
export const regionName = (c) => registry.get(c)?.name || String(c).split(':')[1] || c;
export const regionParent = (c) => registry.get(c)?.parent || String(c).split(':')[0];

// 軽くするための間引き（Douglas–Peucker）。境界の点が多すぎると、地図の描画と操作が重くなる
function simplifyRing(pts, tol) {
  const n = pts.length;
  if (n <= 8) return pts;
  const keep = new Uint8Array(n);
  keep[0] = 1; keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  const t2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop();
    let max = 0; let idx = -1;
    const [ax, ay] = pts[a]; const [bx, by] = pts[b];
    const dx = bx - ax; const dy = by - ay; const len2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      let d;
      if (len2 === 0) { d = (pts[i][0] - ax) ** 2 + (pts[i][1] - ay) ** 2; } else {
        const k = Math.max(0, Math.min(1, ((pts[i][0] - ax) * dx + (pts[i][1] - ay) * dy) / len2));
        d = (pts[i][0] - (ax + k * dx)) ** 2 + (pts[i][1] - (ay + k * dy)) ** 2;
      }
      if (d > max) { max = d; idx = i; }
    }
    if (idx >= 0 && max > t2) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
function simplifyGeometry(g) {
  if (!g) return g;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : null;
  if (!polys) return g;
  // 全体の大きさに合わせた許容値（小さい地域は細かく、大きい地域は粗く）
  let w = Infinity; let e = -Infinity; let s = Infinity; let n = -Infinity;
  for (const poly of polys) for (const [x, y] of poly[0]) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
  const span = Math.max(e - w, n - s);
  const tol = Math.max(0.0008, Math.min(0.02, span * 0.002));
  const out = [];
  for (const poly of polys) {
    const outer = poly[0];
    let pw = Infinity; let pe = -Infinity; let ps = Infinity; let pn = -Infinity;
    for (const [x, y] of outer) { if (x < pw) pw = x; if (x > pe) pe = x; if (y < ps) ps = y; if (y > pn) pn = y; }
    if (polys.length > 1 && Math.max(pe - pw, pn - ps) < tol * 4) continue; // ごく小さい島は、省く
    const rings = poly.map((r) => simplifyRing(r, tol)).filter((r) => r.length >= 4);
    if (rings.length) out.push(rings);
  }
  if (!out.length) return g;
  return out.length === 1 ? { type: 'Polygon', coordinates: out[0] } : { type: 'MultiPolygon', coordinates: out };
}

const cache = new Map(); // 国コード → Promise<FeatureCollection>
export function loadRegions(code, iso3) {
  if (!cache.has(code)) {
    cache.set(code, (async () => {
      if (!iso3) throw new Error('この国の地域データはありません');
      const meta = await (await fetch(`https://www.geoboundaries.org/api/current/gbOpen/${iso3}/ADM1/`)).json();
      const url = meta.simplifiedGeometryGeoJSON || meta.gjDownloadURL;
      if (!url) throw new Error('この国の地域データはありません');
      // github.com/…/raw/… は、ブラウザから直接読むと CORS で断られるので、同じファイルを返す media.githubusercontent.com を使う（大きいファイルは Git LFS に入っている）
      const m = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/raw\/(.+)$/.exec(url);
      const urls = m ? [`https://media.githubusercontent.com/media/${m[1]}/${m[2]}`, `https://raw.githubusercontent.com/${m[1]}/${m[2]}`, url] : [url];
      let fc = null;
      for (const u of urls) { try { const r = await fetch(u); if (!r.ok) continue; const j = await r.json(); if (j?.features) { fc = j; break; } } catch { /* 次の URL */ } }
      if (!fc) throw new Error('地域データを読み込めませんでした');
      const seen = new Set();
      let n = 0;
      for (const f of fc.features || []) {
        if (++n % 6 === 0) await new Promise((r) => setTimeout(r, 0)); // 点の間引きは重いので、少しずつ（画面が固まらないように、途中で一息つく）
        const p = f.properties || {};
        let id = `${code}:${p.shapeISO || p.shapeID || p.shapeName}`;
        while (seen.has(id)) id += '_';
        seen.add(id);
        f.geometry = simplifyGeometry(f.geometry);
        f.properties = { code: id, name: p.shapeName || id, parent: code };
        registry.set(id, { name: f.properties.name, parent: code });
      }
      return fc;
    })());
    cache.get(code).catch(() => cache.delete(code));
  }
  return cache.get(code);
}

const MODE_KEY = 'geo-regionmap-mode';
const EDITABLE = MAP_MODES.filter((m) => m.editable).map((m) => m.id);
const MODES = ['cards', 'flag', 'none', ...EDITABLE];
const modeInfo = (id) => (id === 'cards' ? { icon: '🃏', name: 'カード' } : id === 'flag' ? { icon: '🚩', name: '地域の旗' } : modeDef(id));
let mode = (() => { try { const v = localStorage.getItem(MODE_KEY); return MODES.includes(v) ? v : 'cards'; } catch { return 'cards'; } })();
let legendOpenPref = null; // 凡例の開閉（未操作なら、広い画面は開く・スマホは閉じる）
let svTemp = false; // スペースキーを押している間だけのストリートビューのモード
let svOn = false; // ストリートビューのモード（地図を描き直しても引き継ぐ）

let S = null; // 今の画面の状態
let pendingCity = null; // カードの地名を押して、地図を開いたとき: 開いたら、その場所へ飛ぶ
export const showRegionCityOnNextRender = (place) => { pendingCity = place; };
let cleanups = []; // 地図を離れるとき（ほかのタブへ移る・描き直す）に、必ず外すもの（キー・マウスの監視など）
/** 国モードの地図を片付ける（ほかのタブへ移るとき・描き直すとき）。外し忘れた監視が、ほかのタブのキー操作を奪って、固まったように見えるのを防ぐ */
export function teardownRegionMap() {
  for (const fn of cleanups.splice(0)) { try { fn(); } catch { /* 無視 */ } }
  if (S) { S.seq += 1; try { S.map?.remove(); } catch { /* 無視 */ } S.map = null; S.bubble?.destroy(); S.bubble = null; }
  svTemp = false;
}
const listen = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); cleanups.push(() => target.removeEventListener(type, fn, opts)); };
const norm = (s) => String(s || '').toLowerCase().replace(/\b(prefecture|province|state|region|oblast|department|county|district|governorate|municipality|city|autonomous|republic|of|the)\b/g, '').replace(/[\s\-_.,()'’]/g, '');

// ---- 点がどの地域に入るか（境界の多角形との判定）----
function ringHas(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const polyHas = (poly, x, y) => ringHas(poly[0], x, y) && !poly.slice(1).some((h) => ringHas(h, x, y));
// 地域の代表点（いちばん大きい部分の重心。外にはみ出すときは、内側の点）: 旗・カードの印の位置
function labelPoint(polys) {
  let big = null; let ba = -1;
  for (const poly of polys) {
    const r = poly[0]; let a = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] * r[i][1] - r[i][0] * r[j][1]);
    if (Math.abs(a) > ba) { ba = Math.abs(a); big = poly; }
  }
  if (!big) return null;
  const r = big[0];
  // 面積で重みをつけた重心（頂点の平均だと、海岸線の点が多い側に寄ってしまう）
  let a2 = 0; let cx = 0; let cy = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const f = r[j][0] * r[i][1] - r[i][0] * r[j][1];
    a2 += f; cx += (r[j][0] + r[i][0]) * f; cy += (r[j][1] + r[i][1]) * f;
  }
  if (Math.abs(a2) > 1e-12) { cx /= 3 * a2; cy /= 3 * a2; } else { cx = r[0][0]; cy = r[0][1]; }
  if (polyHas(big, cx, cy)) return [cy, cx];
  for (let i = 0; i < r.length; i += Math.max(1, Math.floor(r.length / 40))) {
    const x = (r[i][0] + cx) / 2; const y = (r[i][1] + cy) / 2;
    if (polyHas(big, x, y)) return [y, x];
  }
  return [r[0][1], r[0][0]];
}
function indexRegion(f) {
  const g = f.geometry;
  const polys = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : [];
  let w = Infinity; let e = -Infinity; let s = Infinity; let n = -Infinity;
  for (const poly of polys) for (const [x, y] of poly[0]) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
  return { polys, bbox: [w, s, e, n], center: labelPoint(polys) };
}
function regionAt(lat, lng) {
  if (!S) return null;
  for (const [rc, r] of S.geo) {
    const [w, s, e, n] = r.bbox;
    if (lng < w || lng > e || lat < s || lat > n) continue;
    if (r.polys.some((poly) => polyHas(poly, lng, lat))) return rc;
  }
  return null;
}

// ---- カードの場所: カードに登録した地名・関連付けたストリートビューの座標から、どの地域のカードかを判断する ----
// 座標のないカードだけ、「詳細エリア」に地域の名前が入っているかで判断する
function computeCardRegions() {
  const map = new Map(); // カード id → { regions: Set, points: [{ lat, lng, label, region }] }
  for (const c of S.ctx.cards) {
    const pts = S.ctx.cardPoints(c).map((p) => ({ ...p, region: regionAt(p.lat, p.lng) }));
    const regions = new Set(pts.map((p) => p.region).filter(Boolean));
    if (!pts.length) {
      const hay = norm(c.area);
      if (hay.length >= 2) for (const [rc] of S.geo) { const nm = norm(regionName(rc)); if (nm.length >= 2 && (hay.includes(nm) || nm.includes(hay)) && (c.scope_countries || []).includes(regionParent(rc))) regions.add(rc); }
    }
    map.set(c.id, { regions, points: pts });
  }
  S.cardRegions = map;
}
// 表示するカード（地図の「地域・カテゴリー」の絞り込みを反映）
const shownCards = () => S.ctx.cards.filter((c) => S.ctx.filterMatch(c));
function cardsOfRegion(rc) {
  if (!S.cardRegions) computeCardRegions();
  return shownCards().filter((c) => S.cardRegions.get(c.id)?.regions.has(rc));
}
const byRegionMap = () => { const m = new Map(); for (const rc of S.byCode.keys()) { const l = cardsOfRegion(rc); if (l.length) m.set(rc, l); } return m; };

const SV_TILE = (x, y, z) => `https://mts1.google.com/vt?hl=ja&lyrs=svv&style=40,18&x=${x}&y=${y}&z=${z}`;

/** 地域の名前（英語）から、境界データの地域と、その代表点を探す: [{ input, name, rc, lat, lng }]（見つからないものは rc なし）。AI のカード提案で、カードの地域を決めるのに使う */
export async function resolveRegions(code, iso3, names) {
  const fc = await loadRegions(code, iso3);
  const feats = fc.features.map((f) => ({ f, nm: norm(f.properties.name), iso: String(f.properties.code.split(':')[1] || '').toLowerCase() }));
  const out = [];
  for (const input of names) {
    const n = norm(input);
    const raw = String(input).trim().toLowerCase();
    if (!n && !raw) continue;
    const hit = feats.find((x) => x.nm === n) || feats.find((x) => x.iso === raw) || feats.find((x) => n.length >= 3 && (x.nm.includes(n) || n.includes(x.nm)) && x.nm.length >= 3);
    if (!hit) { out.push({ input }); continue; }
    const c = indexRegion(hit.f).center;
    out.push({ input, name: hit.f.properties.name, rc: hit.f.properties.code, lat: c?.[0], lng: c?.[1] });
  }
  return out;
}

export async function renderRegionMap(view, ctx) {
  const keepFocus = S?.selected && S.ctx === ctx ? S.selected : null;
  const prevSeq = S?.seq || 0;
  teardownRegionMap();
  let legendOpen = legendOpenPref ?? !window.matchMedia('(max-width: 760px)').matches;
  const seq = Math.max(prevSeq, S?.seq || 0) + 1;
  S = { seq, ctx, view, map: null, byCode: new Map(), geo: new Map(), cardRegions: null, selected: null, pins: null, thumbs: new Map(), gh: null, ghs: new Map(), ghPending: new Set(), ghQueue: [], ghActive: 0, ghTimer: null, svCov: null, svPins: null, found: null, byRegion: new Map() };
  const { esc, countryName, flagImg } = ctx;
  const countries = ctx.countries;
  view.innerHTML = `
    <div class="toolbar map-toolbar rm-bar">
      <label class="rm-modes"><span class="muted small">表示</span>
        <select class="select select-sm" id="rm-mode" aria-label="表示する情報">${MODES.map((id) => `<option value="${id}" ${id === mode ? 'selected' : ''}>${modeInfo(id).icon} ${esc(modeInfo(id).name)}</option>`).join('')}</select></label>
      ${mode === 'cards' ? ctx.filterPicksHtml() : ''}
      ${ctx.isEditor() ? '<button type="button" class="btn btn-ghost btn-sm" id="rm-flagcards" title="選んだ国の、地域ごとの旗・ナンバープレートを、まとめてカードにします（ラベルは、その国の「地域」。すでにカードがある地域は除きます）">🗂 旗・ナンバーをまとめてカードに</button>' : ''}
      <button class="btn btn-ghost btn-sm" id="rm-all" aria-label="選んだ国の全体" title="選んだ国の全体を表示">🌐<span class="tab-long"> 国全体</span></button>
      <span class="rm-countries">${countries.map((c) => `<span class="chip">${flagImg(c)} ${esc(countryName(c))}</span>`).join('')}</span>
      <span class="muted small map-hint" id="rm-status">地域の境界を読み込んでいます…</span>
    </div>
    <div class="map-layout rm-layout" style="--panel-w:${ctx.panelWidth()}px">
      <div class="map-box rm-box">
        <div class="rm-map" id="rm-map"></div>
        <div class="map-top">
          <div class="map-search">
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
            <input type="search" id="map-search" placeholder="${esc(countries.length === 1 ? countryName(countries[0]) : '選んだ国')}の地名・地域を検索" autocomplete="off" enterkeyhint="go" aria-label="地名・地域を検索">
            <div class="map-suggest" id="rm-suggest" role="listbox" aria-label="候補" hidden></div>
          </div>
          <button class="map-sv-btn ${svOn ? 'is-on' : ''}" id="rm-sv" type="button" aria-pressed="${svOn}" aria-label="ストリートビュー" title="ストリートビュー: 押してから、青い線で表示される道路の近くをクリックすると、その場所のストリートビューが開きます">${SV_ICON}</button>
        </div>
        <div class="sv-banner" id="rm-sv-banner" hidden>${SV_ICON}<span>青い線がストリートビューのある道路です。その近くをクリックしてください</span><button type="button" class="link-btn" id="rm-sv-exit">終了</button></div>
        <div class="map-legend ${legendOpen ? 'is-open' : ''}" id="map-legend" ${mode === 'cards' || mode === 'flag' || mode === 'none' ? 'hidden' : ''}><button type="button" class="lg-title" aria-expanded="${legendOpen}" title="凡例を開く / 閉じる">${modeInfo(mode).icon} ${esc(modeInfo(mode).name)}<span class="lg-toggle" aria-hidden="true">▾</span></button><div class="lg-desc">${esc(modeInfo(mode).desc || '')}</div><div class="lg-items"></div></div>
      </div>
      <div class="vsplit" aria-hidden="true"></div>
      <aside class="map-panel" id="rm-panel" style="--pinfo-h:${(Math.max(ctx.panelSplit(), 0.5) * 100).toFixed(1)}%">
        <section class="pinfo" id="pinfo"></section>
        <section class="plist" id="plist"></section>
      </aside>
    </div>`;
  ctx.setFit?.(true);
  ctx.bindFilterPicks?.(() => renderRegionMap(S.view, S.ctx));
  await loadLibs();
  if (S.seq !== seq || !view.isConnected) return;
  const L = window.L;
  const mapEl = view.querySelector('#rm-map');
  // 世界モードの地図と同じ仕組み: 塗りは軽い canvas（シェブロンなどの模様で塗るときだけ SVG）・低スペックの端末や、アニメーションをオフにしているときは、動きを省く
  const lite = mapIsLite();
  const anim = ctx.animations() && !lite;
  const patternMode = !!modeDef(mode).pattern;
  S.lite = lite;
  const map = L.map(mapEl, {
    zoomSnap: 0.25, minZoom: 1, maxZoom: 19, worldCopyJump: false, keyboard: false, preferCanvas: true,
    renderer: patternMode ? window.L.svg({ padding: lite ? 0.25 : 0.6 }) : window.L.canvas({ padding: lite ? 0.3 : 0.8 }),
    zoomAnimation: anim, fadeAnimation: anim, markerZoomAnimation: anim,
  }).setView([20, 10], 2);
  // 移動のアニメーション中は、塗りは見た目だけ引き伸ばされ、クリックの判定は移動前の位置のまま。移動中に押されたら、その場で止めて、判定を今の位置に合わせる
  let flying = false;
  S.fly = (target, zoom) => { if (anim) { flying = true; map.flyTo(target, zoom, { duration: 0.8 }); } else map.setView(target, zoom, { animate: false }); };
  S.flyBounds = (b, opts) => { if (anim) { flying = true; map.flyToBounds(b, { ...opts, duration: 0.8 }); } else map.fitBounds(b, { ...opts, animate: false }); };
  map.on('moveend', () => { flying = false; });
  map.getContainer().addEventListener('pointerdown', () => {
    if (!flying) return;
    flying = false;
    map.stop();
    map.setView(map.getCenter(), map.getZoom(), { animate: false, reset: true });
  }, { capture: true });
  // 移動が途中で打ち切られると、塗りを描く canvas の位置が古いまま残ることがある。終わるたびに、食い違っているときだけ、計算し直す
  const resync = () => requestAnimationFrame(() => {
    const r = S?.map && S.map._renderer;
    if (!r || !r._reset || S.map._animatingZoom) return;
    const stale = r._zoom !== S.map.getZoom() || !r._center || S.map.getCenter().distanceTo(r._center) > 1 || /scale\((?!1\))/.test(r._container?.style.transform || '');
    if (stale) r._reset();
  });
  map.on('zoomend moveend viewreset resize', resync);
  S.map = map;
  mapEl.classList.toggle('map-dark', isDark()); // ダークモード: 背景の地図の色を反転（地図タブと同じ）
  addBaseTiles(map, { updateWhenZooming: false });
  map.attributionControl.addAttribution('地域の境界 &copy; <a href="https://www.geoboundaries.org/" target="_blank" rel="noopener">geoBoundaries</a>');
  map.on('zoomend', () => scalePatterns(map.getPane('overlayPane').querySelector('svg'), map.getZoom()));
  // 動かしている間に何度も描き直さないよう、少し待って、一度だけ描く
  let redrawTimer = null;
  map.on('zoomend moveend', () => { clearTimeout(redrawTimer); redrawTimer = setTimeout(() => { if (S?.seq !== seq || !S.map) return; drawMarks(); if (!S.selected) renderList(); }, 120); });
  cleanups.push(() => clearTimeout(redrawTimer));
  requestAnimationFrame(() => { try { map.invalidateSize(); } catch { /* 無視 */ } });
  view.querySelector('#rm-mode').addEventListener('change', (e) => { mode = e.target.value; try { localStorage.setItem(MODE_KEY, mode); } catch { /* 無視 */ } renderRegionMap(S.view, S.ctx); });
  renderPanel();
  view.querySelector('#map-legend .lg-title')?.addEventListener('click', (e) => {
    legendOpen = !legendOpen; legendOpenPref = legendOpen;
    view.querySelector('#map-legend').classList.toggle('is-open', legendOpen);
    e.currentTarget.setAttribute('aria-expanded', String(legendOpen));
  });
  view.querySelector('#rm-all').addEventListener('click', () => { clearFocus(); try { S.flyBounds(S.group.getBounds(), { padding: [20, 20], maxZoom: 7 }); } catch { /* 無視 */ } });
  const bubble = createHoverBubble();
  S.bubble = bubble;
  const hintHtml = (rc) => {
    const fl = regionFlagSrc(rc, 48);
    const flag = fl ? `<img class="rm-flag-s" src="${esc(fl)}" alt="">` : '';
    if (mode === 'cards') { const n = (S.byRegion.get(rc) || []).length; return `${flag}${n ? `<span class="hb-n">${n} 枚</span>` : ''}`; }
    return `${flag}${EDITABLE.includes(mode) ? factChipHtml(mode, rc) : ''}`;
  };
  let loaded = 0; let failed = 0;
  const status = () => { const el = view.querySelector('#rm-status'); if (el) el.textContent = loaded + failed < countries.length ? `地域の境界を読み込んでいます… ${loaded + failed} / ${countries.length}` : failed ? `${failed} か国は、地域の境界を読み込めませんでした（データがない国もあります）` : `${mode === 'cards' ? 'クリック・拡大でカード表示' : 'クリックで地域を選択'} ／ スペースキー長押しでストリートビュー（${S.byCode.size} 地域）`; };
  const group = L.featureGroup().addTo(map);
  S.group = group;
  await Promise.all(countries.map(async (code) => {
    try {
      const fc = await loadRegions(code, ctx.iso3Of(code));
      if (S.seq !== seq) return;
      const layer = L.geoJSON(fc, {
        smoothFactor: S.lite ? 4 : 1.5, // 細かすぎる点は省いて描く（見た目はほぼ同じで軽くなる）
        style: (f) => styleOf(f.properties.code),
        onEachFeature: (f, l) => {
          const rc = f.properties.code;
          S.byCode.set(rc, l);
          S.geo.set(rc, indexRegion(f));
          // 世界モードの国と同じ、旗 + 名前 + ひとこと（カード枚数・選んでいる情報）の吹き出し。ひとつだけを使い回す
          l.on('mouseover', (e) => { if (svOn) return; S.hover = rc; if (!S.lite) l.setStyle(styleOf(rc)); refreshThumbs(); bubble.show(`${flagImg(code)}<b>${esc(f.properties.name)}</b>${hintHtml(rc)}`, e); });
          l.on('mouseout', () => { if (S.hover === rc) S.hover = null; if (!S.lite) l.setStyle(styleOf(rc)); refreshThumbs(); bubble.hide(); });
          l.on('click', () => { if (!svOn) { S.clicked = true; setTimeout(() => { S.clicked = false; }, 0); toggleFocus(rc); } });
        },
      });
      group.addLayer(layer);
      // 境界線は、世界モードの国境線と同じ色・太さの、別の層（クリックは受けない）
      L.geoJSON(fc, { style: () => ({ color: isDark() ? '#7d8b96' : '#8f9aa3', weight: 0.8, opacity: 0.7, fill: false }), interactive: false, smoothFactor: S.lite ? 4 : 1.5 }).addTo(map);
      loaded++;
      loadRegionFlags(code, fc.features.map((f) => f.properties.code)).then(() => { if (S?.seq === seq) { drawMarks(); if (S.selected) renderInfo(); } }); // 旗は、あとから届く
    } catch { failed++; }
    S.cardRegions = null; // 地域がそろうたびに、カードの場所を判断し直す
    status();
    if (group.getLayers().length && !S.fitted) { try { map.fitBounds(group.getBounds(), { padding: [20, 20], maxZoom: 7 }); } catch { /* 無視 */ } }
    if (loaded + failed >= countries.length) S.fitted = true;
    restyle();
  }));
  status();
  if (S?.seq !== seq || !S.map) return; // 待っている間に、地図を離れた（ほかのタブへ移った・描き直した）
  if (keepFocus && S.byCode.has(keepFocus)) focusRegion(keepFocus);
  buildGeoHints(); // GeoHints の参考写真を、地域に振り分ける（座標つきのもの）
  loadPlateData().then(() => { if (S?.seq === seq && S.map) { drawMarks(); if (S.selected) renderInfo(); } }); // 保存したナンバープレートのリンク
  setupSearch();
  if (pendingCity) { const c = pendingCity; pendingCity = null; S.showCity?.(c); } // カードの地名から来たときは、その場所へ飛ぶ
  setupSv();
  setupFlagCards();
  // 地域のないところ（海・ほかの国など）をクリックしたら、選択を解除（世界モードと同じ）
  map.on('click', () => { if (S.clicked) { S.clicked = false; return; } if (!svOn) clearFocus(); });
  mapEl.addEventListener('click', (e) => { // 地図の上のサムネイル・数字・旗
    const th = e.target.closest('.map-thumb[data-card]');
    if (th) { const c = ctx.cards.find((x) => x.id === th.dataset.card); if (c) ctx.openCard(c, th, (S.byRegion.get(th.closest('[data-rc]')?.dataset.rc) || [c]).map((x) => x.id)); return; }
    const ps = e.target.closest('.map-thumb.is-pseudo');
    if (ps && !svOn) { S.clicked = true; setTimeout(() => { S.clicked = false; }, 0); openPseudo(ps.dataset.rc, ps.dataset.kind, Number(ps.dataset.idx), ps); return; }
    const hd = e.target.closest('[data-rc]');
    if (hd && !svOn) { S.clicked = true; setTimeout(() => { S.clicked = false; }, 0); toggleFocus(hd.dataset.rc); }
  }, true); // Leaflet の印は、クリックを上に伝えないので、先に（キャプチャで）受ける
  // Esc: ストリートビューのモード → 地名の目印 → 地域の選択、の順に解除（世界モードと同じ）
  listen(document, 'keydown', (e) => {
    if (e.key !== 'Escape' || S?.view !== view || !mapEl.isConnected || document.querySelector('dialog[open]') || /^(input|textarea|select)$/i.test(e.target.tagName)) return;
    if (svOn) S.setSv?.(false); else if (S.city) S.clearCity?.(); else if (S.selected) clearFocus();
  });

  // ---- 地名・地域の検索（選んだ国の中だけ。世界モードの地図と同じ流れ）----
  function setupSearch() {
    const ms = view.querySelector('#map-search');
    const sug = view.querySelector('#rm-suggest');
    let cities = []; let hi = -1; let osmMode = false; let sugQ = ''; let sugCtl = null; let sugTimer = null; let sugSeq = 0;
    const inSet = (c) => !c.code || countries.includes(c.code);
    const fmtPop = (n) => (n >= 10000 ? `${Math.round(n / 10000).toLocaleString()}万人` : n ? `${n.toLocaleString()}人` : '');
    const regionHits = (q) => {
      const nq = norm(q); const out = [];
      if (nq.length >= 1) for (const rc of S.byCode.keys()) { if (norm(regionName(rc)).includes(nq)) out.push({ region: rc, name: regionName(rc), sub: `${countryName(regionParent(rc))}の地域`, code: regionParent(rc), pop: 0 }); if (out.length >= 5) break; }
      return out;
    };
    const closeSug = () => { sug.hidden = true; hi = -1; };
    const sugRows = () => cities.length + (osmMode ? 0 : 1);
    function renderSug(q, status = '') {
      const rows = cities.map((c, i) => `<button type="button" role="option" class="sug-row ${i === hi ? 'is-hi' : ''}" data-i="${i}">
        ${c.code ? flagImg(c.code) : '<span class="sug-ico">🏙</span>'}
        <span class="sug-main"><span class="sug-title"><b>${esc(c.name)}</b>${c.region ? '' : altNames(c).map((n) => `<em class="sug-alt">${esc(n)}</em>`).join('')}</span><small>${esc(c.region ? c.sub : [c.sub, c.code ? countryName(c.code) : ''].filter(Boolean).join('・'))}</small></span>
        ${c.pop ? `<span class="sug-pop">${fmtPop(c.pop)}</span>` : ''}
      </button>`).join('');
      const more = osmMode ? '' : `<button type="button" class="sug-row sug-more ${hi === cities.length ? 'is-hi' : ''}" data-more="1"><span class="sug-ico">🔎</span><span class="sug-main"><b>OpenStreetMap で「${esc(q)}」を探す</b><small>小さな地名・漢字の名前など</small></span></button>`;
      sug.innerHTML = `${status ? `<div class="sug-status">${esc(status)}</div>` : ''}${rows}${more}`;
      sug.hidden = !(rows || more || status);
      sug.querySelector('.is-hi')?.scrollIntoView({ block: 'nearest' });
    }
    async function runSuggest(q) {
      sugCtl?.abort(); sugCtl = new AbortController();
      const my = ++sugSeq;
      const local = regionHits(q);
      try {
        const list = (await suggestCities(q, { signal: sugCtl.signal, count: 14 })).filter(inSet);
        if (my !== sugSeq) return;
        cities = [...local, ...list]; sugQ = q; osmMode = false; hi = -1;
        if (document.activeElement === ms) renderSug(q);
        Promise.allSettled(list.slice(0, 6).map((c) => fillNames(c, { signal: sugCtl?.signal }))).then(() => { if (my === sugSeq && !sug.hidden && document.activeElement === ms) renderSug(q); });
      } catch (e) { if (e.name !== 'AbortError' && my === sugSeq) { cities = local; osmMode = false; renderSug(q); } }
    }
    async function runOsm(q, autoPick = false) {
      sugCtl?.abort(); sugCtl = new AbortController();
      const my = ++sugSeq; osmMode = true; cities = []; hi = -1;
      renderSug(q, 'OpenStreetMap で探しています…');
      try {
        const list = (await searchCitiesOSM(q, { signal: sugCtl.signal })).filter(inSet);
        if (my !== sugSeq) return;
        cities = list; sugQ = q;
        if (!list.length) { renderSug(q, '見つかりませんでした'); ctx.toast('この国の中に、見つかりません', 'error'); return; }
        if (autoPick) { pickCity(list[0]); return; }
        renderSug(q);
      } catch (e) { if (e.name !== 'AbortError' && my === sugSeq) { renderSug(q, e.message || '検索できませんでした'); ctx.toast(e.message || '検索できませんでした', 'error'); } }
    }
    // 選んだ都市へ移動して目印を置く。その地域があれば、右パネルにその地域の情報を出す
    const cityIcon = (c) => {
      const place = [c.sub, c.code ? countryName(c.code) : ''].filter(Boolean).join('・');
      return L.divIcon({ className: 'city-pin', iconSize: [0, 0], iconAnchor: [0, 0], html: `<span class="city-dot"></span><div class="city-card">${c.code ? flagImg(c.code) : ''}<span class="city-name"><span class="city-title"><b>${esc(c.name)}</b>${altNames(c).map((n) => `<em class="city-alt">${esc(n)}</em>`).join('')}</span>${place ? `<small>${esc(place)}</small>` : ''}</span><button type="button" class="city-x" aria-label="目印を消す" title="目印を消す（Esc）">✕</button></div>` });
    };
    function showCity(c) {
      S.city = c; S.cityMarker?.remove();
      S.cityMarker = L.marker([c.lat, c.lng], { icon: cityIcon(c), keyboard: false, zIndexOffset: 4500 }).addTo(map);
      const bindX = () => S.cityMarker?.getElement()?.querySelector('.city-x')?.addEventListener('click', (e) => { e.stopPropagation(); clearCity(); });
      bindX();
      if (!c.filled) fillNames(c).then(() => { if (S.city === c && S.cityMarker) { S.cityMarker.setIcon(cityIcon(c)); bindX(); } }).catch(() => {});
      S.fly([c.lat, c.lng], c.zoom || 11);
      const rc = regionAt(c.lat, c.lng);
      if (rc && rc !== S.selected) { const prev = S.selected; S.selected = rc; for (const x of [prev, rc]) { const l = x && S.byCode.get(x); if (l) l.setStyle(styleOf(x)); } renderPanel(); }
    }
    S.showCity = showCity;
    S.clearCity = () => { S.city = null; S.cityMarker?.remove(); S.cityMarker = null; };
    const clearCity = S.clearCity;
    function pickCity(c) {
      clearTimeout(sugTimer); sugCtl?.abort(); closeSug();
      if (c.region) { clearCity(); focusRegion(c.region); } else showCity(c);
      ms.blur(); ms.value = ''; ms.dispatchEvent(new Event('input'));
    }
    // Enter: 入力した言葉そのもので、すぐに探して移動する（候補が更新されるのを待たない）
    async function resolveCity(q) {
      clearTimeout(sugTimer);
      const local = regionHits(q);
      const exact = local.find((r) => norm(r.name) === norm(q));
      if (exact) { pickCity(exact); return; }
      if (!(sugQ === q && cities.length && !osmMode)) {
        sugCtl?.abort(); sugCtl = new AbortController();
        const my = ++sugSeq; cities = []; sugQ = ''; osmMode = false;
        renderSug(q, '探しています…');
        try {
          const list = (await suggestCities(q, { signal: sugCtl.signal, count: 14 })).filter(inSet);
          if (my !== sugSeq) return;
          if (list.length) { cities = [...local, ...list]; sugQ = q; }
        } catch (e) { if (e.name === 'AbortError') return; }
      }
      const firstCity = cities.find((c) => !c.region);
      if (firstCity && firstCity.pop > 0) pickCity(firstCity);
      else if (local.length) pickCity(local[0]);
      else runOsm(q, true);
    }
    ms.addEventListener('input', () => {
      clearTimeout(sugTimer);
      const q = ms.value.trim();
      hi = -1;
      if (!q) { sugCtl?.abort(); sugSeq++; cities = []; sugQ = ''; closeSug(); return; }
      sugTimer = setTimeout(() => runSuggest(q), 300);
    });
    ms.addEventListener('keydown', (e) => {
      if (e.isComposing) return;
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !sug.hidden && sugRows()) {
        e.preventDefault();
        const n = sugRows();
        hi = e.key === 'ArrowDown' ? (hi + 1) % n : (hi < 0 ? n - 1 : (hi - 1 + n) % n);
        renderSug(ms.value.trim());
        return;
      }
      if (e.key === 'Escape') { closeSug(); S.clearCity(); ms.blur(); return; }
      if (e.key !== 'Enter' || e.ctrlKey || e.metaKey || e.altKey) return;
      const q = ms.value.trim();
      if (!q) return;
      e.preventDefault();
      if (hi >= 0 && sugQ === q) { if (hi < cities.length) pickCity(cities[hi]); else runOsm(q); return; }
      resolveCity(q);
    });
    sug.addEventListener('mousedown', (e) => e.preventDefault()); // 候補を押しても、入力欄から離れない
    sug.addEventListener('click', (e) => {
      const row = e.target.closest('.sug-row');
      if (!row) return;
      if (row.dataset.more) runOsm(ms.value.trim()); else pickCity(cities[Number(row.dataset.i)]);
    });
    ms.addEventListener('blur', () => setTimeout(closeSug, 150));
    // 地図の他の場所をクリックしたら、地名の目印を消す（目印の上のクリックは、地図には伝わらない）
    map.on('click', () => { if (S.city) S.clearCity(); });
  }

  // ---- ストリートビュー（青い線の近くをクリックすると、その場所のストリートビューを開く）----
  function setupSv() {
    const btn = view.querySelector('#rm-sv');
    const banner = view.querySelector('#rm-sv-banner');
    const drawSavedPins = () => {
      S.svPins?.remove(); S.svPins = null;
      if (!svOn) return;
      const g = L.layerGroup();
      for (const r of ctx.savedSv()) {
        if (r.code && !countries.includes(r.code)) continue;
        L.circleMarker([Number(r.lat), Number(r.lng)], { radius: 6, color: '#fff', weight: 2, fillColor: '#1c7ed6', fillOpacity: 1 }).addTo(g).bindTooltip(ctx.svLabel(r)).on('click', (e) => { L.DomEvent.stop(e); ctx.openSv(Number(r.lat), Number(r.lng), ctx.svView(r)); });
      }
      g.addTo(map); S.svPins = g;
    };
    const addCoverage = () => {
      if (S.svCov) return;
      if (!map.getPane('svCoverage')) { const pane = map.createPane('svCoverage'); pane.style.zIndex = 450; pane.style.pointerEvents = 'none'; }
      const common = { pane: 'svCoverage', maxZoom: 19, opacity: 1, className: 'sv-coverage', keepBuffer: 1, updateWhenZooming: false, attribution: '', crossOrigin: 'anonymous' };
      const normal = L.tileLayer(SV_TILE('{x}', '{y}', '{z}'), { ...common, tileSize: 128, zoomOffset: 1, maxNativeZoom: 20, maxZoom: 14.5 }).addTo(map);
      const thin = L.tileLayer(SV_TILE('{x}', '{y}', '{z}'), { ...common, minZoom: 15, tileSize: 128, zoomOffset: 1, maxNativeZoom: 20 }).addTo(map);
      S.svCov = { remove() { normal.remove(); thin.remove(); } };
    };
    const set = (on) => {
      svOn = on;
      btn.classList.toggle('is-on', on); btn.setAttribute('aria-pressed', String(on));
      banner.hidden = !on;
      mapEl.classList.toggle('sv-on', on);
      if (on) { addCoverage(); bubble.hide(); } else { S.svCov?.remove(); S.svCov = null; }
      drawSavedPins();
    };
    btn.addEventListener('click', () => { if (svTemp) { svTemp = false; return; } set(!svOn); }); // スペース長押し中にボタンを押したら、そのままオンで固定
    view.querySelector('#rm-sv-exit').addEventListener('click', () => set(false));
    let down = null;
    mapEl.addEventListener('mousedown', (e) => { down = [e.clientX, e.clientY]; }, true);
    mapEl.addEventListener('click', async (e) => {
      if (!svOn || e.target.closest('.leaflet-control, [data-rc]')) return;
      if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
      const ll = map.mouseEventToLatLng(e).wrap();
      const hit = await svFind(ll.lat, ll.lng, map.getZoom());
      if (hit) openSvWindow(hit.lat, hit.lng); else ctx.toast('この付近にはストリートビューがありません', 'error');
    }, true); // 地域の上のクリックも、ここで受ける（地域のクリックは、ストリートビューのモードでは使わない。二重に探さないよう、地域の側では受けない）
    if (svOn) set(true);
    S.setSv = set;
    // スペースキーを押している間だけ、ストリートビューを開ける状態にする（離すと元に戻る。世界モードの地図と同じ）
    const typing = (el) => /^(input|textarea)$/i.test(el?.tagName || '') || el?.isContentEditable;
    const spaceDown = (e) => {
      if (e.code !== 'Space' || e.ctrlKey || e.altKey || e.metaKey || typing(e.target) || document.querySelector('dialog[open]:not(.is-window)') || S?.view !== view || !view.isConnected || !mapEl.isConnected) return;
      e.preventDefault(); // ページが下へ動かないように
      if (e.repeat || svOn) return;
      svTemp = true;
      set(true);
    };
    const spaceUp = (e) => {
      if (e.type === 'keyup') { if (e.code !== 'Space') return; if (!typing(e.target) && view.isConnected) e.preventDefault(); } // フォーカス中のボタンがスペースで押されないように
      if (svTemp) { svTemp = false; set(false); }
    };
    listen(document, 'keydown', spaceDown);
    listen(document, 'keyup', spaceUp);
    listen(window, 'blur', spaceUp);
  }

  // ---- 地域の旗をカードにする（編集者）----
  function setupFlagCards() {
    view.querySelector('#rm-flagcards')?.addEventListener('click', () => ctx.openBulkCards({ scope: 'region', countries: ctx.countries, kinds: ['flag', 'plate'] }));
  }
}

// 画像を取ってきて、カードにする（ラベル: その国の地域 / 場所: 地域の代表点 / 表面は画像だけ）。kind: 'flag' | 'plate'
async function createRegionCard(rc, src, kind, source) {
  const ctx = S.ctx;
  if (!src) throw new Error('画像がありません');
  const blob = await ctx.fetchImage(src);
  const parent = regionParent(rc);
  const c = S.geo.get(rc)?.center;
  await ctx.createRegionCard({ blob, kind, source, parent, name: regionName(rc), lat: c?.[0], lng: c?.[1] });
}
const createFlagCard = (rc) => createRegionCard(rc, regionFlagReadable(rc) ? regionFlagSrc(rc) : '', 'flag', '旗');

// 世界モードの国と同じ配色: 塗りだけ（輪郭は別の境界線の層）。カード数が多いほど濃く / 選んでいる地域は黄色の輪郭と薄い塗り / マウスを乗せると輪郭
function styleOf(rc) {
  const accent = S.accent || (S.accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#1c7f55'); // 毎回は読まない（レイアウトの再計算が重くなる）
  const focused = S?.selected === rc;
  const hover = S?.hover === rc;
  let st;
  if (mode === 'cards') {
    const n = (S.byRegion.get(rc) || []).length;
    st = { stroke: false, color: accent, weight: 2, fillColor: accent, fillOpacity: n ? 0.16 + 0.4 * (n / (S.maxCount || 1)) : 0 };
    if (focused) return { ...st, stroke: true, color: '#f5c400', weight: 2.5, fillColor: '#f5c400', fillOpacity: 0.22 };
  } else if (mode === 'none' || mode === 'flag') {
    st = { stroke: false, color: accent, weight: 2, fillColor: '#888', fillOpacity: 0 };
    if (focused) return { ...st, stroke: true, color: '#f5c400', weight: 2.5, fillColor: '#f5c400', fillOpacity: 0.18 };
  } else {
    st = { stroke: false, color: accent, weight: 2, ...infoStyle(mode, rc) };
    if (focused) return { ...st, stroke: true, color: '#f5c400', weight: 3.5 };
  }
  return hover ? { ...st, stroke: true, fillOpacity: Math.max(0.12, st.fillOpacity || 0) } : st;
}

// 地域に出すもの（カードと同じ形）: カード表示 = その地域のカード / 旗の表示 = 旗のカード（なければ、Wikimedia Commons の旗の画像）/ ナンバープレートの表示 = ナンバープレートのカード（なければ、Wikimedia Commons の候補）
// 候補（pseudo）は、まだカードにしていない画像。
const MARK_MODES = ['cards', 'flag', 'plate'];
function itemsOf(rc) {
  if (mode === 'cards') return (S.byRegion.get(rc) || []).map((card) => ({ card }));
  if (mode !== 'flag' && mode !== 'plate') return [];
  if (!S.cardRegions) computeCardRegions();
  const cards = S.ctx.cards.filter((c) => S.ctx.isKindCard(c, mode) && S.cardRegions.get(c.id)?.regions.has(rc)).map((card) => ({ card }));
  if (cards.length) return cards;
  return pseudoOf(rc, mode);
}
function pseudoOf(rc, kind) {
  const gs = S.ghs.get(rc); // GeoHints の州のページ（アメリカ）
  if (kind === 'flag') {
    if (gs?.flag) return [{ pseudo: true, kind, rc, src: gs.flag, title: `${regionName(rc)}の旗`, page: gs.page, source: 'geohints', idx: 0 }];
    const src = regionFlagSrc(rc, 320);
    return src ? [{ pseudo: true, kind, rc, src, title: `${regionName(rc)}の旗`, idx: 0 }] : [];
  }
  // ナンバープレート: GeoHints の州のページ（アメリカ）→ 保存した Wikimedia Commons のリンク
  const a = (gs?.plates || []).map((f) => ({ pseudo: true, kind, rc, src: f.src, title: `${regionName(rc)} ${f.year || ''}`.trim(), page: gs.page, source: 'geohints' }));
  const b = platesForRegion(regionParent(rc), regionName(rc)).map((f) => ({ pseudo: true, kind, rc, src: f.src, title: f.title, page: f.page, source: 'commons' }));
  return [...a, ...b].map((x, i) => ({ ...x, idx: i }));
}
// GeoHints の州のページを、表示中の地域の分、少しずつ（同時に 3 つまで）取ってくる。取れたら、描き直す
function prefetchGh(rcs, front = false) {
  const todo = rcs.filter((rc) => ghSupported(regionParent(rc)) && !S.ghs.has(rc) && !S.ghPending.has(rc));
  if (!todo.length) return; // 探すものがないときは、何もしない（描き直しと、取得が、互いに呼び合わないように）
  const seq = S.seq;
  for (const rc of front ? todo.reverse() : todo) { S.ghPending.add(rc); S.ghQueue[front ? 'unshift' : 'push'](rc); }
  const pump = async () => {
    while (S?.seq === seq && S.ghQueue.length && S.ghActive < 3) {
      const rc = S.ghQueue.shift();
      S.ghActive++;
      loadGhStateByName(regionParent(rc), rc, regionName(rc)).then((data) => {
        S.ghActive--; S.ghPending.delete(rc);
        if (S?.seq !== seq) return;
        S.ghs.set(rc, data || null);
        clearTimeout(S.ghTimer);
        S.ghTimer = setTimeout(() => { if (S?.seq === seq && S.map) { drawMarks(); if (S.selected) renderInfo(); } }, 150);
        pump();
      });
    }
  };
  pump();
}

// GeoHints の参考写真（ナンバープレート・ボラード・電柱・シェブロン）を、撮影地点の座標から、地域に振り分ける
async function buildGeoHints() {
  const seq = S.seq;
  try { await S.ctx.loadRefInfo(); } catch { return; }
  if (S?.seq !== seq || !S.map) return;
  const gh = {};
  for (const topic of GH_TOPICS) {
    const m = new Map();
    for (const code of S.ctx.countries) {
      for (const p of S.ctx.refPhotos(topic, code)) {
        const rc = regionAt(p.lat, p.lng);
        if (!rc) continue;
        if (!m.has(rc)) m.set(rc, []);
        m.get(rc).push({ src: p.src, rel: p.rel, title: String(p.desc || '').split('\n')[0].replace(/^撮影場所:\s*/, '') || 'GeoHints', page: S.ctx.refPage(topic) });
      }
    }
    gh[topic] = m;
  }
  S.gh = gh;
  drawMarks();
  if (S.selected) renderInfo();
}
const GH_TOPICS = ['bollard', 'pole', 'chevron'];

// 地図の上の印: 地域ごとのサムネイル（拡大すると画像、引くと数字・小さな画像）と、精密な場所（地名・ストリートビュー）の点
function drawMarks() {
  if (!S?.map) return;
  const L = window.L; const { esc, flagImg } = S.ctx; const map = S.map;
  for (const m of S.thumbs.values()) m.remove();
  S.thumbs.clear();
  S.pins?.remove(); S.pins = null;
  const z = map.getZoom();
  const bounds = map.getBounds().pad(0.2);
  if (!MARK_MODES.includes(mode)) return;
  const visible = [...S.byCode.keys()].filter((rc) => { const c = S.geo.get(rc)?.center; return c && bounds.contains(c); });
  if (mode === 'plate' || mode === 'flag') prefetchGh(visible.slice(0, 60));
  for (const rc of visible) {
    const items = itemsOf(rc);
    if (!items.length) continue;
    const c = S.geo.get(rc).center;
    const parent = regionParent(rc);
    const active = rc === S.selected || rc === S.hover;
    // 世界モードと同じ: 縮小しているときは緑の丸い数字、その地域が画面に収まるくらい拡大するとサムネイル（拡大するほど大きく）
    const l = S.byCode.get(rc);
    const rz = l ? Math.max(4, Math.min(11, map.getBoundsZoom(l.getBounds(), false, L.point(60, 60)) - 0.75)) : 6;
    let icon;
    if (z < rz) {
      if (mode === 'cards') {
        const n = items.length; const size = n >= 100 ? 28 : n >= 10 ? 23 : 19;
        icon = L.divIcon({ className: 'map-count', html: `<span>${n}</span>`, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
      } else { // 旗・ナンバープレート: 縮小しているときは、画像を小さく
        const size = z < 4 ? 22 : z < 6 ? 34 : 46;
        icon = L.divIcon({ className: 'rm-flag-icon', iconSize: [size, Math.round(size * 0.7)], iconAnchor: [size / 2, size * 0.35], html: `<img data-rc="${esc(rc)}" src="${esc(items[0].card ? S.ctx.thumbUrl(items[0].card) : items[0].src)}" alt="" style="width:${size}px">` });
      }
    } else {
      const scale = Math.min(1.44, Math.max(0.58, 0.58 * 2 ** ((z - rz) * 0.5))) * (active ? 1 : 0.78);
      const show = items.slice(0, 4); const more = items.length - show.length; const cols = show.length === 1 ? 1 : 2; const w = cols === 1 ? 120 : 172;
      const thumb = (it) => (it.card
        ? `<div class="map-thumb" data-card="${esc(it.card.id)}" style="${S.ctx.catVars(S.ctx.catOf(it.card))}" title="${esc(S.ctx.catOf(it.card).name)}">${S.ctx.thumbUrl(it.card) ? `<img src="${esc(S.ctx.thumbUrl(it.card))}" alt="">` : ''}</div>`
        : `<div class="map-thumb is-photo is-pseudo" data-rc="${esc(rc)}" data-kind="${it.kind}" data-idx="${it.idx}" title="${esc(it.title)}（参考画像・Wikimedia Commons）"><img src="${esc(it.src)}" alt=""></div>`);
      icon = L.divIcon({ className: 'map-thumbs-icon', iconSize: [w, 0], iconAnchor: [w / 2, 20], html: `
        <div class="map-thumbs rm-c${active ? '' : ' is-dim'}" data-rc="${esc(rc)}" data-rz="${rz}" style="transform:translateY(-50%) scale(${scale.toFixed(2)})">
          <div class="map-thumbs-head" data-rc="${esc(rc)}">${flagImg(parent)}<span>${esc(regionName(rc))}</span><span class="map-thumbs-n">${items.length}</span></div>
          <div class="map-thumbs-grid" style="grid-template-columns:repeat(${cols},1fr)">${show.map(thumb).join('')}</div>
          ${more > 0 ? `<div class="map-thumbs-more" data-rc="${esc(rc)}">ほか ${more} 枚</div>` : ''}
        </div>` });
    }
    const mk = L.marker(c, { icon, zIndexOffset: active ? 1000 : 0, keyboard: false, riseOnHover: true }).addTo(map);
    if (z < rz) { const el = mk.getElement(); if (el) { el.dataset.rc = rc; el.dataset.rz = rz; } }
    S.thumbs.set(rc, mk);
  }
  // 精密な場所（カードに登録した地名・関連付けたストリートビュー）
  if (mode === 'cards' && z >= 8) {
    const g = L.layerGroup();
    for (const c of shownCards()) {
      for (const p of S.cardRegions?.get(c.id)?.points || []) {
        if (!p.region || !bounds.contains([p.lat, p.lng])) continue;
        L.circleMarker([p.lat, p.lng], { radius: 6, color: '#fff', weight: 2, fillColor: '#e8590c', fillOpacity: 1 }).addTo(g)
          .bindTooltip(`${esc(c.description || c.area || 'カード')}${p.label ? `（${esc(p.label)}）` : ''}`, { direction: 'top' })
          .on('click', (e) => { L.DomEvent.stop(e); S.ctx.openCard(c, null); });
      }
    }
    g.addTo(map); S.pins = g;
  }
}

// サムネイルの見え方: 選んでいる・マウスが乗っている地域ははっきり、それ以外は半透明で小さめ（世界モードと同じ）
function refreshThumbs() {
  const z = S.map.getZoom();
  for (const [rc, m] of S.thumbs) {
    const el = m.getElement()?.querySelector('.map-thumbs');
    if (!el) continue;
    const rz = Number(el.dataset.rz) || 6;
    const active = rc === S.selected || rc === S.hover;
    const scale = Math.min(1.44, Math.max(0.58, 0.58 * 2 ** ((z - rz) * 0.5))) * (active ? 1 : 0.78);
    el.style.transform = `translateY(-50%) scale(${scale.toFixed(2)})`; // 地域の中心に、まとまりの真ん中が来るように
    el.classList.toggle('is-dim', !active);
    m.setZIndexOffset(active ? 1000 : 0);
  }
}
// 地域のクリック: 選んでいる地域を、その地域が見えている状態でもう一度押したら選択解除、それ以外はその地域を選ぶ
function toggleFocus(rc) {
  const c = S.geo.get(rc)?.center;
  if (S.selected === rc && (!c || S.map.getBounds().contains(c))) clearFocus(); else focusRegion(rc);
}
function focusRegion(rc) {
  const prev = S.selected;
  S.selected = rc;
  for (const c of [prev, rc]) { const l = c && S.byCode.get(c); if (l) l.setStyle(styleOf(c)); }
  S.byCode.get(rc)?.bringToFront();
  const l = S.byCode.get(rc);
  renderPanel();
  refreshThumbs();
  if (l) { try { S.flyBounds(l.getBounds(), { padding: [40, 40], maxZoom: 11 }); } catch { /* 無視 */ } }
}
function clearFocus() {
  const prev = S.selected;
  S.selected = null;
  const l = prev && S.byCode.get(prev); if (l) l.setStyle(styleOf(prev));
  renderPanel();
  drawMarks();
}

function restyle() {
  if (!S?.map) return;
  const svgOf = () => S.map.getPane('overlayPane').querySelector('svg');
  const codes = [...S.byCode.keys()];
  S.byRegion = byRegionMap();
  S.maxCount = Math.max(1, ...[...S.byRegion.values()].map((l) => l.length));
  if (EDITABLE.includes(mode)) ensurePatterns(svgOf(), mode, codes);
  for (const [rc, l] of S.byCode) l.setStyle(styleOf(rc));
  scalePatterns(svgOf(), S.map.getZoom());
  drawMarks();
  const lg = S.view.querySelector('#map-legend');
  if (lg) { const on = EDITABLE.includes(mode); lg.hidden = !on; if (on) lg.querySelector('.lg-items').innerHTML = legendHtml(mode, codes); }
  S.byCode.get(S.selected)?.bringToFront();
  if (!S.selected) renderList(); else renderPanel();
}

// ---- 右のパネル（世界モードの国と同じ: 上に情報、下にカード）----
function renderPanel() { renderInfo(); renderList(); }

// カードにしていない旗・ナンバープレートの画像を、参考写真と同じ画面（拡大・メモ・「カードを作る」）で開く
function openPseudo(rc, kind, idx, el) {
  const items = pseudoOf(rc, kind);
  if (!items.length) return;
  S.ctx.openRegionImage({ kind, rc, items, i: Math.min(idx, items.length - 1), src: el, center: S.geo.get(rc)?.center || null });
}

function renderInfo() {
  const el = S?.view.querySelector('#pinfo');
  if (!el) return;
  const { esc, countryName, flagImg } = S.ctx;
  const rc = S.selected;
  el.classList.toggle('is-empty', !rc);
  el.classList.toggle('is-focused', !!rc);
  if (!rc) { el.innerHTML = '<div class="pinfo-empty"><div class="pinfo-globe">🗺</div>地域の情報がここに表示されます<small>地域をクリック・検索すると表示（マウスを乗せると吹き出しでプレビュー）</small></div>'; return; }
  const parent = regionParent(rc);
  const edit = S.ctx.isEditor();
  el.innerHTML = `<div class="rm-info">
    <h3 class="rm-title">${flagImg(parent)} ${esc(regionName(rc))}</h3>
    <div class="muted small">${esc(countryName(parent))}の地域</div>
    ${(EDITABLE.includes(mode) ? [mode] : EDITABLE).map((id) => { const m = modeDef(id); return `<div class="rm-fact"><div class="rm-fact-head"><span>${m.icon} ${esc(m.name)}</span>${edit ? `<button type="button" class="btn btn-sm btn-ghost" data-edit="${id}" title="この地域の${esc(m.name)}を入力・編集">✏</button>` : ''}</div>${factChipHtml(id, rc)}</div>`; }).join('')}
    ${photoBlocks(rc)}
  </div><button type="button" class="icon-btn pinfo-close" title="選択を解除（Esc）" aria-label="選択を解除">✕</button>`;
  el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => S.ctx.editFact(b.dataset.edit, rc)));
  el.querySelector('.pinfo-close')?.addEventListener('click', clearFocus);
  el.querySelectorAll('.pphoto[data-kind]').forEach((b) => b.addEventListener('click', () => openPseudo(rc, b.dataset.kind, Number(b.dataset.idx), b)));
  prefetchGh([rc], true);
  el.querySelectorAll('.pphoto[data-topic]').forEach((b) => b.addEventListener('click', () => { const list = S.gh?.[b.dataset.topic]?.get(rc) || []; S.ctx.openPhoto(b.dataset.topic, regionParent(rc), list.map((x) => x.src), Number(b.dataset.i), b); }));
}
// 参考写真と同じ並び: カードにしていない旗・ナンバープレート（その種類のカードが、この地域にまだないとき）
function photoBlocks(rc) {
  const { esc } = S.ctx;
  if (!S.cardRegions) computeCardRegions();
  const hasKind = (k) => S.ctx.cards.some((c) => S.ctx.isKindCard(c, k) && S.cardRegions.get(c.id)?.regions.has(rc));
  const block = (kind, icon, name, link) => {
    if (hasKind(kind)) return '';
    const items = pseudoOf(rc, kind);
    if (!items.length) return kind === 'plate' && ghSupported(regionParent(rc)) && (S.ghPending.has(rc) || !S.ghs.has(rc)) ? `<div class="pphotos muted small">${icon} ${name}を探しています…</div>` : '';
    return `<div class="pphotos"><div class="pphotos-head">${icon} ${name}（カード未作成） <a href="${esc(items[0].page || link)}" target="_blank" rel="noopener" class="muted small">${items[0].source === 'geohints' ? 'GeoHints' : 'Wikimedia Commons'} ↗</a></div><div class="pphotos-grid">${items.map((it) => { const n = S.ctx.photoNote(kind, it.src, rc); return `<button type="button" class="pphoto ${n ? 'has-note' : ''}" data-kind="${kind}" data-idx="${it.idx}" title="${esc(n || `${it.title}（${it.source === 'geohints' ? 'GeoHints' : 'Wikimedia Commons'}）`)}"><img src="${esc(it.src)}" alt="" loading="lazy"></button>`; }).join('')}</div></div>`;
  };
  // 参考写真（GeoHints）: この地域で撮影されたボラード・電柱・シェブロン。世界モードの参考写真と同じ画面で開く
  const refBlock = (topic) => {
    const list = S.gh?.[topic]?.get(rc) || [];
    if (!list.length) return '';
    const m = modeDef(topic);
    return `<div class="pphotos"><div class="pphotos-head">${m.icon} ${esc(m.name)}の参考写真 <a href="${esc(S.ctx.refPage(topic))}" target="_blank" rel="noopener" class="muted small">GeoHints ↗</a></div><div class="pphotos-grid">${list.map((it, i) => { const n = S.ctx.photoNote(topic, it.src, regionParent(rc)); return `<button type="button" class="pphoto ${n ? 'has-note' : ''}" data-topic="${topic}" data-i="${i}" title="${esc(n || `${it.title}（GeoHints）`)}"><img src="${esc(it.src)}" alt="" loading="lazy"></button>`; }).join('')}</div></div>`;
  };
  return block('flag', '🚩', '地域の旗', 'https://commons.wikimedia.org/') + block('plate', '🚘', 'ナンバープレート', S.ctx.refPage('plate')) + ['bollard', 'pole', 'chevron'].map(refBlock).join('');
}

function renderList() {
  const el = S?.view.querySelector('#plist');
  if (!el) return;
  const { esc, flagImg, countryName } = S.ctx;
  const rc = S.selected;
  if (rc) {
    const edit = S.ctx.isEditor();
    const all = S.byRegion.get(rc) || [];
    const cats = S.ctx.allCats().filter((k) => all.some((x) => S.ctx.catKey(x) === k.id));
    const cat = S.focusCat && cats.some((k) => k.id === S.focusCat) ? S.focusCat : null;
    const list = all.filter((x) => !cat || S.ctx.catKey(x) === cat);
    el.innerHTML = `
      <h3 class="panel-title">${flagImg(regionParent(rc))}${esc(regionName(rc))} のカード <span class="muted">${all.length} 枚</span></h3>
      ${cats.length > 1 ? `<div class="region-chips cat-chips focus-cats">
        <button class="chip chip-btn ${cat ? '' : 'on'}" data-fcat="">すべて</button>
        ${cats.map((k) => `<button class="chip chip-btn chip-cat ${cat === k.id ? 'on' : ''}" data-fcat="${k.id}" style="${S.ctx.catVars(k)}"><span class="cat-dot"></span>${esc(k.name)}</button>`).join('')}
      </div>` : ''}
      ${list.length ? `<div class="tiles tiles-compact">${list.map((c) => S.ctx.tileHtml(c)).join('')}</div>` : '<p class="muted small">この地域のカードはまだありません。カードに登録した地名や、関連付けたストリートビューの場所が、この地域の中にあると、ここに出ます（座標のないカードは、「詳細エリア」に地域の名前（英語）が入っているもの）。</p>'}`;
    el.querySelectorAll('[data-fcat]').forEach((b) => b.addEventListener('click', () => { S.focusCat = b.dataset.fcat || null; renderList(); }));
    S.ctx.bindTiles();
    return;
  }
  const b = S.map?.getBounds();
  const rows = [...S.byRegion].filter(([r]) => { const c = S.geo.get(r)?.center; return !b || (c && b.contains(c)); }).sort((a, c) => c[1].length - a[1].length);
  if (!rows.length) { el.innerHTML = `<p class="muted small">${S.byRegion.size ? '地図に表示中の地域に、カードはありません' : 'この国の地域のカードは、まだありません。カードのラベルを「国の地域」にして、地名やストリートビューの場所を登録すると、ここと地図に出ます'}</p>`; return; }
  el.innerHTML = `<h3 class="list-title">表示中の地域 <span class="muted">${rows.length}</span></h3>
    <div class="clist">${rows.slice(0, 40).map(([r, list]) => { const show = list.slice(0, 8); return `
      <div class="crow" data-hover="${esc(r)}">
        <div class="crow-head"><button type="button" class="crow-name" data-go="${esc(r)}" title="この地域を選ぶ">${flagImg(regionParent(r))}${esc(regionName(r))}</button><span class="crow-n">${list.length} 枚</span></div>
        <div class="crow-thumbs">${show.map((c) => `<button type="button" class="crow-thumb" data-card="${esc(c.id)}" data-r="${esc(r)}" style="${S.ctx.catVars(S.ctx.catOf(c))}" title="${esc(c.description || S.ctx.catOf(c).name)}">${S.ctx.thumbUrl(c) ? `<img src="${esc(S.ctx.thumbUrl(c))}" alt="">` : ''}</button>`).join('')}${list.length > show.length ? `<button type="button" class="crow-more" data-go="${esc(r)}">+${list.length - show.length}</button>` : ''}</div>
      </div>`; }).join('')}</div>`;
  el.querySelectorAll('[data-go]').forEach((x) => x.addEventListener('click', () => focusRegion(x.dataset.go)));
  el.querySelectorAll('[data-card]').forEach((x) => x.addEventListener('click', () => { const c = S.ctx.cards.find((y) => y.id === x.dataset.card); if (c) S.ctx.openCard(c, x, (S.byRegion.get(x.dataset.r) || [c]).map((y) => y.id)); }));
  el.querySelectorAll('[data-hover]').forEach((r) => {
    r.addEventListener('mouseenter', () => { S.hover = r.dataset.hover; S.byCode.get(S.hover)?.setStyle(styleOf(S.hover)); refreshThumbs(); });
    r.addEventListener('mouseleave', () => { const rc2 = r.dataset.hover; if (S.hover === rc2) S.hover = null; S.byCode.get(rc2)?.setStyle(styleOf(rc2)); refreshThumbs(); });
  });
}

/** 値を保存したあと・カードが変わったあとなどに、地図と横のパネルを描き直す */
export function refreshRegionMap() { if (!S?.map) return; S.cardRegions = null; restyle(); }

/** 国の地域の一覧（代表点・旗つき）と、座標からどの地域かを調べる関数。まとめてカードを作る画面で使う（地図を開かなくても使える） */
export async function getRegionIndex(code, iso3) {
  const fc = await loadRegions(code, iso3);
  const regions = fc.features.map((f) => { const ix = indexRegion(f); return { rc: f.properties.code, name: f.properties.name, center: ix.center, ix }; });
  await loadRegionFlags(code, regions.map((r) => r.rc));
  const at = (lat, lng) => {
    for (const r of regions) {
      const [w, s, e, n] = r.ix.bbox;
      if (lng < w || lng > e || lat < s || lat > n) continue;
      if (r.ix.polys.some((poly) => polyHas(poly, lng, lat))) return r.rc;
    }
    return null;
  };
  return { regions, at };
}
