// 画像の編集: トリミングと書き込み（丸・矢印・四角・ペン）
// 書き込みは 2 つのレイヤー: 「表面」は画像に焼き込み、「裏面だけ」は別の透明な画像として保存し、
// カードを裏返したとき（答えを見たとき）だけ画像に重ねて表示する（どこがヒントだったか分かるように）
// 戻り値: キャンセルなら null。完了なら { image, back }
//   image: 新しい画像（Blob）。変更なしなら null
//   back : 裏面だけのレイヤー（透明な PNG の Blob）。変更なしなら null、消したなら 'clear'
const COLORS = [['#ff3b30', '赤'], ['#ffd60a', '黄'], ['#ffffff', '白'], ['#0a84ff', '青'], ['#000000', '黒']];
const TOOLS = [['crop', '✂ トリミング'], ['ellipse', '◯ 丸'], ['arrow', '➜ 矢印'], ['rect', '▢ 四角'], ['pen', '✎ ペン']];

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
    <div class="annot-stage"><canvas></canvas></div>
    <p class="annot-hint"></p>`;
  host.appendChild(box);
  const canvas = box.querySelector('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  const hint = box.querySelector('.annot-hint');

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
    hint.textContent = tool === 'crop'
      ? 'ドラッグして残す範囲を選びます（もう一度ドラッグで選び直し）'
      : layer === 'back'
        ? '「裏面だけ」: ここに描いた印は、カードを裏返したときだけ画像に重なって表示されます'
        : 'ドラッグして描きます。注目してほしいところに丸や矢印をつけましょう';
  };
  redraw();
  updateUI();

  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    const y = ((e.clientY - r.top) / r.height) * H;
    return [Math.max(0, Math.min(W, x)), Math.max(0, Math.min(H, y))];
  };
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    const [x, y] = pos(e);
    draft = tool === 'pen' ? { layer, type: 'pen', color, pts: [[x, y]] } : { layer, type: tool, color, x0: x, y0: y, x1: x, y1: y };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!draft) return;
    const [x, y] = pos(e);
    if (draft.type === 'pen') draft.pts.push([x, y]); else { draft.x1 = x; draft.y1 = y; }
    redraw();
  });
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
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);

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
    box.remove();
    resolve(result);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); }
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); e.stopPropagation(); undo(); }
  };
  document.addEventListener('keydown', onKey, true);
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
