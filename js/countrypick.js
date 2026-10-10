// 国を選ぶポップアップ: 上に検索バー（地図タブと同じ、補完つき）、その下に地図。検索で選ぶか、地図の国を押すと、追加・解除できる（複数選択）。
// 使い方: const codes = await pickCountries({ selected, resolve, countryName, flagImg, esc, attachComplete }) → 決定した国コードの配列（キャンセルなら null）
import { loadLibs, loadWorld, isDark } from './map.js';

export async function pickCountries({ selected = [], title = '国を選ぶ', resolve, countryName, flagImg, esc, attachComplete = null }) {
  const sel = new Set(selected);
  const d = document.createElement('dialog');
  d.className = 'modal cp-dialog';
  d.innerHTML = `<div class="modal-inner cp-inner">
    <div class="modal-head"><h2>${esc(title)}</h2><button class="icon-btn" type="button" data-cancel aria-label="閉じる">✕</button></div>
    <input type="search" class="input cp-search" list="country-list" placeholder="国名を入力（補完できます。Enter で追加・解除）" autocomplete="off" enterkeyhint="done" aria-label="国を検索">
    <div class="cp-chips selected-chips"></div>
    <div class="cp-map" aria-label="地図"></div>
    <p class="muted small cp-hint">地図の国を押すと、追加・解除できます（複数選択可）。</p>
    <div class="modal-foot"><button class="btn btn-ghost" type="button" data-cancel>キャンセル</button><button class="btn btn-primary" type="button" data-ok>決定</button></div>
  </div>`;
  document.body.appendChild(d);
  const chips = d.querySelector('.cp-chips');
  const input = d.querySelector('.cp-search');
  let layerByCode = new Map();
  let map = null;
  const style = (code) => {
    const on = sel.has(code);
    const dark = isDark();
    return { color: dark ? '#6b7f8c' : '#9aa7b0', weight: on ? 2 : 0.6, fillColor: on ? '#1c7f55' : dark ? '#2b3640' : '#e9eef1', fillOpacity: on ? 0.75 : 0.9 };
  };
  const paintChips = () => {
    chips.innerHTML = sel.size ? [...sel].map((c) => `<span class="chip" data-c="${esc(c)}">${flagImg(c)} ${esc(countryName(c))}<button type="button" class="chip-x" data-rm="${esc(c)}" aria-label="外す">✕</button></span>`).join('') : '<span class="muted small">まだ選んでいません</span>';
    d.querySelector('[data-ok]').textContent = sel.size ? `決定（${sel.size} か国）` : '決定';
  };
  const toggle = (code, fly = false) => {
    if (!code) return;
    if (sel.has(code)) sel.delete(code); else sel.add(code);
    layerByCode.get(code)?.forEach((l) => l.setStyle(style(code)));
    paintChips();
    if (fly && sel.has(code) && map) { const l = layerByCode.get(code)?.[0]; if (l) map.fitBounds(l.getBounds(), { maxZoom: 5, padding: [30, 30] }); }
  };
  chips.addEventListener('click', (e) => { const b = e.target.closest('[data-rm]'); if (b) toggle(b.dataset.rm); });
  const enter = () => {
    const code = resolve(input.value);
    if (code) { toggle(code, true); input.value = ''; } else if (input.value.trim()) input.select();
  };
  if (attachComplete) { try { attachComplete(input, { regions: false, ja: true }); } catch { /* 補完なしでも使える */ } } // 地図タブの検索と同じ補完
  input.addEventListener('keydown', (e) => { if (e.isComposing) return; if (e.key === 'Enter') { e.preventDefault(); enter(); } });
  input.addEventListener('change', () => { if (resolve(input.value)) enter(); }); // 候補を選んだとき
  paintChips();
  return new Promise((resolveP) => {
    const done = (v) => { try { map?.remove(); } catch { /* 無視 */ } d.close(); d.remove(); resolveP(v); };
    d.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', () => done(null)));
    d.querySelector('[data-ok]').addEventListener('click', () => done([...sel]));
    d.addEventListener('cancel', (e) => { e.preventDefault(); done(null); });
    d.showModal();
    input.focus();
    (async () => {
      try {
        await loadLibs();
        const L = window.L;
        const { fc } = await loadWorld('110m');
        const box = d.querySelector('.cp-map');
        map = L.map(box, { minZoom: 1, maxZoom: 8, worldCopyJump: true, zoomControl: true, attributionControl: false, keyboard: false }).setView([20, 10], 2);
        box.classList.toggle('map-dark', isDark());
        L.geoJSON(fc, {
          style: (f) => style(f.properties.code),
          onEachFeature: (f, layer) => {
            const code = f.properties.code;
            if (!code) return;
            if (!layerByCode.has(code)) layerByCode.set(code, []);
            layerByCode.get(code).push(layer);
            layer.bindTooltip(countryName(code), { sticky: true });
            layer.on('click', () => toggle(code));
          },
        }).addTo(map);
        setTimeout(() => map?.invalidateSize(), 50);
        if (sel.size) { const ls = [...sel].flatMap((c) => layerByCode.get(c) || []); if (ls.length) map.fitBounds(L.featureGroup(ls).getBounds(), { maxZoom: 4, padding: [30, 30] }); }
      } catch { d.querySelector('.cp-hint').textContent = '地図を読み込めませんでした。検索で選んでください。'; }
    })();
  });
}
