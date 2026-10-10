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
const sel = new Set(); // 選択中の保存したストリートビューの id（編集者だけ）
let anchor = null;

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
/** p から maxM メートル以内で、いちばん近い保存済みの行（_dist に距離を入れて返す）。なければ null */
export function nearestSavedSv(p, maxM = 100) {
  let best = null;
  let bestD = Infinity;
  for (const x of list || []) { const d = distM(x, p); if (d < bestD) { bestD = d; best = x; } }
  return best && bestD <= maxM ? { ...best, _dist: bestD } : null;
}

/** 地名だけ: 日本語 → 英語 → 現地の言語 → 座標 */
export const placeLabel = (r) => r.name || r.name_en || r.name_local || `${Number(r.lat).toFixed(4)}, ${Number(r.lng).toFixed(4)}`;
/** 表示用の名前: 自分でつけた名前があればそれ、なければ地名 */
export const svLabel = (r) => r.title || placeLabel(r);
export const savedSvById = (id) => list?.find((x) => x.id === id) || null;

/** 今開いているストリートビューを保存する（国と地名は自動で付ける）。保存した行を返す */
export async function saveSv({ lat, lng, heading = 0, pitch = 0, fov = 0 }) {
  await loadSavedSv().catch((e) => { deps.toast(e.message, 'error'); throw e; });
  const dup = savedSvAt({ lat, lng, heading });
  if (dup) {
    // 同じ場所とみなされる範囲（約 3m・向き 30 度未満）で、もう一度保存したときは、保存した場所の位置・向き・ズームを今の状態に更新する（名前・地名・関連付けはそのまま）
    const changed2 = Math.abs(Number(dup.lat) - lat) > 1e-7 || Math.abs(Number(dup.lng) - lng) > 1e-7 || Math.abs((Number(dup.heading) || 0) - heading) > 0.5 || Math.abs((Number(dup.pitch) || 0) - pitch) > 0.5 || Math.abs((Number(dup.fov) || 0) - fov) > 0.5;
    if (!changed2) { deps.toast('この場所は、すでに今の状態で保存してあります'); return dup; }
    const row = await deps.api().updateSavedSv(dup.id, { lat, lng, heading, pitch, fov }).catch((e) => { deps.toast(e.message || '更新できませんでした', 'error'); throw e; });
    Object.assign(dup, row);
    changed();
    refreshSvWindow();
    deps.toast(`保存した場所を更新しました: ${svLabel(dup)}`);
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

/** 名前（自分でつけた名前）を変える。空にすると、地名の表示に戻る。変えた行を返す */
export async function renameSv(id, title) {
  const r = (list || []).find((x) => x.id === id);
  if (!r) throw new Error('見つかりません');
  const row = await deps.api().updateSavedSv(id, { title: String(title || '').trim() });
  Object.assign(r, row);
  changed();
  refreshSvWindow();
  return r;
}

export async function deleteSv(id) {
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
  const arts = deps.articlesFor?.(r.id) || []; // この場所にリンクしている記事
  return `<article class="sv-item${sel.has(r.id) ? ' is-selected' : ''}" data-id="${esc(r.id)}">
    ${deps.isEditor() ? `<label class="sv-check" title="選択（Shift で範囲・Ctrl でひとつずつ）"><input type="checkbox" aria-label="この場所を選択" ${sel.has(r.id) ? 'checked' : ''}></label>` : ''}
    <button type="button" class="sv-item-main" data-open="${esc(r.id)}" title="ストリートビューをウィンドウで開く">
      <span class="sv-item-flag">${r.code ? deps.flagImg(r.code) : '📍'}</span>
      <span class="sv-item-text">
        <b class="sv-item-title">${head}</b>
        <span class="muted small">${sub || '&nbsp;'}</span>
        <span class="muted small">${Number(r.lat).toFixed(4)}, ${Number(r.lng).toFixed(4)}${r.created_at ? ` · ${esc(dateText(r.created_at))}` : ''}</span>
      </span>
    </button>
    ${cards.length ? `<div class="sv-item-cards"><span class="muted small">🔗 関連カード</span>${cards.map((c) => `<button type="button" class="sv-card-chip" data-card-open="${esc(c.id)}" title="${esc(c.description || '')}">${c.countries?.[0] ? deps.flagImg(c.countries[0]) : ''}<span>${esc(deps.cardLabel(c))}</span></button>`).join('')}</div>` : ''}
    ${arts.length ? `<div class="sv-item-cards"><span class="muted small">📝 関連記事</span>${arts.map((a) => `<button type="button" class="sv-card-chip" data-article-open="${esc(a.id)}" title="${esc(a.title || '')}">${esc(a.title || '無題')}</button>`).join('')}</div>` : ''}
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
      try { await renameSv(r.id, input.value); deps.toast('名前を変えました'); } catch (err) { deps.toast(err.message || '変えられませんでした', 'error'); }
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
      <div class="sel-bar sv-selbar" id="sv-selbar" hidden>
        <span id="sv-sel-count"></span>
        <button type="button" class="btn btn-ghost btn-sm" id="sv-sel-all">☑ 全選択</button>
        <button type="button" class="btn btn-ghost btn-sm" id="sv-sel-none">☐ 選択解除</button>
        <span class="grow"></span>
        <button type="button" class="btn btn-danger btn-sm" id="sv-sel-del">選択を削除</button>
      </div>
      <p class="muted small sv-hint">ストリートビューのウィンドウの <b>保存</b> ボタンで、ここに場所が増えます。国と大まかな地名は自動で付きます。</p>
      <div id="sv-list" class="sv-list"><div class="empty page-loading"><span class="spinner"></span>読み込み中…</div></div>
    </div>`;
  const q = view.querySelector('#sv-q');
  let composing = false;
  sel.clear(); anchor = null;
  const shownIds = () => (list || []).filter((r) => matches(r, search.q)).map((r) => r.id);
  const updateSel = () => { // 選択の見た目と上の操作バーを、描き直さずに更新
    for (const id of [...sel]) if (!list?.some((r) => r.id === id)) sel.delete(id);
    view.querySelectorAll('.sv-item[data-id]').forEach((el) => { const on = sel.has(el.dataset.id); el.classList.toggle('is-selected', on); const cb = el.querySelector('.sv-check input'); if (cb) cb.checked = on; });
    const bar = view.querySelector('#sv-selbar'); if (!bar) return;
    bar.hidden = !sel.size;
    view.querySelector('#sv-sel-count').textContent = `${sel.size} 件を選択中`;
  };
  const draw = () => {
    const box = view.querySelector('#sv-list');
    if (!box) return;
    const rows = (list || []).filter((r) => matches(r, search.q));
    view.querySelector('#sv-count').textContent = list ? `${rows.length} / ${list.length} 件` : '';
    box.innerHTML = rows.length ? rows.map(rowHtml).join('') : `<div class="empty">${list?.length ? '一致する場所がありません' : '保存したストリートビューはまだありません。<br>地図の ストリートビュー ボタン → 道路をクリック → ウィンドウの 保存 ボタンで追加できます。'}</div>`;
    updateSel();
  };
  view.querySelector('#sv-sel-all').addEventListener('click', () => { shownIds().forEach((id) => sel.add(id)); updateSel(); });
  view.querySelector('#sv-sel-none').addEventListener('click', () => { sel.clear(); anchor = null; updateSel(); });
  view.querySelector('#sv-sel-del').addEventListener('click', async () => {
    const ids = [...sel].filter((id) => list?.some((r) => r.id === id));
    if (!ids.length || !(await deps.confirmDialog(`選択した ${ids.length} 件の保存を削除しますか？（元に戻せません）`))) return;
    let ok = 0; let ng = 0;
    for (const id of ids) { try { await deleteSv(id); ok++; sel.delete(id); } catch { ng++; } }
    deps.toast(ng ? `${ok} 件を削除しました（${ng} 件は、できませんでした）` : `${ok} 件を削除しました`, ng ? 'error' : undefined);
    draw(); refreshSvWindow();
  });
  // 選択: チェック / Shift+クリックで範囲 / Ctrl(⌘)+クリックでひとつずつ。選択中は、行を押すだけでも切り替わる
  view.querySelector('#sv-list').addEventListener('mousedown', (e) => { if (e.shiftKey && e.target.closest('.sv-item')) e.preventDefault(); });
  view.querySelector('#sv-list').addEventListener('click', (e) => {
    if (!deps.isEditor() || e.target.closest('.sv-rename')) return;
    const item = e.target.closest('.sv-item[data-id]');
    if (!item) return;
    const check = e.target.closest('.sv-check');
    const selecting = check || e.shiftKey || e.ctrlKey || e.metaKey || (sel.size > 0 && e.target.closest('.sv-item-main'));
    if (!selecting) return;
    if (!check && e.target.closest('.sv-item-actions, .sv-item-cards')) return;
    e.stopImmediatePropagation(); // 同じ要素の、ほかのクリック処理（開く・削除など）は動かさない
    const id = item.dataset.id;
    if (e.shiftKey && anchor && anchor !== id) {
      const ids = shownIds(); const [a, b] = [ids.indexOf(anchor), ids.indexOf(id)].sort((x, y) => x - y);
      if (a >= 0) { ids.slice(a, b + 1).forEach((x) => sel.add(x)); anchor = id; updateSel(); e.preventDefault(); return; }
    }
    if (!check) e.preventDefault();
    if (sel.has(id)) sel.delete(id); else sel.add(id);
    anchor = id; updateSel();
  }, true);
  q.addEventListener('compositionstart', () => { composing = true; });
  q.addEventListener('compositionend', () => { composing = false; search.q = q.value; draw(); });
  q.addEventListener('input', (e) => { if (composing || e.isComposing) return; search.q = q.value; draw(); });
  // 右クリックは、新しいウィンドウで開く（PC）
  view.querySelector('#sv-list').addEventListener('contextmenu', (e) => {
    const open = e.target.closest('[data-open]');
    const r = open && list?.find((x) => x.id === open.dataset.open);
    if (!r || !matchMedia('(min-width: 900px) and (pointer: fine)').matches) return;
    e.preventDefault();
    deps.openSv(Number(r.lat), Number(r.lng), rowView(r), { newWindow: true });
  });
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
        try { await deleteSv(r.id); draw(); refreshSvWindow(); } catch (err) { deps.toast(err.message || '削除できませんでした', 'error'); }
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
