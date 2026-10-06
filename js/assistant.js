// AI アシスタント（カード・参考写真・国のデータを読み取って答えるチャット）
// 上のバーのボタンで開閉するパネル。質問に合わせて askctx.js が参考資料を選び、/api/ask（Cloudflare の関数）経由で Gemini に送る
// パネルはポップオーバー（最前面の層）にして、カード詳細などのモーダルの手前にも出す（メモ・chat.js と同じしくみ）

import { buildContext } from './askctx.js';
import { ensureRefInfo } from './refimages.js';
import { compressImage, blobToDataUrl } from './image.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let api;
let toast;
let deps; // アプリ側から: { getDeps(), openCard(id), openPhoto(ref), openCountry(code), countryName(code), imageBlobFor(pinned) }
let btn;
let panel;
let messages = []; // { role, content, text?, refs?, sources?, error?, image? }
let busy = false;
let controller = null;
let attached = null; // { blob, url }（これから送る画像）
let pinned = null; // { type: 'card', id } / { type: 'photo', topic, code, rel }: いま開いているカード・写真について聞く

const canPopover = () => typeof HTMLElement !== 'undefined' && 'showPopover' in HTMLElement.prototype;
const show = (el) => { if (canPopover()) { try { if (el.matches(':popover-open')) el.hidePopover(); el.showPopover(); } catch { /* 非対応 */ } } };
const hide = (el) => { if (canPopover()) { try { if (el.matches(':popover-open')) el.hidePopover(); } catch { /* 非対応 */ } } };
const isOpen = () => panel?.classList.contains('open');

const SUGGESTIONS = [
  'ポーランドのボラードの特徴は？',
  '黄色地に黒の矢印のシェブロンは、どの国に多い？',
  'キリル文字を使う国の見分け方を教えて',
  '私の苦手な国と、復習のおすすめは？',
];

export function initAssistant(opts) {
  ({ api, toast } = opts);
  deps = opts;
  if (btn) { btn.hidden = false; return; }
  build();
}

export function teardownAssistant() {
  if (!btn) return;
  controller?.abort();
  closePanel();
  btn.hidden = true;
  messages = [];
  attached = null;
  pinned = null;
  busy = false;
}

/** パネルを開く。opts.pinned を渡すと、そのカード・写真について聞く（画像も付ける）。opts.question があれば入力欄に入れる */
export async function openAssistant(opts = {}) {
  if (!panel) return;
  if (opts.pinned) {
    pinned = opts.pinned;
    attached = null;
    messages = [];
  }
  openPanel();
  if (opts.question) { const i = panel.querySelector('.ai-input'); i.value = opts.question; i.dispatchEvent(new Event('input')); i.focus(); }
  if (opts.pinned) {
    try {
      const blob = await deps.imageBlobFor(opts.pinned);
      if (blob && pinned === opts.pinned) await attachBlob(blob);
    } catch { /* 画像なしで続行 */ }
  }
}

// ---- モーダルの手前に出すしくみ（chat.js と同じ）
function topHost() {
  for (const sel of ['dialog.viewer', '#modal', '#spotlight']) {
    const d = document.querySelector(sel);
    if (d?.open && !d.classList.contains('closing') && !d.classList.contains('is-window')) return d;
  }
  return document.body;
}
export function raiseAssistant() {
  if (!btn || btn.hidden || !panel) return;
  const host = topHost();
  if (panel.parentNode !== host) host.append(panel);
  if (isOpen()) show(panel);
}
document.addEventListener('close', () => setTimeout(raiseAssistant, 0), true);
window.addEventListener('geo:dialog', () => raiseAssistant());

function build() {
  btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'icon-btn ai-btn';
  btn.title = 'AI に質問（カードや参考写真を読み取って答えます）';
  btn.setAttribute('aria-label', 'AI に質問');
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>';
  btn.addEventListener('click', () => (isOpen() ? closePanel() : openPanel()));
  const anchor = document.getElementById('sound-btn');
  if (anchor?.parentNode) anchor.parentNode.insertBefore(btn, anchor); else document.body.appendChild(btn);

  panel = document.createElement('section');
  panel.className = 'ai-panel';
  panel.setAttribute('popover', 'manual');
  panel.setAttribute('aria-label', 'AI アシスタント');
  panel.innerHTML = `
    <header class="ai-head">
      <b>✨ AI に質問</b>
      <span class="grow"></span>
      <button type="button" class="btn btn-ghost btn-sm ai-new" title="会話を新しく始める">新しい会話</button>
      <button type="button" class="icon-btn ai-close" aria-label="閉じる">✕</button>
    </header>
    <div class="ai-list" tabindex="-1" aria-live="polite"></div>
    <div class="ai-pinned" hidden></div>
    <div class="ai-attach" hidden></div>
    <form class="ai-form">
      <button type="button" class="icon-btn ai-clip" title="画像を添付（貼り付け・ドロップでも）" aria-label="画像を添付">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21 11-9.2 9.2a5 5 0 0 1-7-7L14 3.9a3.3 3.3 0 0 1 4.7 4.7l-9.2 9.2a1.7 1.7 0 0 1-2.4-2.4L15 7"/></svg>
      </button>
      <input type="file" class="ai-file" accept="image/*" hidden>
      <textarea class="ai-input" rows="1" placeholder="質問を書く（Enter で送信・Shift+Enter で改行）" enterkeyhint="send"></textarea>
      <button type="submit" class="ai-send" aria-label="送信">
        <svg class="ai-send-icon" viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M3.4 20.4 21 12 3.4 3.6 3.4 10 15 12 3.4 14z"/></svg>
        <svg class="ai-stop-icon" viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
      </button>
    </form>
    <p class="ai-foot muted">AI は間違えることがあります。質問と、関係するカード・写真の情報は Google の Gemini API（無料枠）に送られ、Google のサービスの改善に使われることがあります。</p>`;
  document.body.appendChild(panel);

  const input = panel.querySelector('.ai-input');
  const form = panel.querySelector('.ai-form');
  const fileInput = panel.querySelector('.ai-file');
  const autosize = () => { input.style.height = 'auto'; input.style.height = `${Math.min(140, input.scrollHeight)}px`; };
  input.addEventListener('input', autosize);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePanel(); }
  });
  panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closePanel(); } });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (busy) { controller?.abort(); return; }
    const text = input.value.trim();
    if (!text && !attached) return;
    input.value = '';
    autosize();
    send(text || 'この画像について教えてください');
  });
  panel.querySelector('.ai-close').addEventListener('click', closePanel);
  panel.querySelector('.ai-new').addEventListener('click', () => {
    controller?.abort();
    messages = [];
    pinned = null;
    attached = null;
    renderAll();
    input.focus();
  });
  panel.querySelector('.ai-clip').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => { if (fileInput.files[0]) attachBlob(fileInput.files[0]); fileInput.value = ''; });
  input.addEventListener('paste', (e) => {
    const f = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'))?.getAsFile();
    if (f) { e.preventDefault(); attachBlob(f); }
  });
  panel.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); });
  panel.addEventListener('drop', (e) => {
    const f = [...(e.dataTransfer?.files || [])].find((x) => x.type.startsWith('image/'));
    if (f) { e.preventDefault(); attachBlob(f); }
  });
  panel.querySelector('.ai-list').addEventListener('click', onListClick);
  panel.querySelector('.ai-pinned').addEventListener('click', (e) => { if (e.target.closest('[data-unpin]')) { pinned = null; renderPinned(); } });
  panel.querySelector('.ai-attach').addEventListener('click', (e) => { if (e.target.closest('[data-unattach]')) { attached = null; renderAttach(); } });
  renderAll();
}

function openPanel() {
  panel.classList.add('open');
  btn.classList.add('active');
  raiseAssistant();
  show(panel);
  renderAll();
  panel.querySelector('.ai-input').focus();
}
function closePanel() {
  if (!panel) return;
  panel.classList.remove('open');
  btn.classList.remove('active');
  hide(panel);
}

// ---- 添付画像（長辺 1280px に縮めてから送る）
async function attachBlob(blob) {
  if (!blob?.type?.startsWith('image/')) { toast('画像ファイルではありません', 'error'); return; }
  try {
    const small = await compressImage(blob, 1280, 0.8);
    attached = { blob: small, url: await blobToDataUrl(small) };
    renderAttach();
  } catch (ex) {
    toast(`画像を読み込めませんでした: ${ex.message}`, 'error');
  }
}
function renderAttach() {
  const el = panel.querySelector('.ai-attach');
  el.hidden = !attached;
  el.innerHTML = attached ? `<img src="${esc(attached.url)}" alt="添付する画像"><span class="muted small">この画像も一緒に送ります</span><button type="button" class="icon-btn" data-unattach aria-label="画像を外す">✕</button>` : '';
}
function renderPinned() {
  const el = panel.querySelector('.ai-pinned');
  el.hidden = !pinned;
  if (!pinned) { el.innerHTML = ''; return; }
  const label = pinned.type === 'card' ? `📇 ${esc(deps.pinnedLabel(pinned))} のカード` : `📷 ${esc(deps.pinnedLabel(pinned))}`;
  el.innerHTML = `<span>${label} について質問中</span><button type="button" class="icon-btn" data-unpin aria-label="外す" title="このカードの質問をやめる">✕</button>`;
}

// ---- 表示
function renderAll() {
  const list = panel.querySelector('.ai-list');
  if (!messages.length) {
    list.innerHTML = `<div class="ai-empty">
      <p><b>カードや参考写真を読み取って答えます</b></p>
      <p class="muted small">国・ボラード・シェブロン・言語などについて聞いてみてください。画像（📎・貼り付け・ドロップ）を付けると、写真から国を推理します。</p>
      <div class="ai-suggest">${SUGGESTIONS.map((q) => `<button type="button" class="chip chip-btn" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>
    </div>`;
  } else {
    list.innerHTML = messages.map((m, i) => messageHtml(m, i)).join('');
  }
  renderPinned();
  renderAttach();
  panel.classList.toggle('is-busy', busy);
  list.scrollTop = list.scrollHeight;
}

function messageHtml(m, i) {
  if (m.role === 'user') {
    return `<div class="ai-msg ai-user">${m.image ? `<img class="ai-user-img" src="${esc(m.image)}" alt="添付した画像">` : ''}<div class="ai-bubble">${esc(m.text ?? m.content).replace(/\n/g, '<br>')}</div></div>`;
  }
  if (m.error) return `<div class="ai-msg ai-bot"><div class="ai-bubble ai-error">${m.error}</div></div>`;
  const body = m.content ? renderMarkdown(m.content, m.refs) : '<span class="ai-typing" aria-label="考え中"><i></i><i></i><i></i></span>';
  const srcs = (m.sources || []).length ? `<details class="ai-src"><summary>参照した資料 ${m.sources.length} 件</summary><div class="ai-src-list">${m.sources.map((s) => `<button type="button" class="ai-ref" data-msg="${i}" data-ref="${s.id}" title="${esc(s.label)}">${s.id.startsWith('C') ? '📇' : '📷'} ${esc(s.label)}</button>`).join('')}</div></details>` : '';
  return `<div class="ai-msg ai-bot"><div class="ai-bubble">${body}</div>${srcs}</div>`;
}

// 簡単な Markdown（太字・インラインコード・箇条書き・見出し）と、[C1] [P2] [国:PL] を押せる印にする
function renderMarkdown(text, refs) {
  const inline = (s) => esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[(国:[A-Z]{2}(?:\s*[,、]\s*国:[A-Z]{2})*)\]/g, (_, ids) => ids.split(/\s*[,、]\s*/).map((x) => refButton(x, refs)).join(''))
    .replace(/\[([CP]\d+(?:\s*[,、]\s*[CP]\d+)*)\]/g, (_, ids) => ids.split(/\s*[,、]\s*/).map((x) => refButton(x, refs)).join(''));
  const out = [];
  let list = null;
  const flush = () => { if (list) { out.push(`<${list.tag}>${list.items.join('')}</${list.tag}>`); list = null; } };
  for (const line of text.split('\n')) {
    const ul = /^\s*[-*・]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const h = /^#{1,4}\s+(.*)$/.exec(line);
    if (ul || ol) {
      const tag = ul ? 'ul' : 'ol';
      if (!list || list.tag !== tag) { flush(); list = { tag, items: [] }; }
      list.items.push(`<li>${inline((ul || ol)[1])}</li>`);
    } else {
      flush();
      if (h) out.push(`<p class="ai-h">${inline(h[1])}</p>`);
      else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
    }
  }
  flush();
  return out.join('');
}
function refButton(id, refs) {
  const key = id.trim();
  if (key.startsWith('国:')) {
    const code = key.slice(2);
    const name = deps.countryName(code);
    return name && name !== code ? `<button type="button" class="ai-ref ai-ref-c" data-country="${code}">🌐 ${esc(name)}</button>` : esc(`[${key}]`);
  }
  const r = refs?.get(key);
  if (!r) return esc(`[${key}]`);
  return `<button type="button" class="ai-ref" data-ref="${key}" data-refs-owner="1">${key.startsWith('C') ? '📇' : '📷'} ${key}</button>`;
}

function onListClick(e) {
  const sug = e.target.closest('[data-q]');
  if (sug) { send(sug.dataset.q); return; }
  const c = e.target.closest('[data-country]');
  if (c) { deps.openCountry(c.dataset.country); return; }
  const r = e.target.closest('[data-ref]');
  if (!r) return;
  const bubble = r.closest('.ai-msg');
  const idx = r.dataset.msg != null ? Number(r.dataset.msg) : [...panel.querySelectorAll('.ai-msg')].indexOf(bubble);
  const m = messages[idx];
  const ref = m?.refs?.get(r.dataset.ref);
  if (!ref) return;
  if (ref.kind === 'card') deps.openCard(ref.id);
  else deps.openPhoto(ref);
}

// ---- 送信と、ストリーミングの受信
const stripRefs = (t) => t.replace(/\[(?:[CP]\d+|国:[A-Z]{2})(?:\s*[,、]\s*(?:[CP]\d+|国:[A-Z]{2}))*\]/g, '').replace(/ {2,}/g, ' ');

async function send(text) {
  if (busy) return;
  const question = text.trim();
  if (!question) return;
  const history = messages.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.role === 'assistant' ? stripRefs(m.content) : m.content }));
  const image = attached;
  const pin = pinned;
  attached = null;
  messages.push({ role: 'user', content: question, image: image?.url });
  const bot = { role: 'assistant', content: '', refs: new Map(), sources: [] };
  messages.push(bot);
  busy = true;
  controller = new AbortController();
  renderAll();
  try {
    await ensureRefInfo().catch(() => {}); // 参考写真の解説・撮影場所
    const ctx = buildContext({ question, history, deps: deps.getDeps(), pinned: pin });
    bot.refs = ctx.refs;
    bot.sources = ctx.sources;
    const payload = { messages: [...history.slice(-10), { role: 'user', content: question }], context: ctx.text };
    if (image) payload.image = { media_type: image.blob.type, data: (await blobToDataUrl(image.blob)).split(',')[1] };
    const token = await api.getAccessToken();
    const res = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) { bot.error = await errorText(res); bot.content = ''; return; }
    await readStream(res, bot);
    if (!bot.content.trim()) bot.error = '答えを受け取れませんでした。もう一度お試しください。';
  } catch (ex) {
    if (ex.name === 'AbortError') { if (!bot.content) messages.splice(messages.indexOf(bot), 1); else bot.content += '\n\n（停止しました）'; } else bot.error = `通信に失敗しました: ${esc(ex.message)}`;
  } finally {
    busy = false;
    controller = null;
    if (isOpen()) renderAll();
  }
}

async function errorText(res) {
  let data = {};
  try { data = await res.json(); } catch { /* 本文なし */ }
  if (data.error === 'not_configured') return 'AI アシスタントは、まだ使えるように設定されていません。<br><span class="small">管理者が Cloudflare Pages の「設定 → 変数とシークレット」に <code>GEMINI_API_KEY</code>（Google AI Studio で無料で作れる API キー）をシークレットとして追加し、再デプロイすると使えます（README の「AI アシスタントの設定」を参照）。</span>';
  if (data.error === 'unauthorized') return 'ログインの確認ができませんでした。いったんログアウトして、もう一度ログインしてください。';
  if (data.error === 'editors_only') return 'AI アシスタントは、今のところ編集者のアカウントだけが使えます。';
  if (data.error === 'bad_key') return 'AI の API キーが無効か、権限がありません。管理者に伝えてください。';
  if (data.error === 'rate_limited') return esc(data.message || '利用が集中しています。少し待ってからもう一度お試しください。');
  if (data.error === 'too_large' || data.error === 'bad_image') return '画像が大きすぎるか、形式に対応していません。別の画像でお試しください。';
  if (res.status === 404) return 'この環境では AI アシスタントを使えません（サーバー側の機能がありません）。';
  return `AI から答えをもらえませんでした（${res.status}）。${data.message ? esc(data.message) : '少し待ってからもう一度お試しください。'}`;
}

// Server-Sent Events: 空行で区切られた "data: {...}" を順に読み、本文（text_delta）をつなげて表示する
async function readStream(res, bot) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let raf = 0;
  const paint = () => {
    raf = 0;
    if (!isOpen()) return;
    const l = panel.querySelector('.ai-list');
    const atEnd = l.scrollHeight - l.scrollTop - l.clientHeight < 80;
    const top = l.scrollTop;
    renderAll();
    l.scrollTop = atEnd ? l.scrollHeight : top; // 上に戻って読んでいるときは、位置を動かさない
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const data = chunk.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
      if (!data) continue;
      let ev;
      try { ev = JSON.parse(data); } catch { continue; }
      if (typeof ev.text === 'string') bot.content += ev.text;
      else if (ev.error) bot.error = esc(ev.error || '途中でエラーが起きました');
      else if (ev.done) {
        if (/^(BLOCKED|SAFETY|PROHIBITED_CONTENT|RECITATION)/.test(ev.reason || '')) bot.content += bot.content ? '\n\n（ここで止まりました。この質問にはお答えできません）' : '';
        else if (ev.reason === 'MAX_TOKENS') bot.content += '\n\n（長くなったため、ここで終わっています）';
      }
      if (!raf) raf = requestAnimationFrame(paint);
    }
  }
  if (raf) cancelAnimationFrame(raf);
}
