// 保存したストリートビュー: ストリートビューのウィンドウの「保存」で場所を保存し、専用のタブから開く。
// 保存するときに、国と大まかな地名（日本語・英語・現地の言語）を自動で付ける。カードの編集画面から、保存した場所を地名として足せる
import { reversePlace } from './cities.js';
import { svOpenUrl, refreshSvWindow } from './svwin.js';

const listeners = new Set();
const changed = () => listeners.forEach((fn) => { try { fn(); } catch { /* 無視 */ } });
/** 保存したストリートビューが増えた・消えた・読み込まれたときに呼ばれる（地図の目印の更新用）。解除する関数を返す */
export function onSavedSvChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

let deps = null;
let list = null; // 読み込み前は null
let loading = null;
const search = { q: '' };

/** アプリから、必要な機能を渡す: { api(), isEditor(), toast, esc, flagImg, countryName, countryAt, createCard, openSv, confirmDialog? } */
export function initSavedSv(d) { deps = d; list = null; loading = null; }
export const savedSvList = () => list || [];

export async function loadSavedSv(force = false) {
  if (list && !force) return list;
  if (!loading) loading = deps.api().listSavedSv().then((l) => { list = l; changed(); return l; }).finally(() => { loading = null; });
  return loading;
}

// 同じ場所とみなす条件: ほぼ動いていない（約 3m 以内）、かつ、向きの違いが 30 度未満。
// 少しでも動いたり、30 度以上向きを変えたりしたら、別の場所として扱う（向きが分からない=0 のときは、向きは比べない）
const MOVE_M = 3;
const TURN_DEG = 30;
const distM = (a, b) => Math.hypot((a.lat - b.lat) * 111320, (a.lng - b.lng) * 111320 * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180));
const turnDeg = (a, b) => { const d = Math.abs(((a - b) % 360 + 360) % 360); return Math.min(d, 360 - d); };
const sameSpot = (row, p) => distM(row, p) <= MOVE_M && (!Number(row.heading) || !Number(p.heading) || turnDeg(Number(row.heading), Number(p.heading)) < TURN_DEG);
/** p = { lat, lng, heading? } と同じ場所とみなせる、保存済みの行 */
export const savedSvAt = (p) => list?.find((x) => sameSpot(x, p)) || null;
export const isSavedSv = (p) => !!savedSvAt(p);

/** 地名だけ: 日本語 → 英語 → 現地の言語 → 座標 */
export const placeLabel = (r) => r.name || r.name_en || r.name_local || `${Number(r.lat).toFixed(4)}, ${Number(r.lng).toFixed(4)}`;
/** 表示用の名前: 自分でつけた名前があればそれ、なければ地名 */
export const svLabel = (r) => r.title || placeLabel(r);
export const savedSvById = (id) => list?.find((x) => x.id === id) || null;

/** 今開いているストリートビューを保存する（国と地名は自動で付ける）。保存した行を返す */
export async function saveSv({ lat, lng, heading = 0, pitch = 0, fov = 0 }) {
  await loadSavedSv().catch((e) => { deps.toast(e.message, 'error'); throw e; });
  const dup = savedSvAt({ lat, lng, heading });
  if (dup) { deps.toast('この場所（この向き）は、すでに保存してあります'); return dup; } // 少し動いたり、30 度以上向きを変えたりしていれば、別の場所として保存する
  deps.toast('地名を調べています…');
  const [place, code] = await Promise.all([
    reversePlace(lat, lng).catch(() => null), // 大まかな地名（OpenStreetMap）。調べられなくても保存は続ける
    Promise.resolve(deps.countryAt(lat, lng)).catch(() => null), // 国（地図の国境から）
  ]);
  const row = await deps.api().addSavedSv({
    lat, lng, heading, pitch, fov,
    code: code || place?.code || '',
    name: place?.name || '', name_en: place?.en || '', name_local: place?.local || '', admin: place?.admin || '',
  }).catch((e) => { deps.toast(e.message || '保存できませんでした', 'error'); throw e; });
  list.unshift(row);
  changed();
  const c = row.code ? deps.countryName(row.code) : '';
  deps.toast(`保存しました: ${[c, svLabel(row)].filter(Boolean).join(' ')}（ストリートビュータブから開けます）`);
  refreshSvWindow();
  return row;
}

async function removeSv(id) {
  await deps.api().deleteSavedSv(id);
  list = (list || []).filter((x) => x.id !== id);
  changed();
}

export const rowView = (r) => ({ heading: Number(r.heading) || 0, pitch: Number(r.pitch) || 0, fov: Number(r.fov) || 0 });
const dateText = (iso) => { try { return new Date(iso).toLocaleDateString('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric' }); } catch { return ''; } };
function matches(r, q) {
  if (!q) return true;
  const hay = [r.title, r.name, r.name_en, r.name_local, r.admin, r.code, r.code ? deps.countryName(r.code) : '', r.note].join(' ').toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}
function rowHtml(r) {
  const { esc } = deps;
  const country = r.code ? deps.countryName(r.code) : '国は未判定';
  const alts = [r.name_en, r.name_local].filter((x) => x && x !== r.name).filter((x, i, a) => a.indexOf(x) === i);
  // 自分でつけた名前があれば大きく出し、地名は別の行に出す
  const head = r.title ? esc(r.title) : `${esc(country)}${r.name || r.admin ? ` <span class="sv-item-sep">·</span> ${esc(placeLabel(r))}` : ''}`;
  const sub = r.title
    ? [country, r.name, r.admin && r.admin !== r.name ? r.admin : '', ...alts].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).map(esc).join(' · ')
    : [r.admin && r.admin !== r.name ? esc(r.admin) : '', ...alts.map(esc)].filter(Boolean).join(' · ');
  const cards = (deps.cardsFor?.(r.id) || []);
  return `<article class="sv-item" data-id="${esc(r.id)}">
    <button type="button" class="sv-item-main" data-open="${esc(r.id)}" title="ストリートビューをウィンドウで開く">
      <span class="sv-item-flag">${r.code ? deps.flagImg(r.code) : '📍'}</span>
      <span class="sv-item-text">
        <b class="sv-item-title">${head}</b>
        <span class="muted small">${sub || '&nbsp;'}</span>
        <span class="muted small">${Number(r.lat).toFixed(4)}, ${Number(r.lng).toFixed(4)}${r.created_at ? ` · ${esc(dateText(r.created_at))}` : ''}</span>
      </span>
    </button>
    ${cards.length ? `<div class="sv-item-cards"><span class="muted small">🔗 関連カード</span>${cards.map((c) => `<button type="button" class="sv-card-chip" data-card-open="${esc(c.id)}" title="${esc(c.description || '')}">${c.countries?.[0] ? deps.flagImg(c.countries[0]) : ''}<span>${esc(deps.cardLabel(c))}</span></button>`).join('')}</div>` : ''}
    <div class="sv-item-actions">
      <button type="button" class="btn btn-sm btn-primary" data-open="${esc(r.id)}">開く</button>
      ${deps.isEditor() ? `<button type="button" class="btn btn-sm" data-rename="${esc(r.id)}" title="名前を変える（地名は別に表示されます）">✏ 名前</button>
      <button type="button" class="btn btn-sm" data-card="${esc(r.id)}" title="この場所でカードを作る（このストリートビューと関連付けます）">📍 カードを作る</button>
      <button type="button" class="btn btn-sm btn-danger" data-del="${esc(r.id)}" title="保存を削除">削除</button>` : ''}
      <a class="btn btn-sm" href="${esc(svOpenUrl(r.lat, r.lng, rowView(r)))}" target="_blank" rel="noopener" title="Google マップで開く">↗</a>
    </div>
  </article>`;
}

// 名前の変更: その場で入力欄にして、Enter で保存・Esc でやめる（地名は変えない）
function startRename(item, r, redraw) {
  const t = item?.querySelector('.sv-item-title');
  if (!t || !r) return;
  const input = document.createElement('input');
  input.type = 'text'; input.className = 'input sv-rename'; input.maxLength = 60; input.value = r.title || '';
  input.placeholder = `名前（空にすると地名: ${placeLabel(r)}）`;
  t.replaceChildren(input);
  input.focus(); input.select();
  let done = false;
  const finish = async (save) => {
    if (done) return; done = true;
    if (save && input.value.trim() !== (r.title || '')) {
      try { const row = await deps.api().updateSavedSv(r.id, { title: input.value.trim() }); Object.assign(r, row); changed(); refreshSvWindow(); deps.toast('名前を変えました'); } catch (err) { deps.toast(err.message || '変えられませんでした', 'error'); }
    }
    redraw();
  };
  input.addEventListener('keydown', (e) => { if (e.isComposing) return; if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.stopPropagation(); finish(false); } });
  input.addEventListener('blur', () => finish(true));
}

/** ストリートビュータブの描画 */
export function renderSavedSvView(view, setFit) {
  setFit?.('scroll');
  const { esc } = deps;
  view.innerHTML = `
    <div class="sv-view">
      <div class="toolbar sv-toolbar">
        <h2 class="lang-title">🧍 ストリートビュー</h2>
        <input type="search" id="sv-q" class="input grow" placeholder="国・地名で絞り込み（例: フランス / Paris / 京都）" value="${esc(search.q)}" autocomplete="off">
        <span class="counter" id="sv-count"></span>
      </div>
      <p class="muted small sv-hint">ストリートビューのウィンドウの <b>保存</b> ボタンで、ここに場所が増えます。国と大まかな地名は自動で付きます。</p>
      <div id="sv-list" class="sv-list"><div class="empty page-loading"><span class="spinner"></span>読み込み中…</div></div>
    </div>`;
  const q = view.querySelector('#sv-q');
  let composing = false;
  const draw = () => {
    const box = view.querySelector('#sv-list');
    if (!box) return;
    const rows = (list || []).filter((r) => matches(r, search.q));
    view.querySelector('#sv-count').textContent = list ? `${rows.length} / ${list.length} 件` : '';
    box.innerHTML = rows.length ? rows.map(rowHtml).join('') : `<div class="empty">${list?.length ? '一致する場所がありません' : '保存したストリートビューはまだありません。<br>地図の ストリートビュー ボタン → 道路をクリック → ウィンドウの 保存 ボタンで追加できます。'}</div>`;
  };
  q.addEventListener('compositionstart', () => { composing = true; });
  q.addEventListener('compositionend', () => { composing = false; search.q = q.value; draw(); });
  q.addEventListener('input', (e) => { if (composing || e.isComposing) return; search.q = q.value; draw(); });
  view.querySelector('#sv-list').addEventListener('click', async (e) => {
    if (e.target.closest('.sv-rename')) return; // 名前の入力中
    const find = (id) => list?.find((x) => x.id === id);
    const open = e.target.closest('[data-open]');
    const card = e.target.closest('[data-card]');
    const del = e.target.closest('[data-del]');
    const rename = e.target.closest('[data-rename]');
    const cardOpen = e.target.closest('[data-card-open]');
    if (open) { const r = find(open.dataset.open); if (r) deps.openSv(Number(r.lat), Number(r.lng), rowView(r)); }
    else if (card) { const r = find(card.dataset.card); if (r) deps.createCard({ lat: Number(r.lat), lng: Number(r.lng), codePromise: r.code || null, svId: r.id }); }
    else if (cardOpen) deps.openCard?.(cardOpen.dataset.cardOpen, cardOpen);
    else if (rename) startRename(rename.closest('.sv-item'), find(rename.dataset.rename), draw);
    else if (del) {
      const r = find(del.dataset.del);
      if (r && (await deps.confirmDialog(`「${svLabel(r)}」の保存を削除しますか？`))) {
        try { await removeSv(r.id); draw(); refreshSvWindow(); } catch (err) { deps.toast(err.message || '削除できませんでした', 'error'); }
      }
    }
  });
  loadSavedSv(true).then(draw).catch((err) => { const box = view.querySelector('#sv-list'); if (box) box.innerHTML = `<div class="empty">${esc(err.message || '読み込めませんでした')}</div>`; });
}

/** カードの編集画面用: 保存したストリートビューの一覧から選んで、地名として足す。pick({ name, en, local, sub, code, lat, lng, zoom }) */
export async function renderSavedSvPicker(box, pick, exclude = new Set()) {
  const { esc } = deps;
  box.innerHTML = '<span class="muted small">読み込み中…</span>';
  try { await loadSavedSv(true); } catch (e) { box.innerHTML = `<span class="muted small">${esc(e.message)}</span>`; return; }
  if (!list.length) { box.innerHTML = '<span class="muted small">保存したストリートビューはまだありません（ストリートビューのウィンドウの保存ボタンで追加できます）</span>'; return; }
  const shown = list.filter((r) => !exclude.has(r.id));
  if (!shown.length) { box.innerHTML = '<span class="muted small">選べるストリートビューはありません</span>'; return; }
  box.innerHTML = `<div class="sv-pick">${shown.map((r) => `<button type="button" class="pl-hit sv-pick-item" data-sv="${esc(r.id)}">
      <span class="pl-flag">${r.code ? deps.flagImg(r.code) : '📍'}</span>
      <span class="pl-title"><b>${esc(svLabel(r))}</b>${r.title ? ` <em>${esc(placeLabel(r))}</em>` : [r.name_en, r.name_local].filter((x) => x && x !== r.name).map((n) => ` <em>${esc(n)}</em>`).join('')}</span>
      <span class="muted small">${esc(r.code ? deps.countryName(r.code) : '')}${r.admin ? ` · ${esc(r.admin)}` : ''}</span>
    </button>`).join('')}</div>`;
  box.querySelectorAll('[data-sv]').forEach((b) => b.addEventListener('click', () => {
    const r = list.find((x) => x.id === b.dataset.sv);
    if (r) pick({ id: r.id, name: placeLabel(r), en: r.name_en || '', local: r.name_local || '', sub: r.admin || '', code: r.code || '', lat: Number(r.lat), lng: Number(r.lng), zoom: 13 });
  }));
}
