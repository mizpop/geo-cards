// 世界地図ビュー: 国を拡大すると、その国のカードが地図上に現れる
import { bringFront, snapSideAt, showSnapPreview, snapWindow, unsnapWindow, isSnapped, releaseSnap } from './floatz.js';
import { COUNTRY_BY_CODE } from './countries.js';
import { GEO, NUM_TO_CODE } from './geo.js';
import { REF_IMAGES, REF_BASE, REF_PAGES } from './refimages.js';
import { MAP_MODES, modeDef, infoStyle, ensurePatterns, scalePatterns, legendHtml, legendGroups, factChipHtml, factPanelHtml, MATCH_TOPICS, matchOptions, matchAll } from './infomap.js';

const LEAFLET_JS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
const LEAFLET_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
const TOPOJSON_JS = 'https://cdn.jsdelivr.net/npm/topojson-client@3/dist/topojson-client.min.js';
// 国境データ: まず軽い 50m（約 0.8MB）で表示し、裏で精細な 10m（約 3.6MB）を読み込んで差し替える
const WORLD_JSON = (res) => `https://cdn.jsdelivr.net/npm/world-atlas@2/countries-${res}.json`;
const NAME_TO_CODE = { Kosovo: 'XK' }; // 数字コードを持たないポリゴン

// Plonkit のガイドがある国（https://www.plonkit.net/sitemap.xml より, 2026-10 時点）
const PLONKIT_SLUGS = new Set(('andorra united-arab-emirates albania argentina american-samoa austria australia bangladesh belgium bulgaria bermuda bolivia brazil bhutan botswana belarus canada cocos-islands switzerland chile china colombia costa-rica curacao christmas-island cyprus czechia germany denmark dominican-republic ecuador estonia egypt spain finland falkland-islands faroe-islands france united-kingdom ghana gibraltar greenland greece guatemala guam hong-kong croatia hungary indonesia ireland israel-west-bank isle-of-man india iraq iceland italy jersey jordan japan kenya kyrgyzstan cambodia south-korea kazakhstan laos lebanon liechtenstein sri-lanka lesotho lithuania luxembourg latvia monaco montenegro madagascar north-macedonia mali mongolia macau northern-mariana-islands martinique malta mexico malaysia namibia nigeria netherlands norway nepal new-zealand oman panama peru philippines pakistan poland saint-pierre-and-miquelon pitcairn-islands puerto-rico portugal qatar reunion romania serbia russia rwanda sweden singapore slovenia svalbard slovakia san-marino sao-tome-and-principe senegal eswatini thailand tunisia turkey taiwan tanzania ukraine uganda united-states uruguay us-virgin-islands vanuatu vietnam south-africa').split(' '));
const PLONKIT_SPECIAL = { IL: 'israel-west-bank', PS: 'israel-west-bank' };

// GeoGuessr で出題される国（公式のストリートビューがある国）。Plonkit にガイドがある国で判定する
export const isPlayable = (code) => !!plonkitUrl(code);
export function plonkitUrl(code) {
  const c = COUNTRY_BY_CODE.get(code);
  if (!c) return null;
  const slug = PLONKIT_SPECIAL[code] || c.en.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return PLONKIT_SLUGS.has(slug) ? `https://www.plonkit.net/${slug}` : null;
}

// Ctrl（Mac は ⌘）+クリックで Plonkit を新しいタブで開く
function openPlonkit(code, ctx) {
  const url = plonkitUrl(code);
  if (url) {
    // Ctrl が押されたままの click 中に開くとブラウザが「背景タブ」で開くため、イベントの外で開いてフォーカスする
    setTimeout(() => {
      const w = window.open(url, '_blank');
      if (w) { w.opener = null; w.focus(); }
    }, 0);
  } else ctx.toast(`${ctx.countryName(code)} の Plonkit ガイドはありません`, 'error');
}
const EXT_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>';
const isModClick = (e) => !!(e && (e.ctrlKey || e.metaKey));

let libsPromise = null;
const worldPromises = {};
let map = null;
let lastView = null; // 再描画時に表示位置を保つ
let renderSeq = 0;
let escHandler = null; // 地図で国を選んでいるとき Esc で解除
// ストリートビュー: ボタンで入る「クリックで開くモード」と、最後に開いた地点（地図を描き直しても開き直す）
let svOn = false;
let svPoint = null; // [lat, lng]
// キー不要の Google マップの埋め込み（クリックした地点の最寄りのストリートビューが開く）
export const svEmbedUrl = (lat, lng, heading = 0) => `https://www.google.com/maps?layer=c&cbll=${lat.toFixed(6)},${lng.toFixed(6)}&cbp=12,${Math.round(heading)},0,0,0&hl=ja&output=svembed`;
export const svOpenUrl = (lat, lng) => `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat.toFixed(6)},${lng.toFixed(6)}`;
// ストリートビューのある道路（青い線）のタイル。キー不要。クリックした地点の近くの線を探すのにも使う
const SV_TILE = (x, y, z) => `https://mts1.google.com/vt?hl=ja&lyrs=svv&style=40,18&x=${x}&y=${y}&z=${z}`;
const SV_HOVER_MIN_ZOOM = 11; // これ以上拡大しているとき、マウスを動かすと開く場所の印を出す
const SV_LINE_ZOOM = 14; // 道路ごとの青い線として見える縮尺
const SV_THIN_ZOOM = 15; // これ以上拡大したら、青い線を半分の太さにする
const SV_SNAP_M = 250; // クリックの近くの何メートル以内の道路に寄せるか
const SV_SNAP_PX = 44; // ...ただし画面で何ピクセル以内か（指でも押しやすい広さ）
const svTiles = new Map(); // url -> Promise<Uint8ClampedArray | null>（画素の透明度の読み取り用）
function svTileAlpha(x, y, z) {
  const n = 2 ** z;
  const url = SV_TILE(((x % n) + n) % n, y, z);
  if (!svTiles.has(url)) {
    svTiles.set(url, new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const c = document.createElement('canvas');
          c.width = c.height = 256;
          const g = c.getContext('2d');
          g.drawImage(img, 0, 0);
          resolve(g.getImageData(0, 0, 256, 256).data);
        } catch { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    }));
    if (svTiles.size > 60) svTiles.delete(svTiles.keys().next().value); // 古いものから手放す
  }
  return svTiles.get(url);
}
// クリックした地点に一番近い「ストリートビューのある線」の地点。見つからなければ null、読み取れなければクリックした地点
async function svSnap(lat, lng, zoom, { R: Ropt = 0, lenient = false } = {}) {
  const z = Math.min(17, Math.round(zoom));
  const n = 256 * 2 ** z;
  const sin = Math.sin((lat * Math.PI) / 180);
  const px = Math.round(((lng + 180) / 360) * n);
  const py = Math.round((0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * n);
  // クリックから何ピクセルまでの青い線を探すか: 250m 以内、かつ画面で 44px 以内（タイルの画素に直して）
  const mpp = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z; // タイルの 1 画素が何メートルか
  const R = Ropt || Math.max(6, Math.min(Math.round(SV_SNAP_M / mpp), Math.round(SV_SNAP_PX * 2 ** (z - zoom)), 60));
  const tx0 = Math.floor((px - R) / 256);
  const tx1 = Math.floor((px + R) / 256);
  const ty0 = Math.max(0, Math.floor((py - R) / 256));
  const ty1 = Math.min(2 ** z - 1, Math.floor((py + R) / 256));
  const tiles = [];
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) tiles.push([tx, ty, svTileAlpha(tx, ty, z)]);
  let best = null;
  let bestD = Infinity;
  let readable = false;
  for (const [tx, ty, pr] of tiles) {
    const d = await pr;
    if (!d) continue;
    readable = true;
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const dd = dx * dx + dy * dy;
        if (dd >= bestD || dd > R * R) continue;
        const gx = px + dx - tx * 256;
        const gy = py + dy - ty * 256;
        if (gx < 0 || gx > 255 || gy < 0 || gy > 255) continue;
        if (d[(gy * 256 + gx) * 4 + 3] > 40) { best = [px + dx, py + dy]; bestD = dd; }
      }
    }
  }
  if (!readable) return lenient ? { lat, lng } : null; // タイルを読めなかった（通信できないなど）: lenient なら、クリックした地点をそのまま開く
  if (!best) return null;
  return {
    lng: (best[0] / n) * 360 - 180,
    lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * best[1]) / n))) * 180) / Math.PI,
  };
}
// クリックした付近の「ストリートビューのある道路」の地点。縮尺が小さいとき（道路が区別できない）は、
// 粗い縮尺で「画面で 44px 以内の青い所」を見つけてから、縮尺を上げながら（粗い → 細かい）道路の上に寄せていく。なければ null
async function svFind(lat, lng, zoom) {
  if (zoom >= SV_LINE_ZOOM) return svSnap(lat, lng, zoom, { lenient: true });
  const z0 = Math.max(5, Math.min(13, Math.round(zoom)));
  let cur = await svSnap(lat, lng, z0, { R: Math.max(8, Math.min(60, Math.round(SV_SNAP_PX * 2 ** (z0 - zoom)))), lenient: true });
  if (!cur) return null;
  for (const [z, R] of [[10, 40], [12, 30], [14, 24], [16, 24]]) {
    if (z <= z0) continue;
    cur = await svSnap(cur.lat, cur.lng, z, { R });
    if (!cur) return null;
  }
  return cur;
}
// 緯度・経度がどの国の中か（50m の国境データで判定。海上や小さな島で見つからなければ null）
function ringHas(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function polyHas(poly, x, y) {
  return ringHas(poly[0], x, y) && !poly.slice(1).some((h) => ringHas(h, x, y)); // 外側の輪の中で、穴の外
}
export async function countryAt(lat, lng) {
  await loadLibs(); // topojson（国境データの読み込みに必要）
  const w = await loadWorld('50m');
  for (const f of w.fc.features) {
    const code = f.properties.code;
    const g = f.geometry;
    if (!code || !g) continue;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    // 日付変更線をまたぐ国は経度が連続するように直してあるので、360 度ずらした位置も調べる
    if (polys.some((poly) => [0, 360, -360].some((d) => polyHas(poly, lng + d, lat)))) return code;
  }
  return null;
}
// 指定した国の中の、ストリートビューのある地点をランダムに 1 つ（練習モード用）。見つからなければ null
// 国の中のランダムな点から、青い線の「いちばん近い所」へ、縮尺を上げながら（粗い → 細かい）寄せていく
const wrapLng = (x) => ((((x + 180) % 360) + 360) % 360) - 180;
export async function randomSvPoint(code, attempts = 8) {
  await loadLibs(); // topojson（国境データの読み込みに必要）
  const w = await loadWorld('50m');
  const polys = [];
  for (const f of w.fc.features) {
    if (f.properties.code !== code || !f.geometry) continue;
    const g = f.geometry;
    for (const poly of g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []) {
      const xs = poly[0].map((p) => p[0]);
      const ys = poly[0].map((p) => p[1]);
      const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      polys.push({ poly, box, area: Math.max(1e-6, (box[2] - box[0]) * (box[3] - box[1])) });
    }
  }
  if (!polys.length) return null;
  const total = polys.reduce((n, p) => n + p.area, 0);
  const pickPoly = () => { let r = Math.random() * total; for (const p of polys) { r -= p.area; if (r <= 0) return p; } return polys[0]; };
  for (let k = 0; k < attempts; k++) {
    const { poly, box } = pickPoly();
    let pt = null;
    for (let i = 0; i < 80 && !pt; i++) {
      const x = box[0] + Math.random() * (box[2] - box[0]);
      const y = box[1] + Math.random() * (box[3] - box[1]);
      if (polyHas(poly, x, y)) pt = [x, y];
    }
    if (!pt) continue;
    let cur = { lat: pt[1], lng: wrapLng(pt[0]) };
    for (const [z, R] of [[8, 60], [10, 40], [12, 30], [14, 24], [16, 24]]) { // 縮尺ごとに「何ピクセル以内の線へ寄せるか」
      const hit = await svSnap(cur.lat, cur.lng, z, { R });
      if (!hit) { cur = null; break; }
      cur = hit;
    }
    if (!cur) continue;
    if ((await countryAt(cur.lat, cur.lng)) !== code) continue; // 寄せているうちに隣の国へ出た
    return cur;
  }
  return null;
}
// パネルの位置と大きさ（画面全体の中で動かせる。開き直しても引き継ぐ）
let svRect = null; // { left, top, width, height }
export function removeSvPanel() { const p = document.getElementById('sv-panel'); if (p) { releaseSnap(p); p.remove(); } }

const SV_ICON = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="5" r="2.6"/><path d="M12 9v6M8 11l4-2 4 2M9.5 21l2.5-6 2.5 6"/></svg>';
let legendOpenPref = null; // 凡例の開閉（未操作なら、広い画面は開く・スマホは閉じる）
let currentFocus = null; // 選んでいる国（データ更新で描き直すときに引き継ぐ）
let restoreFocus = null;
let pendingFocus = null; // 次に地図を描いたときに移動する国（カードの「地図で見る」から）
export function focusOnNextRender(code) { pendingFocus = code; }
// カードが更新されたときの描き直し: 表示位置に加えて、選んでいる国もそのまま
export function refreshMap(view, ctx) {
  restoreFocus = currentFocus;
  return renderMap(view, ctx);
}
let notesHandler = null; // 国のメモが変わったら右パネルを描き直す
window.addEventListener('geo:notes', () => notesHandler && notesHandler());
let bubbleEl = null;
let hoverMove = null;
const mouse = { x: 0, y: 0 };
let lastPointer = 'mouse'; // 直近の操作がマウスか指（touch）・ペンか
for (const ev of ['pointerdown', 'pointermove']) {
  document.addEventListener(ev, (e) => { lastPointer = e.pointerType || 'mouse'; }, { passive: true, capture: true });
}
document.addEventListener('mousemove', (e) => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
  if (hoverMove && bubbleEl?.classList.contains('show')) hoverMove();
}, { passive: true });
function getBubble() {
  if (!bubbleEl) {
    bubbleEl = document.createElement('div');
    bubbleEl.className = 'hover-bubble';
    bubbleEl.setAttribute('aria-hidden', 'true');
    document.body.appendChild(bubbleEl);
  }
  return bubbleEl;
}
// カーソルの右下に置き、画面からはみ出す場合は左・上に回り込ませる
// 背景の地図タイル。'en': 国名・地名が英語表記（Esri World Street Map、Google マップに近い見た目）
// 'osm': OpenStreetMap（地名は現地の言語）。どちらも API キー不要
let tileStyle = 'en';
export function setTileStyle(v) { tileStyle = v === 'osm' ? 'osm' : 'en'; }
// タイルの読み込みを控えめに: 画面の外に先読みする量（keepBuffer）を減らし、スマホ（指で操作する端末）・
// データ節約の設定では、動かしている最中は読み込まず止まってから読み込む（端が少しだけ遅れて出る）
const leanTiles = () => !!(window.matchMedia?.('(pointer: coarse)').matches || navigator.connection?.saveData);
export function addBaseTiles(map, opts = {}) {
  const L = window.L;
  const lean = leanTiles();
  opts = { keepBuffer: lean ? 1 : 3, updateWhenIdle: lean, ...opts };
  // attribution は地図の帰属表示（右下）に自動で出る
  const layer = tileStyle === 'osm'
    ? L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', ...opts })
    : L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, maxNativeZoom: 18, attribution: 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors', ...opts });
  layer.addTo(map);
  return layer;
}

function placeBubble() {
  const b = bubbleEl;
  if (!b) return;
  const w = b.offsetWidth;
  const h = b.offsetHeight;
  let x = mouse.x + 16;
  let y = mouse.y + 18;
  let ox = 'left';
  let oy = 'top';
  if (x + w > window.innerWidth - 8) { x = mouse.x - w - 12; ox = 'right'; }
  const top = b.classList.contains('has-fan') ? 60 : 8; // 扇のカードは本体の上にはみ出して描く
  if (y < top) y = top;
  if (y + h > window.innerHeight - 8) { y = Math.max(top, mouse.y - h - 12); oy = 'bottom'; }
  b.style.setProperty('--origin', `${oy} ${ox}`); // 広がるアニメーションの起点をカーソル側に
  b.style.transform = `translate(${Math.max(8, x)}px, ${y}px)`;
}
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !escHandler || !document.getElementById('map')) return;
  if (document.querySelector('dialog[open]')) return;
  if (/^(input|textarea|select)$/i.test(e.target.tagName)) return;
  escHandler();
});

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`読み込み失敗: ${src}`));
    document.head.appendChild(s);
  });
}
export function loadLibs() {
  if (!libsPromise) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = LEAFLET_CSS;
    document.head.appendChild(link);
    libsPromise = Promise.all([loadScript(LEAFLET_JS), loadScript(TOPOJSON_JS)]);
    libsPromise.catch(() => { libsPromise = null; });
  }
  return libsPromise;
}
export function loadWorld(res = '50m') {
  if (!worldPromises[res]) {
    worldPromises[res] = fetch(WORLD_JSON(res)).then((r) => r.json()).then((topo) => {
      const fc = window.topojson.feature(topo, topo.objects.countries);
      for (const f of fc.features) unwrapGeometry(f.geometry);
      for (const f of fc.features) {
        f.properties.code = NUM_TO_CODE.get(Number(f.id)) || NAME_TO_CODE[f.properties.name] || null;
      }
      // 国と国が接する境界線だけ（海岸線を含まない）。海上にずれた線が出ないようにするため
      const borders = window.topojson.mesh(topo, topo.objects.countries, (a, b) => a !== b);
      unwrapGeometry(borders);
      // 日付変更線の向こう側（地図の隣の 1 周分）にも国を置く。太平洋を中心に見たときに
      // 反対側の国（アラスカ・ハワイ・ニュージーランドなど）が塗られず押せなくなるのを防ぐ
      const copies = [];
      for (const f of fc.features) {
        if (!f.properties.code) continue;
        const [west, east] = lngRange(f.geometry);
        if (west < -20) copies.push(shiftFeature(f, 360));
        if (east > 20) copies.push(shiftFeature(f, -360));
      }
      // 複製は表示範囲が日付変更線をまたいだときだけ地図に載せる（常に載せると描画が重くなるため）
      const copyFc = { type: 'FeatureCollection', features: copies };
      const copyBorders = { type: 'MultiLineString', coordinates: [...shiftGeometry(borders, 360).coordinates, ...shiftGeometry(borders, -360).coordinates] };
      // 複製側の各部分の範囲（「表示中の国」の判定用）。地図に載せていなくても使えるよう座標から求めておく
      const copyParts = new Map();
      for (const f of copies) {
        const list = copyParts.get(f.properties.code) || [];
        list.push(...geometryPartBounds(f.geometry));
        copyParts.set(f.properties.code, list);
      }
      // 国境線を 1 本ずつ範囲付きで（精細表示で画面周辺の線だけ描くため）
      const borderLines = [...borders.coordinates, ...copyBorders.coordinates].map((coords) => {
        let w = Infinity; let e = -Infinity; let so = Infinity; let n = -Infinity;
        for (const [lng, lat] of coords) { if (lng < w) w = lng; if (lng > e) e = lng; if (lat < so) so = lat; if (lat > n) n = lat; }
        return { coords, box: window.L.latLngBounds([so, w], [n, e]) };
      });
      return { fc, borders, copyFc, copyBorders, copyParts, borderLines };
    });
    worldPromises[res].catch(() => { delete worldPromises[res]; });
  }
  return worldPromises[res];
}

export const isDark = () => {
  const t = document.documentElement.dataset.theme;
  if (t) return t === 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
};

export async function renderMap(view, ctx) {
  const seq = ++renderSeq;
  hoverMove = null;
  if (bubbleEl) bubbleEl.classList.remove('show');
  if (map) {
    lastView = { center: map.getCenter(), zoom: map.getZoom() };
    map.remove();
    map = null;
  }
  const mode = ctx.mapMode();
  // 条件で絞り込み: 当てはまる国
  const conds = ctx.matchConds();
  const matched = mode === 'match' ? new Set(matchAll(conds, [...GEO.keys()])) : null;
  const factMode = mode !== 'cards' && mode !== 'match'; // 国ごとの値を出すモード
  // 参考写真（GeoHints）: ボラード・電柱・シェブロン・ナンバープレートで、スイッチがオンなら地図に並べる
  const hasPhotos = !!REF_IMAGES[mode];
  const photoOn = hasPhotos && ctx.mapPhotos();
  const photoList = (code) => (REF_IMAGES[mode]?.[code] || []).map((rel, i) => ({ id: `ref-${code}-${i}`, src: REF_BASE + rel, photo: true }));
  let legendOpen = legendOpenPref ?? !window.matchMedia('(max-width: 760px)').matches;
  const patternMode = !!modeDef(mode).pattern;
  view.innerHTML = `
    <div class="toolbar map-toolbar">
      <label class="map-mode-pick" title="${modeDef(mode).desc}">
        <span class="sr-only">地図の表示</span>
        <select id="map-mode" class="select">
          ${MAP_MODES.filter((m) => !m.quizOnly).map((m) => `<option value="${m.id}" ${m.id === mode ? 'selected' : ''}>${m.icon} ${m.name}</option>`).join('')}
        </select>
      </label>
      ${mode === 'cards' ? ctx.filterPicksHtml() : ''}
      ${hasPhotos ? `<label class="photo-switch" title="GeoHints の参考写真を地図と右パネルに表示"><span class="switch"><input type="checkbox" id="map-photos" ${photoOn ? 'checked' : ''}><span class="switch-track"><span class="switch-thumb"></span></span></span>📷 写真</label>` : ''}
      <button class="btn btn-ghost btn-sm" id="map-world" aria-label="世界全体" title="世界全体を表示">🌐<span class="tab-long"> 世界全体</span></button>
      <span class="muted small map-hint">${mode === 'cards' ? 'クリック・拡大でカード表示' : 'クリックで国を選択'} ／ Ctrl+クリック・Ctrl+Enter で Plonkit ／ Alt+クリック・Alt+Enter で国の詳細</span>
    </div>
    <div class="map-layout">
      <div class="map-box">
        <div id="map" class="map"></div>
        <div class="map-top">
          <div class="map-search">
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
            <input type="search" id="map-search" list="country-list" placeholder="国を検索（そのまま入力 ／ ww で世界全体）" autocomplete="off" enterkeyhint="go" aria-label="国を検索">
            <span class="map-search-help" title="地図で文字を打つ・Enter: 検索を開始 ／ ww: 世界全体 ／ 入力すると候補の国へ自動で移動（設定でオフにできます） ／ Enter: 確定して入力を終える ／ Esc: 元の場所に戻る ／ Ctrl+Enter: Plonkit ／ Alt+Enter: 国の詳細">?</span>
          </div>
          <button class="map-sv-btn ${svOn ? 'is-on' : ''}" id="map-sv" type="button" aria-pressed="${svOn}" aria-label="ストリートビュー" title="ストリートビュー: 押してから、青い線で表示される道路の近くをクリックすると、その場所の映像を表示します">${SV_ICON}</button>
        </div>
        <div class="map-loading" id="map-loading">地図を読み込み中…</div>
        <div class="sv-banner" id="sv-banner" hidden>${SV_ICON}<span id="sv-banner-text">青い線がストリートビューのある道路です。その近くをクリックしてください</span><button type="button" class="link-btn" id="sv-exit">終了（Esc）</button></div>

        ${mode === 'cards' ? '' : `<div class="map-legend ${legendOpen ? 'is-open' : ''}" id="map-legend"><button type="button" class="lg-title" aria-expanded="${legendOpen}" title="凡例を開く / 閉じる">${modeDef(mode).icon} ${modeDef(mode).name}<span class="lg-toggle" aria-hidden="true">▾</span></button><div class="lg-desc">${modeDef(mode).desc}</div><div class="lg-items"></div>${modeDef(mode).editable && ctx.isEditor() ? '<div class="lg-hint">国を選んで「編集」で色・種類を登録</div>' : ''}</div>`}
      </div>
      <aside class="map-panel" id="map-panel" style="--pinfo-h:${(ctx.panelSplit() * 100).toFixed(1)}%">
        <section class="pinfo" id="pinfo"></section>
        <div class="psplit" id="psplit" role="separator" aria-orientation="horizontal" aria-label="上下の高さを調整" tabindex="0" title="ドラッグで上下の高さを調整（ダブルクリックで元に戻す）"></div>
        <section class="plist" id="plist"></section>
      </aside>
    </div>`;

  let world;
  try {
    await loadLibs();
    world = await loadWorld();
  } catch (e) {
    if (seq === renderSeq && $id('map-loading')) $id('map-loading').textContent = `地図の読み込みに失敗しました（${e.message}）`;
    return;
  }
  // 読み込み中に別の画面へ移動した / 再描画された
  if (seq !== renderSeq || !$id('map') || map) return;
  $id('map-loading').remove();

  const L = window.L;
  const anim = ctx.animations();
  map = L.map('map', {
    worldCopyJump: true, minZoom: 2, maxZoom: 18, zoomSnap: 0.5, preferCanvas: true,
    // 塗りは画面の外側も多めに描いておく（既定の 0.1 だと、ドラッグ中に端が切れて見える）
    // シェブロン・ガードレールは模様で塗るので SVG で描く（それ以外は軽い canvas）
    renderer: patternMode ? L.svg({ padding: 0.6 }) : L.canvas({ padding: 0.8 }),
    zoomAnimation: anim, fadeAnimation: anim, markerZoomAnimation: anim,
  });
  window.__geoMap = map; // デバッグ・動作確認用
  // アニメーションをオフにしているときは瞬時に移動
  // 移動のアニメーション中は、塗りは見た目だけ引き伸ばされ、クリックの判定は移動前の位置のまま。
  // そこで移動中にマウスのボタンが押されたら、その場で移動を止めて判定を今の位置に合わせ直す
  let flying = false;
  const fly = (target, zoom) => { if (anim) { flying = true; map.flyTo(target, zoom, { duration: 0.8 }); } else map.setView(target, zoom, { animate: false }); };
  const flyBounds = (b, opts) => { if (anim) { flying = true; map.flyToBounds(b, { ...opts, duration: 0.8 }); } else map.fitBounds(b, { ...opts, animate: false }); };
  map.on('moveend', () => { flying = false; });
  // シェブロン・ガードレール・電柱の模様は、縮尺に合わせて大きさを変える
  if (patternMode) map.on('zoomend', () => scalePatterns(map.getPane('overlayPane').querySelector('svg'), map.getZoom()));
  map.getContainer().addEventListener('pointerdown', () => {
    if (!flying) return;
    flying = false;
    map.stop();
    map.setView(map.getCenter(), map.getZoom(), { animate: false, reset: true }); // 塗り・判定を今の位置で計算し直す
  }, { capture: true });
  const dark = isDark();
  // 背景の地図（設定で英語表記 / OpenStreetMap を切り替え）。ダークモードは CSS で色を反転
  addBaseTiles(map, { updateWhenZooming: false });
  $id('map').classList.toggle('map-dark', dark);
  if (lastView) map.setView(lastView.center, lastView.zoom);
  else map.setView([25, 10], 2);

  // ---- カテゴリーで絞り込んだ国ごとのカード
  const cards = ctx.cards.filter(ctx.filterMatch);
  const byCountry = new Map();
  for (const card of cards) {
    for (const code of card.countries) {
      if (!byCountry.has(code)) byCountry.set(code, []);
      byCountry.get(code).push(card);
    }
  }
  const maxCount = Math.max(1, ...[...byCountry.values()].map((v) => v.length));

  // ---- 右パネル・選択中の国・ホバー中の国の状態
  // PC（マウス）では、国にマウスを乗せるとその国の情報をパネル上段に出す。スマホでは無効
  const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  let focused = null; // 検索・クリックで選んでいる国
  let focusCat = null;
  let hoverCode = null; // マウスが乗っている国
  let flashed = null; // 検索で光らせている国のレイヤー（複製を含む）
  let flashedCode = null;
  let hoverTimer = null;
  if (bubbleEl) bubbleEl.classList.remove('show');
  let shownCodes = [];
  let clickedCountry = false;
  let shownTotal = 0;

  // ---- 国ポリゴン（カード数で色分け）
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#1c7f55';
  const NO_PLAY = dark ? '#5d646c' : '#9aa0a6'; // 出題されない国の灰色
  const baseStyle = (f) => {
    if (mode === 'match') return { stroke: false, color: accent, weight: 2, fillColor: '#2f9e44', fillOpacity: matched.has(f.properties.code) ? 0.6 : 0 };
    if (mode !== 'cards') return { stroke: false, color: accent, weight: 2, ...infoStyle(mode, f.properties.code) };
    const n = byCountry.get(f.properties.code)?.length || 0;
    if (f.properties.code && !isPlayable(f.properties.code)) {
      return { stroke: false, color: NO_PLAY, weight: 2, fillColor: NO_PLAY, fillOpacity: dark ? 0.5 : 0.45 };
    }
    // 輪郭線は描かない（国境データの海岸線が地図とずれて、海上の線のように見えるため）。塗りだけで表現
    return {
      stroke: false,
      color: accent,
      weight: 2,
      fillColor: accent,
      fillOpacity: n ? 0.16 + 0.4 * (n / maxCount) : 0,
    };
  };
  const bounds = new Map(); // code -> 最大のポリゴンの範囲
  const layersByCode = new Map();
  const partBounds = new Map(); // code -> 島などの各部分の範囲（表示範囲との重なり判定用）
  // 選んでいる国は黄色の輪郭と薄い塗りで強調し続ける
  // （インフォグラフィックでは塗りはそのままで、黄色の輪郭だけ）
  const styleFor = (f) => (f.properties.code && f.properties.code === focused
    ? (mode === 'cards'
      ? { ...baseStyle(f), stroke: true, color: '#f5c400', weight: 2.5, fillColor: '#f5c400', fillOpacity: 0.22 }
      : { ...baseStyle(f), stroke: true, color: '#f5c400', weight: 3.5 })
    : baseStyle(f));
  const restyle = (code) => { for (const l of (code && layersByCode.get(code)) || []) layer.resetStyle(l); };
  let layer = null;
  let bordersLayer = null;
  // ---- 国の塗り・国境線の描画（縮尺で詳しさを切り替えて軽くする）
  // 縮尺 HI_ZOOM 未満: 粗い 50m データで全世界 / 以上: 精細な 10m データを画面周辺の国だけ
  // 日付変更線をまたいで見ているときは、隣の 1 周分の国（複製）も載せる
  const HI_ZOOM = 5;
  const POLY_OPTS = { smoothFactor: 1.5 }; // 細かすぎる点は省いて描く（見た目はほぼ同じで軽くなる）
  const BORDER_STYLE = { color: dark ? '#7d8b96' : '#8f9aa3', weight: 0.8, opacity: 0.7, fill: false };
  const worlds = { lo: null, hi: null };
  let drawnKey = '';
  let hiRegion = null;
  function wireCountry(f, lyr) {
    const code = f.properties.code;
    if (!code) return;
    if (!layersByCode.has(code)) layersByCode.set(code, []);
    layersByCode.get(code).push(lyr);
    lyr.on('mouseover', () => {
      lyr.setStyle({ stroke: true, fillOpacity: Math.max(0.12, styleFor(f).fillOpacity) });
      setHover(code);
    });
    lyr.on('mouseout', () => { layer.resetStyle(lyr); setHover(null); });
    lyr.on('contextmenu', (e) => previewNow(code, e));
    lyr.on('click', (e) => {
      clickedCountry = true; // 直後の地図クリック（海などで選択解除）と区別
      if (e.originalEvent?.altKey) ctx.openCountry(code, { x: e.originalEvent.clientX, y: e.originalEvent.clientY });
      else if (isModClick(e.originalEvent)) openPlonkit(code, ctx);
      else toggleFocus(code);
    });
  }
  // 国の範囲（移動先・表示中の国の判定用）は描画と切り離して、粗いデータから一度だけ求める
  function computeBounds(w) {
    bounds.clear();
    partBounds.clear();
    for (const f of w.fc.features) {
      const code = f.properties.code;
      if (!code) continue;
      const parts = geometryPartBounds(f.geometry);
      if (!parts.length) continue;
      let best = parts[0];
      let bestArea = -1;
      for (const pb of parts) {
        const area = (pb.getNorth() - pb.getSouth()) * (pb.getEast() - pb.getWest());
        if (area > bestArea) { bestArea = area; best = pb; }
      }
      bounds.set(code, best);
      partBounds.set(code, [...(partBounds.get(code) || []), ...parts]);
    }
    for (const [code, parts] of w.copyParts) partBounds.set(code, [...(partBounds.get(code) || []), ...parts]);
  }
  const featureBox = new WeakMap();
  const boxOf = (f) => {
    let b = featureBox.get(f);
    if (!b) {
      const parts = geometryPartBounds(f.geometry);
      b = parts.reduce((acc, pb) => acc.extend(pb), L.latLngBounds(parts[0].getSouthWest(), parts[0].getNorthEast()));
      featureBox.set(f, b);
    }
    return b;
  };
  function drawCountries(force = false) {
    const lo = worlds.lo;
    if (!lo) return;
    const view = map.getBounds();
    const crossing = view.getWest() < -178 || view.getEast() > 178;
    const useHi = !!worlds.hi && map.getZoom() >= HI_ZOOM;
    let key;
    let features;
    let borderLines;
    if (useHi) {
      // 画面周辺（表示範囲の 3 倍）の国だけを精細なデータで。範囲から出たら描き直す
      if (!force && hiRegion && drawnKey.startsWith('hi') && hiRegion.contains(view)) return;
      hiRegion = view.pad(1);
      const hi = worlds.hi;
      features = [...hi.fc.features, ...hi.copyFc.features].filter((f) => f.properties.code && boxOf(f).intersects(hiRegion));
      borderLines = hi.borderLines.filter((ln) => ln.box.intersects(hiRegion)).map((ln) => ln.coords);
      key = `hi:${hiRegion.toBBoxString()}`;
    } else {
      hiRegion = null;
      features = crossing ? [...lo.fc.features, ...lo.copyFc.features] : lo.fc.features;
      borderLines = crossing ? [...lo.borders.coordinates, ...lo.copyBorders.coordinates] : lo.borders.coordinates;
      key = `lo:${crossing}`;
    }
    if (!force && key === drawnKey) return;
    drawnKey = key;
    if (layer) map.removeLayer(layer);
    if (bordersLayer) map.removeLayer(bordersLayer);
    layersByCode.clear();
    layer = L.geoJSON({ type: 'FeatureCollection', features }, { style: styleFor, onEachFeature: wireCountry, ...POLY_OPTS }).addTo(map);
    bordersLayer = L.geoJSON({ type: 'MultiLineString', coordinates: borderLines }, { interactive: false, style: BORDER_STYLE, ...POLY_OPTS }).addTo(map);
    layer.bringToBack();
    if (patternMode) {
      const svg = map.getPane('overlayPane').querySelector('svg');
      ensurePatterns(svg, mode, features.map((f) => f.properties.code).filter(Boolean));
      scalePatterns(svg, map.getZoom());
    }
    // 描き直した後も、検索で光らせている国とマウスが乗っている国の見た目を引き継ぐ
    if (flashedCode) {
      flashed = layersByCode.get(flashedCode) || [];
      for (const l of flashed) l.setStyle(FLASH_STYLE);
    }
  }
  worlds.lo = world;
  computeBounds(world);
  drawCountries(true);

  // ---- 国ごとのマーカー（遠いと枚数バッジ、拡大するとカードのサムネイル）
  const markers = new Map();
  const markerSource = mode === 'cards' ? byCountry
    : photoOn ? new Map(Object.keys(REF_IMAGES[mode]).map((c) => [c, photoList(c)])) : [];
  for (const [code, list] of markerSource) {
    const g = GEO.get(code);
    if (!g) continue;
    // 日付変更線の向こう側にも置く（国の塗りの複製と同じ考え方）
    const lngs = [g.lng, ...(g.lng < -20 ? [g.lng + 360] : []), ...(g.lng > 20 ? [g.lng - 360] : [])];
    const mks = lngs.map((lng) => L.marker([g.lat, lng], { icon: countIcon(L, code, list.length), riseOnHover: true }).addTo(map));
    for (const m of mks) bindMarker(m, code, list);
    markers.set(code, { code, markers: mks, list, revealed: false });
  }
  function bindMarker(m, code, list) {
    m.on('click', (e) => {
      if (e.originalEvent?.altKey) { ctx.openCountry(code, { x: e.originalEvent.clientX, y: e.originalEvent.clientY }); return; }
      if (isModClick(e.originalEvent)) { openPlonkit(code, ctx); return; }
      if (e.originalEvent?.target?.closest?.('[data-expand]')) { toggleExpand(code); return; }
      const id = e.originalEvent?.target?.closest?.('[data-card]')?.dataset.card;
      if (id) {
        const card = list.find((c) => c.id === id);
        if (card?.photo) ctx.openPhoto(mode, code, list.map((c) => c.src), list.indexOf(card), e.originalEvent.target.closest('[data-card]')); // 参考写真はカードと同じ画面で
        else if (card) ctx.openCard(card, e.originalEvent.target.closest('[data-card]'), list.map((c) => c.id)); // ← → でこの国のカードを順に
      } else {
        toggleFocus(code);
      }
    });
    // 枚数の丸・サムネイルの上でも、その国の情報をパネルに出す
    m.on('mouseover', () => setHover(code));
    m.on('mouseout', () => setHover(null));
    m.on('contextmenu', (e) => previewNow(code, e));
  }

  // サムネイルに切り替わる縮尺: 国全体が画面に収まる縮尺の少し手前（大きい国ほど早く現れる）
  function revealZoom(code) {
    const b = bounds.get(code);
    if (!b) return 6;
    const fit = map.getBoundsZoom(b, false, L.point(60, 60));
    return Math.max(3, Math.min(7, fit - 0.75));
  }

  // ---- 国を選んでいるとき（検索・クリックで移動）は、右パネルをその国の情報とカードにする
  // 選択が外れるのは: パネルの ✕ / Esc / 海など国以外をクリック / その国が表示範囲から完全に外れたとき
  const setFocused = (code) => {
    const prev = focused;
    if (prev !== code) focusCat = null;
    focused = code;
    currentFocus = code;
    restyle(prev);
    restyle(code);
    refreshThumbs();
  };
  const clearFocus = () => { if (focused) { setFocused(null); renderPanel(); } };
  map.on('click', () => {
    if (clickedCountry) { clickedCountry = false; return; }
    clearFocus();
  });
  // ---- ストリートビュー: ボタンでモードに入り、地図の青い線（ストリートビューのある道路）の近くをクリックして映像を表示
  // 映像のパネルは画面に固定（position: fixed）して、地図の外側まで動かせるようにする
  const mobileSv = () => window.matchMedia('(max-width: 760px)').matches;
  removeSvPanel();
  const svPanel = document.createElement('div');
  svPanel.className = 'sv-panel';
  svPanel.id = 'sv-panel';
  svPanel.hidden = true;
  svPanel.innerHTML = `
    <div class="sv-head" id="sv-head">
      <span class="sv-title">${SV_ICON} ストリートビュー</span>
      <span class="sv-coord muted small" id="sv-coord"></span>
      ${ctx.isEditor() ? '<button type="button" class="icon-btn sv-btn" id="sv-card" title="この場所でカードを作る（国と場所を入れた状態で作成画面を開きます）" aria-label="この場所でカードを作る">📍</button>' : ''}
      <a class="icon-btn sv-btn" id="sv-ext" target="_blank" rel="noopener" title="Google マップで開く" aria-label="Google マップで開く">↗</a>
      <button type="button" class="icon-btn sv-btn" id="sv-min" title="一時的に縮小（ヘッダーだけにする）" aria-label="縮小">—</button>
      <button type="button" class="icon-btn sv-btn" id="sv-max" title="大きく / 元の大きさ（ヘッダーのダブルクリックでも）" aria-label="大きく表示">⤢</button>
      <button type="button" class="icon-btn sv-btn" id="sv-close" title="閉じる（Esc）" aria-label="閉じる">✕</button>
    </div>
    <iframe id="sv-frame" title="Google ストリートビュー" allow="fullscreen" referrerpolicy="strict-origin-when-cross-origin"></iframe>
    <p class="sv-note muted small">ヘッダーをドラッグすると、画面のどこにでも動かせます。</p>`;
  document.body.appendChild(svPanel);
  svPanel.addEventListener('pointerdown', () => bringFront(svPanel), true); // 触ったウィンドウを手前に
  const svFrame = svPanel.querySelector('#sv-frame');
  const svBanner = $id('sv-banner');
  let svMarker = null;
  let svCoverage = null;
  let bannerTimer = null;
  const svPin = () => L.divIcon({ className: 'sv-pin', html: '<span></span>', iconSize: [22, 22], iconAnchor: [11, 11] });
  const SV_HELP = '青い線の近くをクリック';
  const SV_HELP_FAR = 'クリック付近の道路を開きます';
  const helpText = () => (map.getZoom() >= SV_LINE_ZOOM ? SV_HELP : SV_HELP_FAR);
  const bannerNote = (msg) => {
    $id('sv-banner-text').textContent = msg;
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => { bannerTimer = null; const b = $id('sv-banner-text'); if (b) b.textContent = helpText(); }, 3500);
  };
  const placePanel = () => {
    if (mobileSv()) { svPanel.style.cssText = ''; return; }
    if (!svRect) { // 最初は地図の左下に
      const br = $id('map').getBoundingClientRect();
      const w = Math.min(520, br.width - 24);
      const h = Math.min(400, br.height * 0.65);
      svRect = { left: br.left + 12, top: br.bottom - h - 12, width: w, height: h };
    }
    const r = svRect;
    Object.assign(svPanel.style, {
      left: `${Math.max(0, Math.min(window.innerWidth - 120, r.left))}px`, top: `${Math.max(0, Math.min(window.innerHeight - 60, r.top))}px`,
      width: `${r.width}px`, height: `${r.height}px`, right: 'auto', bottom: 'auto',
    });
  };
  const saveRect = () => {
    if (mobileSv() || svPanel.hidden || svPanel.classList.contains('is-max') || svPanel.classList.contains('is-min') || svPanel.classList.contains('is-snap')) return;
    const r = svPanel.getBoundingClientRect();
    svRect = { left: r.left, top: r.top, width: r.width, height: r.height };
  };
  function closeSv() {
    releaseSnap(svPanel);
    svPoint = null;
    setMin(false);
    svPanel.hidden = true;
    svFrame.src = 'about:blank';
    if (svMarker) { svMarker.remove(); svMarker = null; }
  }
  function openSv(lat, lng) {
    svPoint = [lat, lng];
    setMin(false); // 縮小していても、新しい場所を開いたら戻す
    if (svPanel.hidden) { svPanel.hidden = false; placePanel(); bringFront(svPanel); }
    svFrame.src = svEmbedUrl(lat, lng);
    svPanel.querySelector('#sv-coord').textContent = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    svPanel.querySelector('#sv-ext').href = svOpenUrl(lat, lng);
    if (svMarker) svMarker.setLatLng([lat, lng]);
    else svMarker = L.marker([lat, lng], { icon: svPin(), interactive: false, keyboard: false, zIndexOffset: 5000 }).addTo(map);
  }
  function setSv(on, init = false) {
    svOn = on;
    $id('map-sv').classList.toggle('is-on', on);
    $id('map-sv').setAttribute('aria-pressed', String(on));
    svBanner.hidden = !on;
    $id('map').classList.toggle('sv-on', on);
    if (on) {
      $id('sv-banner-text').textContent = helpText();
      if (!svCoverage) { // 青い線（ストリートビューのある道路）を地図に重ねる。拡大したら、半分の太さ（1 段細かいタイルを半分の大きさで）にする
        if (!map.getPane('svCoverage')) { const pane = map.createPane('svCoverage'); pane.style.zIndex = 450; pane.style.pointerEvents = 'none'; }
        // crossOrigin: 画素を読み取る処理（svTileAlpha）と同じ読み込み方にする（違うと、ブラウザのキャッシュのせいで読み取りに失敗することがある）
        const common = { pane: 'svCoverage', maxZoom: 19, opacity: 1, className: 'sv-coverage', keepBuffer: 1, updateWhenZooming: false, attribution: '', crossOrigin: 'anonymous' };
        const normal = L.tileLayer(SV_TILE('{x}', '{y}', '{z}'), { ...common, maxNativeZoom: 17, maxZoom: SV_THIN_ZOOM - 0.5 }).addTo(map);
        const thin = L.tileLayer(SV_TILE('{x}', '{y}', '{z}'), { ...common, minZoom: SV_THIN_ZOOM, tileSize: 128, zoomOffset: 1, maxNativeZoom: 20 }).addTo(map);
        svCoverage = L.layerGroup([normal, thin]); // まとめて外せるように
        svCoverage.remove = () => { normal.remove(); thin.remove(); };
      }
      if (!init) { clearFocus(); hideBubble(); }
    } else {
      if (svCoverage) { svCoverage.remove(); svCoverage = null; }
      hideGhost();
    }
  }
  map.on('zoomend', () => { if (svOn && !bannerTimer) $id('sv-banner-text').textContent = helpText(); });
  $id('map-sv').addEventListener('click', () => setSv(!svOn));
  $id('sv-exit').addEventListener('click', () => setSv(false));
  svPanel.querySelector('#sv-close').addEventListener('click', closeSv);
  // 「📍 この場所でカードを作る」: 国・場所の名前・Google マップのリンクを入れた作成画面を開く（画像は作成画面で選ぶ）
  svPanel.querySelector('#sv-card')?.addEventListener('click', () => {
    if (!svPoint) return;
    const [lat, lng] = svPoint;
    ctx.createCardFromSv({ lat, lng, codePromise: countryAt(lat, lng) });
  });
  svPanel.querySelector('#sv-max').addEventListener('click', () => { unsnapWindow(svPanel); setMin(false); saveRect(); svPanel.classList.toggle('is-max'); });
  // 一時的な縮小: ヘッダーだけにして、地図を見やすくする（もう一度押す・新しい場所を開くと戻る）
  function setMin(on) {
    if (on) { unsnapWindow(svPanel); saveRect(); svPanel.classList.remove('is-max'); }
    svPanel.classList.toggle('is-min', on);
    const b = svPanel.querySelector('#sv-min');
    b.textContent = on ? '□' : '—';
    b.title = on ? 'もとの大きさに戻す' : '一時的に縮小（ヘッダーだけにする）';
    b.setAttribute('aria-label', on ? 'もとの大きさに戻す' : '縮小');
  }
  svPanel.querySelector('#sv-min').addEventListener('click', () => setMin(!svPanel.classList.contains('is-min')));
  // ---- クリックしやすく: マウスを動かすと、クリックしたらどこが開くか（いちばん近い道路）を印で見せる。
  // 道路の近く（250m 以内・画面で 44px 以内）ならどこをクリックしても、その道路に寄せて開く
  let ghost = null;
  let svHoverSeq = 0;
  let svHoverPt = null; // { x, y, hit }（最後に調べたマウスの位置と、寄せ先）
  function hideGhost() { if (ghost) { ghost.remove(); ghost = null; } svHoverPt = null; $id('map')?.classList.remove('sv-hot'); }
  function showGhost(hit) {
    const ll = [hit.lat, hit.lng];
    if (ghost) ghost.setLatLng(ll);
    else ghost = L.marker(ll, { icon: L.divIcon({ className: 'sv-ghost', html: '<span></span>', iconSize: [24, 24], iconAnchor: [12, 12] }), interactive: false, keyboard: false, zIndexOffset: 4000 }).addTo(map);
  }
  let svHoverTimer = null;
  const mapEl = map.getContainer();
  mapEl.addEventListener('mousemove', (e) => {
    if (!svOn || e.buttons || e.target.closest('.leaflet-control')) return;
    clearTimeout(svHoverTimer);
    svHoverTimer = setTimeout(async () => {
      if (!svOn || map.getZoom() < SV_HOVER_MIN_ZOOM) { hideGhost(); return; } // 引いた縮尺では、動かすたびに探すと重いので印は出さない（クリックすれば探す）
      const seq = ++svHoverSeq;
      const ll = map.mouseEventToLatLng(e).wrap();
      const hit = await svFind(ll.lat, ll.lng, map.getZoom());
      if (seq !== svHoverSeq || !svOn) return;
      svHoverPt = { x: e.clientX, y: e.clientY, hit };
      if (hit) { showGhost(hit); $id('map').classList.add('sv-hot'); } else { if (ghost) { ghost.remove(); ghost = null; } $id('map').classList.remove('sv-hot'); }
    }, 40);
  });
  mapEl.addEventListener('mouseleave', () => { clearTimeout(svHoverTimer); svHoverSeq++; hideGhost(); });
  map.on('movestart zoomstart', () => { clearTimeout(svHoverTimer); svHoverSeq++; hideGhost(); });
  // 地図のクリックを横取りして（国の選択などは動かさない）、近くの青い線の地点を求める。ドラッグで動かしただけのときは開かない
  let svDown = null;
  mapEl.addEventListener('mousedown', (e) => { svDown = [e.clientX, e.clientY]; }, true);
  mapEl.addEventListener('click', async (e) => {
    if (!svOn || e.target.closest('.leaflet-control')) return;
    e.stopPropagation();
    e.preventDefault();
    if (svDown && Math.hypot(e.clientX - svDown[0], e.clientY - svDown[1]) > 5) return;
    const ll = map.mouseEventToLatLng(e).wrap();
    // さっきの「印」の近くをクリックしたなら、その印の場所へ（計算し直さない）。なければクリックした付近の道路を探す（縮尺が小さくてもよい）
    const hit = svHoverPt && Math.hypot(e.clientX - svHoverPt.x, e.clientY - svHoverPt.y) < 12 ? svHoverPt.hit : await svFind(ll.lat, ll.lng, map.getZoom());
    if (hit) openSv(hit.lat, hit.lng);
    else { // 何もない所（海・砂漠・映像のない地域など）は、開く前にお知らせ
      ctx.toast('この付近にはストリートビューがありません', 'error');
      bannerNote('付近にはありません');
    }
  }, true);
  // パネルをヘッダーのドラッグで動かす（画面のどこへでも。スマホは下に固定）
  {
    const head = svPanel.querySelector('#sv-head');
    let drag = null;
    head.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button, a') || mobileSv()) return;
      const pr = svPanel.getBoundingClientRect();
      drag = { dx: e.clientX - pr.left, dy: e.clientY - pr.top, w: pr.width, sx: e.clientX, sy: e.clientY, started: false };
      head.setPointerCapture(e.pointerId);
    });
    head.addEventListener('pointermove', (e) => {
      if (!drag) return;
      if (!drag.started) { // 少し動かしてから動かし始める（ダブルクリックで拡大するときに、位置が動かないように）
        if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) return;
        drag.started = true;
        if (isSnapped(svPanel)) { unsnapWindow(svPanel); drag.dx = Math.min(drag.dx, svRect.width / 2); drag.w = svRect.width; } // 分割から外す
        else if (svPanel.classList.contains('is-max')) { // 大きくしている途中で動かしたら元の大きさに戻す
          svPanel.classList.remove('is-max');
          placePanel();
          drag.dx = Math.min(drag.dx, svRect.width - 40);
          drag.w = svRect.width;
        }
      }
      showSnapPreview(snapSideAt(e.clientX)); // 画面の左右のはしに近いときは、離したときに入る場所を見せる
      svPanel.style.left = `${Math.max(-drag.w + 80, Math.min(window.innerWidth - 80, e.clientX - drag.dx))}px`; // 画面の端に少し残す
      svPanel.style.top = `${Math.max(0, Math.min(window.innerHeight - 40, e.clientY - drag.dy))}px`;
    });
    // ヘッダーのダブルクリックで、大きく / 元の大きさ
    head.addEventListener('dblclick', (e) => {
      if (e.target.closest('button, a')) return;
      if (svPanel.classList.contains('is-min')) { setMin(false); return; }
      unsnapWindow(svPanel);
      saveRect();
      svPanel.classList.toggle('is-max');
    });
    const endDrag = (e) => {
      if (drag?.started) {
        const side = e.type === 'pointerup' ? snapSideAt(e.clientX) : null;
        if (side) snapWindow(svPanel, side, () => { svPanel.classList.remove('is-snap'); placePanel(); }); // 画面の左右のはしで離したら、画面を分割
        else saveRect();
      }
      showSnapPreview(null);
      drag = null;
    };
    head.addEventListener('pointerup', endDrag);
    head.addEventListener('pointercancel', endDrag);
    // 角のドラッグで大きさを変えたときも覚える
    if ('ResizeObserver' in window) new ResizeObserver(() => { if (!svPanel.hidden) saveRect(); }).observe(svPanel);
  }
  if (svOn) setSv(true, true); // 地図を描き直したときも、モードと開いていた地点を引き継ぐ
  if (svPoint) openSv(svPoint[0], svPoint[1]);
  escHandler = () => { if (svPoint) closeSv(); else if (svOn) setSv(false); else clearFocus(); };
  notesHandler = () => renderInfo();
  const isVisible = (code, view) => {
    const parts = partBounds.get(code);
    if (parts) return parts.some((b) => view.intersects(b));
    const g = GEO.get(code);
    return !!g && [0, 360, -360].some((d) => view.contains([g.lat, g.lng + d]));
  };

  // ホバー: 国から国へ移るときにちらつかないよう、離れたときだけ少し待つ
  function setHover(code) {
    // スマホなど指で操作しているときはプレビューを出さない（端末の申告ではなく実際の操作で判定）
    if (!canHover || lastPointer !== 'mouse') { if (hoverCode) { hoverCode = null; hideBubble(); } return; }
    clearTimeout(hoverTimer);
    if (code) {
      if (hoverCode !== code) { hoverCode = code; showBubble(code); refreshThumbs(); }
    } else {
      hoverTimer = setTimeout(() => { hoverCode = null; hideBubble(); refreshThumbs(); }, 80);
    }
  }

  // ---- プレビューの吹き出し（カーソルに追尾）。最初は国旗と国名だけ、0.5 秒止めると詳細まで表示
  const bubble = getBubble();
  let expandTimer = null;
  // 右ボタンを押している間は、国をまたいでもすぐに詳しいプレビューを出す
  let rightHeld = false;
  map.getContainer().addEventListener('pointerdown', (e) => {
    if (e.button === 2) { rightHeld = true; if (hoverCode) expandBubble(hoverCode, true); }
  }, { capture: true });
  // 右ボタンを離したら詳しい表示を閉じて、小さい表示（国旗と国名）に戻す
  window.addEventListener('pointerup', (e) => {
    if (e.button !== 2 || !rightHeld) return;
    rightHeld = false;
    if (hoverCode) showBubble(hoverCode, true); else hideBubble();
  });
  // 地図の上ではブラウザの右クリックメニューを出さない（国の上で押して海の上で離した場合なども）
  map.getContainer().addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('blur', () => { rightHeld = false; });

  // 吹き出しの広がる・縮むアニメーションは、右ボタンを押した／離したときだけ（animate）。
  // 右ボタンを押したまま国をまたぐときは、アニメーションなしで中身だけ切り替える（扇のカードは毎回開く）
  function showBubble(code, animate = false) {
    if (rightHeld) { expandBubble(code); return; }
    clearTimeout(expandTimer);
    const n = byCountry.get(code)?.length || 0;
    bubble.dataset.code = code;
    bubble.className = `hover-bubble is-compact show${animate ? ' anim-out' : ''}${isPlayable(code) ? '' : ' no-play'}`;
    bubble.innerHTML = `<div class="hb-body hb-compact">${ctx.flagImg(code)}<b>${ctx.esc(ctx.countryName(code))}</b>${mode === 'cards' ? (n ? `<span class="hb-n">${n} 枚</span>` : '') : mode === 'match' ? (matched.has(code) ? '<span class="fact-chip">✓ 条件に当てはまる</span>' : '') : factChipHtml(mode, code)}${isPlayable(code) ? '' : '<span class="no-play-tag">出題なし</span>'}</div>`;
    placeBubble();
    scheduleExpand(code);
  }
  function expandBubble(code, animate = false) {
    clearTimeout(expandTimer);
    const fan = fanHtml(code);
    bubble.dataset.code = code;
    bubble.className = `hover-bubble is-full show${fan ? ' has-fan' : ''}${animate ? ' anim-in' : ''}${isPlayable(code) ? '' : ' no-play'}`;
    bubble.innerHTML = `${fan}<div class="hb-body">${factMode ? `<div class="pfact hb-fact">${factPanelHtml(mode, code)}</div>` : ''}${ctx.countrySummaryHtml(code)}</div>`;
    placeBubble();
  }
  // 吹き出しの右上に、その国のカードを扇状に（本体の後ろから上だけ見える）
  function fanHtml(code) {
    if (mode !== 'cards') return '';
    const list = byCountry.get(code) || [];
    if (!list.length) return '';
    const show = list.slice(0, 5);
    const n = show.length;
    const step = n > 1 ? Math.min(13, 42 / (n - 1)) : 0;
    return `<div class="hb-fan" aria-hidden="true">
      ${show.map((c, i) => {
        const angle = (i - (n - 1) / 2) * step;
        return `<div class="hb-card" style="${ctx.catVars(ctx.catOf(c))};--a:${angle.toFixed(1)}deg;z-index:${i + 1}">${ctx.thumbUrl(c) ? `<img src="${ctx.esc(ctx.thumbUrl(c))}" alt="">` : ''}</div>`;
      }).join('')}
      ${list.length > n ? `<span class="hb-fan-more">+${list.length - n}</span>` : ''}
    </div>`;
  }
  function scheduleExpand(code) {
    clearTimeout(expandTimer);
    if (!ctx.hoverAutoExpand()) return; // 設定で「止まると詳しく表示」がオフなら右クリックのときだけ
    expandTimer = setTimeout(() => { if (hoverCode === code) expandBubble(code); }, 500);
  }
  // 右クリック: 待たずにすぐ詳しいプレビューを出す（ブラウザのメニューは出さない）
  function previewNow(code, e) {
    e?.originalEvent?.preventDefault();
    // Windows では contextmenu が右ボタンを離した後に来るので、押している間（rightHeld）だけ表示する
    if (!canHover || !rightHeld || lastPointer !== 'mouse') return;
    clearTimeout(hoverTimer);
    if (e?.originalEvent) { mouse.x = e.originalEvent.clientX; mouse.y = e.originalEvent.clientY; }
    hoverCode = code;
    // 押した瞬間（pointerdown）にすでに出していれば何もしない
    if (!(bubble.classList.contains('is-full') && bubble.dataset.code === code)) expandBubble(code, true);
  }
  function hideBubble() {
    clearTimeout(expandTimer);
    bubble.classList.remove('show');
  }
  // カーソルが動いたら追尾。小さい表示のうちは、止まってから 0.5 秒で詳細に
  hoverMove = () => {
    if (!hoverCode) return;
    placeBubble();
    if (bubble.classList.contains('is-compact')) scheduleExpand(hoverCode);
  };
  map.getContainer().addEventListener('mouseleave', () => setHover(null));


  // 選んでいる国が、地図の中央付近に国全体が見える大きさで表示されているか（＝その国に合わせた位置にあるか）
  // 国の範囲のうち、今見ている位置に一番近い複製（日付変更線の向こう側を見ているときはそちら）
  function nearBounds(code) {
    const b = bounds.get(code);
    if (!b) return null;
    const d = nearestShift(b.getCenter().lng, map.getCenter().lng);
    return d ? L.latLngBounds([b.getSouth(), b.getWest() + d], [b.getNorth(), b.getEast() + d]) : b;
  }
  function nearPoint(code) {
    const g = GEO.get(code);
    return g ? L.latLng(g.lat, g.lng + nearestShift(g.lng, map.getCenter().lng)) : null;
  }

  function isAtFocus(code) {
    const size = map.getSize();
    const b = nearBounds(code);
    const g = GEO.get(code);
    const target = b ? b.getCenter() : g && nearPoint(code);
    if (!target) return false;
    const p = map.latLngToContainerPoint(target);
    const nearCenter = Math.abs(p.x - size.x / 2) < size.x * 0.25 && Math.abs(p.y - size.y / 2) < size.y * 0.25;
    const fitZoom = b ? Math.min(8, map.getBoundsZoom(b, false, L.point(80, 80))) : 8;
    return nearCenter && map.getZoom() >= fitZoom - 1;
  }

  // 国のクリック: 選んでいる国をその国に合わせた位置で押したら選択解除、それ以外はその国を選ぶ
  function toggleFocus(code) {
    if (code === focused && isAtFocus(code)) clearFocus();
    else focusCountry(code);
  }

  function focusCountry(code) {
    setFocused(code);
    renderPanel();
    const b = nearBounds(code);
    if (b) flyBounds(b, { padding: [40, 40], maxZoom: 8 });
    else {
      const p = nearPoint(code);
      if (p) fly(p, 8);
    }
  }

  // サムネイルの見え方: 選んでいる・マウスが乗っている・広げている国ははっきり、それ以外は半透明で小さめ
  function refreshThumbs() {
    for (const [code, m] of markers) {
      if (!m.revealed) continue;
      const active = code === focused || code === hoverCode || code === flashedCode || m.expanded;
      const scale = (m.scale || 0.58) * (active ? 1 : 0.78);
      for (const mk of m.markers) {
        const el = mk.getElement()?.querySelector('.map-thumbs');
        if (!el) continue;
        el.style.transform = `scale(${scale.toFixed(2)})`;
        el.classList.toggle('is-dim', !active);
        mk.setZIndexOffset(Math.round(scale * 100) + (active ? 1000 : 0));
      }
    }
  }
  function prepareThumbs(m) {
    for (const mk of m.markers) {
      const el = mk.getElement();
      const grid = el?.querySelector('.map-thumbs-grid');
      // ホイール: 広げた欄の中でまだスクロールできる向きなら欄をスクロール、それ以外は地図をズーム
      if (grid && !grid.dataset.wheelBound) {
        grid.dataset.wheelBound = '1';
        grid.addEventListener('wheel', (e) => {
          // スクロールするのは広げた欄だけ（通常の欄は、拡大表示したサムネイルではみ出して見えても動かない）
          if (!grid.closest('.is-expanded')) return;
          const canScroll = (e.deltaY > 0 && grid.scrollTop + grid.clientHeight < grid.scrollHeight - 1)
            || (e.deltaY < 0 && grid.scrollTop > 0);
          if (canScroll) e.stopPropagation();
        }, { passive: true });
      }
      // 広げた欄からカーソルが外れたら閉じる（少し待って、すぐ戻ってきたら閉じない）
      if (el && !el.dataset.leaveBound) {
        el.dataset.leaveBound = '1';
        el.addEventListener('mouseleave', () => {
          if (!m.expanded) return;
          clearTimeout(m.leaveTimer);
          m.leaveTimer = setTimeout(() => { if (m.expanded) toggleExpand(m.code); }, 300);
        });
        el.addEventListener('mouseenter', () => clearTimeout(m.leaveTimer));
      }
    }
  }
  // 開閉は要素を作り直さず中身だけ入れ替える（作り直すと大きさのアニメーションが最初からになり、一瞬消えて見える）
  function toggleExpand(code) {
    const m = markers.get(code);
    if (!m) return;
    m.expanded = !m.expanded;
    const icon = thumbsIcon(L, ctx, code, m.list, m.expanded);
    const tmp = document.createElement('div');
    tmp.innerHTML = icon.options.html;
    const fresh = tmp.querySelector('.map-thumbs');
    for (const mk of m.markers) {
      const el = mk.getElement();
      const inner = el?.querySelector('.map-thumbs');
      if (!inner) continue;
      inner.classList.toggle('is-expanded', m.expanded);
      inner.innerHTML = fresh.innerHTML;
      el.style.width = `${icon.options.iconSize[0]}px`;
      el.style.marginLeft = `${-icon.options.iconAnchor[0]}px`;
      mk.options.icon = icon; // 以後の setIcon と整合させる
    }
    prepareThumbs(m);
    refreshThumbs();
  }

  function update() {
    const z = map.getZoom();
    const view = map.getBounds().pad(0.1);
    for (const [code, m] of markers) {
      const rz = revealZoom(code);
      const rev = z >= rz;
      if (rev !== m.revealed) {
        m.revealed = rev;
        if (!rev) m.expanded = false;
        for (const mk of m.markers) mk.setIcon(rev ? thumbsIcon(L, ctx, code, m.list, m.expanded) : countIcon(L, code, m.list.length));
        if (rev) prepareThumbs(m);
      }
      // 地図の縮尺に合わせてサムネイルの大きさを変える（現れた直後は小さめ、拡大するほど大きく）
      if (rev) m.scale = Math.min(1.44, Math.max(0.58, 0.58 * 2 ** ((z - rz) * 0.5)));
    }
    refreshThumbs();
    // 選んでいる国が表示範囲から完全に外れたら選択を解除
    const strictView = map.getBounds();
    if (focused && !isVisible(focused, strictView)) setFocused(null);
    // 表示範囲に一部でもかかっている国を、画面中央に近い順に（世界全体ほど縮小しているときは出さない）
    const center = map.getCenter();
    const shown = [];
    if (z >= 3) {
      for (const code of GEO.keys()) {
        if (!isVisible(code, strictView)) continue;
        const g = GEO.get(code);
        shown.push({ code, d: center.distanceTo([g.lat, g.lng + nearestShift(g.lng, center.lng)]) });
      }
    }
    shown.sort((a, b) => a.d - b.d);
    shownTotal = shown.length;
    shownCodes = shown.slice(0, 80).map((x) => x.code); // 実際に出す数は renderList でパネルの高さに合わせて決める
    renderPanel();
  }

  // ---- 右パネル: 上段 = 選択中の国の情報（なければ案内）、下段 = 選択中の国のカード or 表示中の国の一覧
  function renderPanel() {
    renderInfo();
    renderList();
  }

  function renderInfo() {
    const el = $id('pinfo');
    if (!el) return;
    const code = focused;
    el.classList.toggle('is-empty', !code);
    el.classList.toggle('is-focused', !!code);
    if (!code) {
      el.innerHTML = canHover
        ? '<div class="pinfo-empty"><div class="pinfo-globe">🌍</div>国の情報がここに表示されます<small>国をクリック・検索すると表示（マウスを乗せると吹き出しでプレビュー）</small></div>'
        : '';
      return;
    }
    el.innerHTML = (!factMode ? '' : `<div class="pfact">${factPanelHtml(mode, code)}${modeDef(mode).editable && ctx.isEditor() ? `<button type="button" class="btn btn-sm pfact-edit" data-edit-fact>✏️ 編集</button>` : ''}</div>`)
      + ctx.countrySummaryHtml(code)
      + '<button type="button" class="icon-btn pinfo-close" title="選択を解除（Esc）" aria-label="選択を解除">✕</button>';
    el.querySelector('[data-edit-fact]')?.addEventListener('click', () => ctx.editFact(mode, code));
    // 参考写真（スイッチがオンのとき）
    if (photoOn) {
      const photos = photoList(code);
      el.querySelector('.pfact')?.insertAdjacentHTML('afterend', photos.length
        ? `<div class="pphotos"><div class="pphotos-head">📷 参考写真 <a href="${REF_PAGES[mode]}" target="_blank" rel="noopener" class="muted small">GeoHints ↗</a></div><div class="pphotos-grid">${photos.map((p) => { const n = ctx.photoNote(mode, p.src, code); return `<button type="button" class="pphoto ${n ? 'has-note' : ''}" data-src="${ctx.esc(p.src)}" title="${ctx.esc(n || '参考写真（GeoHints）')}"><img src="${ctx.esc(p.src)}" alt="" loading="lazy"></button>`; }).join('')}</div></div>`
        : '<div class="pphotos muted small">この国の参考写真はありません</div>');
      el.querySelectorAll('.pphoto').forEach((b, i) => b.addEventListener('click', () => ctx.openPhoto(mode, code, photos.map((p) => p.src), i, b)));
    } else if (mode === 'guardrail') {
      const url = plonkitUrl(code);
      if (url) el.querySelector('.pfact')?.insertAdjacentHTML('beforeend', `<a class="pfact-link" href="${url}" target="_blank" rel="noopener">Plonkit でガードレールの写真を見る ↗</a>`);
    }
    el.scrollTop = 0;
    el.querySelector('.pinfo-close')?.addEventListener('click', clearFocus);
    el.querySelector('[data-more]')?.addEventListener('click', (e) => ctx.openCountry(code, e.currentTarget));
    el.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => ctx.openCountry(code, b, b.dataset.lang)));
    el.querySelectorAll('[data-focus]').forEach((b) => b.addEventListener('click', () => focusCountry(b.dataset.focus)));
  }

  // 中心に近い国から順に、スクロールしなくても入り切る数だけ残す（スマホは縦に並ぶので最大 12 か国）
  function fitList(el) {
    const rows = [...el.querySelectorAll('.crow')];
    if (getComputedStyle(el).overflowY === 'visible') {
      rows.slice(12).forEach((r) => r.remove());
    } else {
      while (rows.length > 1 && el.scrollHeight > el.clientHeight + 1) rows.pop().remove();
    }
    const n = el.querySelectorAll('.crow').length;
    const note = el.querySelector('.list-note');
    if (note && n < shownTotal) note.textContent = `（中心に近い ${n} か国）`;
  }

  function renderList() {
    const el = $id('plist');
    if (!el) return;
    if (mode === 'match' && !focused) {
      const codes = [...matched].sort((a, b) => ctx.countryName(a).localeCompare(ctx.countryName(b), 'ja'));
      const n = Object.values(conds).filter(Boolean).length;
      el.innerHTML = !n ? '<p class="muted small">左下の欄で条件を選ぶと、すべてに当てはまる国が緑色になります</p>'
        : `<h3 class="list-title">当てはまる国 <span class="muted">${codes.length}</span></h3>
          ${codes.length ? `<div class="fgroup-codes">${codes.map((c) => `<button type="button" class="chip chip-btn" data-go="${c}">${ctx.flagImg(c)}${ctx.esc(ctx.countryName(c))}</button>`).join('')}</div>` : '<p class="muted small">当てはまる国はありません。条件を減らしてみてください</p>'}`;
      el.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => focusCountry(b.dataset.go)));
      return;
    }
    if (mode !== 'cards' && !focused) {
      // インフォグラフィック: 分類ごとに国を並べる（表示中の国を先に）
      const all = [...new Set([...GEO.keys()])];
      const groups = legendGroups(mode, all);
      const shownSet = new Set(shownCodes);
      el.innerHTML = groups.length ? groups.map((g) => {
        const codes = [...g.codes].sort((a, b) => (shownSet.has(b) - shownSet.has(a)) || ctx.countryName(a).localeCompare(ctx.countryName(b), 'ja'));
        return `<div class="fgroup">
          <div class="fgroup-head">${factChipHtml(mode, g.codes[0]).replace(/<small class="seed-tag"[^>]*>[^<]*<\/small>/, '')}<span class="muted small">${g.codes.length} か国</span></div>
          <div class="fgroup-codes">${codes.map((c) => `<button type="button" class="chip chip-btn ${shownSet.has(c) ? '' : 'is-off'}" data-go="${c}">${ctx.flagImg(c)}${ctx.esc(ctx.countryName(c))}</button>`).join('')}</div>
        </div>`;
      }).join('') : `<p class="muted small">${mode === 'weak' ? '暗記カードの「覚えた / まだ」やクイズの結果が、ここに国ごとに出ます' : modeDef(mode).editable ? 'まだ登録がありません。国を選んで「編集」から登録できます' : 'データがありません'}</p>`;
      el.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => focusCountry(b.dataset.go)));
      return;
    }
    if (focused) {
      const all = byCountry.get(focused) || [];
      const catsHere = ctx.allCats().filter((k) => all.some((x) => ctx.catKey(x) === k.id));
      const list = all.filter((x) => !focusCat || ctx.catKey(x) === focusCat);
      el.innerHTML = `
        <h3 class="panel-title">${ctx.flagImg(focused)}${ctx.esc(ctx.countryName(focused))} のカード <span class="muted">${all.length} 枚</span></h3>
        ${catsHere.length > 1 ? `<div class="region-chips cat-chips focus-cats">
          <button class="chip chip-btn ${focusCat ? '' : 'on'}" data-fcat="">すべて</button>
          ${catsHere.map((k) => `<button class="chip chip-btn chip-cat ${focusCat === k.id ? 'on' : ''}" data-fcat="${k.id}" style="${ctx.catVars(k)}"><span class="cat-dot"></span>${ctx.esc(k.name)}</button>`).join('')}
        </div>` : ''}
        ${list.length ? `<div class="tiles tiles-compact">${list.map((c) => ctx.tileHtml(c)).join('')}</div>` : '<p class="muted small">この国のカードはまだありません</p>'}`;
      el.querySelectorAll('[data-fcat]').forEach((b) => b.addEventListener('click', () => { focusCat = b.dataset.fcat || null; renderList(); }));
      ctx.bindTiles();
      return;
    }
    if (!shownCodes.length) {
      const top = [...byCountry.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 40);
      el.innerHTML = `
        <h3 class="list-title">カードがある国 <span class="muted">${byCountry.size}</span></h3>
        ${top.length ? `<div class="map-country-list">
          ${top.map(([code, list]) => `<button class="chip chip-btn" data-go="${code}" data-hover="${code}">${ctx.flagImg(code)}${ctx.esc(ctx.countryName(code))} <span class="muted">${list.length}</span></button>`).join('')}
        </div>` : '<p class="muted small">まだカードがありません</p>'}`;
    } else {
      // 表示中の国をコンパクトに: 1行に国名・枚数・Plonkit、その下に小さなサムネイル
      el.innerHTML = `
        <h3 class="list-title">表示中の国 <span class="muted">${shownTotal}</span> <span class="muted small list-note"></span></h3>
        <div class="clist">
          ${shownCodes.map((code) => {
            const list = byCountry.get(code) || [];
            const url = plonkitUrl(code);
            const show = list.slice(0, 8);
            return `
              <div class="crow" data-hover="${code}">
                <div class="crow-head">
                  <button type="button" class="crow-name${isPlayable(code) ? '' : ' is-no-play'}" data-go="${code}" title="${isPlayable(code) ? 'この国を選ぶ' : 'この国を選ぶ（GeoGuessr では出題なし）'}">${ctx.flagImg(code)}<span>${ctx.esc(ctx.countryName(code))}</span></button>
                  <span class="crow-n">${list.length ? `${list.length} 枚` : '—'}</span>
                  ${url ? `<a class="ext-link" href="${url}" target="_blank" rel="noopener" title="Plonkit で開く">${EXT_ICON}</a>` : ''}
                </div>
                ${show.length ? `<div class="crow-thumbs">
                  ${show.map((c) => `<button type="button" class="crow-thumb" data-card="${c.id}" style="${ctx.catVars(ctx.catOf(c))}" title="${ctx.esc(c.description || ctx.catOf(c).name)}">${ctx.thumbUrl(c) ? `<img src="${ctx.esc(ctx.thumbUrl(c))}" alt="" loading="lazy">` : ''}</button>`).join('')}
                  ${list.length > show.length ? `<button type="button" class="crow-more" data-go="${code}">+${list.length - show.length}</button>` : ''}
                </div>` : ''}
              </div>`;
          }).join('')}
        </div>`;
      fitList(el);
      el.querySelectorAll('[data-card]').forEach((b) => b.addEventListener('click', () => {
        const card = ctx.cards.find((c) => c.id === b.dataset.card);
        const code = b.closest('[data-hover]')?.dataset.hover;
        if (card) ctx.openCard(card, b, (byCountry.get(code) || [card]).map((c) => c.id));
      }));
    }
    el.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => focusCountry(b.dataset.go)));
    if (canHover) {
      el.querySelectorAll('[data-hover]').forEach((r) => {
        r.addEventListener('mouseenter', () => setHover(r.dataset.hover));
        r.addEventListener('mouseleave', () => setHover(null));
      });
    }
  }

  map.on('zoomend moveend', update);
  // 移動・拡大縮小が途中で打ち切られる（検索で次々に国へ飛ぶなど）と、塗りを描くキャンバスの位置が
  // 古いまま残り、国の塗りが地図とずれることがある。終わるたびに必ず位置を計算し直す
  // （重い処理なので、実際に位置・縮尺が食い違っているときだけ）
  const resyncRenderer = () => requestAnimationFrame(() => {
    const r = map && map._renderer;
    if (!r || !r._reset || map._animatingZoom) return;
    const stale = r._zoom !== map.getZoom() || !r._center || map.getCenter().distanceTo(r._center) > 1
      || /scale\((?!1\))/.test(r._container?.style.transform || '');
    if (stale) r._reset();
  });
  map.on('zoomend moveend viewreset resize', resyncRenderer);
  map.on('moveend zoomend', () => drawCountries());
  if ('ResizeObserver' in window) {
    let lastH = 0;
    new ResizeObserver(() => {
      const el = $id('plist');
      if (el && el.clientHeight !== lastH) { lastH = el.clientHeight; if (!focused) renderList(); }
    }).observe($id('plist'));
  }
  update();

  ctx.bindFilterPicks(() => refreshMap(view, ctx)); // 絞り込みを変えても表示位置・選んでいる国はそのまま

  // ---- 国の検索バー（補完付き）
  // Enter: その国へ移動 / Ctrl(⌘)+Enter: Plonkit / Alt+Enter: 国の詳細。補完・候補選択で国名が確定したら自動で移動
  const ms = $id('map-search');
  ctx.attachComplete(ms, { regions: false, ja: true });
  // 候補の国を黄色く光らせる（候補が変わったら前の国はすぐ戻す）
  // 検索中（入力欄にカーソルがある間）は光り続け、検索欄から離れたら少しして消える
  const FLASH_STYLE = { stroke: true, weight: 3, color: '#f5c400', fillColor: '#f5c400', fillOpacity: 0.35 };
  let flashTimer = null;
  const unflash = () => { for (const l of flashed || []) layer.resetStyle(l); flashed = null; flashedCode = null; refreshThumbs(); };
  const flash = (code) => {
    unflash();
    clearTimeout(flashTimer);
    const lyrs = layersByCode.get(code);
    if (!lyrs) return;
    for (const l of lyrs) l.setStyle(FLASH_STYLE);
    flashed = lyrs;
    flashedCode = code;
    refreshThumbs();
    if (document.activeElement !== ms) flashTimer = setTimeout(unflash, 1800);
  };
  const goTo = (code) => {
    focusCountry(code);
    flash(code);
  };
  // 入力に合わせて最上位の候補の国へリアルタイムに移動
  // Esc で検索をやめたら、検索を始める前の場所に戻る。Enter で確定・入力欄から離れたらその場所のまま
  let lastAuto = null;
  let origin = null;
  let timer = null;
  ms.addEventListener('focus', () => { if (!origin) origin = { center: map.getCenter(), zoom: map.getZoom() }; });
  ms.addEventListener('blur', () => {
    clearTimeout(timer);
    origin = null;
    clearTimeout(flashTimer);
    if (flashed) flashTimer = setTimeout(unflash, 1800);
  });
  ms.addEventListener('input', () => {
    clearTimeout(timer);
    if (!ms.value.trim()) { lastAuto = null; return; }
    // 「ww」: 世界全体を表示して検索を終える（日本語入力中の「ｗｗ」「っｗ」も）
    if (/^(ww|ｗｗ|っw|っｗ)$/i.test(ms.value.trim())) {
      lastAuto = null;
      clearFocus();
      unflash();
      fly([25, 10], 2);
      ms.blur(); // 入力中の変換も確定させてから消す
      setTimeout(() => { ms.value = ''; ms.dispatchEvent(new Event('input')); }, 0);
      return;
    }
    // 入力のたびにすぐ移動（候補が変わったときだけ）。設定でオフなら Enter まで待つ
    if (!ctx.liveSearch()) return;
    const code = ctx.resolveCountry(ms.value);
    if (code && code !== lastAuto) { lastAuto = code; goTo(code); }
  });
  // 検索をやめる（Esc・入力欄の ✕）: ハイライトを消して、検索前の場所に戻る
  const cancelSearch = () => {
    clearFocus();
    clearTimeout(timer);
    clearTimeout(flashTimer);
    unflash();
    if (origin) {
      const o = origin;
      if (anim) map.flyTo(o.center, o.zoom, { duration: 0.6 }); else map.setView(o.center, o.zoom, { animate: false });
    }
    ms.value = '';
    ms.dispatchEvent(new Event('input'));
    lastAuto = null;
    ms.blur();
  };
  ms.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    cancelSearch();
  });
  // 入力欄の ✕（ブラウザ標準のクリアボタン）は search イベントで値が空になる
  ms.addEventListener('search', () => { if (!ms.value) cancelSearch(); });
  ms.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    if (!ms.value.trim()) { ms.blur(); return; } // 空のまま Enter: 入力をやめる
    const code = ctx.resolveCountry(ms.value);
    if (!code) { ctx.toast('国が見つかりません', 'error'); return; }
    clearTimeout(timer);
    const moved = lastAuto === code;
    lastAuto = code; // 先に記録して、下の input イベントで二重に移動しないように
    ms.value = ctx.countryName(code);
    ms.dispatchEvent(new Event('input')); // 補完の薄い文字を更新
    clearTimeout(timer);
    if (e.ctrlKey || e.metaKey) { openPlonkit(code, ctx); return; }
    if (e.altKey) { ctx.openCountry(code, ms); return; }
    if (!moved) goTo(code);
    else flash(code); // 入力中にすでに移動済みでも、確定したことが分かるようにもう一度光らせる
    // 確定したら検索バーを空にして入力を終える（国の選択はそのまま。続けて文字を打てば次の検索）
    ms.blur();
    ms.value = '';
    ms.dispatchEvent(new Event('input'));
  });
  $id('map-world').addEventListener('click', () => { clearFocus(); fly([25, 10], 2); });
  // 右パネルの上（国の情報）と下（カード・一覧）の高さの割合をドラッグで変える
  {
    const panel = $id('map-panel');
    const bar = $id('psplit');
    const DEFAULT = 0.36;
    const apply = (r) => panel.style.setProperty('--pinfo-h', `${(r * 100).toFixed(1)}%`);
    const clamp = (r) => Math.min(0.85, Math.max(0.12, r));
    const commit = (r) => { ctx.setPanelSplit(r); renderPanel(); }; // 一覧は高さに合わせて数を決めるので描き直す
    let dragging = false;
    let ratio = ctx.panelSplit();
    let lastDown = 0;
    bar.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      // 2 回続けて押したら元の高さに戻す（pointerdown を止めると dblclick が来ないため自前で判定）
      if (Date.now() - lastDown < 350) { lastDown = 0; ratio = DEFAULT; apply(ratio); commit(ratio); return; }
      lastDown = Date.now();
      dragging = true;
      bar.setPointerCapture(e.pointerId);
      bar.classList.add('is-dragging');
    });
    bar.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const r = panel.getBoundingClientRect();
      ratio = clamp((e.clientY - r.top) / r.height);
      apply(ratio);
    });
    const end = () => { if (!dragging) return; dragging = false; bar.classList.remove('is-dragging'); commit(ratio); };
    bar.addEventListener('pointerup', end);
    bar.addEventListener('pointercancel', end);
    bar.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      ratio = clamp(ratio + (e.key === 'ArrowDown' ? 0.05 : -0.05));
      apply(ratio);
      commit(ratio);
    });
  }
  $id('map-photos')?.addEventListener('change', (e) => { ctx.setMapPhotos(e.target.checked); refreshMap(view, ctx); });
  $id('map-mode').addEventListener('change', (e) => {
    ctx.setMapMode(e.target.value);
    refreshMap(view, ctx); // 表示位置・選んでいる国はそのまま
  });
  // 凡例: 小さい画面では開閉式（最初は閉じておく）
  view.querySelector('#map-legend .lg-title')?.addEventListener('click', (e) => {
    legendOpen = !legendOpen;
    legendOpenPref = legendOpen;
    e.currentTarget.parentElement.classList.toggle('is-open', legendOpen);
    e.currentTarget.setAttribute('aria-expanded', String(legendOpen));
  });
  const legendItems = view.querySelector('#map-legend .lg-items');
  if (legendItems && mode === 'match') {
    const all = [...GEO.keys()];
    legendItems.innerHTML = `<div class="match-form">${MATCH_TOPICS.map((t) => `
      <label class="match-row"><span>${modeDef(t).icon} ${modeDef(t).name}</span>
        <select class="select select-sm" data-topic="${t}">
          <option value="">指定しない</option>
          ${matchOptions(t, all).map((o) => `<option value="${ctx.esc(o.key)}" ${conds[t] === o.key ? 'selected' : ''}>${ctx.esc(o.label)}</option>`).join('')}
        </select></label>`).join('')}
      <div class="match-foot"><b>${matched.size}</b> か国が当てはまる<button type="button" class="btn btn-ghost btn-sm" id="match-clear">条件をクリア</button></div></div>`;
    legendItems.querySelectorAll('select[data-topic]').forEach((sel) => sel.addEventListener('change', () => { ctx.setMatchCond(sel.dataset.topic, sel.value); refreshMap(view, ctx); }));
    legendItems.querySelector('#match-clear').addEventListener('click', () => { ctx.clearMatch(); refreshMap(view, ctx); });
  } else if (legendItems) legendItems.innerHTML = legendHtml(mode, [...GEO.keys()]);
  currentFocus = null;
  if (restoreFocus && bounds.has(restoreFocus)) { setFocused(restoreFocus); renderPanel(); }
  restoreFocus = null;
  if (pendingFocus) { const c = pendingFocus; pendingFocus = null; focusCountry(c); }

  // 精細な国境データ（約 1MB）は、拡大して使う縮尺（HI_ZOOM）の 1 段手前まで寄ったときに初めて読み込み、
  // 届いたら差し替える（選択・強調・ホバーの状態は引き継ぐ）。世界全体を見ているだけなら読み込まない
  let hiLoading = false;
  const maybeLoadHi = () => {
    if (patternMode || worlds.hi || hiLoading || !map || map.getZoom() < HI_ZOOM - 1) return;
    hiLoading = true;
    loadWorld('10m').then((w10) => {
      if (seq !== renderSeq || !map || !layer) return;
      worlds.hi = w10;
      drawCountries(true);
      resyncRenderer();
    }).catch(() => { hiLoading = false; /* 取得できなければ 50m のまま（次に拡大したとき再挑戦） */ });
  };
  map.on('zoomend', maybeLoadHi);
  maybeLoadHi();
  // レイアウト確定後にサイズを再計算
  setTimeout(() => map && map.invalidateSize(), 50);
}

function $id(id) { return document.getElementById(id); }

// 日付変更線（経度±180°）をまたぐ線で経度が +180 → -180 と飛ぶと、地図を横切る水平線が描かれてしまう
// （ロシアのチュコト、フィジーなど）。隣り合う点の経度差が 180° を超えたら 360° ずらして連続させる
function unwrapLine(coords) {
  let min = coords[0]?.[0] ?? 0;
  let max = min;
  for (let i = 1; i < coords.length; i++) {
    const prev = coords[i - 1][0];
    let lng = coords[i][0];
    while (lng - prev > 180) lng -= 360;
    while (lng - prev < -180) lng += 360;
    coords[i][0] = lng;
    if (lng < min) min = lng;
    if (lng > max) max = lng;
  }
  // 連続させた結果、線全体が地図 1 周分ずれていたら（始点が日付変更線の反対側だった場合）戻す
  const mid = (min + max) / 2;
  const shift = mid > 180 ? -360 : mid < -180 ? 360 : 0;
  if (shift) for (const c of coords) c[0] += shift;
}
function unwrapGeometry(g) {
  if (!g) return;
  if (g.type === 'Polygon' || g.type === 'MultiLineString') g.coordinates.forEach(unwrapLine);
  else if (g.type === 'MultiPolygon') {
    g.coordinates.forEach((poly) => poly.forEach(unwrapLine));
    attachToMainland(g.coordinates);
  } else if (g.type === 'LineString') unwrapLine(g.coordinates);
}

// 日付変更線で分割された国（ロシアのチュコト東端、フィジー、アリューシャン列島など）は、
// 分かれた部分が地図の反対側に描かれて本体が途中で切れて見えるので、本体（一番大きい部分）の隣へ 360° ずらす
function attachToMainland(polys) {
  const span = (ring) => {
    let min = Infinity;
    let max = -Infinity;
    for (const [lng] of ring) { if (lng < min) min = lng; if (lng > max) max = lng; }
    return { min, max, mid: (min + max) / 2, w: max - min };
  };
  let main = null;
  let best = -1;
  for (const poly of polys) {
    const sp = span(poly[0]);
    if (sp.w > best) { best = sp.w; main = sp; }
  }
  if (!main) return;
  for (const poly of polys) {
    const d = span(poly[0]).mid - main.mid;
    const shift = d > 180 ? -360 : d < -180 ? 360 : 0;
    if (shift) for (const ring of poly) for (const c of ring) c[0] += shift;
  }
}

// 複数の島などからなる国は、一番大きい部分にズームする（アラスカや海外領土に引っぱられないように）
function largestPartBounds(L, lyr) {
  const latlngs = lyr.getLatLngs();
  let best = null;
  let bestArea = -1;
  const walk = (arr) => {
    if (!arr.length) return;
    if (arr[0] instanceof L.LatLng) {
      const b = L.latLngBounds(arr);
      const area = (b.getNorth() - b.getSouth()) * (b.getEast() - b.getWest());
      if (area > bestArea) { bestArea = area; best = b; }
      return;
    }
    arr.forEach(walk);
  };
  walk(latlngs);
  return best || lyr.getBounds();
}

// ---- 地図の隣の 1 周分に置く複製
function mapCoords(g, fn) {
  const walk = (a) => (typeof a[0] === 'number' ? fn(a) : a.map(walk));
  return { ...g, coordinates: walk(g.coordinates) };
}
const shiftGeometry = (g, d) => mapCoords(g, ([lng, lat]) => [lng + d, lat]);
function shiftFeature(f, d) {
  return { ...f, geometry: shiftGeometry(f.geometry, d), properties: { ...f.properties, copy: d } };
}
// ポリゴンの各部分（外周）の範囲 [[south, west], [north, east]]
function geometryPartBounds(g) {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  return polys.map((poly) => {
    let w = Infinity; let e = -Infinity; let so = Infinity; let n = -Infinity;
    for (const [lng, lat] of poly[0]) { if (lng < w) w = lng; if (lng > e) e = lng; if (lat < so) so = lat; if (lat > n) n = lat; }
    return window.L.latLngBounds([so, w], [n, e]);
  });
}
function lngRange(g) {
  let west = Infinity;
  let east = -Infinity;
  mapCoords(g, (c) => { if (c[0] < west) west = c[0]; if (c[0] > east) east = c[0]; return c; });
  return [west, east];
}
// 3 つの複製（-360, 0, +360）のうち、経度 refLng に一番近いもの
const nearestShift = (lng, refLng) => [0, 360, -360].reduce((best, d) => (Math.abs(lng + d - refLng) < Math.abs(lng + best - refLng) ? d : best), 0);

// 国のすべての部分（本土・島など）の範囲
function allPartBounds(L, lyr) {
  const out = [];
  const walk = (arr) => {
    if (!arr.length) return;
    if (arr[0] instanceof L.LatLng) { out.push(L.latLngBounds(arr)); return; }
    arr.forEach(walk);
  };
  walk(lyr.getLatLngs());
  return out;
}

function countIcon(L, code, n) {
  const size = n >= 100 ? 28 : n >= 10 ? 23 : 19;
  return L.divIcon({
    className: 'map-count',
    html: `<span>${n}</span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

// expanded: 「ほか N 枚」を押して全カードを 1 行 3 枚で広げた状態（長いときは中でスクロール）
function thumbsIcon(L, ctx, code, list, expanded = false) {
  const show = expanded ? list : list.slice(0, 4);
  const more = list.length - Math.min(list.length, 4);
  const cols = expanded ? 3 : show.length === 1 ? 1 : 2;
  const w = expanded ? 236 : cols === 1 ? 120 : 172;
  const html = `
    <div class="map-thumbs${expanded ? ' is-expanded' : ''}">
      <div class="map-thumbs-head">${ctx.flagImg(code)}<span>${ctx.esc(ctx.countryName(code))}</span><span class="map-thumbs-n">${list.length}</span></div>
      <div class="map-thumbs-grid" style="grid-template-columns:repeat(${cols},1fr)">
        ${show.map((c) => (c.photo
          ? `<div class="map-thumb is-photo" data-card="${c.id}" title="参考写真（GeoHints）"><img src="${ctx.esc(c.src)}" alt="" loading="lazy"></div>`
          : `<div class="map-thumb" data-card="${c.id}" style="${ctx.catVars(ctx.catOf(c))}" title="${ctx.esc(ctx.catOf(c).name)}">${ctx.thumbUrl(c) ? `<img src="${ctx.esc(ctx.thumbUrl(c))}" alt="">` : ''}</div>`)).join('')}
      </div>
      ${more > 0 ? `<div class="map-thumbs-more" data-expand>${expanded ? '閉じる ▲' : `ほか ${more} 枚 ▼`}</div>` : ''}
    </div>`;
  return L.divIcon({ className: 'map-thumbs-icon', html, iconSize: [w, 0], iconAnchor: [w / 2, 20] });
}
