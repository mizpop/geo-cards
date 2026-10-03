// チャット形式のメモ（画面右下のボタンで開閉。どの画面からでも使える）
// ボタンとパネルはポップオーバー（最前面の層）にして、カード詳細などのモーダルの手前にも出す

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const linkify = (html) => html.replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);

let api;
let user;
let toast;
let memos = [];
let loaded = false;
let btn;
let panel;
let pollTimer = null;
let unsubscribe = null;
let unread = false;

const canPopover = () => typeof HTMLElement !== 'undefined' && 'showPopover' in HTMLElement.prototype;
const show = (el) => { if (canPopover()) { try { if (el.matches(':popover-open')) el.hidePopover(); el.showPopover(); } catch { /* 非対応 */ } } };
const hide = (el) => { if (canPopover()) { try { if (el.matches(':popover-open')) el.hidePopover(); } catch { /* 非対応 */ } } };
const isOpen = () => panel?.classList.contains('open');

export function initChat(opts) {
  ({ api, toast } = opts);
  user = opts.user;
  memos = [];
  loaded = false;
  if (!btn) build();
  btn.hidden = false;
  show(btn);
  // 閉じている間も変更を受け取り、ほかの人の新しいメモはボタンの赤い点で知らせる
  unsubscribe?.();
  unsubscribe = api.subscribeMemos ? api.subscribeMemos(onRemoteChange) : null;
}

function setUnread(on) {
  unread = on;
  btn?.querySelector('.chat-badge')?.toggleAttribute('hidden', !on);
}

function onRemoteChange(type, row, old) {
  if (type === 'INSERT' && row) {
    if (!memos.some((m) => m.id === row.id)) memos.push(row);
    if (isOpen()) renderList(false);
    else if (row.user_id !== user.id) setUnread(true);
  } else if (type === 'DELETE' && old?.id) {
    memos = memos.filter((m) => m.id !== old.id);
    if (isOpen()) renderList(false);
  } else {
    // 中身が分からない通知（デモの別タブなど）は読み直す
    if (isOpen()) refresh(false); else setUnread(true);
  }
}

export function teardownChat() {
  if (!btn) return;
  closePanel();
  unsubscribe?.();
  unsubscribe = null;
  setUnread(false);
  btn.hidden = true;
  hide(btn);
  memos = [];
  loaded = false;
}

// モーダル（カード詳細・検索パネル・画像の全画面表示）を開くと、その外側は操作できなくなる（ブラウザの仕様）。
// そこで、開いているうち一番手前のモーダルの中にボタンとパネルを移し、手前に積み直す。閉じたら元に戻す
function topHost() {
  for (const sel of ['dialog.viewer', '#modal', '#spotlight']) {
    const d = document.querySelector(sel);
    if (d?.open && !d.classList.contains('closing')) return d;
  }
  return document.body;
}
export function raiseChat() {
  if (!btn || btn.hidden) return;
  const host = topHost();
  if (btn.parentNode !== host) host.append(btn, panel); // 移すとポップオーバーは一旦閉じるので下で開き直す
  show(btn);
  if (isOpen()) show(panel);
}
// モーダルが閉じたら（close は伝わらないイベントなので capture で拾う）、残っている画面か本体に戻す
document.addEventListener('close', () => setTimeout(raiseChat, 0), true);
window.addEventListener('geo:dialog', () => raiseChat());

function build() {
  btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'chat-fab';
  btn.title = 'メモ';
  btn.setAttribute('aria-label', 'メモを開く');
  btn.setAttribute('popover', 'manual');
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.8 7L4 20l1.1-4.6A8 8 0 1 1 21 12z"/><path d="M8.5 11h7M8.5 14h4.5"/></svg><span class="chat-badge" hidden></span>';
  btn.addEventListener('click', () => (isOpen() ? closePanel() : openPanel()));
  document.body.appendChild(btn);

  panel = document.createElement('section');
  panel.className = 'chat-panel';
  panel.setAttribute('popover', 'manual');
  panel.setAttribute('aria-label', 'メモ');
  panel.innerHTML = `
    <header class="chat-head">
      <b>📝 メモ</b><span class="chat-count muted"></span>
      <button type="button" class="icon-btn chat-close" aria-label="閉じる">✕</button>
    </header>
    <div class="chat-list" tabindex="-1"></div>
    <form class="chat-form">
      <textarea class="chat-input" rows="1" placeholder="メモを書く（Enter で送信・Shift+Enter で改行）" enterkeyhint="send"></textarea>
      <button type="submit" class="chat-send" aria-label="送信">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M3.4 20.4 21 12 3.4 3.6 3.4 10 15 12 3.4 14z"/></svg>
      </button>
    </form>`;
  document.body.appendChild(panel);

  panel.querySelector('.chat-close').addEventListener('click', closePanel);
  const input = panel.querySelector('.chat-input');
  const form = panel.querySelector('.chat-form');
  const autosize = () => { input.style.height = 'auto'; input.style.height = `${Math.min(140, input.scrollHeight)}px`; };
  input.addEventListener('input', autosize);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePanel(); }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = input.value.trim();
    if (!body) return;
    input.value = '';
    autosize();
    try {
      const row = await api.addMemo(body, user.email || '');
      memos.push(row);
      renderList(true);
    } catch (ex) {
      input.value = body;
      autosize();
      toast(`メモを保存できませんでした: ${ex.message}`, 'error');
    }
  });
  panel.querySelector('.chat-list').addEventListener('click', async (e) => {
    const del = e.target.closest('[data-del]');
    if (!del) return;
    if (!confirm('このメモを削除しますか？')) return;
    try {
      await api.deleteMemo(del.dataset.del);
      memos = memos.filter((m) => m.id !== del.dataset.del);
      renderList(false);
    } catch (ex) {
      toast(`削除できませんでした: ${ex.message}`, 'error');
    }
  });
}

async function openPanel() {
  panel.classList.add('open');
  btn.classList.add('active');
  setUnread(false);
  show(panel);
  show(btn);
  renderList(true);
  await refresh(true);
  panel.querySelector('.chat-input').focus();
  // 基本はリアルタイム配信で即座に届く。届かなかったときの保険として、開いている間は 10 秒ごとにも確認
  clearInterval(pollTimer);
  pollTimer = setInterval(() => refresh(false), 10000);
}

function closePanel() {
  if (!panel) return;
  panel.classList.remove('open');
  btn.classList.remove('active');
  hide(panel);
  clearInterval(pollTimer);
}

async function refresh(scrollToEnd) {
  try {
    const list = await api.listMemos();
    const sig = (arr) => arr.map((m) => m.id).join(',');
    const changed = !loaded || sig(list) !== sig(memos);
    memos = list;
    loaded = true;
    if (changed) renderList(scrollToEnd);
  } catch (ex) {
    if (!loaded) panel.querySelector('.chat-list').innerHTML = `<p class="chat-empty">メモを読み込めませんでした<br><small>${esc(ex.message)}</small></p>`;
  }
}

const dayLabel = (d) => {
  const today = new Date();
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  const same = (a, b) => a.toDateString() === b.toDateString();
  if (same(d, today)) return '今日';
  if (same(d, y)) return '昨日';
  return d.toLocaleDateString('ja-JP', { year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
};

function renderList(scrollToEnd) {
  const list = panel.querySelector('.chat-list');
  const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  panel.querySelector('.chat-count').textContent = memos.length ? `${memos.length} 件` : '';
  if (!loaded && !memos.length) { list.innerHTML = '<p class="chat-empty">読み込み中…</p>'; return; }
  if (!memos.length) {
    list.innerHTML = '<p class="chat-empty">まだメモはありません<br><small>気づいたこと・覚えたいことを書き留めましょう</small></p>';
    return;
  }
  let lastDay = '';
  const html = [];
  for (const m of memos) {
    const d = new Date(m.created_at);
    const day = d.toDateString();
    if (day !== lastDay) { html.push(`<div class="chat-day"><span>${esc(dayLabel(d))}</span></div>`); lastDay = day; }
    const mine = m.user_id === user.id;
    const canDelete = mine || user.isEditor;
    const time = d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    html.push(`
      <div class="chat-msg ${mine ? 'mine' : 'other'}">
        ${mine ? '' : `<div class="chat-author">${esc((m.author || '').split('@')[0] || '不明')}</div>`}
        <div class="chat-row">
          <div class="chat-bubble">${linkify(esc(m.body)).replace(/\n/g, '<br>')}</div>
          <div class="chat-meta"><time>${time}</time>${canDelete ? `<button type="button" class="chat-del" data-del="${esc(m.id)}" title="削除" aria-label="削除">✕</button>` : ''}</div>
        </div>
      </div>`);
  }
  list.innerHTML = html.join('');
  if (scrollToEnd || atBottom) list.scrollTop = list.scrollHeight;
}
