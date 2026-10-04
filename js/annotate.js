// 画像の編集: トリミングと書き込み（丸・矢印・四角・ペン）
// 書き込みは 2 つのレイヤー: 「表面」は画像に焼き込み、「裏面だけ」は別の透明な画像として保存し、
// カードを裏返したとき（答えを見たとき）だけ画像に重ねて表示する（どこがヒントだったか分かるように）
// 戻り値: キャンセルなら null。完了なら { image, back }
//   image: 新しい画像（Blob）。変更なしなら null
//   back : 裏面だけのレイヤー（透明な PNG の Blob）。変更なしなら null、消したなら 'clear'
const COLORS = [['#ff3b30', '赤'], ['#ffd60a', '黄'], ['#ffffff', '白'], ['#0a84ff', '青'], ['#000000', '黒']];
const TOOLS = [['pan', '✋ 移動'], ['crop', '✂ トリミング'], ['ellipse', '◯ 丸'], ['arrow', '➜ 矢印'], ['line', '╱ 直線'], ['rect', '▢ 四角'], ['pen', '✎ ペン']];
const ZMAX = 8;

// 別のサイトの画像（署名付き URL など）をそのまま描くとキャンバスが汚染されて書き出せないため、
// いったん Blob として取得してから読み込む
async function loadImage(src) {
  if (!src) return null;
  let url = src;
  let revoke = null;
  if (!/^(data|blob):/.test(src)) {
    try {
      const res = await fetch(src, { mode: 'cors' });
      if (!res.ok) throw new Error(String(res.status));
      url = URL.createObjectURL(await res.blob());
      revoke = url;
    } catch { url = src; }
  }
  const img = new Image();
  if (!revoke && !/^(data|blob):/.test(url)) img.crossOrigin = 'anonymous';
  img.src = url;
  try { await img.decode(); } catch { return null; }
  if (revoke) setTimeout(() => URL.revokeObjectURL(revoke), 1000);
  return img;
}

const toBlob = (canvas) => new Promise((resolve, reject) => {
  try {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('画像を書き出せませんでした'))), 'image/png');
  } catch (ex) { reject(ex); }
});

export async function editImage(src, { backSrc = '', host = document.body } = {}) {
  const image = await loadImage(src);
  if (!image) throw new Error('画像を読み込めませんでした');
  const backImage = backSrc ? await loadImage(backSrc) : null;
  return new Promise((resolve) => start(image, backImage, host, resolve));
}

function start(image, backImage, host, resolve) {
  const W = image.naturalWidth;
  const H = image.naturalHeight;
  const lw = Math.max(3, Math.round(Math.max(W, H) / 220)); // 線の太さは画像の大きさに合わせる
  const shapes = []; // { layer: 'front' | 'back', type, color, ... }
  const history = []; // 戻す用: { kind: 'shape' } / { kind: 'crop', prev } / { kind: 'clearBack', prev }
  let crop = null; // { x, y, w, h }（画像の座標）
  let backCleared = false; // 前からある「裏面だけ」のレイヤーを消した
  let tool = 'ellipse';
  let layer = 'front';
  let color = COLORS[0][0];
  let draft = null;

  const box = document.createElement('div');
  box.className = 'annot';
  box.innerHTML = `
    <div class="annot-bar">
      <div class="seg annot-layer" role="group" aria-label="書き込む先">
        <button type="button" data-layer="front" class="on" title="画像そのものに書き込みます（表面にも見えます）">🖼 表面に書き込む</button>
        <button type="button" data-layer="back" title="カードを裏返したときだけ画像に重ねて表示します（どこがヒントだったかの印に）">🔁 裏面だけに表示</button>
      </div>
      <div class="seg annot-tools">${TOOLS.map(([id, label]) => `<button type="button" data-tool="${id}" class="${id === tool ? 'on' : ''}">${label}</button>`).join('')}</div>
      <div class="annot-colors">${COLORS.map(([c, n]) => `<button type="button" class="annot-color ${c === color ? 'on' : ''}" data-color="${c}" style="--c:${c}" title="${n}" aria-label="${n}"></button>`).join('')}</div>
      <button type="button" class="btn btn-sm" data-act="undo" title="ひとつ戻す（Ctrl+Z）">↶ 戻す</button>
      <button type="button" class="btn btn-sm btn-ghost" data-act="clear" title="今のレイヤーの書き込みをすべて消す">消す</button>
      <button type="button" class="btn btn-sm btn-ghost" data-act="uncrop" hidden>トリミング解除</button>
      <span class="grow"></span>
      <button type="button" class="btn btn-sm btn-ghost" data-act="cancel">キャンセル</button>
      <button type="button" class="btn btn-sm btn-primary" data-act="done">完了</button>
    </div>
    <div class="annot-stage"><canvas></canvas>
      <div class="annot-zoom">
        <button type="button" data-z="in" title="拡大（ホイール・ピンチでも）" aria-label="拡大">＋</button>
        <span class="annot-zoom-n">100%</span>
        <button type="button" data-z="out" title="縮小" aria-label="縮小">−</button>
        <button type="button" data-z="fit" title="全体を表示（0 キー）" aria-label="全体を表示">⤢</button>
      </div>
    </div>
    <p class="annot-hint"></p>`;
  host.appendChild(box);
  const canvas = box.querySelector('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  const hint = box.querySelector('.annot-hint');
  const stage = box.querySelector('.annot-stage');

  const drawShape = (ctx, s) => {
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // 暗い背景でも見えるように、細い影をつける
    ctx.shadowColor = s.color === '#000000' ? 'rgba(255,255,255,.7)' : 'rgba(0,0,0,.6)';
    ctx.shadowBlur = lw;
    if (s.type === 'pen') {
      ctx.beginPath();
      s.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
    } else if (s.type === 'line') {
      ctx.beginPath();
      ctx.moveTo(s.x0, s.y0);
      ctx.lineTo(s.x1, s.y1);
      ctx.stroke();
    } else if (s.type === 'rect') {
      ctx.strokeRect(Math.min(s.x0, s.x1), Math.min(s.y0, s.y1), Math.abs(s.x1 - s.x0), Math.abs(s.y1 - s.y0));
    } else if (s.type === 'ellipse') {
      ctx.beginPath();
      ctx.ellipse((s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2, Math.max(1, Math.abs(s.x1 - s.x0) / 2), Math.max(1, Math.abs(s.y1 - s.y0) / 2), 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (s.type === 'arrow') {
      const a = Math.atan2(s.y1 - s.y0, s.x1 - s.x0);
      const head = lw * 4.5;
      ctx.beginPath();
      ctx.moveTo(s.x0, s.y0);
      ctx.lineTo(s.x1 - Math.cos(a) * head * 0.6, s.y1 - Math.sin(a) * head * 0.6);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x1 - head * Math.cos(a - 0.45), s.y1 - head * Math.sin(a - 0.45));
      ctx.lineTo(s.x1 - head * Math.cos(a + 0.45), s.y1 - head * Math.sin(a + 0.45));
      ctx.closePath();
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  };
  const normRect = (r) => ({ x: Math.min(r.x0, r.x1), y: Math.min(r.y0, r.y1), w: Math.abs(r.x1 - r.x0), h: Math.abs(r.y1 - r.y0) });

  const redraw = () => {
    g.clearRect(0, 0, W, H);
    g.globalAlpha = 1;
    g.drawImage(image, 0, 0);
    // 今書き込んでいないレイヤーは薄く表示
    g.globalAlpha = layer === 'front' ? 1 : 0.4;
    for (const s of shapes) if (s.layer === 'front') drawShape(g, s);
    g.globalAlpha = layer === 'back' ? 1 : 0.4;
    if (backImage && !backCleared) g.drawImage(backImage, 0, 0, W, H);
    for (const s of shapes) if (s.layer === 'back') drawShape(g, s);
    g.globalAlpha = 1;
    if (draft && draft.type !== 'crop') drawShape(g, draft);
    // トリミングの範囲の外を暗く
    const c = draft?.type === 'crop' ? normRect(draft) : crop;
    if (c) {
      g.fillStyle = 'rgba(0,0,0,.55)';
      g.fillRect(0, 0, W, c.y);
      g.fillRect(0, c.y + c.h, W, H - c.y - c.h);
      g.fillRect(0, c.y, c.x, c.h);
      g.fillRect(c.x + c.w, c.y, W - c.x - c.w, c.h);
      g.setLineDash([lw * 2, lw * 1.5]);
      g.strokeStyle = '#fff';
      g.lineWidth = Math.max(2, lw / 2);
      g.strokeRect(c.x, c.y, c.w, c.h);
      g.setLineDash([]);
    }
  };
  const updateUI = () => {
    box.querySelectorAll('[data-layer]').forEach((x) => x.classList.toggle('on', x.dataset.layer === layer));
    box.querySelectorAll('[data-tool]').forEach((x) => x.classList.toggle('on', x.dataset.tool === tool));
    box.querySelector('[data-act="uncrop"]').hidden = !crop;
    box.classList.toggle('is-back-layer', layer === 'back');
    stage.classList.toggle('is-pan', tool === 'pan');
    hint.textContent = tool === 'pan'
      ? 'ドラッグで画像を動かします。ホイール / ピンチで拡大・縮小（どのツールでも、スペースキーを押しながら / 右ドラッグで移動できます）'
      : tool === 'crop'
      ? 'ドラッグして残す範囲を選びます（もう一度ドラッグで選び直し）'
      : tool === 'line'
      ? 'ドラッグで直線を引きます。Shift を押しながらで水平・垂直・45° に揃えます'
      : layer === 'back'
        ? '「裏面だけ」: ここに描いた印は、カードを裏返したときだけ画像に重なって表示されます'
        : 'ドラッグして描きます。注目してほしいところに丸や矢印をつけましょう';
  };
  redraw();
  updateUI();

  // ---- 拡大・移動: キャンバスを枠（stage）の中で大きさ・位置を変えて表示する（描く座標は画像の座標のまま）
  const zoomLabel = box.querySelector('.annot-zoom-n');
  let z = 1; // 全体表示に対する倍率
  let ox = 0; // 枠の中でのキャンバスの左上の位置
  let oy = 0;
  const fitScale = () => Math.min(stage.clientWidth / W, stage.clientHeight / H);
  const layout = () => {
    const s0 = fitScale() * z;
    canvas.style.width = `${W * s0}px`;
    canvas.style.height = `${H * s0}px`;
    canvas.style.transform = `translate(${ox}px, ${oy}px)`;
    zoomLabel.textContent = `${Math.round(z * 100)}%`;
  };
  // 拡大していないときは中央、拡大中は画像の外側が枠の内側に入り込みすぎないように
  const clamp = () => {
    const w = W * fitScale() * z;
    const h = H * fitScale() * z;
    const sw = stage.clientWidth;
    const sh = stage.clientHeight;
    ox = w <= sw ? (sw - w) / 2 : Math.min(0, Math.max(sw - w, ox));
    oy = h <= sh ? (sh - h) / 2 : Math.min(0, Math.max(sh - h, oy));
  };
  const zoomAt = (nz, mx, my) => {
    nz = Math.max(1, Math.min(ZMAX, nz));
    ox = mx - ((mx - ox) * nz) / z;
    oy = my - ((my - oy) * nz) / z;
    z = nz;
    clamp();
    layout();
  };
  const fit = () => { z = 1; clamp(); layout(); };
  fit();
  const ro = new ResizeObserver(() => { clamp(); layout(); });
  ro.observe(stage);
  const stagePt = (e) => { const r = stage.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [mx, my] = stagePt(e);
    zoomAt(z * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)), mx, my);
  }, { passive: false });
  box.querySelector('.annot-zoom').addEventListener('click', (e) => {
    const b = e.target.closest('[data-z]');
    if (!b) return;
    if (b.dataset.z === 'fit') { fit(); return; }
    zoomAt(b.dataset.z === 'in' ? z * 1.5 : z / 1.5, stage.clientWidth / 2, stage.clientHeight / 2);
  });

  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    const y = ((e.clientY - r.top) / r.height) * H;
    return [Math.max(0, Math.min(W, x)), Math.max(0, Math.min(H, y))];
  };
  // 直線: Shift で 45° 刻みに
  const snap = (d, e) => {
    if (d.type !== 'line' || !e.shiftKey) return;
    const dx = d.x1 - d.x0;
    const dy = d.y1 - d.y0;
    const len = Math.hypot(dx, dy);
    const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    d.x1 = d.x0 + Math.cos(a) * len;
    d.y1 = d.y0 + Math.sin(a) * len;
  };
  const pointers = new Map(); // 触れている指（2 本でピンチ）
  let pan = null; // { x, y, ox, oy }
  let pinch = null; // { d, z, cx, cy }
  let spaceDown = false;
  const pinchInfo = () => {
    const [a, b] = [...pointers.values()];
    const r = stage.getBoundingClientRect();
    return { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2 - r.left, cy: (a.y + b.y) / 2 - r.top };
  };
  stage.addEventListener('contextmenu', (e) => e.preventDefault());
  stage.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.annot-zoom')) return;
    e.preventDefault();
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) { // 2 本目の指: 描きかけをやめてピンチへ
      draft = null;
      redraw();
      const p = pinchInfo();
      pinch = { d: p.d, z, cx: p.cx, cy: p.cy, ox, oy };
      pan = null;
      return;
    }
    if (pointers.size > 2) return;
    const panning = tool === 'pan' || spaceDown || e.button === 1 || e.button === 2;
    if (panning) { pan = { x: e.clientX, y: e.clientY, ox, oy }; stage.classList.add('is-panning'); return; }
    if (e.button !== 0 || e.target !== canvas) return;
    const [x, y] = pos(e);
    draft = tool === 'pen' ? { layer, type: 'pen', color, pts: [[x, y]] } : { layer, type: tool, color, x0: x, y0: y, x1: x, y1: y };
  });
  stage.addEventListener('pointermove', (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) {
      const p = pinchInfo();
      const nz = Math.max(1, Math.min(ZMAX, pinch.z * (p.d / pinch.d)));
      // 2 本の指の中点の下にある点が、指と一緒に動くように
      ox = p.cx - ((pinch.cx - pinch.ox) * nz) / pinch.z;
      oy = p.cy - ((pinch.cy - pinch.oy) * nz) / pinch.z;
      z = nz;
      clamp();
      layout();
      return;
    }
    if (pan) {
      ox = pan.ox + e.clientX - pan.x;
      oy = pan.oy + e.clientY - pan.y;
      clamp();
      layout();
      return;
    }
    if (!draft) return;
    const [x, y] = pos(e);
    if (draft.type === 'pen') draft.pts.push([x, y]); else { draft.x1 = x; draft.y1 = y; snap(draft, e); }
    redraw();
  });
  const release = (e) => {
    pointers.delete(e.pointerId);
    if (pinch) { if (pointers.size < 2) pinch = null; return; }
    if (pan) { pan = null; stage.classList.remove('is-panning'); return; }
    finish();
  };
  const finish = () => {
    if (!draft) return;
    if (draft.type === 'crop') {
      const c = normRect(draft);
      if (c.w > 8 && c.h > 8) { history.push({ kind: 'crop', prev: crop }); crop = c; }
    } else {
      const big = draft.type === 'pen' ? draft.pts.length > 1 : Math.hypot(draft.x1 - draft.x0, draft.y1 - draft.y0) > lw * 2;
      if (big) { shapes.push(draft); history.push({ kind: 'shape' }); }
    }
    draft = null;
    redraw();
    updateUI();
  };
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);

  const undo = () => {
    const h = history.pop();
    if (!h) return;
    if (h.kind === 'shape') shapes.pop();
    else if (h.kind === 'crop') crop = h.prev;
    else if (h.kind === 'clear') { shapes.push(...h.removed); backCleared = h.prevBackCleared; }
    redraw();
    updateUI();
  };
  const close = (result) => {
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('keyup', onKeyUp, true);
    ro.disconnect();
    box.remove();
    resolve(result);
  };
  const onKeyUp = (e) => { if (e.code === 'Space') { spaceDown = false; stage.classList.remove('is-space'); } };
  const onKey = (e) => {
    if (e.code === 'Space') { e.preventDefault(); e.stopPropagation(); spaceDown = true; stage.classList.add('is-space'); return; }
    if (!e.ctrlKey && !e.metaKey && (e.key === '+' || e.key === ';')) { e.preventDefault(); zoomAt(z * 1.5, stage.clientWidth / 2, stage.clientHeight / 2); return; }
    if (!e.ctrlKey && !e.metaKey && e.key === '-') { e.preventDefault(); zoomAt(z / 1.5, stage.clientWidth / 2, stage.clientHeight / 2); return; }
    if (!e.ctrlKey && !e.metaKey && e.key === '0') { e.preventDefault(); fit(); return; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); }
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); e.stopPropagation(); undo(); }
  };
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('keyup', onKeyUp, true);
  box.querySelectorAll('[data-layer]').forEach((b) => b.addEventListener('click', () => {
    layer = b.dataset.layer;
    if (tool === 'crop') tool = 'ellipse';
    redraw();
    updateUI();
  }));
  box.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => { tool = b.dataset.tool; updateUI(); }));
  box.querySelectorAll('[data-color]').forEach((b) => b.addEventListener('click', () => {
    color = b.dataset.color;
    box.querySelectorAll('[data-color]').forEach((x) => x.classList.toggle('on', x === b));
  }));
  box.querySelector('[data-act="undo"]').addEventListener('click', undo);
  // 消す: 今のレイヤーの書き込み（「裏面だけ」なら前から保存されていた分も）
  box.querySelector('[data-act="clear"]').addEventListener('click', () => {
    const removed = shapes.filter((s) => s.layer === layer);
    const clearsBack = layer === 'back' && backImage && !backCleared;
    if (!removed.length && !clearsBack) return;
    history.push({ kind: 'clear', removed, prevBackCleared: backCleared });
    for (let i = shapes.length - 1; i >= 0; i--) if (shapes[i].layer === layer) shapes.splice(i, 1);
    if (clearsBack) backCleared = true;
    redraw();
    updateUI();
  });
  box.querySelector('[data-act="uncrop"]').addEventListener('click', () => { history.push({ kind: 'crop', prev: crop }); crop = null; redraw(); updateUI(); });
  box.querySelector('[data-act="cancel"]').addEventListener('click', () => close(null));
  const doneBtn = box.querySelector('[data-act="done"]');
  doneBtn.addEventListener('click', async () => {
    const front = shapes.filter((s) => s.layer === 'front');
    const back = shapes.filter((s) => s.layer === 'back');
    const c = crop ? { x: Math.round(crop.x), y: Math.round(crop.y), w: Math.round(crop.w), h: Math.round(crop.h) } : { x: 0, y: 0, w: W, h: H };
    if (!front.length && !back.length && !crop && !backCleared) { close({ image: null, back: null }); return; }
    doneBtn.disabled = true;
    doneBtn.textContent = '書き出し中…';
    try {
      const out = (fn) => {
        const cv = document.createElement('canvas');
        cv.width = c.w;
        cv.height = c.h;
        const ctx = cv.getContext('2d');
        ctx.translate(-c.x, -c.y);
        fn(ctx);
        return cv;
      };
      let imageBlob = null;
      if (front.length || crop) {
        imageBlob = await toBlob(out((ctx) => { ctx.drawImage(image, 0, 0); for (const s of front) drawShape(ctx, s); }));
      }
      let backOut = null;
      const keepOld = backImage && !backCleared;
      if (back.length || (crop && keepOld)) {
        backOut = await toBlob(out((ctx) => { if (keepOld) ctx.drawImage(backImage, 0, 0, W, H); for (const s of back) drawShape(ctx, s); }));
      } else if (backCleared) backOut = 'clear';
      close({ image: imageBlob, back: backOut });
    } catch (ex) {
      doneBtn.disabled = false;
      doneBtn.textContent = '完了';
      hint.textContent = `書き出せませんでした: ${ex.message}`;
      hint.classList.add('is-error');
    }
  });
}
