// 地図クイズ: 国または地域（国モードのとき）の「名前」と「地図上の場所」を結びつけるモード
//   名前 → 場所: 名前を見て、地図で、その場所をクリックする
//   場所 → 名前: 地図で色づけされた場所を見て、名前を当てる（4 択 / 入力）
// 世界モードでは国、国モードでは、選んだ国の中の地域（geoBoundaries の ADM1）が出題される
import { mountQuizMap, ringTiny } from './quizmap.js';
import { loadLibs, loadWorld, isDark, addNoLabelTiles } from './map.js';
import { loadRegions, regionName, regionNameEn } from './regionmap.js';

const DIRS = { both: '両方（ランダム）', toMap: '名前 → 地図でクリック', toName: '地図 → 名前を答える' };
const ANS = { choice: '4 択', input: '入力' };
export const GEO_DIRS = DIRS;
export const GEO_ANS = ANS;

const shuffle = (a) => { const r = [...a]; for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; };
// 入力の照合用: 大文字小文字・空白・記号・アクセント・「州/県/省…」などを無視
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\b(region|province|prefecture|state|county|district|oblast|voivodeship)\b/g, '').replace(/[\s・・.,'’\-_()（）]+/g, '').replace(/(州|県|省|府|都|道|地方|地域|特別市|自治区|共和国)$/g, '');

/**
 * 出題の候補を作る
 * @param {{ mode: 'world'|'country', codes: string[], iso3Of(code): string }} o
 * @returns {Promise<{ kind: 'country'|'region', code: string, parent?: string }[]>}
 */
export async function buildGeoPool({ mode, codes, iso3Of }) {
  if (mode === 'country') {
    const out = [];
    for (const parent of codes) {
      let fc = null;
      try { fc = await loadRegions(parent, iso3Of(parent)); } catch { fc = null; }
      const items = (fc?.features || []).map((f) => ({ kind: 'region', code: f.properties.code, parent }));
      const iso = items.filter((x) => /^[A-Z]{2}-/.test(x.code.split(':')[1] || '')); // 「Other Territories」のような、ふつうの地域ではないもの（ISO コードがない）は、4 つ以上、ふつうの地域があるときは、出題しない
      out.push(...(iso.length >= 4 ? iso : items));
    }
    return out;
  }
  await loadLibs();
  const w = await loadWorld('50m');
  const have = new Set(w.fc.features.map((f) => f.properties.code).filter(Boolean));
  return codes.filter((c) => have.has(c)).map((code) => ({ kind: 'country', code }));
}

/** 出題を作る（n 問。方向は、設定どおり、または、ランダム） */
export function buildGeoQuestions(pool, { n, dir, ans }) {
  return shuffle(pool).slice(0, n).map((it) => ({ ...it, dir: dir === 'both' ? (Math.random() < 0.5 ? 'toMap' : 'toName') : dir, ans, done: false, ok: null, given: null }));
}

// 国の中の地域の地図（クリックで選ぶ / 色づけして見せる）
// 世界の地図と同じく、左右に敷き詰める（境界線も、左右に複製する）。答え合わせは、地図を作り直さず、滑らかに動かす
const shiftCoords = (c, d) => (typeof c[0] === 'number' ? [c[0] + d, c[1]] : c.map((x) => shiftCoords(x, d)));
const shiftFeature = (f, d) => ({ type: 'Feature', properties: f.properties, geometry: f.geometry ? { type: f.geometry.type, coordinates: shiftCoords(f.geometry.coordinates, d) } : null });
export async function mountRegionMap(el, { fc, target, show, onPick, targets = null }) { // targets: 正解の地域が、複数あるとき（どれを選んでも正解）
  await loadLibs();
  if (!el.isConnected) return null;
  const L = window.L;
  const map = L.map(el, { zoomSnap: 0.5, maxZoom: 10, preferCanvas: true, attributionControl: false, worldCopyJump: true });
  el.classList.toggle('map-dark', isDark());
  L.control.attribution({ prefix: false }).addTo(map);
  addNoLabelTiles(map); // 地名が見えると、答えが分かってしまうので、地名のない地図
  const base = { stroke: true, color: '#7a7268', weight: 1, fillColor: '#3b82f6', fillOpacity: 0.07 };
  let answered = null;
  const T = new Set(targets?.length ? targets : [target]);
  const style = (f) => {
    const code = f.properties.code;
    if (answered && T.has(code)) return { stroke: true, color: '#2f9e44', weight: 2.5, fillColor: '#2f9e44', fillOpacity: 0.6 };
    if (answered?.given && code === answered.given) return { stroke: true, color: '#e03131', weight: 2.5, fillColor: '#e03131', fillOpacity: 0.5 };
    if (!answered && show && T.has(code)) return { stroke: true, color: '#f08c00', weight: 2.5, fillColor: '#f59f00', fillOpacity: 0.65 };
    return base;
  };
  const feats = fc.features.filter((f) => f.geometry);
  const all = L.geoJSON({ type: 'FeatureCollection', features: feats }).getBounds(); // 本来の位置のぶんの範囲
  const layer = L.geoJSON({ type: 'FeatureCollection', features: [...feats, ...feats.map((f) => shiftFeature(f, -360)), ...feats.map((f) => shiftFeature(f, 360))] }, {
    style,
    smoothFactor: 1.2,
    onEachFeature: (f, lyr) => {
      lyr.on('mouseover', () => { if (!answered && !show) lyr.setStyle({ fillOpacity: 0.3, color: '#3b82f6', weight: 1.5 }); });
      lyr.on('mouseout', () => { if (!answered && !show) layer.resetStyle(lyr); });
      lyr.on('click', () => { if (!answered && !show) onPick?.(f.properties.code); });
    },
  }).addTo(map);
  // 縮小は、世界の高さが枠に収まるところまで（上下の外側は、地図データがない）。左右は、敷き詰めるので、制限しない
  map.setMinZoom(Math.min(10, Math.max(1, Math.log2((el.clientHeight || 400) / 256))));
  map.setMaxBounds(L.latLngBounds([-84, -100000], [84, 100000]));
  const own = (code) => { // 本来の位置の、その地域の範囲
    const f = feats.find((x) => x.properties.code === code);
    return f ? L.geoJSON(f).getBounds() : null;
  };
  const tb = own([...T][0]);
  const rings = [];
  const fitTo = (b, maxZoom, pad, smooth) => { try { if (smooth) map.flyToBounds(b, { padding: [pad, pad], maxZoom, duration: 0.9 }); else map.fitBounds(b, { padding: [pad, pad], maxZoom, animate: false }); } catch { /* 無視 */ } };
  if (show && tb) { fitTo(tb, 7, 60, false); rings.push(ringTiny(map, tb, '#f08c00')); } // 当てる場所に、フォーカスして始める
  else fitTo(all, 12, 16, false);
  // 答え合わせ: 地図はそのまま、色を変えて、正解と自分の答えが両方入るところまで、滑らかに動かす
  map.reveal = ({ given }) => {
    answered = { given: given || null };
    layer.setStyle(style);
    rings.splice(0).forEach((r) => r.dispose());
    const gb = given ? own(given) : null;
    const u = tb ? (gb ? L.latLngBounds(tb.getSouthWest(), tb.getNorthEast()).extend(gb) : tb) : all;
    fitTo(u, 8, 50, true);
    if (tb) rings.push(ringTiny(map, tb, '#2f9e44'));
    if (gb) rings.push(ringTiny(map, gb, '#e03131'));
  };
  setTimeout(() => map.invalidateSize(), 50);
  new ResizeObserver(() => map.invalidateSize()).observe(el);
  return map;
}

/**
 * 地図クイズを、host に描く（run は、出題・得点を持つ。答えるたびに、描き直す）
 * deps: { esc, flagImg, countryName, resolveCountry(name), iso3Of(code), toast, log(ok, code), onExit(), onRestart(), onDone(run) }
 */
export function mountGeoQuiz(host, run, deps) {
  const { esc, flagImg, countryName } = deps;
  const nameOf = (it) => (it.kind === 'region' ? regionName(it.code) : countryName(it.code));
  const subOf = (it) => (it.kind === 'region' ? countryName(it.parent) : '');
  const flagOf = (it) => (it.kind === 'region' ? flagImg(it.parent) : flagImg(it.code));
  const total = run.questions.length;
  const q = run.questions[run.i];
  if (!q) { renderResult(); return; }
  const kindWord = q.kind === 'region' ? '地域' : '国';
  const score = run.questions.filter((x) => x.ok).length;

  host.innerHTML = `<div class="gq">
    <div class="toolbar gq-bar"><span class="counter">第 ${run.i + 1} 問 / ${total}</span><span class="counter">⭕ ${score}</span><span class="grow"></span><button type="button" class="btn btn-ghost btn-sm" id="gq-exit">✕ やめる</button></div>
    <div class="gq-prompt">${q.dir === 'toMap'
    ? `<span class="gq-q">📍 ${flagOf(q)}<b>${esc(nameOf(q))}</b>${subOf(q) ? ` <span class="muted">（${esc(subOf(q))}）</span>` : ''}</span><span class="muted small">は、どこ？ 地図で、クリックして答えます</span>`
    : `<span class="gq-q">🗺 色のついた${kindWord}は、どこ？</span>${q.kind === 'region' ? `<span class="muted small">${flagImg(q.parent)} ${esc(subOf(q))} の地域</span>` : ''}`}</div>
    <div class="gq-mapbox"></div>
    <div class="gq-side" id="gq-side"></div>
  </div>`;
  const $ = (s) => host.querySelector(s);
  $('#gq-exit').addEventListener('click', () => deps.onExit());
  const box = $('.gq-mapbox');
  const side = $('#gq-side');
  const freshMap = () => { box.innerHTML = ''; const el = document.createElement('div'); el.className = 'gq-map'; box.appendChild(el); return el; };
  let mapObj = null;
  const showMap = async () => { // 問題ごとに、地図は 1 回だけ作る（答え合わせは、同じ地図を、滑らかに動かす）
    const el = freshMap();
    try {
      if (q.kind === 'region') {
        const fc = await loadRegions(q.parent, deps.iso3Of(q.parent));
        mapObj = await mountRegionMap(el, { fc, target: q.code, show: q.dir === 'toName', onPick: (code) => answer(code === q.code, code) });
      } else {
        mapObj = await mountQuizMap(el, {
          answers: [q.code], answered: null, animate: true, qid: `gq${run.i}`,
          highlight: q.dir === 'toName' ? [q.code] : null, noLabels: true, onPick: (code) => answer(code === q.code, code),
        });
      }
      if (q.done) revealMap(); // 読み込み中に答えたとき
    } catch (ex) { box.innerHTML = `<p class="muted gq-err">地図を読み込めませんでした: ${esc(ex.message || '')}</p>`; }
  };
  const revealMap = () => {
    if (!mapObj?.reveal) return;
    mapObj.reveal(q.kind === 'region' ? { given: q.givenCode || null } : { given: q.givenCode ? [q.givenCode] : [] });
  };

  let busy = false;
  function answer(ok, given) {
    if (q.done || busy) return;
    q.done = true; q.ok = !!ok; q.given = given;
    q.givenCode = typeof given === 'string' && (q.dir === 'toMap' || (run.pool || []).some((x) => x.code === given)) ? given : null; // 自分の答えの場所（地図に出す）
    deps.log?.(q.ok, q.kind === 'region' ? q.parent : q.code);
    host.querySelectorAll('.gq-choice, #gq-input, #gq-send').forEach((b) => { b.disabled = true; });
    const last = run.i + 1 >= total;
    side.innerHTML = `<div class="gq-fb ${q.ok ? 'ok' : 'ng'}"><b>${q.ok ? '⭕ 正解！' : '❌ 不正解'}</b>
      <span>${q.dir === 'toMap' && !q.ok && q.given ? `あなたが選んだのは「${esc(q.kind === 'region' ? regionName(q.given) : countryName(q.given))}」。` : q.dir === 'toName' && !q.ok && q.given ? `あなたの答え: 「${esc(q.givenText || '')}」。` : ''}答えは ${flagOf(q)}<b>${esc(nameOf(q))}</b>${subOf(q) ? `（${esc(subOf(q))}）` : ''}${q.kind === 'region' && regionNameEn(q.code) !== nameOf(q) ? ` <span class="muted small">${esc(regionNameEn(q.code))}</span>` : ''}</span>
      <button type="button" class="btn btn-primary" id="gq-next">${last ? '結果を見る' : '次へ →'}</button></div>`;
    if (mapObj) revealMap(); // まだ読み込み中なら、読み込みが終わったときに、答え合わせの表示にする
    $('#gq-next').addEventListener('click', next);
    $('#gq-next').focus();
  }
  function next() { run.i++; if (run.i >= total) { deps.onDone?.(run); } mountGeoQuiz(host, run, deps); }

  if (q.dir === 'toName') {
    if (q.ans === 'input') {
      const names = q.kind === 'region' ? (run.pool || []).filter((x) => x.parent === q.parent).map((x) => ({ ja: regionName(x.code), en: regionNameEn(x.code) })) : null;
      side.innerHTML = `<form class="gq-input" id="gq-form"><input id="gq-input" class="input" type="text" autocomplete="off" ${names ? 'list="gq-list"' : 'list="country-list"'} placeholder="${kindWord}の名前（日本語・英語）" ${q.done ? 'disabled' : ''}><button class="btn btn-primary" id="gq-send" type="submit">答える</button>${names ? `<datalist id="gq-list">${names.map((n) => `<option value="${esc(n.ja)}">${esc(n.en)}</option>`).join('')}</datalist>` : ''}</form>`;
      deps.attachComplete?.($('#gq-input'), names ? { names } : { regions: false, ja: true }); // 地図タブと同じ、候補の補完（PC: 薄い文字で表示して、Tab で補完。スマホ: 候補の一覧）
      $('#gq-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const text = $('#gq-input').value.trim();
        if (!text) return;
        q.givenText = text;
        const n = norm(text);
        const ok = q.kind === 'region' ? [regionName(q.code), regionNameEn(q.code)].some((x) => n && norm(x) === n)
          : deps.resolveCountry?.(text) === q.code || norm(countryName(q.code)) === n;
        const resolved = q.kind === 'region' ? (run.pool || []).find((x) => x.parent === q.parent && n && [regionName(x.code), regionNameEn(x.code)].some((nm) => norm(nm) === n))?.code : deps.resolveCountry?.(text);
        answer(ok, resolved || text);
      });
      setTimeout(() => $('#gq-input')?.focus(), 50);
    } else {
      const same = run.questions.map((x) => x).filter((x) => x.kind === q.kind && x.code !== q.code && (q.kind !== 'region' || x.parent === q.parent));
      const pool = (run.pool || []).filter((x) => x.kind === q.kind && x.code !== q.code && (q.kind !== 'region' || x.parent === q.parent));
      const wrong = shuffle(pool.length >= 3 ? pool : [...pool, ...same]).filter((x, i, a) => a.findIndex((y) => y.code === x.code) === i).slice(0, 3);
      const opts = shuffle([q, ...wrong]);
      side.innerHTML = `<div class="gq-choices">${opts.map((o, i) => `<button type="button" class="btn gq-choice" data-code="${esc(o.code)}"><kbd>${i + 1}</kbd> ${flagOf(o)}${esc(nameOf(o))}</button>`).join('')}</div>`;
      side.querySelectorAll('.gq-choice').forEach((b) => b.addEventListener('click', () => { q.givenText = b.textContent.replace(/^\d\s*/, '').trim(); answer(b.dataset.code === q.code, b.dataset.code); }));
      const onKey = (e) => {
        if (!host.isConnected) { document.removeEventListener('keydown', onKey); return; }
        if (e.target.matches?.('input, textarea')) return;
        const n = Number(e.key);
        if (n >= 1 && n <= opts.length && !q.done) side.querySelectorAll('.gq-choice')[n - 1]?.click();
        else if ((e.key === 'Enter' || e.key === ' ') && q.done) { e.preventDefault(); document.removeEventListener('keydown', onKey); host.querySelector('#gq-next')?.click(); }
      };
      document.addEventListener('keydown', onKey);
    }
  }
  showMap();

  function renderResult() {
    const ok = run.questions.filter((x) => x.ok).length;
    const miss = run.questions.filter((x) => !x.ok);
    const pct = Math.round((ok / Math.max(1, total)) * 100);
    host.innerHTML = `<section class="panel gq-result">
      <h2>🗺 地図クイズの結果</h2>
      <p class="gq-score"><b>${ok}</b> / ${total} 問正解（${pct}%）</p>
      ${miss.length ? `<h3 class="bt-sub">まちがえたもの</h3><ul class="gq-miss">${miss.map((m) => `<li>${m.dir === 'toMap' ? '📍' : '🗺'} ${flagOf(m)}<b>${esc(nameOf(m))}</b>${subOf(m) ? ` <span class="muted small">（${esc(subOf(m))}）</span>` : ''}</li>`).join('')}</ul>` : '<p>全問正解です！ 🎉</p>'}
      <div class="setup-foot"><button type="button" class="btn" id="gq-back">設定に戻る</button><button type="button" class="btn btn-primary btn-lg" id="gq-again">もう一度</button></div>
    </section>`;
    host.querySelector('#gq-back').addEventListener('click', () => deps.onExit());
    host.querySelector('#gq-again').addEventListener('click', () => deps.onRestart());
  }
}
