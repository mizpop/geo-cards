// 旗・ナンバープレートを、国ごとに、まとめてカードにする
//  - 🌍 国の旗: 世界の国のカード（画像: flagcdn.com）。すでに「国旗」のカードがある国は、除く
//  - 📍 国の地域の旗・ナンバープレート: 選んだ国の、州・県などの地域ごとに（旗: Wikidata + Wikimedia Commons / ナンバープレート: GeoHints の州のページ（アメリカ）・保存した Wikimedia Commons のリンク）。ラベルは、その国の「地域」。
//    すでにその種類のカードがある地域（座標・詳細エリアで判断）は、除く
import { getRegionIndex, regionFlagReadable, regionFlagSrc, loadGhStateByName, ghSupported, loadPlateData, platesForRegion } from './regionmap.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** deps: { esc, countryName, flagImg, countries: [{code,ja}], cards(), isKindCard(card, kind), cardPoints(card), iso3Of(code), countryEn(code),
 *          createNationalFlag({ blob, code }), createRegionCard({ blob, kind, source, parent, name, lat, lng }), reloadCards(), pickCountries(selected), toast } */
export function openBulkCards(deps, preset = {}) {
  const { esc, countryName, flagImg } = deps;
  const d = document.createElement('dialog');
  d.className = 'modal modal-wide bc-dialog';
  let scope = preset.scope === 'world' ? 'world' : 'region';
  let sel = new Set(preset.countries || []);
  let kinds = new Set(preset.kinds || ['flag']);
  let running = false; let cancel = false;
  let pending = null; // 探した候補（一覧で確かめて、必要ないものを外してから、作る）
  const paint = () => {
    d.innerHTML = `<div class="modal-inner">
      <div class="modal-head"><h2>🗂 旗・ナンバープレートをまとめてカードに</h2><button class="icon-btn" type="button" data-x aria-label="閉じる">✕</button></div>
      <div class="field"><span>作るカード</span>
        <div class="seg" id="bc-scope"><button type="button" data-v="world" class="${scope === 'world' ? 'on' : ''}">🌍 国の旗（世界の国）</button><button type="button" data-v="region" class="${scope === 'region' ? 'on' : ''}">📍 国ごとの地域</button></div></div>
      ${scope === 'region' ? `
        <div class="field"><span>国（地域ごとに作ります）</span>
          <div class="selected-chips">${[...sel].map((c) => `<span class="chip">${flagImg(c)} ${esc(countryName(c))}</span>`).join('') || '<span class="muted small">まだ選んでいません</span>'}</div>
          <button type="button" class="btn btn-sm" id="bc-pick">🏳 国を選ぶ</button></div>
        <div class="field"><span>種類</span>
          <label class="bc-kind"><input type="checkbox" data-kind="flag" ${kinds.has('flag') ? 'checked' : ''}> 🚩 地域の旗</label>
          <label class="bc-kind"><input type="checkbox" data-kind="plate" ${kinds.has('plate') ? 'checked' : ''}> 🚘 ナンバープレート（GeoHints の州のページ（アメリカ）と、保存した Wikimedia Commons のリンク。見つかった画像は、全部カードにします）</label></div>
        <p class="muted small">ラベルは、その国の「地域」。カテゴリーは「国旗」「ナンバープレート」。場所は、地域の代表点（どの地域のカードかは、この座標で判断します）。すでに、その種類のカードがある地域は除きます。</p>`
      : `<p class="muted small">すべての国の国旗（flagcdn.com の画像）を、「国旗」カテゴリー・ラベル「世界の国」のカードにします。すでに国旗のカードがある国は除きます。</p>`}
      <div class="bc-review" id="bc-review" hidden>
        <div class="bc-review-head"><b id="bc-count"></b><span class="muted small">必要ないものは、右上の ✕ で外してから、作成してください（作成する画像だけ、残ります）</span><span class="grow"></span><button type="button" class="btn btn-ghost btn-sm" id="bc-redo">候補を探し直す</button><button type="button" class="btn btn-primary" id="bc-make">作成する</button></div>
        <div class="bc-tiles" id="bc-tiles"></div>
      </div>
      <div class="bc-progress" id="bc-progress" hidden><div class="progress"><div class="progress-bar" id="bc-bar" style="width:0"></div></div><p class="small muted" id="bc-text"></p></div>
      <div class="modal-foot"><button class="btn btn-ghost" type="button" data-x>閉じる</button><button class="btn btn-primary" type="button" id="bc-start">候補を探す</button></div>
    </div>`;
    d.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', () => { if (running) { cancel = true; return; } d.close(); d.remove(); }));
    d.querySelectorAll('#bc-scope button').forEach((b) => b.addEventListener('click', () => { if (running) return; scope = b.dataset.v; paint(); }));
    d.querySelector('#bc-pick')?.addEventListener('click', async () => { const r = await deps.pickCountries([...sel]); if (r) { sel = new Set(r); paint(); } });
    d.querySelectorAll('[data-kind]').forEach((c) => c.addEventListener('change', () => { if (c.checked) kinds.add(c.dataset.kind); else kinds.delete(c.dataset.kind); }));
    d.querySelector('#bc-start').addEventListener('click', discover);
    d.querySelector('#bc-make')?.addEventListener('click', create);
    d.querySelector('#bc-redo')?.addEventListener('click', () => { pending = null; paint(); });
  };
  const say = (text, pct) => { d.querySelector('#bc-progress').hidden = false; d.querySelector('#bc-text').textContent = text; if (pct != null) d.querySelector('#bc-bar').style.width = `${Math.round(pct * 100)}%`; };

  // 作る画像の一覧（タイル）。必要ないものは ✕ で外す
  function showReview() {
    const box = d.querySelector('#bc-review');
    if (!box || !pending) return;
    box.hidden = false;
    const tiles = d.querySelector('#bc-tiles');
    tiles.innerHTML = pending.map((j, i) => `<figure class="bc-tile" data-i="${i}" title="${esc(j.title || j.name)}">
        <img src="${esc(j.thumb || j.src)}" alt="" loading="lazy">
        <figcaption><span>${j.kind === 'flag' ? '🚩' : '🚘'}</span> ${esc(j.ja || j.name)}${j.country ? `<small>${esc(j.country)}</small>` : ''}</figcaption>
        <button type="button" class="bc-x" data-rm="${i}" aria-label="外す" title="作らない（一覧から外す）">✕</button></figure>`).join('');
    d.querySelector('#bc-count').textContent = `${pending.length} 枚`;
    d.querySelector('#bc-make').textContent = `${pending.length} 枚を作成する`;
    d.querySelector('#bc-make').disabled = !pending.length;
    tiles.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { pending.splice(Number(b.dataset.rm), 1); showReview(); }));
  }

  // ① 作る候補を探す
  async function discover() {
    if (running) return;
    const btn = d.querySelector('#bc-start');
    running = true; cancel = false; btn.disabled = true;
    const jobs = []; // { kind, rc, name, country, center, src, thumb, parent, source, world, code }
    try {
      if (scope === 'world') {
        const have = new Set(deps.cards().filter((c) => deps.isKindCard(c, 'flag') && !(c.scope_countries || []).length).flatMap((c) => c.countries));
        for (const c of deps.countries) if (!have.has(c.code)) jobs.push({ kind: 'flag', world: true, code: c.code, name: c.ja, src: `https://flagcdn.com/w640/${c.code.toLowerCase()}.png`, thumb: `https://flagcdn.com/w160/${c.code.toLowerCase()}.png` });
        if (!jobs.length) say('すべての国に、国旗のカードがあります', 1);
      } else {
        if (!sel.size || !kinds.size) { say('国と種類を選んでください', 0); return; }
        const codes = [...sel];
        for (let ci = 0; ci < codes.length && !cancel; ci++) {
          const code = codes[ci];
          say(`${countryName(code)} の地域を調べています…（${ci + 1} / ${codes.length}）`, ci / codes.length * 0.5);
          let idx;
          try { idx = await getRegionIndex(code, deps.iso3Of(code)); } catch { say(`${countryName(code)} は、地域のデータがありません`, null); await sleep(800); continue; }
          // すでにある、その種類のカードの地域
          const taken = { flag: new Set(), plate: new Set() };
          for (const c of deps.cards()) {
            if (!(c.scope_countries || []).includes(code)) continue;
            for (const k of ['flag', 'plate']) {
              if (!deps.isKindCard(c, k)) continue;
              for (const p of deps.cardPoints(c)) { const rc = idx.at(p.lat, p.lng); if (rc) taken[k].add(rc); }
              const nm = String(c.area || '').toLowerCase().trim();
              for (const r of idx.regions) if (nm && nm === r.name.toLowerCase()) taken[k].add(r.rc);
            }
          }
          const cn = countryName(code);
          for (const r of idx.regions) {
            if (kinds.has('flag') && regionFlagReadable(r.rc) && !taken.flag.has(r.rc)) jobs.push({ kind: 'flag', rc: r.rc, name: r.name, ja: r.ja, country: cn, center: r.center, src: regionFlagSrc(r.rc), parent: code, source: '旗' });
          }
          if (kinds.has('plate')) { // ナンバープレート: GeoHints の州のページ（アメリカ）と、保存した Wikimedia Commons のリンク。見つかった画像は、全部
            await loadPlateData();
            for (let i = 0; i < idx.regions.length && !cancel; i++) {
              const r = idx.regions[i];
              if (taken.plate.has(r.rc)) continue;
              if (ghSupported(code)) {
                say(`${cn} の州のページ（GeoHints）を調べています… ${i + 1} / ${idx.regions.length}（${r.name}）`, 0.5 + 0.5 * (i / idx.regions.length));
                const gs = await loadGhStateByName(code, r.rc, r.name);
                for (const f of gs?.plates || []) jobs.push({ kind: 'plate', rc: r.rc, name: r.name, ja: r.ja, country: cn, center: r.center, src: f.src, parent: code, source: 'geohints' });
              }
              for (const f of platesForRegion(code, r.name)) jobs.push({ kind: 'plate', rc: r.rc, name: r.name, ja: r.ja, country: cn, title: f.title, center: r.center, src: f.src, parent: code, source: 'commons' });
            }
          }
        }
        if (!jobs.length && !cancel) say('作れるものがありませんでした（すでにカードがある・旗や画像が見つからない）', 1);
      }
    } finally { running = false; btn.disabled = false; }
    if (jobs.length) { pending = jobs; d.querySelector('#bc-progress').hidden = true; showReview(); }
  }

  // ② 一覧に残した画像を、カードにする
  async function create() {
    if (running || !pending?.length) return;
    const jobs = pending;
    const make = d.querySelector('#bc-make');
    let ok = 0; let ng = 0;
    running = true; cancel = false; make.disabled = true;
    try {
      for (let i = 0; i < jobs.length && !cancel; i++) {
        const j = jobs[i];
        say(`カードを作っています… ${i + 1} / ${jobs.length}（${j.kind === 'flag' ? '旗' : 'ナンバープレート'}・${j.name}）`, i / jobs.length);
        try {
          const blob = await (deps.fetchImage ? deps.fetchImage(j.src) : (await fetch(j.src)).blob());
          if (j.world) await deps.createNationalFlag({ blob, code: j.code });
          else await deps.createRegionCard({ blob, kind: j.kind, source: j.source, parent: j.parent, name: j.name, ja: j.ja, lat: j.center?.[0], lng: j.center?.[1] });
          ok++;
        } catch { ng++; }
      }
    } finally {
      running = false; make.disabled = false;
      say(`${cancel ? '中止しました: ' : '完了: '}${ok} 枚を作りました${ng ? `（${ng} 枚は、できませんでした）` : ''}`, 1);
      if (ok) { deps.toast(`${ok} 枚のカードを作りました`); pending = null; d.querySelector('#bc-review').hidden = true; await deps.reloadCards(); }
    }
  }
  paint();
  document.body.appendChild(d);
  d.addEventListener('cancel', (e) => { e.preventDefault(); if (running) cancel = true; else { d.close(); d.remove(); } });
  d.showModal();
}
