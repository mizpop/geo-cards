// 国モードの地図: 選んだ国だけを、州・県などの地域ごとに分けて表示する。
// 地域の境界は geoBoundaries（ADM1: 州・県・省など。名前は英語）を、国ごとに、必要になったとき取得する。
// 地域は「国コード:地域コード」（例: JP:JP-13）で区別し、国ごとの情報（シェブロン・ガードレールなど）と同じ仕組みで、値を保存・表示する。
import { createHoverBubble } from './hoverbubble.js';
import { loadLibs, addBaseTiles, isDark, svFind } from './map.js';
import { suggestCities } from './cities.js';
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

export async function renderRegionMap(view, ctx) {
  if (S?.map) { try { S.map.remove(); } catch { /* 無視 */ } }
  S?.bubble?.destroy();
  const keepFocus = S?.selected && S.ctx === ctx ? S.selected : null;
  const seq = (S?.seq || 0) + 1;
  S = { seq, ctx, view, map: null, byCode: new Map(), geo: new Map(), cardRegions: null, selected: null, pins: null, thumbs: new Map(), flagMarks: new Map(), svCov: null, svPins: null, found: null, byRegion: new Map() };
  const { esc, countryName, flagImg } = ctx;
  const countries = ctx.countries;
  view.innerHTML = `
    <div class="toolbar map-toolbar rm-bar">
      <label class="rm-modes"><span class="muted small">表示</span>
        <select class="select select-sm" id="rm-mode" aria-label="表示する情報">${MODES.map((id) => `<option value="${id}" ${id === mode ? 'selected' : ''}>${modeInfo(id).icon} ${esc(modeInfo(id).name)}</option>`).join('')}</select></label>
      ${mode === 'cards' ? ctx.filterPicksHtml() : ''}
      ${ctx.isEditor() ? '<button type="button" class="btn btn-ghost btn-sm" id="rm-flagcards" title="旗が見つかった地域の旗を、まとめてカードにします（ラベルは、その国の「地域」。すでに旗のカードがある地域は除きます）">🚩 地域の旗をカードに</button>' : ''}
      <span class="rm-countries">${countries.map((c) => `<span class="chip">${flagImg(c)} ${esc(countryName(c))}</span>`).join('')}</span>
      <span class="muted small grow" id="rm-status">地域の境界を読み込んでいます…</span>
    </div>
    <div class="map-layout rm-layout" style="--panel-w:${ctx.panelWidth()}px">
      <div class="map-box rm-box">
        <div class="rm-map" id="rm-map"></div>
        <div class="map-top">
          <div class="map-search">
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
            <input type="search" id="rm-search" placeholder="${esc(countries.length === 1 ? countryName(countries[0]) : '選んだ国')}の地名・地域を検索" autocomplete="off" enterkeyhint="go" aria-label="地名・地域を検索">
            <div class="map-suggest" id="rm-suggest" role="listbox" aria-label="候補" hidden></div>
          </div>
          <button class="map-sv-btn ${svOn ? 'is-on' : ''}" id="rm-sv" type="button" aria-pressed="${svOn}" aria-label="ストリートビュー" title="ストリートビュー: 押してから、青い線で表示される道路の近くをクリックすると、その場所のストリートビューが開きます">${SV_ICON}</button>
        </div>
        <div class="sv-banner" id="rm-sv-banner" hidden>${SV_ICON}<span>青い線がストリートビューのある道路です。その近くをクリックしてください</span><button type="button" class="link-btn" id="rm-sv-exit">終了</button></div>
        <div class="rm-legend" id="rm-legend"></div>
      </div>
      <div class="vsplit" aria-hidden="true"></div>
      <aside class="map-panel" id="rm-panel" style="--pinfo-h:${(ctx.panelSplit() * 100).toFixed(1)}%">
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
  const bubble = createHoverBubble();
  S.bubble = bubble;
  const hintHtml = (rc) => {
    const fl = regionFlagSrc(rc, 48);
    const flag = fl ? `<img class="rm-flag-s" src="${esc(fl)}" alt="">` : '';
    if (mode === 'cards') { const n = (S.byRegion.get(rc) || []).length; return `${flag}${n ? `<span class="hb-n">${n} 枚</span>` : ''}`; }
    return `${flag}${EDITABLE.includes(mode) ? factChipHtml(mode, rc) : ''}`;
  };
  let loaded = 0; let failed = 0;
  const status = () => { const el = view.querySelector('#rm-status'); if (el) el.textContent = loaded + failed < countries.length ? `地域の境界を読み込んでいます… ${loaded + failed} / ${countries.length}` : failed ? `${failed} か国は、地域の境界を読み込めませんでした（データがない国もあります）` : `地域をクリックすると、情報が出ます（${S.byCode.size} 地域）`; };
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
          l.on('mouseover', (e) => { if (svOn) return; l.setStyle({ weight: 2.5 }); bubble.show(`${flagImg(code)}<b>${esc(f.properties.name)}</b>${hintHtml(rc)}`, e); });
          l.on('mouseout', () => { l.setStyle({ weight: S.selected === rc ? 3 : 1 }); bubble.hide(); });
          l.on('click', () => { if (!svOn) toggleFocus(rc); });
        },
      });
      group.addLayer(layer);
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
  mapEl.addEventListener('click', (e) => { // 地図の上のサムネイル・数字・旗
    const th = e.target.closest('.map-thumb[data-card]');
    if (th) { const c = ctx.cards.find((x) => x.id === th.dataset.card); if (c) ctx.openCard(c, th, (S.byRegion.get(th.closest('[data-rc]')?.dataset.rc) || [c]).map((x) => x.id)); return; }
    const hd = e.target.closest('[data-rc]');
    if (hd && !svOn) toggleFocus(hd.dataset.rc);
  }, true); // Leaflet の印は、クリックを上に伝えないので、先に（キャプチャで）受ける
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S?.view === view && S.selected && !svOn && !document.querySelector('dialog[open]') && !/^(input|textarea|select)$/i.test(e.target.tagName)) clearFocus(); });

  // ---- 地名・地域の検索（選んだ国の中だけ）----
  function setupSearch() {
    const input = view.querySelector('#rm-search');
    const sug = view.querySelector('#rm-suggest');
    let rows = []; let hi = -1; let timer = null; let ctl = null; let mySeq = 0;
    const close = () => { sug.hidden = true; hi = -1; };
    const render = (q, status = '') => {
      sug.innerHTML = `${status ? `<div class="sug-status">${esc(status)}</div>` : ''}${rows.map((r, i) => `<button type="button" role="option" class="sug-row ${i === hi ? 'is-hi' : ''}" data-i="${i}">
        ${r.code ? flagImg(r.code) : '<span class="sug-ico">📍</span>'}
        <span class="sug-main"><span class="sug-title"><b>${esc(r.name)}</b></span><small>${esc(r.sub || '')}</small></span></button>`).join('')}`;
      sug.hidden = !rows.length && !status;
    };
    const pick = (r) => {
      if (!r) return;
      close();
      if (r.region) { focusRegion(r.region); input.blur(); return; }
      if (S.found) { S.found.remove(); S.found = null; }
      S.found = L.marker([r.lat, r.lng], { title: r.name }).addTo(map).bindPopup(`<b>${esc(r.name)}</b>${r.sub ? `<br><small>${esc(r.sub)}</small>` : ''}`).openPopup();
      map.flyTo([r.lat, r.lng], Math.max(8, Math.min(13, r.zoom || 10)), { duration: 0.6 });
      const rc = regionAt(r.lat, r.lng);
      if (rc) { S.selected = rc; renderPanel(); restyle(); }
      input.blur();
    };
    const search = async (q) => {
      const local = [];
      const nq = norm(q);
      if (nq.length >= 1) for (const rc of S.byCode.keys()) { if (norm(regionName(rc)).includes(nq)) local.push({ region: rc, name: regionName(rc), sub: `${countryName(regionParent(rc))}の地域`, code: regionParent(rc) }); if (local.length >= 6) break; }
      rows = local; hi = -1; render(q, '都市を探しています…');
      ctl?.abort(); ctl = new AbortController();
      const my = ++mySeq;
      try {
        const list = (await suggestCities(q, { signal: ctl.signal, count: 12 })).filter((c) => countries.includes(c.code));
        if (my !== mySeq) return;
        rows = [...local, ...list.map((c) => ({ ...c, sub: [c.sub, countryName(c.code)].filter(Boolean).join(' · ') }))];
        render(q, rows.length ? '' : '見つかりませんでした');
      } catch (e) { if (e.name !== 'AbortError' && my === mySeq) render(q, '都市を検索できませんでした'); }
    };
    input.addEventListener('input', () => { clearTimeout(timer); const q = input.value.trim(); if (!q) { rows = []; close(); return; } timer = setTimeout(() => search(q), 300); });
    input.addEventListener('keydown', (e) => {
      if (e.isComposing) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); hi = Math.min(rows.length - 1, hi + 1); render(input.value); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); hi = Math.max(0, hi - 1); render(input.value); }
      else if (e.key === 'Enter') { e.preventDefault(); if (rows.length) pick(rows[Math.max(0, hi)]); else search(input.value.trim()); }
      else if (e.key === 'Escape') { close(); if (S.found) { S.found.remove(); S.found = null; } input.blur(); }
    });
    sug.addEventListener('mousedown', (e) => { const b = e.target.closest('[data-i]'); if (b) { e.preventDefault(); pick(rows[Number(b.dataset.i)]); } });
    input.addEventListener('blur', () => setTimeout(close, 150));
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
    btn.addEventListener('click', () => set(!svOn));
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
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && svOn && S?.view === view && !/^(input|textarea|select)$/i.test(e.target.tagName)) set(false); });
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

// 旗の画像を取ってきて、カードにする（ラベル: その国の地域 / 場所: 地域の代表点 / 表面は画像だけ）
async function createFlagCard(rc) {
  const ctx = S.ctx;
  const src = regionFlagReadable(rc) ? regionFlagSrc(rc) : '';
  if (!src) throw new Error('旗の画像を取得できませんでした');
  const blob = await (await fetch(src)).blob();
  const parent = regionParent(rc);
  const c = S.geo.get(rc)?.center;
  await ctx.createRegionFlagCard({ blob, parent, name: regionName(rc), lat: c?.[0], lng: c?.[1] });
}

function styleOf(rc) {
  const dark = isDark();
  const sel = S?.selected === rc;
  const base = { color: sel ? '#f08c00' : dark ? '#9fb2bf' : '#4b5b66', weight: sel ? 3 : 1, opacity: 1 };
  if (mode === 'none' || mode === 'flag') return { ...base, fillColor: '#888', fillOpacity: 0.05 };
  if (mode === 'cards') {
    const n = (S.byRegion.get(rc) || []).length;
    return n ? { ...base, fillColor: '#1c7f55', fillOpacity: Math.min(0.75, 0.3 + n * 0.12) } : { ...base, fillColor: '#888', fillOpacity: 0.06 };
  }
  return { ...base, ...infoStyle(mode, rc) };
}

// 地図の上の印: カード表示 = 地域ごとのサムネイル（拡大すると画像、引くと枚数）、旗の表示 = 地域の旗、精密な場所（地名・ストリートビュー）の点
function drawMarks() {
  if (!S?.map) return;
  const L = window.L; const { esc, flagImg, countryName } = S.ctx; const map = S.map;
  for (const m of S.thumbs.values()) m.remove();
  for (const m of S.flagMarks.values()) m.remove();
  S.thumbs.clear(); S.flagMarks.clear();
  S.pins?.remove(); S.pins = null;
  const z = map.getZoom();
  const bounds = map.getBounds().pad(0.2);
  if (mode === 'cards') {
    for (const [rc, list] of S.byRegion) {
      const c = S.geo.get(rc)?.center;
      if (!c || !bounds.contains(c)) continue;
      const parent = regionParent(rc);
      const active = rc === S.selected;
      let icon;
      if (z < 5) icon = L.divIcon({ className: 'map-count', html: `<span data-rc="${esc(rc)}">${list.length}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] });
      else {
        const show = list.slice(0, 4); const more = list.length - show.length; const cols = show.length === 1 ? 1 : 2; const w = cols === 1 ? 120 : 172;
        icon = L.divIcon({ className: 'map-thumbs-icon', iconSize: [w, 0], iconAnchor: [w / 2, 20], html: `
          <div class="map-thumbs" data-rc="${esc(rc)}" style="transform:scale(${active ? 0.58 : 0.45})">
            <div class="map-thumbs-head" data-rc="${esc(rc)}">${flagImg(parent)}<span>${esc(regionName(rc))}</span><span class="map-thumbs-n">${list.length}</span></div>
            <div class="map-thumbs-grid" style="grid-template-columns:repeat(${cols},1fr)">${show.map((c2) => `<div class="map-thumb" data-card="${esc(c2.id)}" style="${S.ctx.catVars(S.ctx.catOf(c2))}" title="${esc(S.ctx.catOf(c2).name)}">${S.ctx.thumbUrl(c2) ? `<img src="${esc(S.ctx.thumbUrl(c2))}" alt="">` : ''}</div>`).join('')}</div>
            ${more > 0 ? `<div class="map-thumbs-more" data-rc="${esc(rc)}">ほか ${more} 枚</div>` : ''}
          </div>` });
      }
      S.thumbs.set(rc, L.marker(c, { icon, zIndexOffset: active ? 1000 : 0, keyboard: false }).addTo(map));
    }
    // 精密な場所（カードに登録した地名・関連付けたストリートビュー）
    if (z >= 8) {
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
  } else if (mode === 'flag') {
    const size = z < 4 ? 22 : z < 6 ? 34 : z < 8 ? 48 : 64;
    for (const rc of S.byCode.keys()) {
      const c = S.geo.get(rc)?.center; const src = regionFlagSrc(rc, 160);
      if (!c || !src || !bounds.contains(c)) continue;
      const icon = L.divIcon({ className: 'rm-flag-icon', iconSize: [size, Math.round(size * 0.7)], iconAnchor: [size / 2, size * 0.35], html: `<img data-rc="${esc(rc)}" src="${esc(src)}" alt="" title="${esc(regionName(rc))}" style="width:${size}px">` });
      S.flagMarks.set(rc, L.marker(c, { icon, keyboard: false, zIndexOffset: rc === S.selected ? 1000 : 0 }).addTo(map));
    }
  }
}

function toggleFocus(rc) { if (S.selected === rc) clearFocus(); else focusRegion(rc); }
function focusRegion(rc) {
  const prev = S.selected;
  S.selected = rc;
  for (const c of [prev, rc]) { const l = c && S.byCode.get(c); if (l) l.setStyle(styleOf(c)); }
  S.byCode.get(rc)?.bringToFront();
  const l = S.byCode.get(rc);
  renderPanel();
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
  if (EDITABLE.includes(mode)) ensurePatterns(svgOf(), mode, codes);
  for (const [rc, l] of S.byCode) l.setStyle(styleOf(rc));
  scalePatterns(svgOf(), S.map.getZoom());
  drawMarks();
  const lg = S.view.querySelector('#rm-legend');
  if (lg) lg.innerHTML = EDITABLE.includes(mode) ? `<div class="map-legend is-open"><div class="lg-title">${modeDef(mode).icon} ${S.ctx.esc(modeDef(mode).name)}</div>${legendHtml(mode, codes)}</div>` : '';
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
  const flag = regionFlagSrc(rc, 320);
  const hasFlagCard = S.ctx.cards.some((c) => S.ctx.isFlagCard(c) && S.cardRegions?.get(c.id)?.regions.has(rc));
  const edit = S.ctx.isEditor();
  el.innerHTML = `<div class="rm-info">
    <h3 class="rm-title">${flagImg(parent)} ${esc(regionName(rc))}</h3>
    <div class="muted small">${esc(countryName(parent))}の地域</div>
    ${flag ? `<div class="rm-flagbox"><img src="${esc(flag)}" alt="${esc(regionName(rc))}の旗"><span class="muted small">🚩 地域の旗（Wikimedia Commons）</span>${edit ? `<button type="button" class="btn btn-sm" data-flagcard ${hasFlagCard ? 'disabled' : ''} title="この地域の旗を、カードにします（ラベル: ${esc(countryName(parent))}の地域）">${hasFlagCard ? '✔ 旗のカードあり' : '🚩 旗をカードにする'}</button>` : ''}</div>` : ''}
    ${(EDITABLE.includes(mode) ? [mode] : EDITABLE).map((id) => { const m = modeDef(id); return `<div class="rm-fact"><div class="rm-fact-head"><span>${m.icon} ${esc(m.name)}</span>${edit ? `<button type="button" class="btn btn-sm btn-ghost" data-edit="${id}" title="この地域の${esc(m.name)}を入力・編集">✏</button>` : ''}</div>${factChipHtml(id, rc)}</div>`; }).join('')}
  </div><button type="button" class="icon-btn pinfo-close" title="選択を解除（Esc）" aria-label="選択を解除">✕</button>`;
  el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => S.ctx.editFact(b.dataset.edit, rc)));
  el.querySelector('.pinfo-close')?.addEventListener('click', clearFocus);
  el.querySelector('[data-flagcard]')?.addEventListener('click', async (e) => {
    const b = e.currentTarget; b.disabled = true; b.textContent = '作成中…';
    try { await createFlagCard(rc); S.ctx.toast('旗のカードを作りました'); await S.ctx.reloadCards(); } catch (ex) { S.ctx.toast(`作れませんでした: ${ex.message}`, 'error'); b.disabled = false; b.textContent = '🚩 旗をカードにする'; }
  });
}

function renderList() {
  const el = S?.view.querySelector('#plist');
  if (!el) return;
  const { esc, flagImg, countryName } = S.ctx;
  const rc = S.selected;
  if (rc) {
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
    r.addEventListener('mouseenter', () => S.byCode.get(r.dataset.hover)?.setStyle({ weight: 3, color: '#f08c00' }));
    r.addEventListener('mouseleave', () => { const rc2 = r.dataset.hover; S.byCode.get(rc2)?.setStyle(styleOf(rc2)); });
  });
}

/** 値を保存したあと・カードが変わったあとなどに、地図と横のパネルを描き直す */
export function refreshRegionMap() { if (!S?.map) return; S.cardRegions = null; restyle(); }
