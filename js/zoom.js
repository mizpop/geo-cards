// 画像の拡大・縮小・移動（ホイール / ピンチ / ドラッグ / ボタン）
// container は position:relative、中の img は inset:0 + object-fit:contain で配置されている前提。

const MIN = 1;
const MAX = 10;
const STEP = 1.5;

/**
 * @param {HTMLElement} container
 * @param {{ onTap?: () => void, dblclick?: boolean, fullscreen?: boolean, ctrls?: boolean }} opts
 */
export function attachZoom(container, opts = {}) {
  if (!container) return null;
  const img = container.querySelector('img');
  if (!img) return null;
  const { onTap, onSwipe, dblclick = true, fullscreen = true, ctrls = true } = opts;

  let scale = 1;
  let tx = 0;
  let ty = 0;
  container.classList.add('zoomable');
  img.draggable = false;

  if (ctrls) {
    const bar = document.createElement('div');
    bar.className = 'zoom-ctrls';
    bar.innerHTML = `
      <button type="button" data-z="in" title="拡大" aria-label="拡大">＋</button>
      <button type="button" data-z="out" title="縮小" aria-label="縮小">−</button>
      <button type="button" data-z="reset" title="元のサイズ" aria-label="元のサイズ">⟲</button>
      ${fullscreen ? '<button type="button" data-z="full" title="全画面で見る" aria-label="全画面で見る">⛶</button>' : ''}`;
    container.appendChild(bar);
    bar.addEventListener('pointerdown', (e) => e.stopPropagation());
    bar.addEventListener('click', (e) => {
      e.stopPropagation();
      const b = e.target.closest('button');
      if (!b) return;
      const { width, height } = container.getBoundingClientRect();
      if (b.dataset.z === 'in') zoomAt(scale * STEP, width / 2, height / 2);
      else if (b.dataset.z === 'out') zoomAt(scale / STEP, width / 2, height / 2);
      else if (b.dataset.z === 'reset') reset();
      else if (b.dataset.z === 'full') openViewer(img.src);
    });
  }

  const apply = () => {
    // 重ねて表示している画像（裏面だけの書き込みのレイヤー）も一緒に動かす
    for (const x of container.querySelectorAll('img')) x.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    container.classList.toggle('is-zoomed', scale > 1.001);
  };

  // 表示中の画像（余白を除いた部分）がはみ出しすぎないように位置を補正
  function clampPan() {
    const W = container.clientWidth;
    const H = container.clientHeight;
    const iw = img.naturalWidth || W;
    const ih = img.naturalHeight || H;
    const r = Math.min(W / iw, H / ih);
    const dw = iw * r;
    const dh = ih * r;
    const ox = (W - dw) / 2;
    const oy = (H - dh) / 2;
    if (dw * scale <= W) tx = (W - dw * scale) / 2 - ox * scale;
    else tx = Math.min(-ox * scale, Math.max(W - (ox + dw) * scale, tx));
    if (dh * scale <= H) ty = (H - dh * scale) / 2 - oy * scale;
    else ty = Math.min(-oy * scale, Math.max(H - (oy + dh) * scale, ty));
  }

  function zoomAt(next, cx, cy) {
    next = Math.min(MAX, Math.max(MIN, next));
    const k = next / scale;
    tx = cx - (cx - tx) * k;
    ty = cy - (cy - ty) * k;
    scale = next;
    clampPan();
    apply();
  }

  function reset() {
    scale = 1;
    tx = 0;
    ty = 0;
    apply();
  }

  const local = (e) => {
    const rect = container.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  container.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = local(e);
    zoomAt(scale * Math.exp(-e.deltaY * 0.0015), p.x, p.y);
  }, { passive: false });

  if (dblclick) {
    container.addEventListener('dblclick', (e) => {
      if (e.target.closest('.zoom-ctrls')) return;
      const p = local(e);
      if (scale > 1.001) reset();
      else zoomAt(2.5, p.x, p.y);
    });
  }

  // ドラッグ（1本指 / マウス）とピンチ（2本指）
  const pointers = new Map();
  let moved = false;
  let startDist = 0;
  let startScale = 1;
  let last = null;
  let start = null;

  container.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button > 0) return;
    container.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, local(e));
    if (pointers.size === 1) { moved = false; last = local(e); start = { ...last, scale, t: Date.now() }; }
    if (pointers.size === 2) start = null; // ピンチはスワイプ扱いしない
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      startDist = Math.hypot(a.x - b.x, a.y - b.y);
      startScale = scale;
      moved = true;
    }
  });

  container.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const p = local(e);
    pointers.set(e.pointerId, p);
    if (pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (startDist > 0) zoomAt(startScale * (dist / startDist), (a.x + b.x) / 2, (a.y + b.y) / 2);
      return;
    }
    const dx = p.x - last.x;
    const dy = p.y - last.y;
    if (Math.abs(dx) + Math.abs(dy) > 0) {
      if (!moved && Math.hypot(dx, dy) < 4) return; // 小さなブレはタップ扱い
      moved = true;
      if (scale > 1.001) {
        tx += dx;
        ty += dy;
        clampPan();
        apply();
        container.classList.add('is-dragging');
      }
      last = p;
    }
  });

  const end = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    container.classList.remove('is-dragging');
    if (pointers.size === 1) { last = [...pointers.values()][0]; return; }
    if (pointers.size !== 0 || e.type !== 'pointerup') return;
    if (!moved && scale <= 1.001 && onTap) { onTap(); return; }
    // 等倍のときの素早い横スワイプ（スマホで前後のカードへ）
    if (onSwipe && start && start.scale <= 1.001 && scale <= 1.001) {
      const p = local(e);
      const dx = p.x - start.x;
      const dy = p.y - start.y;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - start.t < 700) onSwipe(dx < 0 ? 1 : -1);
    }
  };
  container.addEventListener('pointerup', end);
  container.addEventListener('pointercancel', end);

  if ('ResizeObserver' in window) new ResizeObserver(() => { clampPan(); apply(); }).observe(container);
  if (!img.complete) img.addEventListener('load', () => { clampPan(); apply(); }, { once: true });

  return {
    reset,
    zoomIn: () => zoomAt(scale * STEP, container.clientWidth / 2, container.clientHeight / 2),
    zoomOut: () => zoomAt(scale / STEP, container.clientWidth / 2, container.clientHeight / 2),
  };
}

// 全画面ビューア
let viewer;
export function openViewer(src) {
  if (!viewer) {
    viewer = document.createElement('dialog');
    viewer.className = 'viewer';
    document.body.appendChild(viewer);
    viewer.addEventListener('close', () => { viewer.innerHTML = ''; });
  }
  viewer.innerHTML = `
    <div class="viewer-stage"><img src="${src.replace(/"/g, '&quot;')}" alt="拡大画像"></div>
    <button type="button" class="viewer-close" aria-label="閉じる">✕</button>
    <p class="viewer-hint">ホイール / ピンチで拡大・ドラッグで移動・ダブルクリックで拡大／元に戻す・Esc で閉じる</p>`;
  viewer.querySelector('.viewer-close').addEventListener('click', () => viewer.close());
  const z = attachZoom(viewer.querySelector('.viewer-stage'), { fullscreen: false });
  viewer.onkeydown = (e) => {
    if (e.key === '+' || e.key === '=') z.zoomIn();
    else if (e.key === '-') z.zoomOut();
    else if (e.key === '0') z.reset();
  };
  viewer.showModal();
  window.dispatchEvent(new Event('geo:dialog')); // メモのボタンを手前に
}
