// Plonkit の国ごとのガイドを、日本語に翻訳して、アプリのウィンドウの中で読めるようにする
// 本文は /api/plonkit（functions/api/plonkit.js）が、Plonkit から取得して翻訳する。画像も、同じ API が中継する
// 画像ごとに「画像 | 説明」を並べる。画像に貼られた Google マップのリンクは、押すとアプリのストリートビューで開く

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const cache = new Map(); // slug → ガイド（開き直しても、もう一度取りに行かない）
const loading = new Map();

export function loadGuide(slug, api) {
  if (cache.has(slug)) return Promise.resolve(cache.get(slug));
  if (loading.has(slug)) return loading.get(slug);
  const p = (async () => {
    const token = await api.getAccessToken();
    const res = await fetch(`/api/plonkit?slug=${encodeURIComponent(slug)}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `読み込めませんでした（${res.status}）`);
    if (data.translated) cache.set(slug, data); // 翻訳できていないときは、次に開いたときにやり直す
    return data;
  })().finally(() => loading.delete(slug));
  loading.set(slug, p);
  return p;
}

// 画像は、GitHub の Currywarrior/geoguessr-guide に集められた Plonkit の画像（WebP）を、jsDelivr（CDN）から直接読み込む。
// そこにない画像・読み込めない画像は、このサイトの中継（/api/plonkit?img=）から取得する
const CDN = 'https://cdn.jsdelivr.net/gh/Currywarrior/geoguessr-guide@fe8d0288858de706f56b273ca801bf2c3267fdd1/assets/img/plonkit/';
const proxySrc = (u) => (!u ? '' : u.startsWith('/') ? `/api/plonkit?img=${encodeURIComponent(u)}` : u);
export function imgSrc(u) {
  if (!u || !u.startsWith('/images/')) return proxySrc(u);
  let key = u.slice('/images/'.length);
  try { key = decodeURI(key); } catch { /* そのまま */ }
  return CDN + encodeURI(key.replace(/\.[A-Za-z0-9]+$/, '') + '.webp');
}
// <img> の属性: 読み込む先（data-src）と、だめだったときの先（data-fb）
const imgAttrs = (u) => `data-src="${esc(imgSrc(u))}" data-fb="${esc(proxySrc(u))}"`;

// ---- Google マップのリンクから、ストリートビューの位置・向きを読み取る ----
const SHORT = /^https?:\/\/(goo\.gl\/maps\/|maps\.app\.goo\.gl\/)/;
export function parseStreetView(url) {
  if (!url) return null;
  let m = /\/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(?:[\d.]+a,)?([\d.]+y)?,?(?:([\d.]+)h)?,?(?:([\d.]+)t)?/.exec(url);
  const isPano = /\/@[^/]*,\d+(?:\.\d+)?a,/.test(url) || /map_action=pano|cbll=|layer=c|!1e1!|!3m\d+!1e1/.test(url);
  let lat; let lng; let heading = 0; let pitch = 0; let fov = 0;
  if (m) {
    lat = +m[1]; lng = +m[2];
    heading = m[4] ? +m[4] : 0;
    pitch = m[5] ? Math.round((90 - +m[5]) * 10) / 10 : 0; // リンクの t は、真下からの角度（90 − 俯仰角）
    if (m[3]) fov = Math.max(10, Math.min(100, +m[3])); // リンクの y は、視野角
  } else {
    m = /[?&](?:viewpoint|cbll)=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(url);
    if (!m) { m = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(url); if (!m || !isPano) return null; }
    lat = +m[1]; lng = +m[2];
    const h = /[?&]heading=(-?[\d.]+)/.exec(url); if (h) heading = ((+h[1] % 360) + 360) % 360;
    const p = /[?&]pitch=(-?[\d.]+)/.exec(url); if (p) pitch = +p[1];
  }
  if (!isPano || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng, heading, pitch, fov };
}
const svAttr = (url) => {
  if (SHORT.test(url)) return ` data-pk-go="${esc(url)}"`;
  const p = parseStreetView(url);
  return p ? ` data-pk-sv="${p.lat},${p.lng},${Math.round(p.heading)},${p.pitch},${Math.round(p.fov)}"` : '';
};
const externalOk = (u) => /^https?:\/\//i.test(u);

// ---- 説明（Markdown の一部: **太字**、- 箇条書き、[文字](リンク)）----
function inline(t) {
  let s = esc(t);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, url) => {
    const u = url.replace(/&amp;/g, '&');
    if (!externalOk(u)) return text;
    const sv = svAttr(u);
    return `<a href="${esc(u)}"${sv ? `${sv} class="pk-sv-link" title="ストリートビューで開く"` : ' target="_blank" rel="noopener"'}>${sv ? '📍' : ''}${text}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[\s(（])\*([^*\s][^*]*?)\*(?=$|[\s)）。、.,])/g, '$1<em>$2</em>');
  return s;
}
function textHtml(lines) {
  let out = '';
  let list = false;
  for (const raw of lines) {
    const line = String(raw);
    const li = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (li) { if (!list) { out += '<ul>'; list = true; } out += `<li>${inline(li[1])}</li>`; continue; }
    if (list) { out += '</ul>'; list = false; }
    if (line.trim()) out += `<p>${inline(line)}</p>`;
  }
  if (list) out += '</ul>';
  return out;
}

/** ガイド全体の HTML と、目次の項目 */
export function guideHtml(g, { editor = false } = {}) {
  const addBtn = editor ? '<button type="button" class="pk-add" data-pk-add title="この画像で、カードを作る（国と画像を入れた状態で、作成画面を開きます）">＋ カード</button>' : '';
  const toc = [];
  let n = 0;
  const body = g.steps.map((s) => {
    const sid = `pk-${n++}`;
    toc.push({ id: sid, title: s.title, level: 1 });
    const items = s.items.map((it) => {
      if (it.k === 'div') { const id = `pk-${n++}`; toc.push({ id, title: it.title, level: 2 }); return `<h4 class="pk-div" id="${id}">${esc(it.title)}</h4>`; }
      if (it.k === 'img') return `<figure class="pk-wide pk-pic"><img ${imgAttrs(it.img)} alt="">${addBtn}</figure>`;
      const link = it.link || '';
      const sv = link && !/\.(png|jpe?g|webp|gif)(\?|$)/i.test(link) ? svAttr(link) : '';
      const w = it.w > 0 ? Math.max(28, Math.min(60, Math.round(it.w * 100))) : 40;
      const img = it.img ? `<figure class="pk-img pk-pic" style="--w:${w}%"><img ${imgAttrs(it.img)} alt="${esc(it.alt)}" ${sv ? `${sv} class="pk-sv" title="押すとストリートビューで開く"` : link && externalOk(link) && !sv ? `data-pk-ext="${esc(link)}" class="pk-zoom" title="押すと拡大"` : 'class="pk-zoom" title="押すと拡大"'}>${sv ? '<span class="pk-badge" aria-hidden="true">📍 ストリートビュー</span>' : ''}${addBtn}</figure>` : '';
      return `<div class="pk-tip ${img ? '' : 'is-text'}">${img}<div class="pk-text">${textHtml(it.text)}</div></div>`;
    }).join('');
    return `<section class="pk-step" id="${sid}"><h3 class="pk-step-title">${esc(s.title)}</h3>${items}</section>`;
  }).join('');
  return { body, toc };
}

export function tocHtml(toc) {
  return toc.map((t) => `<a href="#${t.id}" class="pk-toc-item lv${t.level}" data-pk-to="${t.id}">${esc(t.title)}</a>`).join('');
}

/** 画像を、画面に近づいたものから、少しずつ（同時に 6 枚まで）読み込む。Plonkit が続けての取得を断ることがあるので、失敗したら間をあけてやり直す */
export function loadImages(root) {
  const queue = [];
  let active = 0;
  const pump = () => {
    while (active < 6 && queue.length) {
      const img = queue.shift();
      if (!img.isConnected) continue;
      active++;
      const done = () => { active--; pump(); };
      const tries = Number(img.dataset.tries || 0);
      img.onload = () => { img.closest('.pk-pic')?.classList.remove('is-failed'); img.closest('.pk-pic')?.classList.add('is-loaded'); done(); };
      img.onerror = () => {
        if (img.dataset.fb && img.dataset.src !== img.dataset.fb) { img.dataset.src = img.dataset.fb; queue.unshift(img); done(); return; } // まず、画像の置き場（CDN）にない・読めないときは、このサイトの中継から
        if (tries < 6) { img.dataset.tries = String(tries + 1); setTimeout(() => { queue.push(img); pump(); }, 2500 * (tries + 1)); } else img.closest('.pk-pic')?.classList.add('is-failed');
        done();
      };
      const src = img.dataset.src;
      img.src = src;
    }
  };
  const start = (img) => { if (img.dataset.queued) return; img.dataset.queued = '1'; queue.push(img); pump(); };
  const imgs = [...root.querySelectorAll('img[data-src]')];
  if (!('IntersectionObserver' in window)) imgs.forEach(start);
  else {
    const io = new IntersectionObserver((list) => { for (const e of list) if (e.isIntersecting) { io.unobserve(e.target); const i = e.target.querySelector('img[data-src]'); if (i) start(i); } }, { rootMargin: '600px 0px' });
    imgs.forEach((i) => io.observe(i.closest('.pk-pic') || i)); // 画像の入れ物（高さのある枠）を見張る
  }
  // 読み込めなかった画像は、押すと、もう一度試す
  root.addEventListener('click', (e) => {
    const f = e.target.closest('.pk-pic.is-failed');
    if (!f) return;
    e.preventDefault(); e.stopPropagation();
    const img = f.querySelector('img');
    f.classList.remove('is-failed');
    img.dataset.tries = '0';
    queue.push(img); pump();
  }, true);
}

/** 画像・リンクを押したときの動作。openSv(lat, lng, {heading, pitch, fov}, newWindow) はアプリのストリートビュー */
export function bindGuide(root, { openSv, api, toast, addCard }) {
  const open = (v, newWindow) => {
    const [lat, lng, heading, pitch, fov] = v.split(',').map(Number);
    openSv(lat, lng, { heading, pitch, fov }, newWindow);
  };
  const go = async (short, newWindow) => {
    try {
      const token = await api.getAccessToken();
      const res = await fetch(`/api/plonkit?go=${encodeURIComponent(short)}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
      const j = await res.json();
      const p = parseStreetView(j.url);
      if (p) { openSv(p.lat, p.lng, p, newWindow); return; }
      window.open(j.url || short, '_blank', 'noopener');
    } catch { toast?.('リンクを開けませんでした', 'error'); }
  };
  root.addEventListener('click', (e) => { // 画像でカードを作る
    const b = e.target.closest('[data-pk-add]');
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    addCard?.(b.closest('.pk-pic')?.querySelector('img'));
  }, true);
  const handle = (e, newWindow) => {
    const t = e.target.closest?.('[data-pk-sv], [data-pk-go], .pk-zoom, [data-pk-ext]');
    if (!t || !root.contains(t)) return false;
    e.preventDefault();
    e.stopPropagation();
    if (t.dataset.pkSv) open(t.dataset.pkSv, newWindow);
    else if (t.dataset.pkGo) go(t.dataset.pkGo, newWindow);
    else if (t.classList.contains('pk-zoom')) t.closest('.pk-img')?.classList.toggle('is-zoom');
    return true;
  };
  root.addEventListener('click', (e) => { if (!handle(e, false) && e.target.closest?.('.pk-img.is-zoom')) e.target.closest('.pk-img').classList.remove('is-zoom'); });
  root.addEventListener('contextmenu', (e) => { if (e.target.closest?.('[data-pk-sv], [data-pk-go]')) handle(e, true); }, true);
}
