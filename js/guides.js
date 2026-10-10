import { openArticleAi } from './aiarticle.js';
// ガイド: ユーザーが書く記事（マークダウン）。一覧（タブ）・フォルダ・編集・読む（ウィンドウ）の部品
// 記事の書式: 見出し(# ## ###)・太字 **x**・斜体 *x*・取り消し ~~x~~・`コード`・```コードブロック```・箇条書き(- / 1.)・引用(>)・区切り(---)・表(| a | b |)・リンク [文字](https://…)
//   画像: ![説明](img:パス)（アップロード・貼り付け。ストレージに保存） / ![説明](card:カードのid)（カードの画像をそのまま使う。容量を使わない）
//   リンク: [[card:id]]（カード）・[[sv:id]]（保存したストリートビュー）・[[article:id]]（別の記事）。カードの「関連カード」「関連ストリートビュー」と同じ見た目で出る
const EMOJIS = '📝 📚 📖 🗺 🌍 🌏 🧭 📍 🚗 🛣 🚧 🛑 ⚡ 🔌 🏠 🏔 🌴 🌲 🌵 ❄ 🌊 🏝 🚩 🏳 🔤 🔢 🚘 🪧 🧠 💡 ⭐ 🔥 ✅ ❓ ⚠ 🎯 🏆 🧩 🔍 📷 🎒 🕹 🧪 📌 📎 🗂 📁'.split(' ');

let deps = null;
let articles = [];
let folders = [];
const listeners = new Set();
const imgUrls = new Map(); // 画像の参照（img:… / card:…）→ URL
const info = { missing: '' }; // 表がまだないときの案内
const state = { q: '', sel: new Set(), openFolders: null };

export function initGuides(d) { deps = d; }

// ---- 下書き: 書いている途中で、自動で、このブラウザに保存する（あとから、一覧から再開できる）----
const DRAFTS_KEY = 'geo-guide-drafts-v1';
const loadDrafts = () => { try { return JSON.parse(localStorage.getItem(DRAFTS_KEY)) || {}; } catch { return {}; } };
const writeDrafts = (o) => { try { localStorage.setItem(DRAFTS_KEY, JSON.stringify(o)); return true; } catch { return false; } };
const saveDraft = (key, d) => { const o = loadDrafts(); o[key] = { ...d, at: Date.now() }; return writeDrafts(o); };
const deleteDraft = (key) => { const o = loadDrafts(); if (key in o) { delete o[key]; writeDrafts(o); } };
export const draftList = () => Object.entries(loadDrafts()).map(([key, d]) => ({ key, ...d })).sort((a, b) => (b.at || 0) - (a.at || 0));
const timeText = (ms) => { const d = new Date(ms); const p = (n) => String(n).padStart(2, '0'); return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`; };
export const onGuidesChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const changed = () => { buildIndex(); listeners.forEach((fn) => { try { fn(); } catch { /* 無視 */ } }); };
export const guideArticles = () => articles;
export const guideFolders = () => folders;
export const articleById = (id) => articles.find((a) => a.id === id) || null;
export async function loadGuides() {
  try { [articles, folders] = await Promise.all([deps.api.listArticles(), deps.api.listFolders()]); } catch (e) { articles = []; folders = []; info.missing = e.message || String(e); }
  changed();
  return articles;
}

// ---- 記事の中のリンクの索引: カード・ストリートビューから、その記事へ戻れるように ----
const TOKEN_RE = /(?:\[\[|\]\()\s*(card|sv|article):([\w-]+)/g;
let linkIndex = new Map(); // 'card:id' → [記事 id]
function buildIndex() {
  linkIndex = new Map();
  for (const a of articles) {
    const seen = new Set();
    for (const m of String(a.body || '').matchAll(/\[\[(card|sv):([\w-]+)\]\]|\]\((card|sv):([\w-]+)\)/g)) {
      const key = `${m[1] || m[3]}:${m[2] || m[4]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!linkIndex.has(key)) linkIndex.set(key, []);
      linkIndex.get(key).push(a.id);
    }
  }
}
/** カード（kind = 'card'）・保存したストリートビュー（'sv'）にリンクしている記事 */
export const articlesLinking = (kind, id) => (linkIndex.get(`${kind}:${id}`) || []).map(articleById).filter(Boolean);
/** 関連記事（この記事が指定したもの + この記事を指定したもの） */
export function relatedArticles(a) {
  const ids = new Set((a.related || []).filter((x) => x !== a.id));
  for (const o of articles) if (o.id !== a.id && (o.related || []).includes(a.id)) ids.add(o.id);
  return [...ids].map(articleById).filter(Boolean);
}
export const articleChipHtml = (a) => `<button type="button" class="related-item art-chip" data-article-open="${deps.esc(a.id)}" title="${deps.esc(a.title || '無題')}"><span class="related-thumb art-chip-ico">${folderIconHtml(folderOf(a), '📝')}</span><span class="related-text"><span class="related-country">${deps.esc(a.title || '無題')}</span><span class="related-cat">${folderOf(a) ? deps.esc(folderOf(a).name) : '記事'}</span></span></button>`;
/** カード・ストリートビューの詳細に出す「関連記事」 */
export function backlinksHtml(kind, id) {
  const list = articlesLinking(kind, id);
  if (!list.length) return '';
  return `<div class="related art-backlinks"><div class="related-head">📝 関連記事 <span class="muted">${list.length}</span></div><div class="related-list">${list.map(articleChipHtml).join('')}</div></div>`;
}
const folderOf = (a) => folders.find((f) => f.id === a.folder_id) || null;
function folderIconHtml(f, fallback = '📁') {
  const ic = f?.icon || '';
  if (/^data:image\//.test(ic)) return `<img class="fold-ico-img" src="${deps.esc(ic)}" alt="">`;
  return `<span class="fold-ico">${deps.esc(ic || fallback)}</span>`;
}

// ================= マークダウン =================
const escAmp = (s) => s.replace(/&amp;/g, '&');
function inline(text, env) {
  const esc = deps.esc;
  let s = esc(text);
  const hold = [];
  const put = (h) => { hold.push(h); return `\u0000${hold.length - 1}\u0000`; };
  s = s.replace(/`([^`]+)`/g, (m, c) => put(`<code>${c}</code>`));
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, src) => put(imageHtml(escAmp(src), escAmp(alt), env)));
  s = s.replace(/\[\[(card|sv|article):([\w-]+)\]\]/g, (m, k, id) => put(linkChip(k, id, '', env)));
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, href) => {
    const h = escAmp(href);
    const mm = /^(card|sv|article):([\w-]+)$/.exec(h);
    if (mm) return put(linkChip(mm[1], mm[2], label, env));
    if (/^(https?:\/\/|mailto:|#)/i.test(h)) return put(`<a href="${esc(h)}" target="_blank" rel="noopener">${label}</a>`);
    return m;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>').replace(/~~([^~]+)~~/g, '<del>$1</del>');
  s = s.replace(/(^|[\s(（])(https?:\/\/[^\s<）)]+)/g, (m, pre, url) => `${pre}<a href="${url}" target="_blank" rel="noopener">${url}</a>`);
  return s.replace(/\u0000(\d+)\u0000/g, (m, i) => hold[Number(i)]);
}
/** 画像の説明の最後に「|50%」「|300」（px）と書くと、表示の大きさになる（例: ![説明|50%](img:…)） */
const IMG_SIZE = /^(.*?)\s*\|\s*(\d{1,4})\s*(%|px)?\s*$/;
export const parseImgAlt = (alt) => { const m = IMG_SIZE.exec(alt || ''); return m ? { alt: m[1], size: m[3] === '%' ? `${Math.min(100, +m[2])}%` : `${+m[2]}px` } : { alt: alt || '', size: '' }; };
function imageHtml(src, rawAlt, env, inRow = false) {
  const { alt, size } = parseImgAlt(rawAlt);
  const idx = env.imgN = (env.imgN || 0) + 1;
  const url = env.urls.get(src) || '';
  if (!url) return `<span class="art-img-missing" title="${deps.esc(src)}">🖼（画像が見つかりません）</span>`;
  return `<span class="art-zoom front-img" data-art-img data-img-i="${idx - 1}"${size && !inRow ? ` style="width:${size};max-width:100%"` : ''}><img src="${deps.esc(url)}" alt="${deps.esc(alt)}" loading="lazy"></span>`;
}
function linkChip(kind, id, label, env) {
  if (kind === 'card') { const c = deps.cardById(id); return c ? deps.cardChipHtml(c) : '<span class="art-link-gone">（削除されたカード）</span>'; }
  if (kind === 'sv') { const r = deps.svById(id); return r ? deps.svChipHtml(r) : '<span class="art-link-gone">（削除されたストリートビュー）</span>'; }
  const a = articleById(id);
  return a ? `<a href="#" class="art-inlink" data-article-open="${deps.esc(a.id)}">${label ? label : `📝 ${deps.esc(a.title || '無題')}`}</a>` : '<span class="art-link-gone">（削除された記事）</span>';
}
function svEmbed(r, env) {
  const esc = deps.esc;
  const label = esc(deps.svLabel(r));
  if (env.svPlaceholder) return `<div class="art-sv art-sv-ph"><span class="muted small">🧍 記事では、ここにストリートビューが埋め込まれます</span>${deps.svChipHtml(r)}</div>`;
  return `<div class="art-sv"><iframe class="art-sv-frame" title="${label}" src="${esc(deps.svEmbedUrl(r))}" loading="lazy" allow="fullscreen" referrerpolicy="strict-origin-when-cross-origin"></iframe><div class="art-sv-cap">${deps.svChipHtml(r)}</div></div>`;
}
const ONLY_CHIPS = /^(\s*\[\[(card|sv|article):[\w-]+\]\]\s*)+$/;
const IMGS_LINE = /^\s*(?:!\[[^\]]*\]\([^)\s]+\)\s*){2,}$/; // 画像だけが、同じ行に、2 枚以上
const IMG_LINE = /^\s*!\[([^\]]*)\]\(([^)\s]+)\)\s*$/;

/** マークダウン → { html, toc: [{ id, title, level }], refs: 使っている画像の参照 } */
export function renderMarkdown(src, urls = new Map(), opts = {}) {
  const env = { urls, svPlaceholder: !!opts.svPlaceholder }; // svPlaceholder: 書く画面のプレビューでは、ストリートビューを埋め込まず、場所だけ出す（入力のたびに読み込み直さないため）
  const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
  const toc = [];
  const out = [];
  let i = 0;
  let n = 0;
  const para = [];
  const flushPara = () => {
    if (!para.length) return;
    // ストリートビューだけの行は、リンクではなく、ストリートビューを、その場に埋め込む
    const lines2 = [...para]; para.length = 0;
    let buf = [];
    const emit = () => {
      if (!buf.length) return;
      const t = buf.join('\n'); buf = [];
      out.push(ONLY_CHIPS.test(t.replace(/\n/g, ' ')) ? `<div class="art-links related-list">${inline(t, env)}</div>` : `<p>${inline(t, env).replace(/\n/g, '<br>')}</p>`);
    };
    for (const l of lines2) {
      const m = /^\s*\[\[sv:([\w-]+)\]\]\s*$/.exec(l);
      const r = m && deps.svById(m[1]);
      if (r) { emit(); out.push(svEmbed(r, env)); } else buf.push(l);
    }
    emit();
  };
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) { // コードブロック
      flushPara();
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code>${deps.esc(buf.join('\n'))}</code></pre>`);
      continue;
    }
    const h = /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      flushPara();
      const level = h[1].length;
      const id = `art-h-${n++}`;
      toc.push({ id, title: h[2].replace(/[*_`~]/g, ''), level: level === 1 ? 1 : 2 });
      out.push(`<h${level + 1} class="art-h art-h${level}" id="${id}">${inline(h[2], env)}</h${level + 1}>`);
      i++;
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flushPara(); out.push('<hr>'); i++; continue; }
    if (/^>\s?/.test(line)) { // 引用
      flushPara();
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${buf.map((l) => inline(l, env)).join('<br>')}</blockquote>`);
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) { // 表
      flushPara();
      const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
      out.push(`<div class="art-table"><table><thead><tr>${head.map((c) => `<th>${inline(c, env)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c, env)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^(\s*)([-*+]|\d+[.)])\s+/.test(line)) { // 箇条書き（2 スペースで入れ子）
      flushPara();
      const stack = []; // { indent, tag }
      let html = '';
      while (i < lines.length && /^(\s*)([-*+]|\d+[.)])\s+/.test(lines[i])) {
        const m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
        const indent = m[1].replace(/\t/g, '  ').length;
        const tag = /\d/.test(m[2]) ? 'ol' : 'ul';
        while (stack.length && indent < stack[stack.length - 1].indent) { html += `</li></${stack.pop().tag}>`; }
        if (!stack.length || indent > stack[stack.length - 1].indent) { stack.push({ indent, tag }); html += `<${tag}><li>`; } else html += '</li><li>';
        html += inline(m[3], env);
        i++;
      }
      while (stack.length) html += `</li></${stack.pop().tag}>`;
      out.push(html);
      continue;
    }
    if (IMGS_LINE.test(line)) { // 同じ行の複数の画像は、1 行に収まるように、並べる（幅は、自動で調節）
      flushPara();
      const imgs = [...line.matchAll(/!\[([^\]]*)\]\(([^)\s]+)\)/g)].map((x) => { const { alt, size } = parseImgAlt(x[1]); return `<figure class="art-fig"${size ? ` style="flex:0 1 ${size}"` : ''}>${imageHtml(x[2], x[1], env, true)}${alt ? `<figcaption>${deps.esc(alt)}</figcaption>` : ''}</figure>`; });
      out.push(`<div class="art-imgrow">${imgs.join('')}</div>`); i++; continue;
    }
    const im = IMG_LINE.exec(line);
    if (im) { flushPara(); out.push(`<figure class="art-fig">${imageHtml(im[2], im[1], env)}${parseImgAlt(im[1]).alt ? `<figcaption>${deps.esc(parseImgAlt(im[1]).alt)}</figcaption>` : ''}</figure>`); i++; continue; }
    if (!line.trim()) { flushPara(); i++; continue; }
    para.push(line);
    i++;
  }
  flushPara();
  const refs = [];
  for (const m of String(src || '').matchAll(/!\[[^\]]*\]\(((?:img|card):[^)\s]+)\)/g)) refs.push(m[1]);
  return { html: out.join('\n'), toc, refs: [...new Set(refs)] };
}

/** 記事の画像の URL を、まとめて求める（card: はカードの画像、img: はストレージ / 保存した画像） */
export async function resolveImages(refs) {
  const need = [];
  for (const r of refs) {
    if (r.startsWith('card:')) { const u = deps.cardImg(r.slice(5)); if (u) imgUrls.set(r, u); } else if (!imgUrls.get(r)) need.push(r);
  }
  if (need.length) { try { const m = await deps.api.articleImageUrls(need); for (const [k, v] of m) if (v) imgUrls.set(k, v); } catch { /* 画像が出なくても読める */ } }
  return imgUrls;
}

// 記事を読む画面の本文: { html, toc }（画像の URL を求めてから描く）
export async function buildArticle(a) {
  const first = renderMarkdown(a.body, imgUrls);
  await resolveImages(first.refs);
  const r = renderMarkdown(a.body, imgUrls);
  return r;
}
export const articleTocHtml = (toc) => toc.map((t) => `<a href="#${t.id}" class="pk-toc-item lv${t.level}" data-pk-to="${t.id}">${deps.esc(t.title)}</a>`).join('');
/** 読む画面の本文に、画像の拡大縮小・リンクの動作をつける */
export function bindArticle(root) {
  root.querySelectorAll('[data-art-img]').forEach((el) => deps.attachZoom(el));
  root.querySelectorAll('[data-related]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); const c = deps.cardById(b.dataset.related); if (c) deps.openCard(c, b); }));
  root.querySelectorAll('[data-article-open]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); deps.openArticle(b.dataset.articleOpen, b); }));
}

// ================= 選ぶ画面（カード・ストリートビュー・記事） =================
function pickDialog({ title, search = true, filters = '', render }) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'modal modal-sm gd-pick';
    d.innerHTML = `<div class="modal-inner"><div class="modal-head"><h2>${deps.esc(title)}</h2><button class="icon-btn" type="button" data-x aria-label="閉じる">✕</button></div>
      ${search ? '<input type="search" class="input gd-pick-q" placeholder="絞り込み（文字）" autocomplete="off">' : ''}${filters ? `<div class="gd-pick-filters">${filters}</div>` : ''}<div class="gd-pick-count muted small"></div><div class="gd-pick-list"></div></div>`;
    document.body.appendChild(d);
    const list = d.querySelector('.gd-pick-list');
    const q = d.querySelector('.gd-pick-q');
    const done = (v) => {
      document.activeElement?.blur?.();
      d.close(); d.remove(); resolve(v);
      setTimeout(() => { window.blur(); window.focus(); }, 0); // ダイアログを閉じたあと、入力欄に入力できなくなることがあるので、フォーカスを取り直す
    };
    const paint = () => {
      const vals = {};
      d.querySelectorAll('[data-f]').forEach((el) => { vals[el.dataset.f] = el.type === 'checkbox' ? el.checked : el.value; });
      const r = render(q?.value.trim() || '', vals);
      list.innerHTML = r.html;
      d.querySelector('.gd-pick-count').textContent = r.count != null ? `${r.count} 件${r.count > r.shown ? `（先頭の ${r.shown} 件を表示。絞り込んでください）` : ''}` : '';
    };
    list.addEventListener('click', (e) => { const b = e.target.closest('[data-pick]'); if (b) done(b.dataset.pick); });
    d.querySelector('[data-x]').addEventListener('click', () => done(null));
    d.addEventListener('cancel', (e) => { e.preventDefault(); done(null); });
    q?.addEventListener('input', paint);
    d.querySelectorAll('[data-f]').forEach((el) => el.addEventListener('change', paint));
    paint();
    d.showModal();
    q?.focus();
  });
}
const optHtml = (pairs, all) => `<option value="">${all}</option>${pairs.map(([v, l]) => `<option value="${deps.esc(v)}">${deps.esc(l)}</option>`).join('')}`;
const emptyHtml = '<p class="muted small" style="padding:12px">見つかりません</p>';
const cardPick = (title, { imagesOnly = false } = {}) => {
  const all = deps.cards().filter((c) => !imagesOnly || deps.cardThumb(c));
  const cats = new Map(); const countries = new Set();
  for (const c of all) { const k = deps.cardCat(c); cats.set(k.id, k.name); (c.countries || []).forEach((x) => countries.add(x)); }
  const filters = `<select class="select select-sm" data-f="cat" aria-label="種類">${optHtml([...cats], 'すべての種類')}</select><select class="select select-sm" data-f="country" aria-label="国">${optHtml([...countries].map((x) => [x, deps.countryName(x)]).sort((a, b) => a[1].localeCompare(b[1], 'ja')), 'すべての国')}</select>`;
  return pickDialog({
    title,
    filters,
    render: (qt, f) => {
      const base = qt ? deps.cardSearch(qt) : deps.cards();
      const hit = base.filter((c) => (!imagesOnly || deps.cardThumb(c)) && (!f.cat || deps.cardCat(c).id === f.cat) && (!f.country || (c.countries || []).includes(f.country)));
      const cards = hit.slice(0, 60);
      return { count: hit.length, shown: cards.length, html: cards.length ? cards.map((c) => `<button type="button" class="gd-pick-row" data-pick="${deps.esc(c.id)}"><span class="gd-pick-thumb">${deps.cardThumb(c) ? `<img src="${deps.esc(deps.cardThumb(c))}" alt="" loading="lazy">` : ''}</span><span class="gd-pick-text">${deps.esc(deps.cardLabel(c))}</span></button>`).join('') : emptyHtml };
    },
  });
};
const svPick = (title) => {
  const rows0 = deps.svList();
  const countries = [...new Set(rows0.map((r) => r.code).filter(Boolean))].map((x) => [x, deps.countryName(x)]).sort((a, b) => a[1].localeCompare(b[1], 'ja'));
  return pickDialog({
    title,
    filters: `<select class="select select-sm" data-f="country" aria-label="国">${optHtml(countries, 'すべての国')}</select>`,
    render: (qt, f) => {
      const hit = deps.svList().filter((r) => (!qt || deps.svLabel(r).toLowerCase().includes(qt.toLowerCase())) && (!f.country || r.code === f.country));
      const rows = hit.slice(0, 80);
      return { count: hit.length, shown: rows.length, html: rows.length ? rows.map((r) => `<button type="button" class="gd-pick-row" data-pick="${deps.esc(r.id)}"><span class="gd-pick-thumb">🧍</span><span class="gd-pick-text">${deps.esc(deps.svLabel(r))}</span></button>`).join('') : emptyHtml };
    },
  });
};
const articlePick = (title, exclude = new Set()) => pickDialog({
  title,
  render: (qt) => {
    const rows = articles.filter((a) => !exclude.has(a.id) && (!qt || (a.title || '').toLowerCase().includes(qt.toLowerCase()))).slice(0, 80);
    return { html: rows.length ? rows.map((a) => `<button type="button" class="gd-pick-row" data-pick="${deps.esc(a.id)}"><span class="gd-pick-thumb">${folderIconHtml(folderOf(a), '📝')}</span><span class="gd-pick-text">${deps.esc(a.title || '無題')}</span></button>`).join('') : emptyHtml };
  },
});

// ================= 記事の編集 =================
export const draftOf = (key) => loadDrafts()[key] || null;
/** 記事の編集画面を開く（PC は、浮かぶウィンドウ。app.js が、ウィンドウで開く） */
export function openArticleEditor(article = null, opts = {}) {
  if (!deps.isEditor()) { deps.toast('記事を書けるのは、編集者のみです', 'error'); return; }
  if (deps.openEditorWindow) deps.openEditorWindow(article, opts); else buildArticleEditor(article, opts);
}
/** 記事の編集画面を作る（今のウィンドウ・モーダルの中に） */
let editorSeq = 0; // 編集画面を作るたびに増やす（戻ってきて作り直したとき、古い画面の自動保存が、新しい内容を上書きしないように）
export async function buildArticleEditor(article = null, opts = {}) {
  if (!deps.isEditor()) { deps.toast('記事を書けるのは、編集者のみです', 'error'); return; }
  const a = article || { id: null, title: '', body: opts.body || '', folder_id: opts.folder_id || null, related: [] };
  // 下書き: 一覧から再開したとき・この記事に、保存していない下書きがあるとき（続きから書くか、聞く）
  let seed = opts.draft || null;
  if (!seed && a.id) {
    const d = loadDrafts()[a.id];
    if (d && (d.body !== (a.body || '') || d.title !== (a.title || ''))) {
      if (await deps.confirm(`この記事の、保存していない下書きがあります（${timeText(d.at)}）。続きから書きますか？\n（キャンセルすると、保存済みの内容から書きます。下書きは、破棄されます）`)) seed = d; else deleteDraft(a.id);
    }
  }
  const draftKey = opts.draftKey || a.id || `new-${Date.now()}`;
  const draft = { title: seed?.title ?? (a.title || ''), body: seed?.body ?? (a.body || ''), folder_id: (seed ? seed.folder_id : a.folder_id) || '', related: new Set(seed ? seed.related || [] : a.related || []) };
  const original = { title: a.title || '', body: a.body || '' };
  const m = deps.openWindow(`
    <div class="modal-head"><h2>${a.id ? '記事を編集' : '新しい記事'}</h2><button class="icon-btn" id="gd-max" type="button" aria-label="入力欄だけにする・元に戻す" title="枠の中を、入力欄だけにする（タイトル・ツールバー・プレビュー・関連記事を隠す）・元に戻す">⤢</button><button class="icon-btn" data-close aria-label="閉じる">✕</button></div>
    <div class="gd-ed">
      <div class="gd-ed-top">
        <input type="text" id="gd-title" class="input gd-title" maxlength="200" placeholder="タイトル" value="${deps.esc(draft.title)}">
        <label class="gd-folder-sel">📁 <select id="gd-folder" class="select select-sm"><option value="">フォルダなし</option>${folders.map((f) => `<option value="${deps.esc(f.id)}" ${f.id === draft.folder_id ? 'selected' : ''}>${deps.esc(f.icon && !/^data:/.test(f.icon) ? `${f.icon} ` : '')}${deps.esc(f.name)}</option>`).join('')}</select></label>
      </div>
      <div class="gd-tools" id="gd-tools">
        <button type="button" data-md="h1" title="大見出し（目次に出る）">H1</button><button type="button" data-md="h2" title="見出し（目次に出る）">H2</button><button type="button" data-md="h3" title="小見出し">H3</button>
        <button type="button" data-md="b" title="太字"><b>B</b></button><button type="button" data-md="i" title="斜体"><i>I</i></button><button type="button" data-md="s" title="取り消し線"><s>S</s></button><button type="button" data-md="code" title="コード">&lt;/&gt;</button>
        <button type="button" data-md="ul" title="箇条書き">• 一覧</button><button type="button" data-md="ol" title="番号つきの一覧">1. 一覧</button><button type="button" data-md="quote" title="引用">❝</button><button type="button" data-md="hr" title="区切り線">―</button><button type="button" data-md="table" title="表">▦</button><button type="button" data-md="link" title="リンク">🔗</button>
        <span class="gd-sep"></span>
        <button type="button" data-md="img-file" title="画像をアップロード（複数可）">🖼 画像</button><button type="button" data-md="img-paste" title="クリップボードの画像を貼り付け">📋 貼り付け</button><button type="button" data-md="img-card" title="カードの画像を使う（容量を使いません）">🃏 カードの画像</button>
        <span class="gd-sep"></span>
        <button type="button" data-md="ai" class="gd-ai-btn" title="AI に記事を書いてもらう（下書き・カード・Plonk It などを読んで、提案します。反映する前に、確認できます）">✨ AI</button>
        <button type="button" data-md="l-card" title="カードへのリンク">🃏 カード</button><button type="button" data-md="l-sv" title="保存したストリートビューへのリンク">🧍 ストリートビュー</button><button type="button" data-md="l-art" title="ほかの記事へのリンク">📝 記事</button>
        <input type="file" id="gd-file" accept="image/*" multiple hidden>
      </div>
      <div class="gd-split">
        <textarea id="gd-body" class="input gd-body" spellcheck="false" placeholder="ここに書きます。# 見出し / **太字** / - 箇条書き / 画像をここに貼り付け・ドロップできます">${deps.esc(draft.body)}</textarea>
        <div class="gd-preview pk-body" id="gd-preview"></div>
      </div>
      <div class="field gd-rel"><span>関連記事</span><div class="related-list" id="gd-rel"></div><button type="button" class="btn btn-sm" id="gd-rel-add">＋ 関連記事を足す</button></div>
      <div class="modal-foot">${a.id ? '<button class="btn btn-danger" id="gd-del" type="button">削除</button>' : ''}<span class="grow"></span><button class="btn btn-ghost btn-sm" id="gd-ai-undo" type="button" hidden title="AI の提案を反映する前の内容に戻す">↩ AI の適用を取り消す</button><span class="muted small" id="gd-status"></span><button class="btn btn-ghost" data-close type="button">キャンセル</button><button class="btn btn-primary" id="gd-save" type="button">保存</button></div>
    </div>`, 'modal-wide modal-guide-ed');
  const $ = (s) => m.el.querySelector(s);
  const ta = $('#gd-body');
  // 書く画面の拡大（PC）: 画面いっぱいに。選んだ状態は、覚えておく
  const setMax = (on) => { m.el.classList.toggle('gd-focus', on); $('#gd-max').setAttribute('aria-pressed', String(on)); $('#gd-max').textContent = on ? '⤡' : '⤢'; if (on) ta.focus(); try { localStorage.setItem('geo-guide-ed-focus', on ? '1' : '0'); } catch { /* 無視 */ } };
  $('#gd-max').addEventListener('click', () => setMax(!m.el.classList.contains('gd-focus')));
  try { if (localStorage.getItem('geo-guide-ed-focus') === '1') setMax(true); } catch { /* 無視 */ }
  const status = (t) => { const s = $('#gd-status'); if (s) s.textContent = t; };
  // 自動保存（下書き）: 入力が止まって 1 秒で、このブラウザに保存する。何も書いていない・保存済みと同じなら、保存しない
  let autoTimer = null;
  let saved = false; // 記事として保存した（下書きは、もう要らない）
  const mySeq = ++editorSeq;
  const form = { title: draft.title, body: draft.body, folder_id: draft.folder_id || null }; // 入力欄の今の内容（閉じたあとに、画面が空になっていても、使える）
  const autosave = () => {
    if (saved || mySeq !== editorSeq) return;
    const cur = { title: form.title, body: form.body, folder_id: form.folder_id, related: [...draft.related], id: a.id || null };
    if (!cur.title.trim() && !cur.body.trim()) { deleteDraft(draftKey); return; }
    if (cur.title === original.title && cur.body === original.body && a.id) { deleteDraft(draftKey); return; }
    status(saveDraft(draftKey, cur) ? `下書きを保存しました（${timeText(Date.now())}）` : '下書きを保存できませんでした（ブラウザの保存容量）');
  };
  const scheduleAuto = () => { clearTimeout(autoTimer); autoTimer = setTimeout(autosave, 1000); };
  // プレビュー
  let pv = null;
  const preview = async () => {
    const r = renderMarkdown(ta.value, imgUrls, { svPlaceholder: true });
    if (r.refs.some((x) => !imgUrls.get(x))) { await resolveImages(r.refs); }
    const r2 = renderMarkdown(ta.value, imgUrls, { svPlaceholder: true });
    const box = $('#gd-preview');
    if (!box) return; // 閉じたあと
    box.innerHTML = r2.html || '<p class="muted small">プレビューが、ここに出ます</p>';
    bindArticle(box);
    box.querySelectorAll('[data-sv-open]').forEach(() => {});
  };
  const schedule = () => { form.body = ta.value; clearTimeout(pv); pv = setTimeout(preview, 200); scheduleAuto(); };
  ta.addEventListener('input', () => { form.body = ta.value; schedule(); scheduleAuto(); });
  $('#gd-title').addEventListener('input', (e) => { form.title = e.target.value; scheduleAuto(); });
  $('#gd-folder').addEventListener('change', (e) => { form.folder_id = e.target.value || null; scheduleAuto(); });
  // 挿入
  const insert = (text, { select = null } = {}) => {
    const s = ta.selectionStart; const e = ta.selectionEnd;
    ta.setRangeText(text, s, e, 'end');
    if (select) ta.setSelectionRange(s + select[0], s + select[1]);
    ta.focus();
    schedule();
  };
  const wrap = (l, r = l) => { const s = ta.selectionStart; const e = ta.selectionEnd; const sel = ta.value.slice(s, e); ta.setRangeText(`${l}${sel}${r}`, s, e, 'end'); ta.setSelectionRange(s + l.length, s + l.length + sel.length); ta.focus(); schedule(); }; // 選んだ文字を囲む（何も選んでいなければ、記号だけ入れて、その間にカーソル）
  const linePrefix = (p) => { const s = ta.selectionStart; const start = ta.value.lastIndexOf('\n', s - 1) + 1; const e = ta.selectionEnd; const sel = ta.value.slice(start, e); ta.setRangeText(sel.split('\n').map((l) => p + l).join('\n'), start, e, 'end'); ta.focus(); schedule(); }; // 行の先頭に記号だけ入れる（文字は入れない）
  const needBreak = () => { const before = ta.value.slice(0, ta.selectionStart); return before && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : ''; };
  const upload = async (blobs) => {
    for (const b of blobs) {
      status('画像をアップロード中…');
      try { const ref = await deps.api.uploadArticleImage(b); insert(`${needBreak()}![](${ref})\n\n`); } catch (ex) { deps.toast(`画像をアップロードできませんでした: ${ex.message}`, 'error'); }
    }
    status('');
  };
  ta.addEventListener('paste', (e) => { const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/')); if (files.length) { e.preventDefault(); upload(files); } });
  ta.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.items || [])].some((x) => x.kind === 'file')) e.preventDefault(); });
  ta.addEventListener('drop', (e) => { const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/')); if (files.length) { e.preventDefault(); upload(files); } });
  $('#gd-file').addEventListener('change', (e) => { const f = [...e.target.files]; e.target.value = ''; if (f.length) upload(f); });
  // AI に書いてもらう（提案は、確認の画面で、直してから、反映する）
  let aiUndo = null;
  const setBody = (v) => { ta.value = v; form.body = v; schedule(); };
  const setTitle = (v) => { $('#gd-title').value = v; form.title = v; scheduleAuto(); };
  function openAi() {
    if (!deps.ai) { deps.toast('この環境では、AI を使えません', 'error'); return; }
    openArticleAi({
      api: deps.api, esc: deps.esc, toast: deps.toast, confirm: deps.confirm, articles: () => articles, currentId: a.id, ai: deps.ai,
      getForm: () => ({ title: form.title, body: form.body, folder_id: form.folder_id }),
      exists: { card: (id) => !!deps.cardById(id), sv: (id) => !!deps.svById(id), article: (id) => !!articleById(id) },
      preview: async (md) => { const r = renderMarkdown(md, imgUrls, { svPlaceholder: true }); if (r.refs.some((x) => !imgUrls.get(x))) await resolveImages(r.refs); return renderMarkdown(md, imgUrls, { svPlaceholder: true }).html; },
      saveAsDraft: (f) => { const ok = saveDraft(`new-${Date.now()}`, { title: f.title, body: f.body, folder_id: f.folder_id, related: [], id: null }); refreshGuideView(); return ok; },
      apply: ({ mode, title, body }) => {
        aiUndo = { title: form.title, body: form.body, caret: ta.selectionStart };
        if (mode === 'replace') setBody(body);
        else if (mode === 'append') setBody(`${form.body.replace(/\s+$/, '')}${form.body.trim() ? '\n\n' : ''}${body}\n`);
        else { const s = Math.min(ta.selectionStart, ta.value.length); const e = Math.min(ta.selectionEnd, ta.value.length); ta.setRangeText(`${needBreak()}${body}\n\n`, s, e, 'end'); form.body = ta.value; schedule(); }
        if (title) setTitle(title);
        $('#gd-ai-undo').hidden = false;
        ta.focus();
      },
    });
  }
  $('#gd-ai-undo').addEventListener('click', () => {
    if (!aiUndo) return;
    setBody(aiUndo.body); setTitle(aiUndo.title);
    ta.focus(); ta.setSelectionRange(aiUndo.caret, aiUndo.caret);
    aiUndo = null; $('#gd-ai-undo').hidden = true;
    deps.toast('AI を反映する前に、戻しました');
  });
  $('#gd-tools').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-md]');
    if (!b) return;
    const k = b.dataset.md;
    if (k === 'h1') linePrefix('# '); else if (k === 'h2') linePrefix('## '); else if (k === 'h3') linePrefix('### ');
    else if (k === 'b') wrap('**'); else if (k === 'i') wrap('*'); else if (k === 's') wrap('~~'); else if (k === 'code') wrap('`', '`');
    else if (k === 'ul') linePrefix('- '); else if (k === 'ol') linePrefix('1. '); else if (k === 'quote') linePrefix('> ');
    else if (k === 'hr') insert(`${needBreak()}---\n\n`); else if (k === 'table') insert(`${needBreak()}| 見出し 1 | 見出し 2 |\n| --- | --- |\n| 内容 | 内容 |\n\n`);
    else if (k === 'link') { const s = ta.selectionStart; const sel = ta.value.slice(s, ta.selectionEnd); insert(`[${sel}](https://)`, { select: sel ? [sel.length + 3, sel.length + 11] : [1, 1] }); }
    else if (k === 'img-file') $('#gd-file').click();
    else if (k === 'img-paste') {
      try {
        const items = await navigator.clipboard.read();
        const blobs = [];
        for (const it of items) { const t = it.types.find((x) => x.startsWith('image/')); if (t) blobs.push(await it.getType(t)); }
        if (!blobs.length) { deps.toast('クリップボードに、画像がありません', 'error'); return; }
        upload(blobs);
      } catch { deps.toast('クリップボードを読めませんでした（ブラウザの許可が必要です。Ctrl+V でも貼り付けられます）', 'error'); }
    } else if (k === 'img-card') {
      const id = await cardPick('画像を使うカードを選ぶ', { imagesOnly: true });
      const c = id && deps.cardById(id);
      if (c) insert(`${needBreak()}![${deps.cardLabel(c).replace(/[\]\n|]/g, ' ')}](card:${c.id})\n\n`);
    } else if (k === 'l-card') { const id = await cardPick('リンクするカードを選ぶ'); if (id) insert(`[[card:${id}]]`); }
    else if (k === 'l-sv') { const id = await svPick('リンクするストリートビューを選ぶ'); if (id) insert(`[[sv:${id}]]`); }
    else if (k === 'ai') openAi();
    else if (k === 'l-art') { const id = await articlePick('リンクする記事を選ぶ', new Set(a.id ? [a.id] : [])); if (id) insert(`[[article:${id}]]`); }
  });
  ta.addEventListener('keydown', (e) => { // Tab で字下げ・Ctrl+B / Ctrl+I
    if (e.key === 'Tab' && !e.shiftKey && !e.isComposing) { e.preventDefault(); insert('  '); }
    else if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'i')) { e.preventDefault(); wrap(e.key === 'b' ? '**' : '*'); }
  });
  // 関連記事
  const paintRel = () => {
    const box = $('#gd-rel');
    const list = [...draft.related].map(articleById).filter(Boolean);
    box.innerHTML = list.length ? list.map((r) => `<span class="art-rel-item">${articleChipHtml(r).replace('data-article-open', 'data-nope')}<button type="button" class="btn btn-sm btn-ghost" data-rel-rm="${deps.esc(r.id)}" title="関連から外す">✕</button></span>`).join('') : '<span class="muted small">まだありません</span>';
    box.querySelectorAll('[data-rel-rm]').forEach((b) => b.addEventListener('click', () => { draft.related.delete(b.dataset.relRm); paintRel(); scheduleAuto(); }));
  };
  $('#gd-rel-add').addEventListener('click', async () => { const id = await articlePick('関連記事を選ぶ', new Set([a.id, ...draft.related].filter(Boolean))); if (id) { draft.related.add(id); paintRel(); scheduleAuto(); } });
  paintRel();
  // 保存・削除
  $('#gd-save').addEventListener('click', async (e) => {
    const title = $('#gd-title').value.trim();
    if (!title) { deps.toast('タイトルを入れてください', 'error'); $('#gd-title').focus(); return; }
    e.currentTarget.disabled = true;
    try {
      const row = await deps.api.saveArticle({ title, body: ta.value, folder_id: $('#gd-folder').value || null, related: [...draft.related] }, a.id);
      const i = articles.findIndex((x) => x.id === row.id);
      if (i >= 0) articles[i] = row; else articles.unshift(row);
      saved = true; clearTimeout(autoTimer); deleteDraft(draftKey);
      changed();
      deps.closeModal();
      deps.toast('保存しました');
      opts.onSaved?.(row);
    } catch (ex) { deps.toast(`保存できませんでした: ${ex.message}`, 'error'); e.currentTarget.disabled = false; }
  });
  $('#gd-del')?.addEventListener('click', async () => {
    if (!(await deps.confirm(`「${a.title || '無題'}」を削除しますか？（元に戻せません）`))) return;
    try { await deps.api.deleteArticle(a.id); saved = true; deleteDraft(draftKey); articles = articles.filter((x) => x.id !== a.id); changed(); deps.closeModal(); deps.toast('削除しました'); opts.onDeleted?.(a.id); } catch (ex) { deps.toast(`削除できませんでした: ${ex.message}`, 'error'); }
  });
  opts.flush = () => { clearTimeout(autoTimer); autosave(); return draftKey; }; // ウィンドウを外に出す前に、今の内容を保存する
  // プレビューの画像を押すと、大きさを選べる（本文の「![説明|50%](…)」を書き換える）
  const imgSpans = () => { // 本文の中の画像の書き方の位置（コードの中は除く）
    const masked = ta.value.replace(/```[\s\S]*?(```|$)/g, (s) => ' '.repeat(s.length)).replace(/`[^`\n]+`/g, (s) => ' '.repeat(s.length));
    return [...masked.matchAll(/!\[([^\]]*)\]\(([^)\s]+)\)/g)].map((x) => ({ at: x.index, len: x[0].length, alt: parseImgAlt(ta.value.slice(x.index + 2, x.index + 2 + x[1].length)).alt, src: x[2] }));
  };
  const setImgSize = (i, size) => {
    const x = imgSpans()[i];
    if (!x) return;
    ta.setRangeText(`![${x.alt}${size ? `|${size}` : ''}](${x.src})`, x.at, x.at + x.len, 'preserve');
    schedule();
  };
  let sizePop = null;
  const closeSizePop = () => { sizePop?.remove(); sizePop = null; };
  $('#gd-preview').addEventListener('click', (e) => {
    const el = e.target.closest?.('[data-art-img]');
    if (!el) { closeSizePop(); return; }
    e.preventDefault(); e.stopPropagation();
    closeSizePop();
    const i = Number(el.dataset.imgI);
    const cur = parseImgAlt(ta.value.slice(...(() => { const x = imgSpans()[i]; return x ? [x.at + 2, x.at + x.len] : [0, 0]; })())).size;
    const sizes = [['25%', '小'], ['50%', '中'], ['75%', '大'], ['100%', '幅いっぱい'], ['', '元の大きさ']];
    sizePop = document.createElement('div');
    sizePop.className = 'gd-sizepop';
    sizePop.innerHTML = `<span class="muted small">画像の大きさ</span>${sizes.map(([v, l]) => `<button type="button" class="btn btn-sm ${v === cur ? 'btn-primary' : ''}" data-sz="${v}">${l}</button>`).join('')}<input type="number" class="input input-sm" min="20" max="2000" step="10" placeholder="px" value="${cur.endsWith('px') ? parseInt(cur, 10) : ''}" aria-label="幅（px）"><button type="button" class="btn btn-sm" data-sz-px>幅 px</button>`;
    const r = el.getBoundingClientRect();
    const host = m.el.getBoundingClientRect();
    sizePop.style.left = `${Math.max(8, Math.min(r.left - host.left, host.width - 420))}px`;
    sizePop.style.top = `${Math.max(8, r.top - host.top - 44)}px`;
    m.el.appendChild(sizePop);
    sizePop.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const b = ev.target.closest('button');
      if (!b) return;
      if (b.hasAttribute('data-sz-px')) { const n = Number(sizePop.querySelector('input').value); if (n >= 20) { setImgSize(i, `${Math.round(n)}px`); closeSizePop(); } return; }
      setImgSize(i, b.dataset.sz); closeSizePop();
    });
  }, true);
  // プレビューのカード・ストリートビュー・記事を開く前に、今の内容を下書きに保存して、戻ってきたときに、そのまま続きから書けるようにする
  $('#gd-preview').addEventListener('click', () => {
    clearTimeout(autoTimer); autosave();
  }, true);
  // 別の画面を開いて、戻ってきたとき（戻る・作り直し）に、いつも、直前の内容から続けられるように、今の入力欄の内容を、いつでも渡せるようにする（ボタンを押したときだけだと、直前の入力が、戻ってしまう）
  opts.draftKey = draftKey;
  Object.defineProperty(opts, 'draft', { configurable: true, enumerable: true, get: () => ({ title: form.title, body: form.body, folder_id: form.folder_id, related: [...draft.related] }) });
  m.el.addEventListener('close', () => { clearTimeout(autoTimer); autosave(); refreshGuideView(); }, { once: true }); // 閉じるときにも、下書きを保存して、一覧に出す
  preview();
  $('#gd-title').focus();
}

// ================= フォルダの編集 =================
export function openFolderEditor(folder = null) {
  if (!deps.isEditor()) { deps.toast('フォルダを作れるのは、編集者のみです', 'error'); return; }
  const f = folder || { id: null, name: '', icon: '📁' };
  const draft = { name: f.name || '', icon: f.icon || '📁' };
  const m = deps.openModal(`
    <div class="modal-head"><h2>${f.id ? 'フォルダを編集' : '新しいフォルダ'}</h2><button class="icon-btn" data-close aria-label="閉じる">✕</button></div>
    <div class="gd-fed">
      <label class="field"><span>名前</span><input type="text" id="fd-name" class="input" maxlength="80" value="${deps.esc(draft.name)}" placeholder="例: ボラードの見分け方"></label>
      <div class="field"><span>アイコン <span class="muted small">（好きな絵文字を入力、下から選ぶ、または画像）</span></span>
        <div class="fd-icon-row"><span class="fd-now" id="fd-now"></span><input type="text" id="fd-emoji" class="input" maxlength="8" placeholder="絵文字を入力" value="${/^data:/.test(draft.icon) ? '' : deps.esc(draft.icon)}">
          <label class="btn btn-sm">🖼 画像を選ぶ<input type="file" id="fd-file" accept="image/*" hidden></label><button type="button" class="btn btn-sm btn-ghost" id="fd-clear">アイコンなし</button></div>
        <div class="fd-emojis">${EMOJIS.map((e) => `<button type="button" data-e="${e}">${e}</button>`).join('')}</div></div>
      <div class="modal-foot">${f.id ? '<button class="btn btn-danger" id="fd-del" type="button">削除</button>' : ''}<span class="grow"></span><button class="btn btn-ghost" data-close type="button">キャンセル</button><button class="btn btn-primary" id="fd-save" type="button">保存</button></div>
    </div>`, 'modal-sm');
  const $ = (s) => m.el.querySelector(s);
  const paint = () => { $('#fd-now').innerHTML = folderIconHtml({ icon: draft.icon }); };
  paint();
  $('#fd-emoji').addEventListener('input', (e) => { draft.icon = e.target.value.trim(); paint(); });
  m.el.querySelectorAll('[data-e]').forEach((b) => b.addEventListener('click', () => { draft.icon = b.dataset.e; $('#fd-emoji').value = b.dataset.e; paint(); }));
  $('#fd-clear').addEventListener('click', () => { draft.icon = ''; $('#fd-emoji').value = ''; paint(); });
  $('#fd-file').addEventListener('change', async (e) => { // 画像は、小さく（64px）して、そのまま保存する
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    try {
      const bmp = await createImageBitmap(file);
      const k = Math.min(1, 64 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      draft.icon = c.toDataURL('image/png'); $('#fd-emoji').value = ''; paint();
    } catch { deps.toast('画像を読み込めませんでした', 'error'); }
  });
  $('#fd-save').addEventListener('click', async (e) => {
    const name = $('#fd-name').value.trim();
    if (!name) { deps.toast('名前を入れてください', 'error'); return; }
    e.currentTarget.disabled = true;
    try {
      const row = await deps.api.saveFolder({ name, icon: draft.icon }, f.id);
      const i = folders.findIndex((x) => x.id === row.id);
      if (i >= 0) folders[i] = row; else folders.push(row);
      if (state.openFolders) { state.openFolders.add(row.id); try { localStorage.setItem('geo-guide-open-folders', JSON.stringify([...state.openFolders])); } catch { /* 無視 */ } }
      changed(); deps.closeModal(); deps.toast('保存しました'); render();
    } catch (ex) { deps.toast(`保存できませんでした: ${ex.message}`, 'error'); e.currentTarget.disabled = false; }
  });
  $('#fd-del')?.addEventListener('click', async () => {
    if (!(await deps.confirm(`フォルダ「${f.name}」を削除しますか？（中の記事は、削除されず、フォルダなしになります）`))) return;
    try { await deps.api.deleteFolder(f.id); folders = folders.filter((x) => x.id !== f.id); for (const a of articles) if (a.folder_id === f.id) a.folder_id = null; changed(); deps.closeModal(); deps.toast('フォルダを削除しました'); render(); } catch (ex) { deps.toast(`削除できませんでした: ${ex.message}`, 'error'); }
  });
}

// ================= タブ（一覧） =================
let viewEl = null;
const dateText = (iso) => { try { return new Date(iso).toLocaleDateString('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric' }); } catch { return ''; } };
const snippet = (body) => String(body || '').replace(/```[\s\S]*?```/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[\[[^\]]*\]\]/g, ' ').replace(/[#>*_`~|-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90);

export function renderGuideView(view, setFit) {
  setFit?.('scroll');
  viewEl = view;
  render();
}
export const refreshGuideView = () => { if (viewEl?.isConnected && viewEl.querySelector('.gd-view')) render(); };

function rowHtml(a, ed) {
  const links = (linkIndexOf(a));
  return `<article class="gd-row ${state.sel.has(a.id) ? 'is-selected' : ''}" data-id="${deps.esc(a.id)}">
    ${ed ? `<label class="gd-check" title="選択（まとめてフォルダに入れる）"><input type="checkbox" ${state.sel.has(a.id) ? 'checked' : ''} aria-label="この記事を選択"></label>` : ''}
    <button type="button" class="gd-row-main" data-open="${deps.esc(a.id)}">
      <span class="gd-row-title">${deps.esc(a.title || '無題')}</span>
      <span class="gd-row-snip muted small">${deps.esc(snippet(a.body)) || '（本文なし）'}</span>
      <span class="gd-row-meta muted small">更新 ${dateText(a.updated_at)}${links.cards ? ` ・ 🃏 ${links.cards}` : ''}${links.svs ? ` ・ 🧍 ${links.svs}` : ''}${(a.related || []).length ? ` ・ 🔗 ${(a.related || []).length}` : ''}</span>
    </button>
    ${ed ? `<button type="button" class="btn btn-sm gd-edit" data-edit="${deps.esc(a.id)}" title="編集">✏</button>` : ''}
  </article>`;
}
function linkIndexOf(a) {
  let cards = 0; let svs = 0;
  for (const m of String(a.body || '').matchAll(/\[\[(card|sv):[\w-]+\]\]|\]\((card|sv):[\w-]+\)/g)) { if ((m[1] || m[2]) === 'card') cards++; else svs++; }
  return { cards, svs };
}

// 下書き（書いている途中のもの。このブラウザに、自動で保存してある）
function draftsHtml(ed) {
  const drafts = ed ? draftList() : [];
  if (!drafts.length) return '';
  return `<section class="gd-folder is-open gd-drafts"><div class="gd-folder-head"><span class="gd-fold-static"><span class="fold-ico">✍</span><b>下書き</b><span class="muted small">${drafts.length}</span><span class="muted small">書いている途中のもの（自動で保存。このブラウザの中）</span></span></div>
    <div class="gd-folder-body">${drafts.map((d) => `<article class="gd-row gd-draft"><button type="button" class="gd-row-main" data-resume="${deps.esc(d.key)}">
        <span class="gd-row-title">${deps.esc(d.title || '無題')}${d.id ? ' <span class="muted small">（保存済みの記事を編集中）</span>' : ' <span class="muted small">（新しい記事）</span>'}</span>
        <span class="gd-row-snip muted small">${deps.esc(snippet(d.body)) || '（本文なし）'}</span>
        <span class="gd-row-meta muted small">下書き ${timeText(d.at)}</span></button>
      <button type="button" class="btn btn-sm btn-ghost" data-draft-rm="${deps.esc(d.key)}" title="この下書きを破棄する">破棄</button></article>`).join('')}</div></section>`;
}

function render() {
  if (!viewEl) return;
  const ed = deps.isEditor();
  const q = state.q.trim().toLowerCase();
  const match = (a) => !q || `${a.title}\n${a.body}`.toLowerCase().includes(q);
  const list = articles.filter(match);
  if (!state.openFolders) { try { state.openFolders = new Set(JSON.parse(localStorage.getItem('geo-guide-open-folders') || 'null') || folders.map((f) => f.id)); } catch { state.openFolders = new Set(folders.map((f) => f.id)); } }
  const byFolder = new Map(folders.map((f) => [f.id, []]));
  const loose = [];
  for (const a of list) { if (a.folder_id && byFolder.has(a.folder_id)) byFolder.get(a.folder_id).push(a); else loose.push(a); }
  const sections = folders.map((f) => {
    const items = byFolder.get(f.id) || [];
    if (q && !items.length) return '';
    const open = state.openFolders.has(f.id) || !!q;
    return `<section class="gd-folder ${open ? 'is-open' : ''}" data-folder="${deps.esc(f.id)}">
      <div class="gd-folder-head"><button type="button" class="gd-fold-toggle" data-toggle="${deps.esc(f.id)}" aria-expanded="${open}"><span class="gd-caret">▸</span>${folderIconHtml(f)}<b>${deps.esc(f.name)}</b><span class="muted small">${items.length}</span></button>${ed ? `<button type="button" class="btn btn-sm btn-ghost" data-fedit="${deps.esc(f.id)}" title="フォルダを編集">✏</button>` : ''}</div>
      ${open ? `<div class="gd-folder-body">${items.length ? items.map((a) => rowHtml(a, ed)).join('') : '<p class="muted small gd-empty">記事がありません。記事を選んで「フォルダに入れる」で、足せます</p>'}</div>` : ''}
    </section>`;
  }).join('');
  const missing = info.missing;
  viewEl.innerHTML = `<div class="gd-view">
    <div class="toolbar gd-toolbar">
      <h2 class="lang-title">📝 ガイド</h2>
      <input type="search" id="gd-q" class="input grow" placeholder="記事を探す（タイトル・本文）" value="${deps.esc(state.q)}" autocomplete="off">
      ${ed ? '<button class="btn btn-primary" id="gd-new">＋ 新しい記事</button><button class="btn btn-ghost" id="gd-newfolder">📁 新しいフォルダ</button>' : ''}
      <span class="counter">${articles.length} 件</span>
    </div>
    ${missing ? `<p class="gd-warn">${deps.esc(missing)}</p>` : ''}
    ${ed ? `<div class="sel-bar gd-selbar" id="gd-selbar" ${state.sel.size ? '' : 'hidden'}><b>${state.sel.size} 件を選択中</b><span class="grow"></span>
      <select id="gd-moveto" class="select select-sm"><option value="">📁 フォルダに入れる…</option><option value="__none">（フォルダから出す）</option>${folders.map((f) => `<option value="${deps.esc(f.id)}">${deps.esc(f.icon && !/^data:/.test(f.icon) ? `${f.icon} ` : '')}${deps.esc(f.name)}</option>`).join('')}</select>
      <button class="btn btn-sm btn-danger" id="gd-selDel">🗑 削除</button><button class="icon-btn" id="gd-selClear" aria-label="選択を解除">✕</button></div>` : ''}
    <p class="muted small gd-hint">${ed ? '記事を書くと、ここに増えます。カードやストリートビューへのリンク・カードの画像を、記事に入れられます。' : 'ここで、記事を読めます（書けるのは、編集者のみです）。'}</p>
    <div class="gd-list">
      ${draftsHtml(ed)}
      ${sections}
      ${loose.length || !folders.length ? `<section class="gd-folder is-open gd-loose">${folders.length ? '<div class="gd-folder-head"><span class="gd-fold-static"><span class="fold-ico">📄</span><b>フォルダに入っていない記事</b><span class="muted small">' + loose.length + '</span></span></div>' : ''}<div class="gd-folder-body">${loose.length ? loose.map((a) => rowHtml(a, ed)).join('') : `<div class="empty">${articles.length ? '一致する記事がありません' : 'まだ記事がありません。' + (ed ? '「＋ 新しい記事」から書けます。' : '')}</div>`}</div></section>` : ''}
    </div>
  </div>`;
  bind(ed);
}

function bind(ed) {
  const v = viewEl;
  const q = v.querySelector('#gd-q');
  let composing = false;
  q.addEventListener('compositionstart', () => { composing = true; });
  q.addEventListener('compositionend', () => { composing = false; state.q = q.value; keepFocus(); });
  q.addEventListener('input', (e) => { if (composing || e.isComposing) return; state.q = q.value; keepFocus(); });
  const keepFocus = () => { const pos = q.selectionStart; render(); const n = viewEl.querySelector('#gd-q'); n?.focus(); try { n.setSelectionRange(pos, pos); } catch { /* 無視 */ } };
  v.querySelectorAll('[data-resume]').forEach((b) => b.addEventListener('click', () => {
    const key = b.dataset.resume; const d = loadDrafts()[key];
    if (d) openArticleEditor(d.id ? articleById(d.id) : null, { draft: d, draftKey: key, onSaved: () => render(), onDeleted: () => render() });
  }));
  v.querySelectorAll('[data-draft-rm]').forEach((b) => b.addEventListener('click', async () => {
    if (await deps.confirm('この下書きを破棄しますか？（元に戻せません）')) { deleteDraft(b.dataset.draftRm); render(); }
  }));
  v.querySelector('#gd-new')?.addEventListener('click', () => openArticleEditor(null, { onSaved: () => render() }));
  v.querySelector('#gd-newfolder')?.addEventListener('click', () => openFolderEditor());
  v.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.toggle;
    if (state.openFolders.has(id)) state.openFolders.delete(id); else state.openFolders.add(id);
    try { localStorage.setItem('geo-guide-open-folders', JSON.stringify([...state.openFolders])); } catch { /* 無視 */ }
    render();
  }));
  v.querySelectorAll('[data-fedit]').forEach((b) => b.addEventListener('click', () => openFolderEditor(folders.find((f) => f.id === b.dataset.fedit))));
  v.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', (e) => {
    if (state.sel.size && ed && !e.target.closest('.gd-edit')) { toggleSel(b.dataset.open); return; }
    deps.openArticle(b.dataset.open, b);
  }));
  v.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openArticleEditor(articleById(b.dataset.edit), { onSaved: () => render(), onDeleted: () => render() })));
  const toggleSel = (id) => { if (state.sel.has(id)) state.sel.delete(id); else state.sel.add(id); render(); };
  v.querySelectorAll('.gd-check input').forEach((c) => c.addEventListener('change', () => toggleSel(c.closest('.gd-row').dataset.id)));
  v.querySelector('#gd-selClear')?.addEventListener('click', () => { state.sel.clear(); render(); });
  v.querySelector('#gd-moveto')?.addEventListener('change', async (e) => {
    const to = e.target.value; e.target.value = '';
    if (!to) return;
    const ids = [...state.sel];
    try {
      for (const id of ids) { const a = articleById(id); if (!a) continue; const row = await deps.api.saveArticle({ folder_id: to === '__none' ? null : to }, id); Object.assign(a, row); }
      if (to !== '__none' && state.openFolders) state.openFolders.add(to);
      state.sel.clear(); changed(); deps.toast(`${ids.length} 件を、${to === '__none' ? 'フォルダから出しました' : 'フォルダに入れました'}`); render();
    } catch (ex) { deps.toast(`移せませんでした: ${ex.message}`, 'error'); }
  });
  v.querySelector('#gd-selDel')?.addEventListener('click', async () => {
    const ids = [...state.sel];
    if (!ids.length || !(await deps.confirm(`選んだ ${ids.length} 件の記事を削除しますか？（元に戻せません）`))) return;
    for (const id of ids) { try { await deps.api.deleteArticle(id); articles = articles.filter((a) => a.id !== id); } catch { /* 次へ */ } }
    state.sel.clear(); changed(); render();
  });
}
