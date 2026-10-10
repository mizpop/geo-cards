// 国モードの地図: 選んだ国だけを、州・県などの地域ごとに分けて表示する。
// 地域の境界は geoBoundaries（ADM1: 州・県・省など。名前は英語）を、国ごとに、必要になったとき取得する。
// 地域は「国コード:地域コード」（例: JP:JP-13）で区別し、国ごとの情報（シェブロン・ガードレールなど）と同じ仕組みで、値を保存・表示する。
import { createHoverBubble } from './hoverbubble.js';
import { loadLibs, addBaseTiles, isDark, svFind } from './map.js';
import { suggestCities } from './cities.js';
import { openSvWindow, SV_ICON } from './svwin.js';
import { MAP_MODES, modeDef, infoStyle, ensurePatterns, scalePatterns, legendHtml, factChipHtml, factPanelHtml } from './infomap.js';

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
const MODES = ['cards', 'none', ...EDITABLE];
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
function indexRegion(f) {
  const g = f.geometry;
  const polys = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : [];
  let w = Infinity; let e = -Infinity; let s = Infinity; let n = -Infinity;
  for (const poly of polys) for (const [x, y] of poly[0]) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
  return { polys, bbox: [w, s, e, n] };
}
function regionAt(lat, lng) {
  if (!S) return null;
  let best = null;
  for (const [rc, r] of S.geo) {
    const [w, s, e, n] = r.bbox;
    if (lng < w || lng > e || lat < s || lat > n) continue;
    if (r.polys.some((poly) => ringHas(poly[0], lng, lat) && !poly.slice(1).some((h) => ringHas(h, lng, lat)))) { best = rc; break; }
  }
  return best;
}

// ---- カードの場所: カードに登録した地名・関連付けたストリートビューの座標から、どの地域のカードかを判断する ----
// 座標のないカードだけ、「詳細エリア」に地域の名前が入っているかで判断する
function pointsOf(card) { return S.ctx.cardPoints(card); }
function computeCardRegions() {
  const map = new Map(); // カード id → { regions: Set, points: [{ lat, lng, label, region }] }
  for (const c of S.ctx.cards) {
    const pts = pointsOf(c).map((p) => ({ ...p, region: regionAt(p.lat, p.lng) }));
    const regions = new Set(pts.map((p) => p.region).filter(Boolean));
    if (!pts.length) { // 座標がないとき: 詳細エリアの文字で
      const hay = norm(c.area);
      if (hay.length >= 2) for (const [rc] of S.geo) { const nm = norm(regionName(rc)); if (nm.length >= 2 && (hay.includes(nm) || nm.includes(hay)) && (c.scope_countries || []).includes(regionParent(rc))) regions.add(rc); }
    }
    map.set(c.id, { regions, points: pts });
  }
  S.cardRegions = map;
}
function cardsOfRegion(ctx, rc) {
  if (!S.cardRegions) computeCardRegions();
  return ctx.cards.filter((c) => S.cardRegions.get(c.id)?.regions.has(rc));
}

const SV_TILE = (x, y, z) => `https://mts1.google.com/vt?hl=ja&lyrs=svv&style=40,18&x=${x}&y=${y}&z=${z}`;

export async function renderRegionMap(view, ctx) {
  if (S?.map) { try { S.map.remove(); } catch { /* 無視 */ } }
  S?.bubble?.destroy();
  const seq = (S?.seq || 0) + 1;
  S = { seq, ctx, view, map: null, layers: new Map(), byCode: new Map(), geo: new Map(), cardRegions: null, selected: null, pins: null, svCov: null, svPins: null, found: null };
  const { esc, countryName, flagImg } = ctx;
  const countries = ctx.countries;
  view.innerHTML = `<section class="rm">
    <div class="toolbar rm-bar">
      <label class="rm-modes"><span class="muted small">表示</span>
        <select class="select select-sm" id="rm-mode" aria-label="表示する情報">${MODES.map((id) => { const m = id === 'cards' ? { icon: '🃏', name: 'カード' } : modeDef(id); return `<option value="${id}" ${id === mode ? 'selected' : ''}>${m.icon} ${esc(m.name)}</option>`; }).join('')}</select></label>
      <span class="rm-countries">${countries.map((c) => `<span class="chip">${flagImg(c)} ${esc(countryName(c))}</span>`).join('')}</span>
      <span class="muted small grow" id="rm-status">地域の境界を読み込んでいます…</span>
    </div>
    <div class="rm-body">
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
      </div>
      <aside class="rm-side" id="rm-side"></aside>
    </div>
    <div class="rm-legend" id="rm-legend"></div>
  </section>`;
  ctx.setFit?.(true);
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
  view.querySelector('#rm-mode').addEventListener('change', (e) => { mode = e.target.value; try { localStorage.setItem(MODE_KEY, mode); } catch { /* 無視 */ } restyle(); });
  paintSide();
  const bubble = createHoverBubble();
  S.bubble = bubble;
  const hintHtml = (rc) => {
    if (mode === 'cards') { const n = cardsOfRegion(ctx, rc).length; return n ? `<span class="hb-n">${n} 枚</span>` : ''; }
    return EDITABLE.includes(mode) ? factChipHtml(mode, rc) : '';
  };
  let loaded = 0; let failed = 0;
  const status = () => { const el = view.querySelector('#rm-status'); if (el) el.textContent = loaded + failed < countries.length ? `地域の境界を読み込んでいます… ${loaded + failed} / ${countries.length}` : failed ? `${failed} か国は、地域の境界を読み込めませんでした（データがない国もあります）` : `地域をクリックすると、情報が出ます（${S.byCode.size} 地域）`; };
  const group = L.featureGroup().addTo(map);
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
          l.on('click', () => { if (!svOn) selectRegion(rc); });
        },
      });
      group.addLayer(layer);
      S.layers.set(code, layer);
      loaded++;
    } catch { failed++; }
    S.cardRegions = null; // 地域がそろうたびに、カードの場所を判断し直す
    status();
    if (group.getLayers().length && !S.fitted) { try { map.fitBounds(group.getBounds(), { padding: [20, 20], maxZoom: 7 }); } catch { /* 無視 */ } }
    if (loaded + failed >= countries.length) S.fitted = true;
    restyle();
  }));
  status();
  setupSearch();
  setupSv();

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
      if (r.region) { // 地域
        const l = S.byCode.get(r.region);
        if (l) { map.fitBounds(l.getBounds(), { padding: [30, 30], maxZoom: 9 }); selectRegion(r.region); }
        input.blur();
        return;
      }
      if (S.found) { S.found.remove(); S.found = null; }
      S.found = L.marker([r.lat, r.lng], { title: r.name }).addTo(map).bindPopup(`<b>${esc(r.name)}</b>${r.sub ? `<br><small>${esc(r.sub)}</small>` : ''}`).openPopup();
      map.flyTo([r.lat, r.lng], Math.max(8, Math.min(13, r.zoom || 10)), { duration: 0.6 });
      const rc = regionAt(r.lat, r.lng);
      if (rc) selectRegion(rc);
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
      if (!svOn || e.target.closest('.leaflet-control, .leaflet-interactive')) return;
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
}

function styleOf(rc) {
  const dark = isDark();
  const sel = S?.selected === rc;
  const base = { color: sel ? '#f08c00' : dark ? '#9fb2bf' : '#4b5b66', weight: sel ? 3 : 1, opacity: 1 };
  if (mode === 'none') return { ...base, fillColor: '#888', fillOpacity: 0.05 };
  if (mode === 'cards') {
    const n = cardsOfRegion(S.ctx, rc).length;
    return n ? { ...base, fillColor: '#1c7f55', fillOpacity: Math.min(0.75, 0.3 + n * 0.12) } : { ...base, fillColor: '#888', fillOpacity: 0.06 };
  }
  return { ...base, ...infoStyle(mode, rc) };
}

// カードの場所（地名・ストリートビュー）の印を、地図に出す（カード表示のとき）
function drawCardPins() {
  S.pins?.remove(); S.pins = null;
  if (!S.map || mode !== 'cards') return;
  if (!S.cardRegions) computeCardRegions();
  const L = window.L;
  const g = L.layerGroup();
  const { esc } = S.ctx;
  for (const c of S.ctx.cards) {
    const info = S.cardRegions.get(c.id);
    for (const p of info?.points || []) {
      if (!p.region) continue;
      const m = L.circleMarker([p.lat, p.lng], { radius: 6, color: '#fff', weight: 2, fillColor: '#e8590c', fillOpacity: 1 }).addTo(g);
      m.bindTooltip(`${esc(c.description || c.area || 'カード')}${p.label ? `（${esc(p.label)}）` : ''}`, { direction: 'top' });
      m.on('click', (e) => { window.L.DomEvent.stop(e); S.ctx.openCard(c.id, null); });
    }
  }
  g.addTo(S.map); S.pins = g;
}

function selectRegion(rc) {
  const prev = S.selected;
  S.selected = rc;
  paintSide();
  for (const c of [prev, rc]) { const l = c && S.byCode.get(c); if (l) l.setStyle(styleOf(c)); } // 色を替えるのは、前に選んだ地域と、いま選んだ地域だけ
  S.byCode.get(rc)?.bringToFront();
}

function restyle() {
  if (!S?.map) return;
  const svgOf = () => S.map.getPane('overlayPane').querySelector('svg');
  const codes = [...S.byCode.keys()];
  if (EDITABLE.includes(mode)) ensurePatterns(svgOf(), mode, codes);
  for (const [rc, l] of S.byCode) l.setStyle(styleOf(rc));
  scalePatterns(svgOf(), S.map.getZoom());
  drawCardPins();
  const lg = S.view.querySelector('#rm-legend');
  if (lg) lg.innerHTML = EDITABLE.includes(mode) ? `<div class="map-legend is-open"><div class="lg-title">${modeDef(mode).icon} ${S.ctx.esc(modeDef(mode).name)}</div>${legendHtml(mode, codes)}</div>` : '';
  S.byCode.get(S.selected)?.bringToFront();
}

function paintSide() {
  const side = S?.view.querySelector('#rm-side');
  if (!side) return;
  const { esc, countryName, flagImg } = S.ctx;
  const rc = S.selected;
  if (!rc) { side.innerHTML = '<p class="muted small">地図の地域（州・県など）をクリックすると、その地域の情報が出ます。</p>'; return; }
  const parent = regionParent(rc);
  const cards = cardsOfRegion(S.ctx, rc);
  side.innerHTML = `<h3 class="rm-title">${flagImg(parent)} ${esc(regionName(rc))}</h3>
    <div class="muted small">${esc(countryName(parent))}の地域</div>
    ${EDITABLE.map((id) => { const m = modeDef(id); return `<div class="rm-fact"><div class="rm-fact-head"><span>${m.icon} ${esc(m.name)}</span>${S.ctx.isEditor() ? `<button type="button" class="btn btn-sm btn-ghost" data-edit="${id}" title="この地域の${esc(m.name)}を入力・編集">✏</button>` : ''}</div>${factChipHtml(id, rc)}</div>`; }).join('')}
    <div class="rm-cards"><div class="rm-fact-head"><span>🃏 この地域のカード（${cards.length}）</span></div>
      ${cards.length ? cards.map((c) => `<button type="button" class="rm-card" data-card="${esc(c.id)}">${S.ctx.thumb(c) ? `<img src="${esc(S.ctx.thumb(c))}" alt="" loading="lazy">` : ''}<span>${esc(c.description || c.area || 'カード')}</span></button>`).join('') : '<p class="muted small">カードに登録した地名や、関連付けたストリートビューの場所が、この地域の中にあると、ここに出ます（座標のないカードは、「詳細エリア」に地域の名前（英語）が入っているもの）。</p>'}
    </div>`;
  side.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => S.ctx.editFact(b.dataset.edit, rc)));
  side.querySelectorAll('[data-card]').forEach((b) => b.addEventListener('click', () => S.ctx.openCard(b.dataset.card, b)));
}

/** 値を保存したあと・カードが変わったあとなどに、地図と横のパネルを描き直す */
export function refreshRegionMap() { if (!S?.map) return; S.cardRegions = null; restyle(); paintSide(); }
