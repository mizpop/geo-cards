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

const near = (a, b) => Math.abs(a.lat - b.lat) < 0.0002 && Math.abs(a.lng - b.lng) < 0.0003; // 約 20m 以内は同じ場所
export const isSavedSv = (p) => !!list?.some((x) => near(x, p));

/** 表示用の地名: 日本語 → 英語 → 現地の言語 → 座標 */
export const svLabel = (r) => r.name || r.name_en || r.name_local || `${Number(r.lat).toFixed(4)}, ${Number(r.lng).toFixed(4)}`;

/** 今開いているストリートビューを保存する（国と地名は自動で付ける）。保存した行を返す */
export async function saveSv({ lat, lng, heading = 0, pitch = 0, fov = 0 }) {
  await loadSavedSv().catch((e) => { deps.toast(e.message, 'error'); throw e; });
  const dup = list.find((x) => near(x, { lat, lng }));
  const hasView = heading || pitch || fov;
  if (dup) {
    // 同じ場所でも、向きやズームが変わっていれば、それを更新する
    if (hasView && (Math.abs((dup.heading || 0) - heading) > 1 || Math.abs((dup.pitch || 0) - pitch) > 1 || Math.abs((dup.fov || 0) - fov) > 1)) {
      const row = await deps.api().updateSavedSv(dup.id, { heading, pitch, fov }).catch((e) => { deps.toast(e.message || '更新できませんでした', 'error'); throw e; });
      Object.assign(dup, row);
      changed();
      deps.toast('向きとズームを更新しました');
      return dup;
    }
    deps.toast('この場所は、すでに保存してあります');
    return dup;
  }
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
  const hay = [r.name, r.name_en, r.name_local, r.admin, r.code, r.code ? deps.countryName(r.code) : '', r.note].join(' ').toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}
function rowHtml(r) {
  const { esc } = deps;
  const alts = [r.name_en, r.name_local].filter((x) => x && x !== r.name).filter((x, i, a) => a.indexOf(x) === i);
  return `<article class="sv-item" data-id="${esc(r.id)}">
    <button type="button" class="sv-item-main" data-open="${esc(r.id)}" title="ストリートビューをウィンドウで開く">
      <span class="sv-item-flag">${r.code ? deps.flagImg(r.code) : '📍'}</span>
      <span class="sv-item-text">
        <b>${esc(r.code ? deps.countryName(r.code) : '国は未判定')}${r.name || r.admin ? ` <span class="sv-item-sep">·</span> ${esc(svLabel(r))}` : ''}</b>
        <span class="muted small">${[r.admin && r.admin !== r.name ? esc(r.admin) : '', ...alts.map(esc)].filter(Boolean).join(' · ') || '&nbsp;'}</span>
        <span class="muted small">${Number(r.lat).toFixed(4)}, ${Number(r.lng).toFixed(4)}${r.created_at ? ` · ${esc(dateText(r.created_at))}` : ''}</span>
      </span>
    </button>
    <div class="sv-item-actions">
      <button type="button" class="btn btn-sm btn-primary" data-open="${esc(r.id)}">開く</button>
      ${deps.isEditor() ? `<button type="button" class="btn btn-sm" data-card="${esc(r.id)}" title="この場所でカードを作る">📍 カードを作る</button>
      <button type="button" class="btn btn-sm btn-danger" data-del="${esc(r.id)}" title="保存を削除">削除</button>` : ''}
      <a class="btn btn-sm" href="${esc(svOpenUrl(r.lat, r.lng, rowView(r)))}" target="_blank" rel="noopener" title="Google マップで開く">↗</a>
    </div>
  </article>`;
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
    const find = (id) => list?.find((x) => x.id === id);
    const open = e.target.closest('[data-open]');
    const card = e.target.closest('[data-card]');
    const del = e.target.closest('[data-del]');
    if (open) { const r = find(open.dataset.open); if (r) deps.openSv(Number(r.lat), Number(r.lng), rowView(r)); }
    else if (card) { const r = find(card.dataset.card); if (r) deps.createCard({ lat: Number(r.lat), lng: Number(r.lng), codePromise: r.code || null }); }
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
export async function renderSavedSvPicker(box, pick) {
  const { esc } = deps;
  box.innerHTML = '<span class="muted small">読み込み中…</span>';
  try { await loadSavedSv(true); } catch (e) { box.innerHTML = `<span class="muted small">${esc(e.message)}</span>`; return; }
  if (!list.length) { box.innerHTML = '<span class="muted small">保存したストリートビューはまだありません（ストリートビューのウィンドウの保存ボタンで追加できます）</span>'; return; }
  box.innerHTML = `<div class="sv-pick">${list.map((r) => `<button type="button" class="pl-hit sv-pick-item" data-sv="${esc(r.id)}">
      <span class="pl-flag">${r.code ? deps.flagImg(r.code) : '📍'}</span>
      <span class="pl-title"><b>${esc(svLabel(r))}</b>${[r.name_en, r.name_local].filter((x) => x && x !== r.name).map((n) => ` <em>${esc(n)}</em>`).join('')}</span>
      <span class="muted small">${esc(r.code ? deps.countryName(r.code) : '')}${r.admin ? ` · ${esc(r.admin)}` : ''}</span>
    </button>`).join('')}</div>`;
  box.querySelectorAll('[data-sv]').forEach((b) => b.addEventListener('click', () => {
    const r = list.find((x) => x.id === b.dataset.sv);
    if (r) pick({ name: svLabel(r), en: r.name_en || '', local: r.name_local || '', sub: r.admin || '', code: r.code || '', lat: Number(r.lat), lng: Number(r.lng), zoom: 13 });
  }));
}
