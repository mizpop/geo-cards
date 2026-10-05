// 地図で答えるクイズ用の小さな世界地図（国をクリックして回答）
import { loadLibs, loadWorld, isDark, addBaseTiles } from './map.js';
import { GEO } from './geo.js';

let lastView = null; // 同じ問題の中（答えた後の再描画など）では表示位置を引き継ぐ
let lastQ = null; // 問題が変わったら世界全体の表示に戻す

// 2 点間の距離（km）
function distanceKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
// 答えた国から一番近い正解の国までの距離
export function nearestKm(given, answers) {
  const g = GEO.get(given);
  if (!g) return null;
  let best = null;
  for (const code of answers) {
    const a = GEO.get(code);
    if (!a) continue;
    const d = distanceKm(g, a);
    if (best === null || d < best) best = d;
  }
  return best;
}

// el に地図を作る。answered があれば正解（緑）と答えた国（赤）を塗って両方が見えるように移動
// onPick(code): 国がクリックされたとき（回答前だけ）
export async function mountQuizMap(el, { answers, answered, onPick, animate = true, qid = null }) {
  await loadLibs();
  const world = await loadWorld('50m');
  if (!el.isConnected) return null;
  const L = window.L;
  const map = L.map(el, {
    worldCopyJump: true, minZoom: 1, maxZoom: 8, zoomSnap: 0.5, preferCanvas: true,
    zoomAnimation: animate, fadeAnimation: animate, attributionControl: false,
  });
  window.__quizMap = map; // 動作確認用
  el.classList.toggle('map-dark', isDark());
  L.control.attribution({ prefix: false }).addTo(map);
  addBaseTiles(map);
  if (qid !== lastQ) { lastView = null; lastQ = qid; }
  if (lastView) map.setView(lastView.center, lastView.zoom, { animate: false });
  else map.setView([25, 10], 1.5, { animate: false });
  map.on('moveend', () => { lastView = { center: map.getCenter(), zoom: map.getZoom() }; });

  const given = answered ? new Set(answered.given) : new Set();
  const correct = new Set(answers);
  const accent = '#2f9e44';
  const style = (f) => {
    const code = f.properties.code;
    if (answered && correct.has(code)) return { stroke: true, color: accent, weight: 2, fillColor: accent, fillOpacity: 0.55 };
    if (answered && given.has(code)) return { stroke: true, color: '#e03131', weight: 2, fillColor: '#e03131', fillOpacity: 0.5 };
    return { stroke: false, fillColor: '#3b82f6', fillOpacity: 0 };
  };
  const features = [...world.fc.features, ...world.copyFc.features].filter((f) => f.properties.code);
  const layer = L.geoJSON({ type: 'FeatureCollection', features }, {
    style,
    smoothFactor: 1.5,
    onEachFeature: (f, lyr) => {
      if (answered) return;
      lyr.on('mouseover', () => lyr.setStyle({ fillOpacity: 0.28, stroke: true, color: '#3b82f6', weight: 1.5 }));
      lyr.on('mouseout', () => layer.resetStyle(lyr));
      lyr.on('click', () => onPick?.(f.properties.code));
    },
  }).addTo(map);

  if (answered) {
    // 正解と答えた国が両方収まるように
    let b = null;
    layer.eachLayer((lyr) => {
      const code = lyr.feature.properties.code;
      if (!correct.has(code) && !given.has(code)) return;
      // 日付変更線の反対側の複製は、今の中心に近い方だけ使う
      const lb = lyr.getBounds();
      if (Math.abs(lb.getCenter().lng - map.getCenter().lng) > 180) return;
      b = b ? b.extend(lb) : L.latLngBounds(lb.getSouthWest(), lb.getNorthEast());
    });
    if (b) {
      if (animate) map.flyToBounds(b, { padding: [30, 30], maxZoom: 5, duration: 0.7 });
      else map.fitBounds(b, { padding: [30, 30], maxZoom: 5, animate: false });
    }
  }
  setTimeout(() => map.invalidateSize(), 50);
  new ResizeObserver(() => map.invalidateSize()).observe(el); // 地図の大きさが変わったとき（右下の小さい地図が広がるとき）に合わせる
  return map;
}

// 撮影地点を当てる: 地図のどこでもクリックしてピンを置き、ボタンで回答。answered なら答えた地点と正解の地点を線で結ぶ
export async function mountPinMap(el, { answer, guess, onPlace, animate = true, qid = null }) {
  await loadLibs();
  if (!el.isConnected) return null;
  const L = window.L;
  const map = L.map(el, { worldCopyJump: true, minZoom: 1, maxZoom: 17, zoomSnap: 0.5, zoomAnimation: animate, fadeAnimation: animate, attributionControl: false });
  window.__quizMap = map;
  el.classList.toggle('map-dark', isDark());
  L.control.attribution({ prefix: false }).addTo(map);
  addBaseTiles(map);
  if (qid !== lastQ) { lastView = null; lastQ = qid; }
  if (lastView) map.setView(lastView.center, lastView.zoom, { animate: false });
  else map.setView([25, 10], 1.5, { animate: false });
  map.on('moveend', () => { lastView = { center: map.getCenter(), zoom: map.getZoom() }; });
  const dot = (latlng, color) => L.circleMarker(latlng, { radius: 8, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1 }).addTo(map);
  if (guess) {
    const a = L.latLng(answer);
    // 経度の差が 180° を超えるときは、近い側の複製に合わせる
    const g = L.latLng(guess[0], guess[1] + (guess[1] - a.lng > 180 ? -360 : guess[1] - a.lng < -180 ? 360 : 0));
    L.polyline([g, a], { color: '#ffd43b', weight: 3, dashArray: '6 6' }).addTo(map);
    dot(g, '#e03131');
    dot(a, '#2f9e44');
    const b = L.latLngBounds([g, a]);
    if (animate) map.flyToBounds(b, { padding: [40, 40], maxZoom: 9, duration: 0.7 }); else map.fitBounds(b, { padding: [40, 40], maxZoom: 9, animate: false });
  } else {
    map.getContainer().style.cursor = 'crosshair';
    // クリックでピンを置く（何度でも置き直せる）。回答は、ピンを置いたあとに「回答」ボタンを押したとき（呼び出し側が行う）
    let pin = null;
    map.on('click', (e) => {
      if (pin) pin.setLatLng(e.latlng); else pin = L.circleMarker(e.latlng, { radius: 9, color: '#fff', weight: 3, fillColor: '#e03131', fillOpacity: 1 }).addTo(map);
      const w = e.latlng.wrap();
      onPlace?.([w.lat, w.lng]);
    });
  }
  setTimeout(() => map.invalidateSize(), 50);
  new ResizeObserver(() => map.invalidateSize()).observe(el); // 地図の大きさが変わったとき（右下の小さい地図が広がるとき）に合わせる
  return map;
}
export function distanceBetween(a, b) {
  return distanceKm({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] });
}
