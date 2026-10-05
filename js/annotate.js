// 画像の編集: トリミングと書き込み（丸・矢印・直線・四角・ペン）。書いた図形は選んで動かす・大きさを変える・色や太さを変える・消すができる
// 書き込みは 2 つのレイヤー: 「表面」は画像に焼き込み、「裏面だけ」は別の透明な画像として保存し、
// カードを裏返したとき（答えを見たとき）だけ画像に重ねて表示する（どこがヒントだったか分かるように）
// 戻り値: キャンセルなら null。完了なら { image, back }
//   image: 新しい画像（Blob）。変更なしなら null
//   back : 裏面だけのレイヤー（透明な PNG の Blob）。変更なしなら null、消したなら 'clear'
const COLORS = [['#ff3b30', '赤'], ['#ffd60a', '黄'], ['#ffffff', '白'], ['#0a84ff', '青'], ['#000000', '黒']];
// ツールはアイコンだけ（名前は title / aria-label で）
const svg = (inner) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const TOOLS = [
  ['select', '図形を選ぶ（動かす・大きさ・色・太さを変える）', svg('<path d="M5 3l14 8-6 2-3 6z"/>')],
  ['pan', '画像を動かす（スペース+ドラッグ・右ドラッグでも）', svg('<path d="M12 2v20M2 12h20M12 2l-3 3M12 2l3 3M12 22l-3-3M12 22l3-3M2 12l3-3M2 12l3 3M22 12l-3-3M22 12l-3 3"/>')],
  ['crop', 'トリミング', svg('<path d="M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14"/>')],
  ['ellipse', '丸', svg('<ellipse cx="12" cy="12" rx="9" ry="6.5"/>')],
  ['arrow', '矢印', svg('<path d="M5 19L19 5M9 5h10v10"/>')],
  ['line', '直線（Shift で水平・垂直・45°）', svg('<path d="M5 19L19 5"/>')],
  ['rect', '四角', svg('<rect x="3.5" y="6" width="17" height="12" rx="1"/>')],
  ['pen', 'ペン', svg('<path d="M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>')],
];
const TRASH = svg('<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6"/>');
const DRAW_TOOLS = new Set(['ellipse', 'arrow', 'line', 'rect', 'pen']);
const LV_DEFAULT = 3;
const LV_MAX = 10;
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

export async function editImage(src, { backSrc = '', host = document.body, tool: initTool = '', crop: initCrop = null } = {}) {
  const image = await loadImage(src);
  if (!image) throw new Error('画像を読み込めませんでした');
  const backImage = backSrc ? await loadImage(backSrc) : null;
  return new Promise((resolve) => start(image, backImage, host, resolve, { tool: initTool, crop: initCrop }));
}

function start(image, backImage, host, resolve, initial = {}) {
  const W = image.naturalWidth;
  const H = image.naturalHeight;
  const lw = Math.max(3, Math.round(Math.max(W, H) / 220)); // 線の太さは画像の大きさに合わせる
  const shapes = []; // { layer: 'front' | 'back', type, color, ... }
  const history = []; // 戻す用: { kind: 'shape' } / { kind: 'crop', prev } / { kind: 'clearBack', prev }
  let crop = initial.crop || null; // { x, y, w, h }（画像の座標）。最初から範囲を決めておくこともできる
  let backCleared = false; // 前からある「裏面だけ」のレイヤーを消した
  let tool = initial.tool || 'ellipse';
  let layer = 'front';
  let color = COLORS[0][0];
  let level = LV_DEFAULT; // 線の太さ（1〜10。3 が標準）
  let draft = null;
  let selected = null; // 選んでいる図形（図形を選ぶツールのとき、ハンドルで調整できる）
  let lastDrawn = null; // 最後に描いた図形（「図形を選ぶ」に切り替えたとき最初から選ぶ）
  let edit = null; // 図形の移動・大きさ変更中: { shape, mode, start, orig, before }
  let widthBefore = null; // 太さのスライダーを動かし始める前の図形（戻す用）

  const box = document.createElement('div');
  box.className = 'annot';
  box.innerHTML = `
    <div class="annot-bar">
      <div class="seg annot-layer" role="group" aria-label="書き込む先">
        <button type="button" data-layer="front" class="on" title="画像そのものに書き込みます（表面にも見えます）">🖼 表面に書き込む</button>
        <button type="button" data-layer="back" title="カードを裏返したときだけ画像に重ねて表示します（どこがヒントだったかの印に）">🔁 裏面だけに表示</button>
      </div>
      <div class="seg annot-tools seg-icons">${TOOLS.map(([id, label, icon]) => `<button type="button" data-tool="${id}" class="${id === tool ? 'on' : ''}" title="${label}" aria-label="${label}">${icon}</button>`).join('')}</div>
      <label class="annot-width" title="線の太さ（図形を選んでいるときは、その図形の太さ）">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16" stroke-width="1.5"/><path d="M4 12h16" stroke-width="3"/><path d="M4 19h16" stroke-width="5"/></svg>
        <input type="range" min="1" max="${LV_MAX}" step="1" value="${level}" aria-label="線の太さ">
      </label>
      <div class="annot-colors">${COLORS.map(([c, n]) => `<button type="button" class="annot-color ${c === color ? 'on' : ''}" data-color="${c}" style="--c:${c}" title="${n}" aria-label="${n}"></button>`).join('')}</div>
      <button type="button" class="btn btn-sm btn-icon" data-act="del" title="選んでいる図形を消す（Delete キー）" aria-label="選んでいる図形を消す" hidden>${TRASH}</button>
      <button type="button" class="btn btn-sm" data-act="undo" title="ひとつ戻す（Ctrl+Z）">↶ 戻す</button>
      <button type="button" class="btn btn-sm btn-ghost" data-act="clear" title="今のレイヤーの書き込みをすべて消す">すべて消す</button>
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

  const widthOf = (s) => Math.max(1.5, (lw * (s.lv || LV_DEFAULT)) / LV_DEFAULT);
  const drawShape = (ctx, s) => {
    const w = widthOf(s);
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // 暗い背景でも見えるように、細い影をつける
    ctx.shadowColor = s.color === '#000000' ? 'rgba(255,255,255,.7)' : 'rgba(0,0,0,.6)';
    ctx.shadowBlur = Math.min(w, lw * 1.5);
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
      const head = Math.max(w * 4.5, lw * 3);
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

  // ---- 図形の選択・移動・大きさ変更 -------------------------------------------------
  const scaleNow = () => (canvas.getBoundingClientRect().width || W) / W; // 画面の 1px が画像の何 px か（の逆数）
  const clone = (s) => JSON.parse(JSON.stringify(s));
  const bboxOf = (s) => {
    if (s.type === 'pen') {
      const xs = s.pts.map((p) => p[0]);
      const ys = s.pts.map((p) => p[1]);
      return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
    }
    return { x0: Math.min(s.x0, s.x1), y0: Math.min(s.y0, s.y1), x1: Math.max(s.x0, s.x1), y1: Math.max(s.y0, s.y1) };
  };
  // ハンドル: 直線・矢印は両端（a, b）、四角・丸・ペンは外接する四角の四隅（nw, ne, sw, se）
  const handlesOf = (s) => {
    if (s.type === 'line' || s.type === 'arrow') return [['a', s.x0, s.y0], ['b', s.x1, s.y1]];
    const b = bboxOf(s);
    return [['nw', b.x0, b.y0], ['ne', b.x1, b.y0], ['sw', b.x0, b.y1], ['se', b.x1, b.y1]];
  };
  const drawHandles = (s) => {
    const k = 1 / scaleNow(); // 画面上で一定の大きさになるように
    if (s.type !== 'line' && s.type !== 'arrow') {
      const b = bboxOf(s);
      g.save();
      g.setLineDash([6 * k, 4 * k]);
      g.strokeStyle = '#fff';
      g.lineWidth = 1.5 * k;
      g.shadowColor = 'rgba(0,0,0,.8)';
      g.shadowBlur = 2 * k;
      g.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
      g.restore();
    }
    for (const [, x, y] of handlesOf(s)) {
      g.save();
      g.fillStyle = '#fff';
      g.strokeStyle = '#1c7ed6';
      g.lineWidth = 2 * k;
      g.beginPath();
      g.rect(x - 6 * k, y - 6 * k, 12 * k, 12 * k);
      g.fill();
      g.stroke();
      g.restore();
    }
  };
  const distSeg = (px, py, x0, y0, x1, y1) => {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / l2)) : 0;
    return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
  };
  const hitShape = (s, x, y) => {
    const tol = Math.max(widthOf(s) / 2, 9 / scaleNow());
    if (s.type === 'line' || s.type === 'arrow') return distSeg(x, y, s.x0, s.y0, s.x1, s.y1) <= tol;
    if (s.type === 'pen') {
      for (let i = 1; i < s.pts.length; i++) if (distSeg(x, y, s.pts[i - 1][0], s.pts[i - 1][1], s.pts[i][0], s.pts[i][1]) <= tol) return true;
      return s.pts.length === 1 && Math.hypot(x - s.pts[0][0], y - s.pts[0][1]) <= tol;
    }
    const b = bboxOf(s);
    if (s.type === 'rect') {
      const inside = x >= b.x0 - tol && x <= b.x1 + tol && y >= b.y0 - tol && y <= b.y1 + tol;
      const innerOnly = x > b.x0 + tol && x < b.x1 - tol && y > b.y0 + tol && y < b.y1 - tol;
      return inside && !innerOnly;
    }
    // 丸: 楕円の輪郭からの距離（おおよそ）
    const rx = Math.max(1, (b.x1 - b.x0) / 2);
    const ry = Math.max(1, (b.y1 - b.y0) / 2);
    const q = Math.hypot((x - (b.x0 + b.x1) / 2) / rx, (y - (b.y0 + b.y1) / 2) / ry);
    return Math.abs(q - 1) * Math.min(rx, ry) <= tol;
  };
  const hitHandle = (s, x, y) => {
    const tol = 12 / scaleNow();
    return handlesOf(s).find(([, hx, hy]) => Math.hypot(x - hx, y - hy) <= tol)?.[0] || null;
  };
  // 一番手前（あとから描いた）の図形から探す。今のレイヤーの図形だけ
  const pickShape = (x, y) => [...shapes].reverse().find((s) => s.layer === layer && hitShape(s, x, y)) || null;
  const select = (s) => { selected = s; syncControls(); };
  // 選んでいる図形の値をスライダー・色に映す
  const syncControls = () => {
    const lv = selected ? selected.lv || LV_DEFAULT : level;
    const col = selected ? selected.color : color;
    box.querySelector('.annot-width input').value = String(lv);
    box.querySelectorAll('[data-color]').forEach((x) => x.classList.toggle('on', x.dataset.color === col));
    box.querySelector('[data-act="del"]').hidden = !selected;
  };
  const applyEdit = (mode, s, o, [x, y], [sx, sy], shift) => {
    const dx = x - sx;
    const dy = y - sy;
    if (mode === 'move') {
      if (s.type === 'pen') s.pts = o.pts.map(([px, py]) => [px + dx, py + dy]);
      else { s.x0 = o.x0 + dx; s.y0 = o.y0 + dy; s.x1 = o.x1 + dx; s.y1 = o.y1 + dy; }
      return;
    }
    if (s.type === 'line' || s.type === 'arrow') {
      const [fx, fy] = mode === 'a' ? [o.x1, o.y1] : [o.x0, o.y0]; // 動かさない側の端
      let [nx, ny] = [x, y];
      if (shift && s.type === 'line') [nx, ny] = snapEnd(fx, fy, nx, ny);
      if (mode === 'a') { s.x0 = nx; s.y0 = ny; } else { s.x1 = nx; s.y1 = ny; }
      return;
    }
    // 四隅: 反対側の隅を固定して外接する四角を作り直す
    const ob = o.bbox;
    const fx = mode.endsWith('w') ? ob.x1 : ob.x0;
    const fy = mode.startsWith('n') ? ob.y1 : ob.y0;
    const nb = { x0: Math.min(fx, x), y0: Math.min(fy, y), x1: Math.max(fx, x), y1: Math.max(fy, y) };
    if (nb.x1 - nb.x0 < 4) nb.x1 = nb.x0 + 4;
    if (nb.y1 - nb.y0 < 4) nb.y1 = nb.y0 + 4;
    if (s.type === 'pen') {
      const sxr = (nb.x1 - nb.x0) / Math.max(1e-6, ob.x1 - ob.x0);
      const syr = (nb.y1 - nb.y0) / Math.max(1e-6, ob.y1 - ob.y0);
      s.pts = o.pts.map(([px, py]) => [nb.x0 + (px - ob.x0) * sxr, nb.y0 + (py - ob.y0) * syr]);
    } else { s.x0 = nb.x0; s.y0 = nb.y0; s.x1 = nb.x1; s.y1 = nb.y1; }
  };

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
    if (selected && shapes.includes(selected)) drawHandles(selected);
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
    stage.classList.toggle('is-select', tool === 'select');
    hint.textContent = tool === 'select'
      ? '図形をクリックして選びます。ドラッグで動かし、四角い取っ手で大きさを変えます。色・太さもそのまま変更でき、Delete で消せます'
      : tool === 'pan'
      ? 'ドラッグで画像を動かします。ホイール / ピンチで拡大・縮小（どのツールでも、スペースキーを押しながら / 右ドラッグで移動できます）'
      : tool === 'crop'
      ? 'ドラッグして残す範囲を選びます（もう一度ドラッグで選び直し）'
      : tool === 'line'
      ? 'ドラッグで直線を引きます。Shift を押しながらで水平・垂直・45° に揃えます（描いたあとは ↖ の「図形を選ぶ」で調整できます）'
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
  // 直線: Shift で 45° 刻みに（固定した端 fx,fy から見て）
  const snapEnd = (fx, fy, x, y) => {
    const len = Math.hypot(x - fx, y - fy);
    const a = Math.round(Math.atan2(y - fy, x - fx) / (Math.PI / 4)) * (Math.PI / 4);
    return [fx + Math.cos(a) * len, fy + Math.sin(a) * len];
  };
  const snap = (d, e) => {
    if (d.type !== 'line' || !e.shiftKey) return;
    [d.x1, d.y1] = snapEnd(d.x0, d.y0, d.x1, d.y1);
  };
  const cursorFor = (e) => {
    if (tool !== 'select' && !selected) return '';
    const [x, y] = pos(e);
    if (selected && shapes.includes(selected)) {
      const h = hitHandle(selected, x, y);
      if (h) return { a: 'move', b: 'move', nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize' }[h];
    }
    return tool === 'select' && pickShape(x, y) ? 'move' : '';
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
    if (pointers.size === 2) { // 2 本目の指: 描きかけ・調整をやめてピンチへ
      if (edit) { Object.assign(edit.shape, edit.before); edit = null; }
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
    // 選んでいる図形のハンドル、または「図形を選ぶ」ツールで図形の上: 調整
    const grab = (s, mode) => {
      edit = { shape: s, mode, start: [x, y], orig: { ...clone(s), bbox: s.type === 'line' || s.type === 'arrow' ? null : bboxOf(s) }, before: clone(s) };
    };
    if (selected && shapes.includes(selected) && selected.layer === layer) {
      const h = hitHandle(selected, x, y);
      if (h) { grab(selected, h); return; }
    }
    if (tool === 'select') {
      const hit = pickShape(x, y);
      select(hit);
      if (hit) grab(hit, 'move');
      redraw();
      return;
    }
    if (selected) select(null);
    draft = tool === 'pen' ? { layer, type: 'pen', color, lv: level, pts: [[x, y]] } : { layer, type: tool, color, lv: level, x0: x, y0: y, x1: x, y1: y };
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
    if (edit) {
      applyEdit(edit.mode, edit.shape, edit.orig, pos(e), edit.start, e.shiftKey);
      redraw();
      return;
    }
    if (!draft) {
      if (!pointers.size || e.pointerType === 'mouse') canvas.style.cursor = cursorFor(e);
      return;
    }
    const [x, y] = pos(e);
    if (draft.type === 'pen') draft.pts.push([x, y]); else { draft.x1 = x; draft.y1 = y; snap(draft, e); }
    redraw();
  });
  const release = (e) => {
    pointers.delete(e.pointerId);
    if (pinch) { if (pointers.size < 2) pinch = null; return; }
    if (pan) { pan = null; stage.classList.remove('is-panning'); return; }
    if (edit) { // 動かした・大きさを変えたら、戻せるように記録
      if (JSON.stringify(edit.before) !== JSON.stringify(edit.shape)) history.push({ kind: 'edit', shape: edit.shape, before: edit.before });
      edit = null;
      redraw();
      return;
    }
    finish();
  };
  const finish = () => {
    if (!draft) return;
    if (draft.type === 'crop') {
      const c = normRect(draft);
      if (c.w > 8 && c.h > 8) { history.push({ kind: 'crop', prev: crop }); crop = c; }
    } else {
      const big = draft.type === 'pen' ? draft.pts.length > 1 : Math.hypot(draft.x1 - draft.x0, draft.y1 - draft.y0) > lw * 2;
      if (big) { shapes.push(draft); history.push({ kind: 'add', shape: draft }); lastDrawn = draft; }
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
    if (h.kind === 'add') { const i = shapes.indexOf(h.shape); if (i >= 0) shapes.splice(i, 1); if (selected === h.shape) selected = null; if (lastDrawn === h.shape) lastDrawn = null; }
    else if (h.kind === 'edit') Object.assign(h.shape, h.before);
    else if (h.kind === 'del') shapes.splice(Math.min(h.index, shapes.length), 0, h.shape);
    else if (h.kind === 'crop') crop = h.prev;
    else if (h.kind === 'clear') { shapes.push(...h.removed); backCleared = h.prevBackCleared; }
    redraw();
    syncControls();
    updateUI();
  };
  const close = (result) => {
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('keyup', onKeyUp, true);
    ro.disconnect();
    box.remove();
    resolve(result);
  };
  const deleteSelected = () => {
    if (!selected) return;
    const i = shapes.indexOf(selected);
    if (i < 0) return;
    history.push({ kind: 'del', shape: selected, index: i });
    shapes.splice(i, 1);
    if (lastDrawn === selected) lastDrawn = null;
    select(null);
    redraw();
    updateUI();
  };
  const onKeyUp = (e) => { if (e.code === 'Space') { spaceDown = false; stage.classList.remove('is-space'); } };
  const onKey = (e) => {
    if (e.code === 'Space') { e.preventDefault(); e.stopPropagation(); spaceDown = true; stage.classList.add('is-space'); return; }
    if (!e.ctrlKey && !e.metaKey && (e.key === '+' || e.key === ';')) { e.preventDefault(); zoomAt(z * 1.5, stage.clientWidth / 2, stage.clientHeight / 2); return; }
    if (!e.ctrlKey && !e.metaKey && e.key === '-') { e.preventDefault(); zoomAt(z / 1.5, stage.clientWidth / 2, stage.clientHeight / 2); return; }
    if (!e.ctrlKey && !e.metaKey && e.key === '0') { e.preventDefault(); fit(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected) { e.preventDefault(); e.stopPropagation(); deleteSelected(); return; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (selected) { select(null); redraw(); } else close(null); }
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); e.stopPropagation(); undo(); }
  };
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('keyup', onKeyUp, true);
  box.querySelectorAll('[data-layer]').forEach((b) => b.addEventListener('click', () => {
    layer = b.dataset.layer;
    if (tool === 'crop') tool = 'ellipse';
    if (selected && selected.layer !== layer) select(null);
    redraw();
    updateUI();
  }));
  box.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => {
    tool = b.dataset.tool;
    if (tool === 'select' && !selected && lastDrawn && shapes.includes(lastDrawn) && lastDrawn.layer === layer) select(lastDrawn); // 描いたばかりの図形をすぐ調整できるように
    else if (tool !== 'select' && selected) select(null);
    canvas.style.cursor = '';
    redraw();
    updateUI();
  }));
  box.querySelectorAll('[data-color]').forEach((b) => b.addEventListener('click', () => {
    if (selected) { // 選んでいる図形の色を変える
      if (selected.color !== b.dataset.color) { history.push({ kind: 'edit', shape: selected, before: clone(selected) }); selected.color = b.dataset.color; redraw(); }
    } else color = b.dataset.color;
    syncControls();
  }));
  // 線の太さ: 選んでいる図形があればその図形、なければこれから描く線
  const wInput = box.querySelector('.annot-width input');
  wInput.addEventListener('input', () => {
    const v = Number(wInput.value);
    if (selected) {
      if (!widthBefore) widthBefore = clone(selected);
      selected.lv = v;
      redraw();
    } else level = v;
  });
  wInput.addEventListener('change', () => {
    if (selected && widthBefore) { if (widthBefore.lv !== selected.lv) history.push({ kind: 'edit', shape: selected, before: widthBefore }); }
    widthBefore = null;
  });
  box.querySelector('[data-act="del"]').addEventListener('click', deleteSelected);
  box.querySelector('[data-act="undo"]').addEventListener('click', undo);
  // 消す: 今のレイヤーの書き込み（「裏面だけ」なら前から保存されていた分も）
  box.querySelector('[data-act="clear"]').addEventListener('click', () => {
    const removed = shapes.filter((s) => s.layer === layer);
    const clearsBack = layer === 'back' && backImage && !backCleared;
    if (!removed.length && !clearsBack) return;
    history.push({ kind: 'clear', removed, prevBackCleared: backCleared });
    for (let i = shapes.length - 1; i >= 0; i--) if (shapes[i].layer === layer) shapes.splice(i, 1);
    if (selected && selected.layer === layer) select(null);
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
