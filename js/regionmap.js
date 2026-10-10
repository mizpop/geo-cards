// 国モードの地図: 選んだ国だけを、州・県などの地域ごとに分けて表示する。
// 地域の境界は geoBoundaries（ADM1: 州・県・省など。名前は英語）を、国ごとに、必要になったとき取得する。
// 地域は「国コード:地域コード」（例: JP:JP-13）で区別し、国ごとの情報（シェブロン・ガードレールなど）と同じ仕組みで、値を保存・表示する。
import { createHoverBubble } from './hoverbubble.js';
import { loadLibs, addBaseTiles, isDark } from './map.js';
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

let S = null; // 今の画面の状態
const norm = (s) => String(s || '').toLowerCase().replace(/\b(prefecture|province|state|region|oblast|department|county|district|governorate|municipality|city|autonomous|republic|of|the)\b/g, '').replace(/[\s\-_.,()'’]/g, '');
// カードを、地域に結びつける: 「詳細エリア」や地名に、地域の名前が含まれるもの
function cardsOfRegion(ctx, code) {
  const name = norm(regionName(code));
  const parent = regionParent(code);
  if (name.length < 2) return [];
  return ctx.cards.filter((c) => (c.scope_countries || []).includes(parent)).filter((c) => {
    const hay = [c.area, ...(c.places || []).flatMap((p) => [p.name, p.en, p.local])].map(norm).filter((x) => x.length >= 2);
    return hay.some((h) => h.includes(name) || name.includes(h));
  });
}

export async function renderRegionMap(view, ctx) {
  if (S?.map) { try { S.map.remove(); } catch { /* 無視 */ } }
  const seq = (S?.seq || 0) + 1;
  S = { seq, ctx, view, map: null, layers: new Map(), byCode: new Map(), selected: null };
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
      <div class="rm-map" id="rm-map"></div>
      <aside class="rm-side" id="rm-side"></aside>
    </div>
    <div class="rm-legend" id="rm-legend"></div>
  </section>`;
  ctx.setFit?.(true);
  await loadLibs();
  if (S.seq !== seq || !view.isConnected) return;
  const L = window.L;
  const map = L.map(view.querySelector('#rm-map'), { zoomSnap: 0.25, minZoom: 1, maxZoom: 14, worldCopyJump: false, keyboard: false }).setView([20, 10], 2);
  S.map = map;
  view.querySelector('#rm-map').classList.toggle('map-dark', isDark()); // ダークモード: 背景の地図の色を反転（地図タブと同じ）
  addBaseTiles(map, { updateWhenZooming: false });
  map.attributionControl.addAttribution('地域の境界 &copy; <a href="https://www.geoboundaries.org/" target="_blank" rel="noopener">geoBoundaries</a>');
  map.on('zoomend', () => scalePatterns(map.getPane('overlayPane').querySelector('svg'), map.getZoom()));
  view.querySelector('#rm-mode').addEventListener('change', (e) => { mode = e.target.value; try { localStorage.setItem(MODE_KEY, mode); } catch { /* 無視 */ } restyle(); });
  paintSide();
  let loaded = 0; let failed = 0;
  const status = () => { const el = view.querySelector('#rm-status'); if (el) el.textContent = loaded + failed < countries.length ? `地域の境界を読み込んでいます… ${loaded + failed} / ${countries.length}` : failed ? `${failed} か国は、地域の境界を読み込めませんでした（データがない国もあります）` : `地域をクリックすると、情報が出ます（${[...S.byCode.keys()].length} 地域）`; };
  if (S.bubble) S.bubble.destroy();
  const bubble = createHoverBubble();
  S.bubble = bubble;
  const hintHtml = (rc) => {
    if (mode === 'cards') { const n = cardsOfRegion(ctx, rc).length; return n ? `<span class="hb-n">${n} 枚</span>` : ''; }
    return EDITABLE.includes(mode) ? factChipHtml(mode, rc) : '';
  };
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
          // 世界モードの国と同じ、旗 + 名前 + ひとこと（カード枚数・選んでいる情報）の吹き出し。ひとつだけを使い回す
          l.on('mouseover', (e) => { l.setStyle({ weight: 2.5 }); bubble.show(`${flagImg(code)}<b>${esc(f.properties.name)}</b>${hintHtml(rc)}`, e); });
          l.on('mouseout', () => { l.setStyle({ weight: S.selected === rc ? 3 : 1 }); bubble.hide(); });
          l.on('click', () => selectRegion(rc));
        },
      });
      group.addLayer(layer);
      S.layers.set(code, layer);
      loaded++;
    } catch { failed++; }
    status();
    if (group.getLayers().length) { try { map.fitBounds(group.getBounds(), { padding: [20, 20], maxZoom: 7 }); } catch { /* 無視 */ } }
    restyle();
  }));
  status();
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
      ${cards.length ? cards.map((c) => `<button type="button" class="rm-card" data-card="${esc(c.id)}">${S.ctx.thumb(c) ? `<img src="${esc(S.ctx.thumb(c))}" alt="" loading="lazy">` : ''}<span>${esc(c.description || c.area || 'カード')}</span></button>`).join('') : '<p class="muted small">カードの「詳細エリア」や地名に、この地域の名前（英語）が入っていると、ここに出ます。</p>'}
    </div>`;
  side.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => S.ctx.editFact(b.dataset.edit, rc)));
  side.querySelectorAll('[data-card]').forEach((b) => b.addEventListener('click', () => S.ctx.openCard(b.dataset.card, b)));
}

/** 値を保存したあとなどに、地図と横のパネルを描き直す */
export function refreshRegionMap() { if (!S?.map) return; restyle(); paintSide(); }
