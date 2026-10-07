// ナンバープレートのぼかし: カードごとに、ぼかす範囲（画像に対する割合の四角 [x, y, 幅, 高さ]）を持つ。
//  - editBlur: 範囲を指定する画面（ドラッグで四角を追加・押して削除。AI に自動で探してもらうこともできる）
//  - blurredUrl: 範囲をぼかした画像を作る（暗記・クイズで、設定がオンのときに使う）
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));

/** 保存・表示してよい範囲だけにそろえる */
export function cleanRegions(list) {
  return (Array.isArray(list) ? list : []).map((r) => (Array.isArray(r) ? r.map(Number) : [])).filter((r) => r.length === 4 && r.every(Number.isFinite))
    .map(([x, y, w, h]) => [clamp(x), clamp(y), clamp(w, 0, 1 - clamp(x)), clamp(h, 0, 1 - clamp(y))]).filter(([, , w, h]) => w > 0.004 && h > 0.004).slice(0, 12)
    .map((r) => r.map((v) => Math.round(v * 10000) / 10000));
}

// ---- ぼかした画像を作る ----
const cache = new Map(); // key → Promise<objectURL>
async function loadBitmap(src) {
  let url = src;
  if (!/^(data|blob):/.test(src)) {
    const res = await fetch(src, { mode: 'cors' });
    if (!res.ok) throw new Error(String(res.status));
    url = URL.createObjectURL(await res.blob());
  }
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}
/** src の画像の、regions の範囲をぼかした画像の URL（同じ組み合わせは作り直さない） */
export function blurredUrl(src, regions) {
  const rs = cleanRegions(regions);
  if (!src || !rs.length) return Promise.resolve(src);
  const key = `${src}|${JSON.stringify(rs)}`;
  if (!cache.has(key)) {
    cache.set(key, (async () => {
      const img = await loadBitmap(src);
      const scale = Math.min(1, 1800 / Math.max(img.naturalWidth, img.naturalHeight));
      const W = Math.max(1, Math.round(img.naturalWidth * scale));
      const H = Math.max(1, Math.round(img.naturalHeight * scale));
      const cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      const g = cv.getContext('2d');
      g.drawImage(img, 0, 0, W, H);
      const canFilter = 'filter' in g;
      for (const [x, y, w, h] of rs) {
        const px = Math.max(0, Math.floor((x - w * 0.08) * W));
        const py = Math.max(0, Math.floor((y - h * 0.15) * H));
        const pw = Math.min(W - px, Math.ceil(w * W * 1.16));
        const ph = Math.min(H - py, Math.ceil(h * H * 1.3));
        g.save();
        g.beginPath(); g.rect(px, py, pw, ph); g.clip();
        if (canFilter) { g.filter = `blur(${Math.max(5, Math.round(Math.min(pw, ph) / 4))}px)`; g.drawImage(img, 0, 0, W, H); } // 縁の外の色も混ぜて、なめらかに
        else { // blur が使えないブラウザは、モザイク
          const t = document.createElement('canvas');
          t.width = Math.max(2, Math.round(pw / 14)); t.height = Math.max(2, Math.round(ph / 14));
          t.getContext('2d').drawImage(cv, px, py, pw, ph, 0, 0, t.width, t.height);
          g.imageSmoothingEnabled = false;
          g.drawImage(t, 0, 0, t.width, t.height, px, py, pw, ph);
        }
        g.restore();
      }
      const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.9));
      return URL.createObjectURL(blob);
    })().catch((e) => { cache.delete(key); throw e; }));
  }
  return cache.get(key);
}

// ---- AI でナンバープレートを探す（/api/ask に画像を送り、JSON で位置をもらう）----
async function detectWithAi(src, api) {
  const img = await loadBitmap(src);
  const scale = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight));
  const cv = document.createElement('canvas');
  cv.width = Math.round(img.naturalWidth * scale); cv.height = Math.round(img.naturalHeight * scale);
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  const data = cv.toDataURL('image/jpeg', 0.85).split(',')[1];
  const token = await api.getAccessToken();
  const res = await fetch('/api/ask', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({
      messages: [{ role: 'user', content: '画像に写っている車のナンバープレート（読める・読めない両方）の位置を探してください。説明は書かず、次の形式の JSON だけを返してください。座標は画像の左上を原点として、画像全体を 1 とした割合です: {"plates":[[x,y,幅,高さ],…]}。ナンバープレートがなければ {"plates":[]} にしてください。' }],
      context: '', model: 'auto', image: { media_type: 'image/jpeg', data },
    }),
  });
  if (!res.ok) throw new Error(res.status === 404 || res.status === 503 ? 'AI が設定されていません' : `AI に接続できませんでした（${res.status}）`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let text = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const ev = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const line = ev.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      try { const j = JSON.parse(line.slice(5)); if (j.text) text += j.text; if (j.error) throw new Error(j.error); } catch (e) { if (e.message && !(e instanceof SyntaxError)) throw e; }
    }
  }
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) throw new Error('位置を読み取れませんでした');
  const j = JSON.parse(m[0]);
  return cleanRegions(j.plates);
}

/** 範囲を指定する画面。保存なら新しい範囲の配列、キャンセルなら null */
export function editBlur(src, regions, { api, toast, host } = {}) {
  return new Promise((resolve) => {
    let list = cleanRegions(regions);
    const d = document.createElement('dialog');
    d.className = 'modal modal-blur';
    d.innerHTML = `<div class="modal-inner">
      <div class="modal-head"><h2>🔲 ナンバープレートのぼかし範囲</h2><button class="icon-btn" data-x aria-label="閉じる">✕</button></div>
      <p class="muted small">画像の上をドラッグして、ぼかしたい範囲を追加します。範囲を押すと削除できます。暗記・クイズで、設定の「ナンバープレートをぼかす」がオンのときに、この範囲がぼかされます。</p>
      <div class="blur-stage"><div class="blur-box"><img src="${esc(src)}" alt="" draggable="false"><div class="blur-rects"></div></div></div>
      <div class="modal-foot blur-foot">
        <button class="btn btn-ghost" type="button" data-ai title="AI がナンバープレートを探して、範囲を追加します（精度は完全ではないので、確認してください）">✨ AI で自動検出</button>
        <button class="btn btn-ghost" type="button" data-clear>すべて消す</button>
        <span class="grow"></span>
        <button class="btn btn-ghost" type="button" data-x>キャンセル</button>
        <button class="btn btn-primary" type="button" data-ok>決定</button>
      </div></div>`;
    (host || document.body).appendChild(d);
    const box = d.querySelector('.blur-box');
    const rects = d.querySelector('.blur-rects');
    const draw = () => {
      rects.innerHTML = list.map(([x, y, w, h], i) => `<button type="button" class="blur-rect" data-i="${i}" title="押すと削除" style="left:${x * 100}%;top:${y * 100}%;width:${w * 100}%;height:${h * 100}%"></button>`).join('');
      d.querySelector('[data-clear]').disabled = !list.length;
    };
    draw();
    let drag = null;
    const pos = (e) => { const r = box.getBoundingClientRect(); return [clamp((e.clientX - r.left) / r.width), clamp((e.clientY - r.top) / r.height)]; };
    box.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.blur-rect') || e.button !== 0) return;
      e.preventDefault();
      box.setPointerCapture(e.pointerId);
      drag = { a: pos(e), el: document.createElement('div') };
      drag.el.className = 'blur-rect is-draft';
      rects.append(drag.el);
    });
    box.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const [x0, y0] = drag.a; const [x1, y1] = pos(e);
      drag.cur = [Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)];
      Object.assign(drag.el.style, { left: `${drag.cur[0] * 100}%`, top: `${drag.cur[1] * 100}%`, width: `${drag.cur[2] * 100}%`, height: `${drag.cur[3] * 100}%` });
    });
    const endDrag = () => { if (!drag) return; const c = drag.cur; drag = null; if (c && c[2] > 0.01 && c[3] > 0.01) list = cleanRegions([...list, c]); draw(); };
    box.addEventListener('pointerup', endDrag);
    box.addEventListener('pointercancel', endDrag);
    rects.addEventListener('click', (e) => { const b = e.target.closest('.blur-rect[data-i]'); if (b) { list.splice(Number(b.dataset.i), 1); draw(); } });
    d.querySelector('[data-clear]').addEventListener('click', () => { list = []; draw(); });
    d.querySelector('[data-ai]').addEventListener('click', async (e) => {
      const b = e.currentTarget;
      b.disabled = true; b.textContent = '✨ 探しています…';
      try {
        const found = await detectWithAi(src, api);
        list = cleanRegions([...list, ...found]);
        draw();
        toast?.(found.length ? `ナンバープレートを ${found.length} か所見つけました（位置を確認してください）` : 'ナンバープレートは見つかりませんでした');
      } catch (ex) { toast?.(`自動検出できませんでした: ${ex.message}`, 'error'); } finally { b.disabled = false; b.textContent = '✨ AI で自動検出'; }
    });
    const done = (v) => { d.close(); d.remove(); resolve(v); };
    d.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', () => done(null)));
    d.querySelector('[data-ok]').addEventListener('click', () => done(list));
    d.addEventListener('cancel', (e) => { e.preventDefault(); done(null); });
    d.showModal();
  });
}
