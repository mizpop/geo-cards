// 国モードの地図: 選んだ国だけを、州・県などの地域ごとに分けて表示する。
// 地域の境界は geoBoundaries（ADM1: 州・県・省など。名前は英語）を、国ごとに、必要になったとき取得する。
// 地域は「国コード:地域コード」（例: JP:JP-13）で区別し、国ごとの情報（シェブロン・ガードレールなど）と同じ仕組みで、値を保存・表示する。
import { createHoverBubble } from './hoverbubble.js';
import { loadLibs, addBaseTiles, isDark, svFind } from './map.js';
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


// ---- 地域のナンバープレート（Wikimedia Commons の「License plates of ○○」カテゴリー。地域ごとにカテゴリーがある国だけ）----
const plateCache = new Map(); // 地域コード → Promise<[{ thumb, title, page }]>
let plateLast = 0;
async function commonsApi(params) {
  const wait = plateLast + 350 - Date.now(); // 続けて呼びすぎないように、少し間をあける
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  plateLast = Date.now();
  const q = new URLSearchParams({ format: 'json', origin: '*', ...params });
  const r = await fetch(`https://commons.wikimedia.org/w/api.php?${q}`);
  return r.json();
}
const plateNorm = (s) => String(s || '').toLowerCase().replace(/\b(prefecture|province|state|region|oblast|department|county|district|governorate|municipality|city|autonomous|republic|of|the|license|licence|plates?|vehicle|registration)\b/g, '').replace(/[^a-z0-9\u00c0-\u024f\u3040-\u30ff\u3400-\u9fff]/g, '');
export function loadRegionPlates(rc, name, countryEn) {
  if (!plateCache.has(rc)) {
    plateCache.set(rc, (async () => {
      const core = String(name).replace(/\b(Prefecture|Province|State|Region|Oblast|Department|County|District|Governorate|Municipality|Autonomous|Republic)\b/g, '').replace(/\s+/g, ' ').trim() || name;
      const j = await commonsApi({ action: 'query', list: 'search', srnamespace: '14', srlimit: '8', srsearch: `intitle:"license plates of" "${core}"` });
      const want = plateNorm(core);
      const cats = (j.query?.search || []).map((x) => x.title).filter((tt) => /license plates? of|vehicle registration plates? of/i.test(tt) && !/trailer|diplomatic|military|temporary|by |personal|motorcycle/i.test(tt) && plateNorm(tt).includes(want));
      cats.sort((a, b) => (plateNorm(b).includes(plateNorm(countryEn || '')) ? 1 : 0) - (plateNorm(a).includes(plateNorm(countryEn || '')) ? 1 : 0) || a.length - b.length);
      if (!cats.length) return [];
      const g = await commonsApi({ action: 'query', generator: 'categorymembers', gcmtitle: cats[0], gcmtype: 'file', gcmlimit: '24', prop: 'imageinfo', iiprop: 'url|mime', iiurlwidth: '320' });
      const files = Object.values(g.query?.pages || {}).map((pg) => ({ title: pg.title, thumb: pg.imageinfo?.[0]?.thumburl, page: pg.imageinfo?.[0]?.descriptionurl, mime: pg.imageinfo?.[0]?.mime })).filter((f) => f.thumb && /^image\/(jpeg|png|svg)/.test(f.mime || ''));
      // ナンバープレートの画像らしいものだけ（名前に plate / license / registration / Kennzeichen など）。地図・外交官用・トレーラーなどは除き、新しい年のものを先に
      const isPlate = (f) => /plate|licen[cs]e|registration|kennzeichen|kenteken|plaque|targa|matr[ií]cula|placa|rejestracyjn|nummerskylt|nummerplate|ナンバー/i.test(f.title) && !/\bmap\b|diplomatic|trailer|police car|patrol|motor show/i.test(f.title);
      const year = (f) => Math.max(0, ...((f.title.match(/\b(19|20)\d\d\b/g) || []).map(Number)));
      return files.filter(isPlate).sort((a, b) => year(b) - year(a)).slice(0, 4);
    })().catch(() => []));
  }
  return plateCache.get(rc);
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
      for (const f of fc.features || []) {
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
let spaceKeys = null;
let svOn = false; // ストリートビューのモード（地図を描き直しても引き継ぐ）

let S = null; // 今の画面の状態
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
  const r = big[0]; let cx = 0; let cy = 0;
  for (const [x, y] of r) { cx += x; cy += y; }
  cx /= r.length; cy /= r.length;
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
  if (S?.map) { try { S.map.remove(); } catch { /* 無視 */ } }
  S?.bubble?.destroy();
  const keepFocus = S?.selected && S.ctx === ctx ? S.selected : null;
  let legendOpen = legendOpenPref ?? !window.matchMedia('(max-width: 760px)').matches;
  const seq = (S?.seq || 0) + 1;
  S = { seq, ctx, view, map: null, byCode: new Map(), geo: new Map(), cardRegions: null, selected: null, pins: null, thumbs: new Map(), plates: new Map(), platePending: new Set(), plateQueue: [], plateRun: false, svCov: null, svPins: null, found: null, byRegion: new Map() };
  const { esc, countryName, flagImg } = ctx;
  const countries = ctx.countries;
  view.innerHTML = `
    <div class="toolbar map-toolbar rm-bar">
      <label class="rm-modes"><span class="muted small">表示</span>
        <select class="select select-sm" id="rm-mode" aria-label="表示する情報">${MODES.map((id) => `<option value="${id}" ${id === mode ? 'selected' : ''}>${modeInfo(id).icon} ${esc(modeInfo(id).name)}</option>`).join('')}</select></label>
      ${mode === 'cards' ? ctx.filterPicksHtml() : ''}
      ${ctx.isEditor() ? '<button type="button" class="btn btn-ghost btn-sm" id="rm-flagcards" title="旗が見つかった地域の旗を、まとめてカードにします（ラベルは、その国の「地域」。すでに旗のカードがある地域は除きます）">🚩 地域の旗をカードに</button>' : ''}
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
  const map = L.map(mapEl, { zoomSnap: 0.25, minZoom: 1, maxZoom: 19, worldCopyJump: false, keyboard: false }).setView([20, 10], 2);
  S.map = map;
  mapEl.classList.toggle('map-dark', isDark()); // ダークモード: 背景の地図の色を反転（地図タブと同じ）
  addBaseTiles(map, { updateWhenZooming: false });
  map.attributionControl.addAttribution('地域の境界 &copy; <a href="https://www.geoboundaries.org/" target="_blank" rel="noopener">geoBoundaries</a>');
  map.on('zoomend', () => scalePatterns(map.getPane('overlayPane').querySelector('svg'), map.getZoom()));
  map.on('zoomend moveend', () => { drawMarks(); if (!S.selected) renderList(); });
  requestAnimationFrame(() => { try { map.invalidateSize(); } catch { /* 無視 */ } });
  view.querySelector('#rm-mode').addEventListener('change', (e) => { mode = e.target.value; try { localStorage.setItem(MODE_KEY, mode); } catch { /* 無視 */ } renderRegionMap(S.view, S.ctx); });
  renderPanel();
  view.querySelector('#map-legend .lg-title')?.addEventListener('click', (e) => {
    legendOpen = !legendOpen; legendOpenPref = legendOpen;
    view.querySelector('#map-legend').classList.toggle('is-open', legendOpen);
    e.currentTarget.setAttribute('aria-expanded', String(legendOpen));
  });
  view.querySelector('#rm-all').addEventListener('click', () => { clearFocus(); try { map.flyToBounds(S.group.getBounds(), { padding: [20, 20], maxZoom: 7, duration: 0.8 }); } catch { /* 無視 */ } });
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
        style: (f) => styleOf(f.properties.code),
        onEachFeature: (f, l) => {
          const rc = f.properties.code;
          S.byCode.set(rc, l);
          S.geo.set(rc, indexRegion(f));
          // 世界モードの国と同じ、旗 + 名前 + ひとこと（カード枚数・選んでいる情報）の吹き出し。ひとつだけを使い回す
          l.on('mouseover', (e) => { if (svOn) return; S.hover = rc; l.setStyle(styleOf(rc)); refreshThumbs(); bubble.show(`${flagImg(code)}<b>${esc(f.properties.name)}</b>${hintHtml(rc)}`, e); });
          l.on('mouseout', () => { if (S.hover === rc) S.hover = null; l.setStyle(styleOf(rc)); refreshThumbs(); bubble.hide(); });
          l.on('click', () => { if (!svOn) { S.clicked = true; setTimeout(() => { S.clicked = false; }, 0); toggleFocus(rc); } });
        },
      });
      group.addLayer(layer);
      // 境界線は、世界モードの国境線と同じ色・太さの、別の層（クリックは受けない）
      L.geoJSON(fc, { style: () => ({ color: isDark() ? '#7d8b96' : '#8f9aa3', weight: 0.8, opacity: 0.7, fill: false }), interactive: false, smoothFactor: 1.5 }).addTo(map);
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
  if (keepFocus && S.byCode.has(keepFocus)) focusRegion(keepFocus);
  setupSearch();
  setupSv();
  setupFlagCards();
  // 地域のないところ（海・ほかの国など）をクリックしたら、選択を解除（世界モードと同じ）
  map.on('click', () => { if (S.clicked) { S.clicked = false; return; } if (!svOn) clearFocus(); });
  mapEl.addEventListener('click', (e) => { // 地図の上のサムネイル・数字・旗
    const th = e.target.closest('.map-thumb[data-card]');
    if (th) { const c = ctx.cards.find((x) => x.id === th.dataset.card); if (c) ctx.openCard(c, th, (S.byRegion.get(th.closest('[data-rc]')?.dataset.rc) || [c]).map((x) => x.id)); return; }
    const hd = e.target.closest('[data-rc]');
    if (hd && !svOn) { S.clicked = true; setTimeout(() => { S.clicked = false; }, 0); toggleFocus(hd.dataset.rc); }
  }, true); // Leaflet の印は、クリックを上に伝えないので、先に（キャプチャで）受ける
  // Esc: ストリートビューのモード → 地名の目印 → 地域の選択、の順に解除（世界モードと同じ）
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || S?.view !== view || document.querySelector('dialog[open]') || /^(input|textarea|select)$/i.test(e.target.tagName)) return;
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
      map.flyTo([c.lat, c.lng], c.zoom || 11, { duration: 0.8 });
      const rc = regionAt(c.lat, c.lng);
      if (rc && rc !== S.selected) { const prev = S.selected; S.selected = rc; for (const x of [prev, rc]) { const l = x && S.byCode.get(x); if (l) l.setStyle(styleOf(x)); } renderPanel(); }
    }
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
      if (!svOn || e.target.closest('.leaflet-control, .leaflet-interactive, [data-rc]')) return;
      if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
      const ll = map.mouseEventToLatLng(e).wrap();
      const hit = await svFind(ll.lat, ll.lng, map.getZoom());
      if (hit) openSvWindow(hit.lat, hit.lng); else ctx.toast('この付近にはストリートビューがありません', 'error');
    }, true);
    // 地域の上でもクリックできるように（地域のクリックは、ストリートビューのモードでは使わない）
    group.on('click', async (e) => {
      if (!svOn) return;
      const hit = await svFind(e.latlng.lat, e.latlng.lng, map.getZoom());
      if (hit) openSvWindow(hit.lat, hit.lng); else ctx.toast('この付近にはストリートビューがありません', 'error');
    });
    if (svOn) set(true);
    S.setSv = set;
    // スペースキーを押している間だけ、ストリートビューを開ける状態にする（離すと元に戻る。世界モードの地図と同じ）
    if (spaceKeys) { document.removeEventListener('keydown', spaceKeys.down); document.removeEventListener('keyup', spaceKeys.up); window.removeEventListener('blur', spaceKeys.up); }
    const typing = (el) => /^(input|textarea)$/i.test(el?.tagName || '') || el?.isContentEditable;
    const spaceDown = (e) => {
      if (e.code !== 'Space' || e.ctrlKey || e.altKey || e.metaKey || typing(e.target) || document.querySelector('dialog[open]:not(.is-window)') || S?.view !== view || !view.isConnected) return;
      e.preventDefault(); // ページが下へ動かないように
      if (e.repeat || svOn) return;
      svTemp = true;
      set(true);
    };
    const spaceUp = (e) => {
      if (e.type === 'keyup') { if (e.code !== 'Space') return; if (!typing(e.target) && view.isConnected) e.preventDefault(); } // フォーカス中のボタンがスペースで押されないように
      if (svTemp) { svTemp = false; set(false); }
    };
    spaceKeys = { down: spaceDown, up: spaceUp };
    document.addEventListener('keydown', spaceDown);
    document.addEventListener('keyup', spaceUp);
    window.addEventListener('blur', spaceUp);
  }

  // ---- 地域の旗をカードにする（編集者）----
  function setupFlagCards() {
    view.querySelector('#rm-flagcards')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      if (!S.cardRegions) computeCardRegions();
      const have = new Set();
      for (const c of ctx.cards) if (ctx.isFlagCard(c)) for (const r of S.cardRegions.get(c.id)?.regions || []) have.add(r);
      const todo = [...S.byCode.keys()].filter((rc) => regionFlagReadable(rc) && !have.has(rc));
      if (!todo.length) { ctx.toast('カードにできる旗がありません（旗がまだ読み込まれていないか、すべてカードにしてあります）'); return; }
      if (!confirm(`${todo.length} 地域の旗を、カードにします（ラベルは、その国の「地域」。カテゴリーは「国旗」）。よろしいですか？`)) return;
      btn.disabled = true;
      let ok = 0; let ng = 0;
      for (const rc of todo) {
        btn.textContent = `作成中… ${ok + ng + 1} / ${todo.length}`;
        try { await createFlagCard(rc); ok++; } catch { ng++; }
      }
      btn.disabled = false; btn.textContent = '🚩 地域の旗をカードに';
      ctx.toast(ng ? `${ok} 枚を作りました（${ng} 枚は、できませんでした）` : `${ok} 枚の旗のカードを作りました`, ng ? 'error' : undefined);
      await ctx.reloadCards();
    });
  }
}

// 画像を取ってきて、カードにする（ラベル: その国の地域 / 場所: 地域の代表点 / 表面は画像だけ）。kind: 'flag' | 'plate'
async function createRegionCard(rc, src, kind, source) {
  const ctx = S.ctx;
  if (!src) throw new Error('画像がありません');
  const blob = await (await fetch(src)).blob();
  const parent = regionParent(rc);
  const c = S.geo.get(rc)?.center;
  await ctx.createRegionCard({ blob, kind, source, parent, name: regionName(rc), lat: c?.[0], lng: c?.[1] });
}
const createFlagCard = (rc) => createRegionCard(rc, regionFlagReadable(rc) ? regionFlagSrc(rc) : '', 'flag', '旗');

// 世界モードの国と同じ配色: 塗りだけ（輪郭は別の境界線の層）。カード数が多いほど濃く / 選んでいる地域は黄色の輪郭と薄い塗り / マウスを乗せると輪郭
function styleOf(rc) {
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#1c7f55';
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
  if (kind === 'flag') { const src = regionFlagSrc(rc, 320); return src ? [{ pseudo: true, kind, rc, src, title: `${regionName(rc)}の旗`, idx: 0 }] : []; }
  return (S.plates.get(rc) || []).map((f, i) => ({ pseudo: true, kind, rc, src: f.thumb, title: f.title, page: f.page, idx: i }));
}
// 表示中の地域のナンバープレート（Wikimedia Commons）を、順に（続けて呼びすぎないように）取ってくる
function ensurePlates(rcs, front = false) {
  for (const rc of rcs) {
    if (S.plates.has(rc) || S.platePending.has(rc)) continue;
    const i = S.plateQueue.indexOf(rc);
    if (i >= 0) { if (front) { S.plateQueue.splice(i, 1); S.plateQueue.unshift(rc); } } else if (front) S.plateQueue.unshift(rc); else S.plateQueue.push(rc);
  }
  if (S.plateRun) return;
  S.plateRun = true;
  const seq = S.seq;
  (async () => {
    let done = 0;
    while (S.seq === seq && S.plateQueue.length) {
      const rc = S.plateQueue.shift();
      S.platePending.add(rc);
      const list = await loadRegionPlates(rc, regionName(rc), S.ctx.countryEn(regionParent(rc)));
      S.platePending.delete(rc);
      if (S.seq !== seq) return;
      S.plates.set(rc, list);
      done++;
      if (list.length && (mode === 'plate' || S.selected === rc) && (done % 3 === 0 || !S.plateQueue.length)) { drawMarks(); if (S.selected === rc) renderList(); }
    }
    S.plateRun = false;
    if (S.seq === seq) { drawMarks(); if (S.selected) renderList(); }
  })();
}

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
  if (mode === 'plate') ensurePlates(visible.filter((rc) => !itemsOf(rc).some((i) => !i.pseudo)).slice(0, 40));
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
        : `<div class="map-thumb is-pseudo" data-rc="${esc(rc)}" style="${(S.ctx.catOfKind(it.kind) ? S.ctx.catVars(S.ctx.catOfKind(it.kind)) : '')}" title="${esc(it.title)}（カード未作成・Wikimedia Commons）"><img src="${esc(it.src)}" alt=""></div>`);
      icon = L.divIcon({ className: 'map-thumbs-icon', iconSize: [w, 0], iconAnchor: [w / 2, 20], html: `
        <div class="map-thumbs${active ? '' : ' is-dim'}" data-rc="${esc(rc)}" data-rz="${rz}" style="transform:scale(${scale.toFixed(2)})">
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
    el.style.transform = `scale(${scale.toFixed(2)})`;
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
  if (l) { try { S.map.flyToBounds(l.getBounds(), { padding: [40, 40], maxZoom: 8, duration: 0.6 }); } catch { /* 無視 */ } }
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
    <p class="muted small rm-info-note">旗・ナンバープレートの画像は、下のカードの欄に、カードと同じ形で出ます（まだカードにしていないものは「候補」）。</p>
  </div><button type="button" class="icon-btn pinfo-close" title="選択を解除（Esc）" aria-label="選択を解除">✕</button>`;
  el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => S.ctx.editFact(b.dataset.edit, rc)));
  el.querySelector('.pinfo-close')?.addEventListener('click', clearFocus);
}

function renderList() {
  const el = S?.view.querySelector('#plist');
  if (!el) return;
  const { esc, flagImg, countryName } = S.ctx;
  const rc = S.selected;
  if (rc) {
    const edit = S.ctx.isEditor();
    const all = S.byRegion.get(rc) || [];
    // まだカードにしていない旗・ナンバープレートの候補（その種類のカードが、この地域になければ）
    if (!S.cardRegions) computeCardRegions();
    const hasKind = (k) => S.ctx.cards.some((c) => S.ctx.isKindCard(c, k) && S.cardRegions.get(c.id)?.regions.has(rc));
    ensurePlates([rc], true); // 選んだ地域は、先に
    const pseudo = [...(hasKind('flag') ? [] : pseudoOf(rc, 'flag')), ...(hasKind('plate') ? [] : pseudoOf(rc, 'plate'))];
    const plateLoading = !hasKind('plate') && !S.plates.has(rc);
    const kindKey = (it) => S.ctx.catOfKind(it.kind)?.id || it.kind;
    const cats = S.ctx.allCats().filter((k) => all.some((x) => S.ctx.catKey(x) === k.id) || pseudo.some((it) => kindKey(it) === k.id));
    const cat = S.focusCat && cats.some((k) => k.id === S.focusCat) ? S.focusCat : null;
    const list = all.filter((x) => !cat || S.ctx.catKey(x) === cat);
    const pl = pseudo.filter((it) => !cat || kindKey(it) === cat);
    const tile = (it) => { const k = S.ctx.catOfKind(it.kind); return `<article class="tile is-pseudo" data-rc="${esc(rc)}" style="${k ? S.ctx.catVars(k) : ''}">
        <div class="tile-img">${k ? `<span class="cat-badge cat-on-img" style="${S.ctx.catVars(k)}">${esc(k.name)}</span>` : ''}<a href="${esc(it.page || it.src)}" target="_blank" rel="noopener" title="${esc(it.title)}（Wikimedia Commons）"><img src="${esc(it.src)}" alt="${esc(it.title)}" loading="lazy"></a></div>
        <div class="tile-body"><div class="tile-countries"><span class="chip">${flagImg(regionParent(rc))}${esc(S.ctx.countryName(regionParent(rc)))}</span></div>
          <div class="tile-scope"><span class="scope-tag is-region">📍 ${esc(S.ctx.countryName(regionParent(rc)))}の地域</span><span class="scope-tag">候補（カード未作成）</span></div>
          ${edit ? `<div class="tile-actions"><button type="button" class="btn btn-sm" data-mk="${it.kind}|${it.idx}">カードにする</button></div>` : ''}</div></article>`; };
    el.innerHTML = `
      <h3 class="panel-title">${flagImg(regionParent(rc))}${esc(regionName(rc))} のカード <span class="muted">${all.length} 枚</span></h3>
      ${cats.length > 1 ? `<div class="region-chips cat-chips focus-cats">
        <button class="chip chip-btn ${cat ? '' : 'on'}" data-fcat="">すべて</button>
        ${cats.map((k) => `<button class="chip chip-btn chip-cat ${cat === k.id ? 'on' : ''}" data-fcat="${k.id}" style="${S.ctx.catVars(k)}"><span class="cat-dot"></span>${esc(k.name)}</button>`).join('')}
      </div>` : ''}
      ${list.length || pl.length ? `<div class="tiles tiles-compact">${list.map((c) => S.ctx.tileHtml(c)).join('')}${pl.map(tile).join('')}</div>` : '<p class="muted small">この地域のカードはまだありません。カードに登録した地名や、関連付けたストリートビューの場所が、この地域の中にあると、ここに出ます（座標のないカードは、「詳細エリア」に地域の名前（英語）が入っているもの）。</p>'}
      ${plateLoading ? '<p class="muted small">ナンバープレートの画像を探しています…（地域ごとにカテゴリーがある国だけ、見つかります）</p>' : ''}`;
    el.querySelectorAll('[data-fcat]').forEach((b) => b.addEventListener('click', () => { S.focusCat = b.dataset.fcat || null; renderList(); }));
    el.querySelectorAll('[data-mk]').forEach((b) => b.addEventListener('click', async () => {
      const [kind, idx] = b.dataset.mk.split('|');
      const it = pseudoOf(rc, kind)[Number(idx)];
      if (!it) return;
      b.disabled = true; b.textContent = '作成中…';
      try { await createRegionCard(rc, it.src, kind, it.title); S.ctx.toast(kind === 'flag' ? '旗のカードを作りました' : 'ナンバープレートのカードを作りました'); await S.ctx.reloadCards(); } catch (ex) { S.ctx.toast(`作れませんでした: ${ex.message}`, 'error'); b.disabled = false; b.textContent = 'カードにする'; }
    }));
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
