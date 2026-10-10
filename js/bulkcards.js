// 旗・ナンバープレートを、国ごとに、まとめてカードにする
//  - 🌍 国の旗: 世界の国のカード（画像: flagcdn.com）。すでに「国旗」のカードがある国は、除く
//  - 📍 国の地域の旗・ナンバープレート: 選んだ国の、州・県などの地域ごとに（旗: Wikidata + Wikimedia Commons / ナンバープレート: GeoHints の州のページ（アメリカ））。ラベルは、その国の「地域」。
//    すでにその種類のカードがある地域（座標・詳細エリアで判断）は、除く
import { getRegionIndex, regionFlagReadable, regionFlagSrc, loadGhStateByName, ghSupported } from './regionmap.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** deps: { esc, countryName, flagImg, countries: [{code,ja}], cards(), isKindCard(card, kind), cardPoints(card), iso3Of(code), countryEn(code),
 *          createNationalFlag({ blob, code }), createRegionCard({ blob, kind, source, parent, name, lat, lng }), reloadCards(), pickCountries(selected), toast } */
export function openBulkCards(deps, preset = {}) {
  const { esc, countryName, flagImg } = deps;
  const d = document.createElement('dialog');
  d.className = 'modal modal-sm bc-dialog';
  let scope = preset.scope === 'world' ? 'world' : 'region';
  let sel = new Set(preset.countries || []);
  let kinds = new Set(preset.kinds || ['flag']);
  let running = false; let cancel = false;
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
          <label class="bc-kind"><input type="checkbox" data-kind="plate" ${kinds.has('plate') ? 'checked' : ''}> 🚘 ナンバープレート（GeoHints の州のページにあるもの。今は、アメリカだけ。見つかった画像は、全部カードにします）</label></div>
        <p class="muted small">ラベルは、その国の「地域」。カテゴリーは「国旗」「ナンバープレート」。場所は、地域の代表点（どの地域のカードかは、この座標で判断します）。すでに、その種類のカードがある地域は除きます。</p>`
      : `<p class="muted small">すべての国の国旗（flagcdn.com の画像）を、「国旗」カテゴリー・ラベル「世界の国」のカードにします。すでに国旗のカードがある国は除きます。</p>`}
      <div class="bc-progress" id="bc-progress" hidden><div class="progress"><div class="progress-bar" id="bc-bar" style="width:0"></div></div><p class="small muted" id="bc-text"></p></div>
      <div class="modal-foot"><button class="btn btn-ghost" type="button" data-x>閉じる</button><button class="btn btn-primary" type="button" id="bc-start">作成を始める</button></div>
    </div>`;
    d.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', () => { if (running) { cancel = true; return; } d.close(); d.remove(); }));
    d.querySelectorAll('#bc-scope button').forEach((b) => b.addEventListener('click', () => { if (running) return; scope = b.dataset.v; paint(); }));
    d.querySelector('#bc-pick')?.addEventListener('click', async () => { const r = await deps.pickCountries([...sel]); if (r) { sel = new Set(r); paint(); } });
    d.querySelectorAll('[data-kind]').forEach((c) => c.addEventListener('change', () => { if (c.checked) kinds.add(c.dataset.kind); else kinds.delete(c.dataset.kind); }));
    d.querySelector('#bc-start').addEventListener('click', start);
  };
  const say = (text, pct) => { d.querySelector('#bc-progress').hidden = false; d.querySelector('#bc-text').textContent = text; if (pct != null) d.querySelector('#bc-bar').style.width = `${Math.round(pct * 100)}%`; };

  async function start() {
    if (running) return;
    const btn = d.querySelector('#bc-start');
    let ok = 0; let ng = 0; let skipped = 0;
    running = true; cancel = false; btn.disabled = true;
    try {
      if (scope === 'world') {
        const have = new Set(deps.cards().filter((c) => deps.isKindCard(c, 'flag') && !(c.scope_countries || []).length).flatMap((c) => c.countries));
        const todo = deps.countries.filter((c) => !have.has(c.code));
        if (!todo.length) { say('すべての国に、国旗のカードがあります', 1); }
        for (let i = 0; i < todo.length && !cancel; i++) {
          const c = todo[i];
          say(`国旗を作っています… ${i + 1} / ${todo.length}（${c.ja}）`, i / todo.length);
          try { const blob = await (await fetch(`https://flagcdn.com/w640/${c.code.toLowerCase()}.png`)).blob(); await deps.createNationalFlag({ blob, code: c.code }); ok++; } catch { ng++; }
        }
      } else {
        if (!sel.size || !kinds.size) { say('国と種類を選んでください', 0); running = false; btn.disabled = false; return; }
        const jobs = []; // { kind, rc, name, center, src, parent, source }
        const codes = [...sel];
        for (let ci = 0; ci < codes.length && !cancel; ci++) {
          const code = codes[ci];
          say(`${countryName(code)} の地域を調べています…（${ci + 1} / ${codes.length}）`, ci / codes.length * 0.3);
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
          for (const r of idx.regions) {
            if (kinds.has('flag') && regionFlagReadable(r.rc) && !taken.flag.has(r.rc)) jobs.push({ kind: 'flag', rc: r.rc, name: r.name, center: r.center, src: regionFlagSrc(r.rc), parent: code, source: '旗' });
          }
          if (kinds.has('plate') || kinds.has('flag')) { // GeoHints の州のページ（今は、アメリカだけ）: 旗はこちらを優先、ナンバープレートは見つかった画像を、全部
            if (ghSupported(code)) {
              for (let i = 0; i < idx.regions.length && !cancel; i++) {
                const r = idx.regions[i];
                say(`${countryName(code)} の州のページ（GeoHints）を調べています… ${i + 1} / ${idx.regions.length}（${r.name}）`, 0.3 + 0.3 * (i / idx.regions.length));
                const gs = await loadGhStateByName(code, r.rc, r.name);
                if (!gs) continue;
                if (kinds.has('plate') && !taken.plate.has(r.rc)) for (const f of gs.plates) jobs.push({ kind: 'plate', rc: r.rc, name: r.name, center: r.center, src: f.src, parent: code, source: 'geohints' });
              }
            }
          }
        }
        if (!jobs.length && !cancel) say('作れるものがありませんでした（すでにカードがある・旗や画像が見つからない）', 1);
        for (let i = 0; i < jobs.length && !cancel; i++) {
          const j = jobs[i];
          say(`カードを作っています… ${i + 1} / ${jobs.length}（${j.kind === 'flag' ? '旗' : 'ナンバープレート'}・${j.name}）`, 0.6 + 0.4 * (i / jobs.length));
          try { const blob = await (deps.fetchImage ? deps.fetchImage(j.src) : (await fetch(j.src)).blob()); await deps.createRegionCard({ blob, kind: j.kind, source: j.source, parent: j.parent, name: j.name, lat: j.center?.[0], lng: j.center?.[1] }); ok++; } catch { ng++; }
        }
        skipped = 0;
      }
    } finally {
      running = false; btn.disabled = false;
      say(`${cancel ? '中止しました: ' : '完了: '}${ok} 枚を作りました${ng ? `（${ng} 枚は、できませんでした）` : ''}`, 1);
      if (ok) { deps.toast(`${ok} 枚のカードを作りました`); await deps.reloadCards(); }
    }
  }
  paint();
  document.body.appendChild(d);
  d.addEventListener('cancel', (e) => { e.preventDefault(); if (running) cancel = true; else { d.close(); d.remove(); } });
  d.showModal();
}
